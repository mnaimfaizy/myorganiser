/**
 * Vault Meta convergence — decided on its own terms, never alongside the data.
 *
 * Vault Meta and Vault Blobs diverge for unrelated reasons, so they converge
 * by unrelated rules (see CONTEXT.md's "Vault Meta" entry and
 * [ADR 0057](../../../../../docs/adr/0057-vault-meta-converges-separately-and-never-silently.md)).
 * Changing a passphrase rewraps the *same* Master Key: the wrapping moves and
 * every Vault Blob stays byte-identical and fully readable. Deciding the two
 * together would turn an ordinary passphrase change into a whole-Vault
 * conflict, and answering "keep this device" would silently revert it.
 *
 * Adopting a remote wrapping is the one move that can brick a Local Vault. If
 * it wraps a different Master Key, every Vault Blob on this device is left
 * encrypted under a key nothing here can unwrap — and a wrapping cannot be
 * verified without the passphrase it was derived from, so there is no check to
 * run first. That is why nothing here happens without an explicit answer.
 *
 * This module structurally cannot write. It takes `getVaultMeta` and nothing
 * else, so no answer given to it can push a local wrapping over the server's
 * and undo a passphrase change made elsewhere. Adoption is returned as the
 * wrapping to adopt and the local wrapping it was decided against, never as a
 * whole Local Vault: the answer can arrive arbitrarily late, and a Local Vault
 * read before it would revert every Vault Blob saved meanwhile.
 * `settleVaultMeta` performs the write from a fresh read
 * ([ADR 0143](../../../../../docs/adr/0143-a-local-vault-write-is-conditional-on-the-ciphertext-it-read-and-a-contended-save-merges.md)).
 */
import { VaultApi, VaultMetaV1 } from '@myorganiser/app-api-client';

import { getHttpStatus } from '../http/getHttpStatus';

import { VaultStorageV1 } from './localVaultStorage';
import { getServerVaultMeta, type ServerVaultMeta } from './serverVaultSync';
import { stableStringify } from './stableStringify';
import { localToServerMeta, normalizeEncryptedBlobV1 } from './vaultShapes';

/**
 * Which wrapping in a Vault Meta moved, in the order divergence is reported —
 * first match wins.
 *
 * `different-vault` comes first because it is the only one that is not a
 * change at all. A differing `kdf_salt` cannot be a rotated passphrase:
 * `changePassphrase` re-derives from the salt the vault already has and
 * replaces only the wrapping, while `initialize` mints a fresh salt beside a
 * fresh Master Key. So a salt that moved means the two sides were initialized
 * separately and hold different Master Keys — and every other difference in
 * the meta follows from that rather than standing on its own.
 *
 * Reading it as a passphrase change is what
 * [#578](https://github.com/mnaimfaizy/myorganiser/issues/578) was: the User
 * was told their passphrase had changed elsewhere and offered a button that
 * would adopt the other vault's wrapping over this device's Ciphertext,
 * leaving every Vault Blob here encrypted under a key nothing here can
 * unwrap.
 *
 * The passphrase comes next because it is the wrapping that can lock a User
 * out of their own device: a User whose passphrase changed elsewhere needs to
 * hear about the passphrase, not about a recovery key that also moved.
 *
 * This array is the only enumeration of the members; the tables below are
 * pinned against it ([ADR 0053](../../../../../docs/adr/0053-a-fan-out-over-a-domain-enum-is-pinned-at-its-call-site.md)),
 * so a fourth member cannot be added without a facet to read it from and an
 * answer to whether it may be adopted.
 */
export const VAULT_META_CHANGES = [
  'different-vault',
  'passphrase',
  'recovery-key',
] as const;

export type VaultMetaChange = (typeof VAULT_META_CHANGES)[number];

/** The part of a Vault Meta one Vault Meta Change is read from. */
type VaultMetaFacet = (meta: VaultMetaV1) => object;

const VAULT_META_CHANGE_FACETS = {
  /**
   * The salt alone, and deliberately nothing else. It is the one field that
   * answers "is this the same vault?" without needing the passphrase it was
   * derived from — which ADR 0057 correctly says a wrapping cannot be
   * verified without, and which is why this evidence is worth reading before
   * anything else.
   */
  'different-vault': (meta) => ({ kdf_salt: meta.kdf_salt }),
  /**
   * The KDF parameters belong here and nowhere else: the recovery key wraps
   * the Master Key directly, without deriving anything, so a hash or
   * iteration move can only change what a passphrase produces. `version` is
   * here for the conservative reason — it decides how a wrapping is read at
   * all, and naming the passphrase is the safer answer when it moves. The
   * salt is not here; it is read above, where a difference in it means
   * something else entirely.
   */
  passphrase: (meta) => ({
    version: meta.version,
    kdf_name: meta.kdf_name,
    kdf_params: meta.kdf_params,
    wrapped: normalizeEncryptedBlobV1(meta.wrapped_mk_passphrase),
  }),
  'recovery-key': (meta) => ({
    wrapped: normalizeEncryptedBlobV1(meta.wrapped_mk_recovery),
  }),
} as const satisfies Record<VaultMetaChange, VaultMetaFacet>;

/**
 * Whether this device may start using the server's wrapping for a given Vault
 * Meta Change.
 *
 * Adoption carries the local Ciphertext across and replaces only the
 * wrapping, which is right exactly when both sides hold the same Master Key.
 * A rotated passphrase or recovery key does; two separately initialized
 * vaults do not, and adopting there destroys the data on this device.
 *
 * Pinned rather than inferred so the answer is decided per member: a fourth
 * Vault Meta Change fails to compile until somebody says whether adopting it
 * is a safe thing to offer.
 */
export const VAULT_META_CHANGE_ADOPTABLE = {
  'different-vault': false,
  passphrase: true,
  'recovery-key': true,
} as const satisfies Record<VaultMetaChange, boolean>;

export type VaultMetaDivergence =
  | { kind: 'none' }
  | { kind: 'diverged'; change: VaultMetaChange };

/**
 * Compare two Vault Metas and name what moved.
 *
 * Naming matters more than the boolean: the answer is what the User is asked
 * about, and "your vault differs" is not something a User can act on, while
 * "your passphrase was changed on another device" is.
 */
export function describeVaultMetaDivergence(options: {
  local: VaultMetaV1;
  remote: VaultMetaV1;
}): VaultMetaDivergence {
  for (const change of VAULT_META_CHANGES) {
    const read = VAULT_META_CHANGE_FACETS[change];
    if (
      stableStringify(read(options.local)) !==
      stableStringify(read(options.remote))
    ) {
      return { kind: 'diverged', change };
    }
  }

  return { kind: 'none' };
}

/**
 * The whole of what a Vault Meta is, for the purpose of asking whether two of
 * them are the same one.
 *
 * Built from the same facets divergence is read through, so "two Vault Metas
 * have equal identity" and "`describeVaultMetaDivergence` reports none" are
 * one statement rather than two that can drift apart. That matters because a
 * Vault Meta Bookmark is a hash of this: a bookmark that considered a field
 * divergence ignores would report a device as owing a push forever, and one
 * that ignored a field divergence reads would call a moved wrapping unmoved.
 *
 * A fan-out over `VAULT_META_CHANGES` reaching the pinned facet table, not a
 * hand-written object literal ([ADR 0053](../../../../../docs/adr/0053-a-fan-out-over-a-domain-enum-is-pinned-at-its-call-site.md)).
 */
export function vaultMetaIdentity(meta: VaultMetaV1): string {
  return stableStringify(
    Object.fromEntries(
      VAULT_META_CHANGES.map((change) => [
        change,
        VAULT_META_CHANGE_FACETS[change](meta),
      ]),
    ),
  );
}

/**
 * The Vault Identity a Vault Meta carries: which Vault it belongs to, and
 * nothing about how that Vault is opened.
 *
 * Read through the same pinned facet `different-vault` divergence is read
 * through, so "these two Vault Metas are two Vaults" has exactly one
 * definition and cannot drift into a second. Rewrapping — a changed
 * passphrase, a replaced Recovery Key — re-derives from the salt the Vault
 * already holds and never moves this, while `initialize` mints a fresh one
 * beside a fresh Master Key.
 *
 * This is the one thing about a Vault Meta a Vault Blob decision may rest on
 * ([ADR 0067](../../../../../docs/adr/0067-a-vault-blob-is-never-taken-across-a-vault-identity.md)),
 * and unlike everything else about opening a Vault it is answerable without
 * unlocking anything — which is what lets a locked device keep converging.
 */
export function vaultIdentityOf(meta: VaultMetaV1): string {
  return stableStringify(VAULT_META_CHANGE_FACETS['different-vault'](meta));
}

/**
 * The three answers to "start using the new wrapping here?".
 *
 * `defer` is the answer given by a User who gave no answer — a dismissed
 * prompt. It writes nothing and is not remembered, so the question comes back
 * (ADR 0033). `keep-local` is a given answer that also writes nothing: this
 * device carries on unlocking the way it already does, and the server keeps
 * the wrapping the other device put there.
 */
export type VaultMetaDecision = 'adopt-remote' | 'keep-local' | 'defer';

export type VaultMetaConvergePrompt = (params: {
  change: VaultMetaChange;
  remote: ServerVaultMeta;
}) => Promise<VaultMetaDecision> | VaultMetaDecision;

/**
 * The Vault Identity this pass saw on the server, reported on every outcome
 * reached after the server's Vault Meta was actually read.
 *
 * Evidence, not a write: this module cannot write (its `api` is one read-only
 * method and it holds no handle), so it reports what it saw and lets
 * `settleVaultMeta` record it. That split is what lets the Observed Vault
 * Identity be recorded by the pass that reads the Vault Meta, rather than only
 * by `convergeVaultBlob` — which a differing identity stops from running, so
 * recording only there could never observe the very case it exists to report
 * (ADR 0067, decision point 7).
 *
 * Absent on the three `skipped-*` outcomes, which are reached without an
 * observation: no Local Vault, no Session, or no Vault Meta on the server.
 */
type ObservedIdentity = { observedIdentity: string };

export type VaultMetaConvergeResult =
  /** No Local Vault on this device — there is no wrapping to replace. */
  | { kind: 'skipped-no-local-vault' }
  | { kind: 'skipped-not-authenticated' }
  /** The server holds no Vault Meta yet. First sync is Vault Reconcile's job. */
  | { kind: 'skipped-no-server-meta' }
  | ({ kind: 'noop-already-in-sync' } & ObservedIdentity)
  /** The User answered, and the answer was to leave this device alone. */
  | ({ kind: 'noop-declined'; change: VaultMetaChange } & ObservedIdentity)
  /** The User gave no answer. Nothing was written; ask again later. */
  | ({ kind: 'noop-deferred'; change: VaultMetaChange } & ObservedIdentity)
  /**
   * The User answered `adopt-remote` for a change that cannot be adopted.
   * Reported rather than silently treated as `keep-local`: an answer that
   * cannot be carried out is something the caller has to know it gave, and a
   * silent downgrade would hide a UI offering an action the library refuses.
   */
  | ({
      kind: 'refused-not-adoptable';
      change: VaultMetaChange;
    } & ObservedIdentity)
  | ({
      kind: 'adopted-remote';
      change: VaultMetaChange;
      /** The server's Vault Meta, whose wrapping the User chose to adopt. */
      remoteMeta: VaultMetaV1;
      /**
       * The local wrapping this decision was made against. Adoption writes
       * nothing if the Local Vault no longer holds it when the write is made.
       */
      comparedLocalMeta: VaultMetaV1;
    } & ObservedIdentity);

/**
 * Converge one User's Vault Meta with the server's, asking before replacing.
 *
 * Runs independently of Vault Blob convergence and cannot gate it: a Vault
 * Meta that diverges — or a check that fails outright — leaves every Vault
 * Blob exactly as mergeable as it was.
 */
export async function convergeVaultMeta(options: {
  // Deliberately narrower than the Vault Reconcile surface: one method, and
  // no way to write. See the module doc.
  api: Pick<VaultApi, 'getVaultMeta'>;
  localVault: VaultStorageV1 | null;
  prompt: VaultMetaConvergePrompt;
  /**
   * Called with the Vault Identity this pass observed on the server, the
   * moment it is observed and before anything is asked.
   *
   * Required rather than optional, for the reason ADR 0067 gives about the
   * evidence parameter on `convergeVaultBlob`: optional would let a caller
   * omit it and silently get the under-reporting back, and a compiler that
   * enumerates every call site is the whole value.
   *
   * This does not make the module able to write. It calls a callback its
   * caller supplied and holds no handle — the same shape adoption already
   * uses to return a next Local Vault rather than saving one.
   */
  onObserved: (observation: { identity: string }) => void;
}): Promise<VaultMetaConvergeResult> {
  const { localVault } = options;
  if (!localVault) {
    return { kind: 'skipped-no-local-vault' };
  }

  let serverMeta: ServerVaultMeta | null;
  try {
    serverMeta = await getServerVaultMeta(options.api);
  } catch (error) {
    const status = getHttpStatus(error);
    if (status === 401 || status === 403) {
      return { kind: 'skipped-not-authenticated' };
    }
    throw error;
  }

  if (!serverMeta) {
    return { kind: 'skipped-no-server-meta' };
  }

  // Every outcome below this line follows a real observation of the server's
  // Vault Meta, so every one of them carries it. Read once here rather than
  // per branch: a branch that forgot it would silently under-report a
  // standoff, which is the failure this evidence exists to prevent.
  const observedIdentity = vaultIdentityOf(serverMeta.meta);

  // Reported here rather than left to the returned result. What follows may
  // ask the User, and on `different-vault` that question is a dialog that
  // stays on screen until it is answered — so a record written from the
  // result is a record a User can withhold indefinitely by not answering.
  // The observation is evidence about the server and nothing the User
  // decides can make it untrue (ADR 0067's amendment, #691).
  options.onObserved({ identity: observedIdentity });

  const comparedLocalMeta = localToServerMeta(localVault);
  const divergence = describeVaultMetaDivergence({
    local: comparedLocalMeta,
    remote: serverMeta.meta,
  });

  if (divergence.kind === 'none') {
    return { kind: 'noop-already-in-sync', observedIdentity };
  }

  const decision = await options.prompt({
    change: divergence.change,
    remote: serverMeta,
  });

  if (decision === 'defer') {
    return {
      kind: 'noop-deferred',
      change: divergence.change,
      observedIdentity,
    };
  }

  if (decision === 'keep-local') {
    return {
      kind: 'noop-declined',
      change: divergence.change,
      observedIdentity,
    };
  }

  if (!VAULT_META_CHANGE_ADOPTABLE[divergence.change]) {
    // The wrapping on the server belongs to a different Master Key, so there
    // is no Ciphertext here it can open. Abandoning this device's Vault for
    // another is an explicit removal (ADR 0033), never a wrapping quietly
    // swapped in underneath the data it cannot decrypt.
    return {
      kind: 'refused-not-adoptable',
      change: divergence.change,
      observedIdentity,
    };
  }

  return {
    kind: 'adopted-remote',
    change: divergence.change,
    observedIdentity,
    remoteMeta: serverMeta.meta,
    comparedLocalMeta,
  };
}
