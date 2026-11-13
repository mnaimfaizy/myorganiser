/**
 * The Vault Handle — the only supported way to reach a Local Vault.
 *
 * Vault access is obtained, not invoked: a caller acquires a handle bound to
 * one owner and one Master Key, and calls methods on it. Nothing exported here
 * hands back Vault data without an owner having been named first, which is the
 * property ADR 0047 exists to keep.
 *
 * Handles are not reusable across Users. When the owner changes, the old
 * handle is discarded and a new one is created.
 */
import { VaultBlobType, VaultMetaV1 } from '@myorganiser/app-api-client';

import {
  createLocalVaultAccess,
  type LocalVaultAccess,
} from './localVaultAccess';
import { type LocalVaultRevision } from './localVaultRevision';
import {
  assertVaultOwner,
  ownedLocalVaultSlot,
  type VaultRecordType,
} from './localVaultStorage';
import { disablePasskeyUnlock } from './passkeyUnlock';
import { createSyncBookmarkAccess } from './syncBookmarkAccess';
import { VAULT_BLOB_TYPE_BY_FIELD } from './vaultBlobFields';
import { createRecoveryKeyAcknowledgmentAccess } from './recoveryKeyAcknowledgment';
import {
  createVaultMetaRefusalAccess,
  type VaultMetaQuestion,
  type VaultMetaRefusalLifetime,
} from './vaultMetaRefusal';

export {
  VaultLockedError,
  VaultSecretMismatchError,
  VaultWriteContendedError,
} from './localVaultAccess';
// `NoUnclaimedLocalVaultError` and `LocalVaultAlreadyOwnedError` stay
// internal: `claimUnclaimedLocalVaultOnEvidence` reads `vaultStatus` before it
// claims and reports `skipped-nothing-to-claim` / `skipped-already-owned`
// rather than letting either throw, so reaching one is a programming error
// rather than a case the interface asks callers to handle.
export type { LocalVaultStatus } from './localVaultStorage';
export type { VaultMetaAdoptionWrite } from './localVaultAccess';

/**
 * Where a Vault Handle reports that one Vault Blob Type's Ciphertext changed.
 *
 * The sink lives on the handle rather than beside it. The handle is the only
 * supported way to reach a Local Vault (ADR 0047), and that guarantee is worth
 * something only while it is unbypassable: a sink bolted on outside would mean
 * holding a handle is enough to write locally and never synchronise, which
 * reopens the hole one layer up. Pushing at each write call site is the same
 * failure spread thinner — the next call site added is the one that silently
 * does not synchronise.
 *
 * The handle hands over a Vault Blob Type and itself, never Ciphertext. What
 * the sink does with that is its own business, and `createVaultSyncQueue` is
 * the implementation this library ships: mark the type unsent, and drain
 * through the converge primitive, reading the Local Vault when it drains.
 *
 * Reporting is fire-and-forget. It is called after the Local Vault write has
 * landed, its return value is ignored, and anything it throws is swallowed —
 * a save has already succeeded by the time the sink hears about it, so a sink
 * failure must never surface as a failed edit.
 */
export type VaultSyncSink = {
  vaultBlobChanged(change: { type: VaultBlobType; handle: VaultHandle }): void;
};

export type VaultHandle = LocalVaultAccess & {
  /** The User this handle resolves a Local Vault for. Fixed at construction. */
  readonly owner: string;
  /**
   * Whether `type`'s current Ciphertext has unsent changes — derived from
   * this owner's Sync Bookmark, not a stored flag. See CONTEXT.md's "Sync
   * Bookmark" entry.
   */
  hasUnsentChanges(type: VaultRecordType): Promise<boolean>;
  /**
   * The ETag of the Ciphertext this device and the server last agreed on for
   * `type`, or `undefined` when they never have. A conditional push sends it
   * as `If-Match`, so the server refuses a push over Ciphertext this device
   * has not seen.
   */
  lastPushedEtag(type: VaultRecordType): string | undefined;
  /**
   * Advance this owner's Sync Bookmark for `type` to the Ciphertext currently
   * saved, which the server now holds under `etag`. Call it only when that is
   * a confirmed fact — after a successful Vault Push, or after adopting the
   * server's copy.
   */
  recordPushSuccess(options: {
    type: VaultRecordType;
    etag: string;
  }): Promise<void>;
  /**
   * The hash of the Vault Meta this device and the server last agreed on, or
   * `undefined` when they never have. It is what tells a wrapping changed here
   * apart from one changed elsewhere — without it the two are the same
   * observation. See CONTEXT.md's "Vault Meta Bookmark" entry.
   */
  lastAgreedVaultMetaHash(): string | undefined;
  /**
   * Advance this owner's Vault Meta Bookmark to `meta`. Call it only after a
   * successful Vault Meta Push, or to record what this device and the server
   * last agreed on before a push that has not landed.
   */
  recordVaultMetaAgreement(options: { meta: VaultMetaV1 }): Promise<void>;
  /**
   * The Vault Identity a pass last observed on the server for this owner, or
   * `undefined` when no pass ever has. See CONTEXT.md's "Observed Vault
   * Identity" entry and ADR 0067.
   */
  observedVaultIdentity(): string | undefined;
  /**
   * Record the Vault Identity a pass just observed on the server for this
   * owner — whether or not it matches this device's own. Called from
   * `convergeVaultBlob`, the one place a pass's observation of the server's
   * Vault Meta reaches a decision.
   */
  recordObservedVaultIdentity(options: { identity: string }): void;
  /**
   * Whether this device has already been asked this question — `change` about
   * `meta` — and declined it. Derived by comparing the Vault Meta and the Vault
   * Meta Change against this owner's Vault Meta Refusal, never read from a flag
   * saying a question was asked.
   *
   * It is what lets a second and genuinely different wrapping change ask again
   * where a record of having asked stays silent. See CONTEXT.md's "Vault Meta
   * Refusal" entry and ADR 0066.
   */
  isVaultMetaRefused(question: VaultMetaQuestion): Promise<boolean>;
  /**
   * Record that this device declined this question: `durable` for an answer,
   * which holds until the question changes, `session` for a dismissal, which
   * holds until the tab closes.
   *
   * Records nothing about the Vault itself — no wrapping is adopted and no
   * Ciphertext is touched, on either side.
   */
  recordVaultMetaRefusal(
    options: VaultMetaQuestion & { lifetime: VaultMetaRefusalLifetime },
  ): Promise<void>;
  /**
   * Whether this owner's current recovery wrapping is one that was minted and
   * never acknowledged. Derived by hashing `masterKeyWrappedWithRecoveryKey`
   * and comparing that hash to this owner's pending Recovery Key
   * Acknowledgment, never read from a flag saying a key was shown.
   *
   * `false` when there is no Local Vault, when nothing readable is stored, or
   * when a record exists for a wrapping this device no longer holds — a claim,
   * an import, a replacement or a rotation retires the question with the
   * wrapping (CONTEXT.md, "Recovery Key Acknowledgment").
   */
  isRecoveryKeyUnacknowledged(): Promise<boolean>;
  /**
   * Record that this owner's current recovery wrapping was minted and has not
   * been acknowledged. Writes the wrapping's fingerprint and never the
   * Recovery Key. Called from `initialize` after the write lands; a caller
   * that mints by some other path and owes the same reminder can call it too.
   */
  recordUnacknowledgedRecoveryKey(): Promise<void>;
  /**
   * The User states they have recorded the Recovery Key. Clears the pending
   * Acknowledgment. The product cannot verify that claim.
   */
  acknowledgeRecoveryKey(): void;
  /**
   * Forget everything this device recorded about what it and the server last
   * agreed on — every Vault Blob Type's Sync Bookmark and the Vault Meta
   * Bookmark alike.
   *
   * A Sync Bookmark is evidence about the *server's* copy, and it stays true
   * for as long as this device's own Ciphertext only ever moves forward. A
   * caller that replaces the whole Local Vault with an older copy breaks that
   * assumption without touching the server, so the evidence survives while the
   * thing it was evidence about is gone: dirtiness reads true, the recorded
   * ETag still matches the unmoved server, and the conditional push that was
   * meant to refuse an unseen overwrite waves the older Ciphertext straight
   * through ([ADR 0063](../../../../../docs/adr/0063-a-restore-discards-the-evidence-it-holds-about-the-server.md),
   * [#617](https://github.com/mnaimfaizy/myorganiser/issues/617)).
   *
   * Dropping the evidence is what makes that safe, and it adds no new
   * behaviour to rely on: a device holding no bookmark is the case
   * `convergeVaultBlob` already handles by going and looking before it pushes,
   * and the case `pushVaultMeta` already refuses outright. Losing a bookmark
   * has always cost a look or a prompt and never a User's edit, which is why
   * this is the direction it is safe to be wrong in.
   *
   * Deliberately not folded into `saveVault`. That is also how convergence
   * writes the server's Ciphertext back after taking it, and clearing the
   * bookmark there would erase the agreement the take is in the middle of
   * recording.
   */
  forgetSyncBookmarks(): void;
};

/**
 * Acquire a handle to `owner`'s Local Vault.
 *
 * `masterKeyBytes` binds an already-unlocked Master Key; omit it and the
 * handle starts locked, with `unlockWithPassphrase` or `unlockWithRecoveryKey`
 * binding one.
 *
 * `syncSink` is optional, and omitting it is not a degraded mode: a handle
 * without one does exactly what a handle did before there was one to give,
 * which is what keeps every caller that has no server to reach — tests,
 * export, import, the shim — untouched.
 */
export function createVaultHandle(options: {
  owner: string;
  masterKeyBytes?: Uint8Array | null;
  syncSink?: VaultSyncSink | null;
  /**
   * Told whenever this handle replaces the whole Local Vault. Optional for the
   * same reason `syncSink` is: a handle without one behaves exactly as it did
   * before there was one to give, which is what keeps export, import and the
   * tests untouched.
   */
  revision?: LocalVaultRevision | null;
}): VaultHandle {
  assertVaultOwner(options.owner);

  const access = createLocalVaultAccess({
    slot: ownedLocalVaultSlot(options.owner),
    masterKeyBytes: options.masterKeyBytes,
  });
  const bookmarks = createSyncBookmarkAccess(options.owner);
  const refusals = createVaultMetaRefusalAccess(options.owner);
  const acknowledgments = createRecoveryKeyAcknowledgmentAccess(options.owner);
  const syncSink = options.syncSink ?? null;
  const revision = options.revision ?? null;

  /**
   * Tell the sink which Vault Blob Type just changed, and let nothing it does
   * reach the caller.
   *
   * Both halves matter. The call is not awaited, so a save resolves on the
   * Local Vault write and never on the network. The throw is swallowed,
   * because by this point the edit is saved: propagating would report a
   * successful edit as a failed one, and a User told their edit failed retypes
   * data that is already there.
   */
  const reportChange = (field: VaultRecordType): void => {
    if (!syncSink) return;
    try {
      syncSink.vaultBlobChanged({
        type: VAULT_BLOB_TYPE_BY_FIELD[field],
        handle,
      });
    } catch {
      // Deliberately swallowed — see above.
    }
  };

  /**
   * Tell readers the Local Vault they are holding has been replaced.
   *
   * Same fire-and-forget contract as `reportChange` and for the same reason:
   * the write has landed by the time this runs, so nothing a reader does with
   * the news may turn a completed write into a failed one.
   */
  const reportVaultReplaced = (): void => {
    if (!revision) return;
    try {
      revision.bump();
    } catch {
      // Deliberately swallowed — see above.
    }
  };

  // Every method below is a closure over the access object's own state, so
  // handing the references out directly keeps them bound and keeps generics.
  const handle: VaultHandle = {
    owner: options.owner,
    get isUnlocked() {
      return access.isUnlocked;
    },
    hasVault: access.hasVault,
    hasOwnedVault: access.hasOwnedVault,
    vaultStatus: access.vaultStatus,
    hasUnclaimedLocalVault: access.hasUnclaimedLocalVault,
    loadVault: access.loadVault,
    loadUnclaimedVault: access.loadUnclaimedVault,
    // Not reported to the sink, and the asymmetry with `saveEncryptedData` is
    // deliberate. `saveVault` writes a whole Local Vault and names no Vault
    // Blob Type, so there is nothing to report; and it is how convergence
    // itself writes Ciphertext back after taking the server's copy, so
    // reporting here would feed the sink its own output.
    //
    // The Local Vault Revision is told, and that is not the same thing. The
    // sink exists to send a change outward; the revision exists to tell
    // whoever is already reading this Vault that what they hold is no longer
    // what is stored. Convergence replacing Ciphertext is the case that needs
    // saying loudest, which is exactly the case the sink must not hear.
    saveVault: (vault) => {
      access.saveVault(vault);
      reportVaultReplaced();
    },
    // Told to the Local Vault Revision only when something was written, as
    // `saveVault` is: a refused adoption leaves what is stored exactly as it
    // was, so whoever is reading this Vault holds nothing stale.
    adoptVaultMetaWrapping: (options) => {
      const outcome = access.adoptVaultMetaWrapping(options);
      if (outcome === 'adopted') reportVaultReplaced();
      return outcome;
    },
    // Explicit Local Vault removal (ADR 0033) also removes this owner's Sync
    // Bookmarks, Vault Meta Bookmark and Observed Vault Identity (ADR 0058,
    // ADR 0067), their Vault Meta Refusals (ADR 0066) and their pending
    // Recovery Key Acknowledgment (ADR 0069) — the per-User namespaces are
    // removed together because a bookmark, an observation, a refusal or an
    // owed Acknowledgment about a Vault this device no longer holds is stale
    // by construction. The Acknowledgment's wrapping fingerprint already
    // retires the question when the wrapping moves; clearing it here is
    // belt-and-braces beside that guard, consistent with its neighbours.
    removeVault: () => {
      access.removeVault();
      bookmarks.removeBookmarks();
      refusals.removeRefusals();
      acknowledgments.remove();
      // Passkey Unlock (ADR 0136, decision 6): its wrapping holds the Master
      // Key of the Vault being removed. Storage failure is tolerated the same
      // way the neighbours tolerate it — removal of the Local Vault proceeds.
      disablePasskeyUnlock(options.owner);
      reportVaultReplaced();
    },
    async hasUnsentChanges(type) {
      const vault = access.loadVault();
      return bookmarks.hasUnsentChanges({ type, blob: vault?.data[type] });
    },
    lastPushedEtag(type) {
      return bookmarks.lastPushedEtag({ type });
    },
    lastAgreedVaultMetaHash: bookmarks.lastAgreedVaultMetaHash,
    recordVaultMetaAgreement: bookmarks.recordVaultMetaAgreement,
    observedVaultIdentity: bookmarks.observedVaultIdentity,
    recordObservedVaultIdentity: bookmarks.recordObservedVaultIdentity,
    isVaultMetaRefused: refusals.isRefused,
    recordVaultMetaRefusal: refusals.record,
    async isRecoveryKeyUnacknowledged() {
      const vault = access.loadVault();
      if (!vault) return false;
      return acknowledgments.isUnacknowledged(
        vault.masterKeyWrappedWithRecoveryKey,
      );
    },
    async recordUnacknowledgedRecoveryKey() {
      const vault = access.loadVault();
      if (!vault) return;
      await acknowledgments.record(vault.masterKeyWrappedWithRecoveryKey);
    },
    acknowledgeRecoveryKey: acknowledgments.acknowledge,
    // Deliberately not clearing refusals. This drops evidence about the
    // *server's* copy, which a restore invalidates (ADR 0063); a refusal is
    // evidence about neither copy — it is what a User answered when asked — and
    // replacing this device's Ciphertext does not un-answer it.
    forgetSyncBookmarks: () => {
      bookmarks.removeBookmarks();
    },
    async recordPushSuccess({ type, etag }) {
      const vault = access.loadVault();
      const blob = vault?.data[type];
      if (!blob) {
        throw new Error(
          `No Ciphertext saved for "${type}" to record a Sync Bookmark for`,
        );
      }
      await bookmarks.recordPushSuccess({ type, blob, etag });
    },
    // Creating a Vault replaces what a reader holds just as squarely as a
    // claim or an import does: a device that read `absent` a moment ago now
    // holds this owner's own Local Vault. It was the one door that stayed
    // silent, and the silence was load-bearing in the wrong direction — the
    // gate kept a newly minted Recovery Key on screen only because its status
    // had gone stale, so the first reader to consult storage live withheld the
    // very screen the key is shown on ([#667](https://github.com/mnaimfaizy/myorganiser/issues/667)).
    //
    // Reported after `initialize` resolves, so the write has landed before any
    // reader is told to look again — the same ordering every other door here
    // keeps. What holds the Recovery Key on screen afterwards is a Recovery Key
    // Acknowledgment (CONTEXT.md) and no longer a status nobody refreshed.
    async initialize(initializeOptions) {
      const result = await access.initialize(initializeOptions);
      // The wrapping exists the moment initialize writes. Creation cannot mint
      // before it writes the way Recovery Key Rotation does, so the owed
      // Acknowledgment is recorded after the write — fingerprint of the
      // wrapping, never the key that came back (ADR 0069).
      await handle.recordUnacknowledgedRecoveryKey();
      reportVaultReplaced();
      return result;
    },
    // A claim now changes what a reader sees, so readers are told. It did not
    // used to: an owner holding no Vault of their own resolved the Unclaimed
    // Local Vault implicitly, so recording it as theirs handed back the same
    // Ciphertext it already had. Removing that resolution is what changed it —
    // such an owner now reads no Vault at all until the claim lands, and a
    // reader not told would sit on that emptiness after it stopped being true.
    claimUnclaimedLocalVaultLocked: () => {
      access.claimUnclaimedLocalVaultLocked();
      reportVaultReplaced();
    },
    async claimUnclaimedLocalVaultByRecoveryKey(claimOptions) {
      const result =
        await access.claimUnclaimedLocalVaultByRecoveryKey(claimOptions);
      reportVaultReplaced();
      return result;
    },
    // A replacement changes the Ciphertext a reader who already holds this
    // owner's Local Vault would see — it is a different Vault under the same
    // key, not the same Vault newly owned — so readers are told here too.
    replaceOwnedLocalVaultWithUnclaimedLocked: () => {
      access.replaceOwnedLocalVaultWithUnclaimedLocked();
      reportVaultReplaced();
    },
    unlockWithPassphrase: access.unlockWithPassphrase,
    unlockWithRecoveryKey: access.unlockWithRecoveryKey,
    async replaceOwnedLocalVaultWithUnclaimedByRecoveryKey(replaceOptions) {
      const result =
        await access.replaceOwnedLocalVaultWithUnclaimedByRecoveryKey(
          replaceOptions,
        );
      reportVaultReplaced();
      return result;
    },
    changePassphrase: access.changePassphrase,
    resetPassphrase: access.resetPassphrase,
    // Not reported to the sink. A rotation replaces a wrapping and no
    // Ciphertext: every Vault Blob a reader holds is exactly as readable as it
    // was, because the Master Key did not move. What the server needs to hear
    // about it is a Vault Meta Push, which `rotateRecoveryKeyWithPassphrase`
    // does above this layer.
    //
    // The Local Vault Revision *is* bumped. A pending Recovery Key
    // Acknowledgment is keyed to the wrapping that moved, and a reader that
    // already holds "owed" would otherwise keep showing it until the next
    // remount. Passphrase changes do not move this wrapping and do not bump.
    async rotateRecoveryKey(rotateOptions) {
      const result = await access.rotateRecoveryKey(rotateOptions);
      reportVaultReplaced();
      return result;
    },
    loadDecryptedData: access.loadDecryptedData,
    loadDecryptedDataWithCiphertext: access.loadDecryptedDataWithCiphertext,
    decryptCiphertext: access.decryptCiphertext,
    // The one write that names a Vault Blob Type, so the one the sink hears
    // about. Local first, then the report: the Local Vault is written and this
    // promise is settled by everything the caller can observe before the sink
    // has done anything at all. A contended write throws before the report,
    // so the sink hears only of Ciphertext that was actually written.
    //
    // It does not bump the Local Vault Revision, and a merged save is no
    // exception: it is an edit, not a replacement (ADR 0143, decision 5).
    async saveEncryptedData(saveOptions) {
      await access.saveEncryptedData(saveOptions);
      reportChange(saveOptions.type);
    },
  };

  return handle;
}
