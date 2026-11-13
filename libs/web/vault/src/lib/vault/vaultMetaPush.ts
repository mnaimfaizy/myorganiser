/**
 * Vault Meta Push — the direction Vault Meta Converge deliberately cannot go.
 *
 * Converge asks whether this device should start using a wrapping made
 * somewhere else, and it can never check its own answer: a wrapping cannot be
 * verified without the passphrase it was derived from, which is why adoption
 * never happens without an explicit answer and why that module structurally
 * cannot write ([ADR 0057](../../../../../docs/adr/0057-vault-meta-converges-separately-and-never-silently.md)).
 *
 * A push is the opposite act. The wrapping being sent is one this device
 * wrote itself, so there is nothing to verify — but it can still land on top
 * of a wrapping some other device wrote, and that is the whole hazard here.
 * The safety claim is deliberately *not* "this device holds the Master Key
 * unlocked". That is true of the push made right after a change and false of
 * the retry, which runs at session start against a Vault that is usually
 * locked. What holds for both is narrower:
 *
 *   a device may push a wrapping it wrote itself, and only over a server
 *   state it can prove has not moved since.
 *
 * The Vault Meta Bookmark carries that proof. Everything else in this module
 * is arranged so that no path reaches `putVaultMeta` without it.
 *
 * This module writes; `vaultMetaConverge.ts` still does not. `settleVaultMeta`
 * composes the two exactly as `vaultReconcile.ts` composes `convergeVaultBlob`
 * — the write capability lives here, above the primitive, never inside it.
 */
import { VaultApi, VaultMetaV1 } from '@myorganiser/app-api-client';

import { getHttpStatus } from '../http/getHttpStatus';

import type { MintedRecoveryKey } from './recoveryKeyMint';
import {
  getServerVaultMeta,
  putServerVaultMetaEtagAware,
  type ServerVaultMeta,
} from './serverVaultSync';
import { hashVaultMeta } from './syncBookmarkAccess';
import type { VaultHandle, VaultMetaAdoptionWrite } from './vaultHandle';
import {
  describeVaultMetaDivergence,
  vaultMetaIdentity,
  vaultIdentityOf,
  type VaultMetaChange,
  type VaultMetaConvergePrompt,
  type VaultMetaConvergeResult,
  VAULT_META_CHANGES,
  convergeVaultMeta,
} from './vaultMetaConverge';
import { localToServerMeta } from './vaultShapes';

type VaultMetaApi = Pick<VaultApi, 'getVaultMeta' | 'putVaultMeta'>;

/**
 * Whether a local wrapping may be pushed over a server Vault Meta that
 * differs from it in this way.
 *
 * Checked before the base comparison, deliberately: a server holding a
 * separately initialized Vault is not a stale base to be caught up, it is a
 * different Vault, and no proof about the base makes pushing over it right.
 * Pushing there would leave the server's Ciphertext guarded by a key it was
 * not encrypted under — exactly
 * [#578](https://github.com/mnaimfaizy/myorganiser/issues/578) pointing the
 * other way.
 *
 * It guards a second case that does not exist yet. `changePassphrase`
 * re-derives from the salt the Vault already has, which is what keeps a
 * rotation legible as a rotation; a future change that minted a fresh salt
 * would make this device's own rotation read as a different Vault, and this
 * table is what stops that becoming a silent data hazard rather than a
 * refusal.
 *
 * Pinned rather than inferred so a fourth Vault Meta Change fails to compile
 * until somebody says whether pushing over it is safe
 * ([ADR 0053](../../../../../docs/adr/0053-a-fan-out-over-a-domain-enum-is-pinned-at-its-call-site.md)).
 */
export const VAULT_META_CHANGE_PUSHABLE = {
  'different-vault': false,
  passphrase: true,
  'recovery-key': true,
} as const satisfies Record<VaultMetaChange, boolean>;

/**
 * What one attempt to reach this User's Vault Meta found — a Server
 * Reachability reading.
 *
 * Three states rather than two because the repairs differ. `unreachable` is
 * waited out; `signed-out` never is, and telling a User to wait for a
 * connection they already have is worse than telling them nothing.
 */
export type ServerReachability = 'reachable' | 'unreachable' | 'signed-out';

/**
 * Ask, right now, whether this device can reach this User's Vault Meta.
 *
 * Deliberately the same read `pushLocalVaultMeta` opens with, classified by
 * the same `isSessionGone`. A second definition of "the session is gone",
 * living in whichever library drew the indicator, would drift from this one
 * and produce the exact lie the reading exists to prevent: "reachable" for a
 * push that comes back `skipped-not-authenticated`.
 *
 * A reading is an observation and never a precondition. It says what one
 * request found at the moment it ran, and nothing about whether the next
 * write will land — a third device can move the server in between. No caller
 * may gate a write on it.
 *
 * The Vault Meta this returns with is discarded. Comparing it against the
 * Vault Meta Bookmark here would predict `refused-server-moved`, and that is
 * declined on purpose: it re-implements this module's base comparison
 * somewhere it can disagree with it, and a refusal predicted before the fact
 * reads to a User as a reason not to act, when acting is still correct.
 */
export async function probeVaultMetaReachability(options: {
  /**
   * Narrowed to the one method the read needs, carrying
   * `getServerVaultMeta`'s own narrowing outward: a probe that could reach
   * `putVaultMeta` would be a probe that could push.
   */
  api: Pick<VaultMetaApi, 'getVaultMeta'>;
}): Promise<ServerReachability> {
  try {
    await getServerVaultMeta(options.api);
    return 'reachable';
  } catch (error) {
    return isSessionGone(error) ? 'signed-out' : 'unreachable';
  }
}

export type VaultMetaPushResult =
  /** The server now holds this device's Vault Meta. */
  | { kind: 'pushed' }
  /** Both sides already held it. Nothing was sent. */
  | { kind: 'noop-already-in-sync' }
  /**
   * The server's Vault Meta is not the one this device last agreed on, so
   * some other device moved the wrapping. Nothing was sent: two wrappings
   * changed independently is a question for the User at session start, not a
   * choice made by whichever device pushed second.
   */
  | { kind: 'refused-server-moved'; change: VaultMetaChange }
  /**
   * This device holds no evidence about the server's Vault Meta, so it cannot
   * prove the server has not moved. Refused for the same reason.
   */
  | { kind: 'refused-no-base' }
  /** The difference is one `VAULT_META_CHANGE_PUSHABLE` refuses outright. */
  | { kind: 'refused-not-pushable'; change: VaultMetaChange }
  | { kind: 'skipped-not-authenticated' };

function isSessionGone(error: unknown): boolean {
  const status = getHttpStatus(error);
  return status === 401 || status === 403;
}

/**
 * Name what differs between two Vault Metas, for reporting a refusal.
 *
 * Divergence is guaranteed by the caller — this is only reached once the two
 * identities differ — so the `none` case is a contradiction rather than an
 * outcome, and reporting the first Vault Meta Change is the honest fallback
 * over inventing a fourth member to mean "cannot happen".
 */
function nameDifference(
  local: VaultMetaV1,
  remote: VaultMetaV1,
): VaultMetaChange {
  const divergence = describeVaultMetaDivergence({ local, remote });
  return divergence.kind === 'diverged'
    ? divergence.change
    : VAULT_META_CHANGES[0];
}

/**
 * Send this device's Vault Meta to the server, conditional on the server
 * still holding what this device last agreed on.
 *
 * `baseHash` is that agreement — a Vault Meta Bookmark's hash. It is compared
 * against the server's Vault Meta read here, and the ETag from that same read
 * carries the decision to the server as `If-Match`. The ETag is the mechanism;
 * the hash is the decision. Both are needed: the hash is what this device can
 * reason about, and the `If-Match` is what closes the gap between the read and
 * the write when a third device writes in between.
 *
 * Never throws for a refusal, and never resolves a conflict on the User's
 * behalf. The conflict handler is passed explicitly rather than defaulted:
 * `putServerVaultMetaEtagAware`'s default raises a `window.confirm` from
 * inside the library, which is the shape ADR 0057 was written against.
 */
export async function pushLocalVaultMeta(options: {
  api: VaultMetaApi;
  /** The Vault Meta this device holds and wants the server to hold. */
  meta: VaultMetaV1;
  /** Hash of the Vault Meta this device and the server last agreed on. */
  baseHash: string | undefined;
}): Promise<VaultMetaPushResult> {
  const { api, meta, baseHash } = options;

  let serverMeta: ServerVaultMeta | null;
  try {
    serverMeta = await getServerVaultMeta(api);
  } catch (error) {
    if (isSessionGone(error)) return { kind: 'skipped-not-authenticated' };
    throw error;
  }

  // No wrapping on the server at all: there is nothing to overwrite, nobody
  // whose change could be reverted, and no base to need. The same case
  // Vault Reconcile calls its first sync.
  if (!serverMeta) {
    await put({ api, meta });
    return { kind: 'pushed' };
  }

  if (vaultMetaIdentity(serverMeta.meta) === vaultMetaIdentity(meta)) {
    return { kind: 'noop-already-in-sync' };
  }

  const change = nameDifference(meta, serverMeta.meta);
  if (!VAULT_META_CHANGE_PUSHABLE[change]) {
    return { kind: 'refused-not-pushable', change };
  }

  if (!baseHash) return { kind: 'refused-no-base' };

  if ((await hashVaultMeta(serverMeta.meta)) !== baseHash) {
    return { kind: 'refused-server-moved', change };
  }

  try {
    const result = await put({ api, meta, ifMatch: serverMeta.etag });
    // A 409 the ETag caught: a third device wrote between the read above and
    // the write. The same fact as a moved server, learned one step later, and
    // it collapses into the same refusal rather than a forced retry.
    if (result.kind === 'kept-remote') {
      return { kind: 'refused-server-moved', change };
    }
  } catch (error) {
    if (isSessionGone(error)) return { kind: 'skipped-not-authenticated' };
    throw error;
  }

  return { kind: 'pushed' };
}

function put(options: {
  api: VaultMetaApi;
  meta: VaultMetaV1;
  ifMatch?: string;
}) {
  return putServerVaultMetaEtagAware({
    api: options.api,
    meta: options.meta,
    ifMatch: options.ifMatch,
    // Explicit, never defaulted. Keeping the remote copy is what turns a
    // conflict into a refusal the caller reports, rather than a prompt the
    // library raises from underneath whoever called it.
    onConflict: () => 'keep-remote',
  });
}

/**
 * Every Vault Meta Push outcome that a wrapping change reports.
 * Includes both successful push results and the unreachable case when the
 * Local Vault is unreadable after a wrapping change.
 */
export type VaultMetaPushOutcome =
  | VaultMetaPushResult
  | { kind: 'unreachable' };

export type WrappingChangeResult = {
  /**
   * Always true by the time this resolves. The local wrapping is written
   * before the server is touched and is never rolled back: a User who has
   * just set a wrapping must be able to use it, whatever the network did.
   */
  changedLocally: true;
  /** What became of the attempt to make it the server's wrapping too. */
  push: VaultMetaPushOutcome;
};

/**
 * Rewrap and push, for whichever of the two passphrase changes called it.
 *
 * The two halves are one operation because the base cannot be recovered once
 * the first half has run: the Vault Meta the server was last known to hold is
 * the local one from *before* the rewrap, and after the rewrap nothing can
 * reconstruct it. A caller doing this in steps would have to capture state
 * before mutating it, correctly, at every call site. Nothing outside this
 * function ever holds the base, so that ordering cannot be got wrong.
 *
 * The Vault Meta Bookmark is written to the base *before* the push is
 * attempted, not after it fails. A push that dies mid-flight — the tab closed,
 * the machine asleep — then still leaves this device able to tell its own
 * change apart from somebody else's at the next session, which is the whole
 * job of the bookmark.
 *
 * Nothing here throws for a failed push. The local change has landed by then,
 * and reporting it as a failure would tell a User their passphrase did not
 * change when it did.
 */
async function rewrapAndPush(options: {
  api: VaultMetaApi;
  handle: VaultHandle;
  /**
   * Writes the new wrapping to the Local Vault, and throws if it may not.
   * Whatever authorization the change needs has already been decided by the
   * caller that supplied this — a wrong current passphrase, a locked Vault, or
   * an absent Vault throws from in here, before anything is written and before
   * the server is told anything.
   */
  rewrap: () => Promise<void>;
}): Promise<WrappingChangeResult> {
  const { api, handle } = options;

  const before = handle.loadVault();
  const base = before ? localToServerMeta(before) : null;

  await options.rewrap();

  if (base) {
    await handle.recordVaultMetaAgreement({ meta: base });
  }

  const after = handle.loadVault();
  if (!after) return { changedLocally: true, push: { kind: 'unreachable' } };
  const meta = localToServerMeta(after);

  let push: VaultMetaPushResult;
  try {
    push = await pushLocalVaultMeta({
      api,
      meta,
      baseHash: handle.lastAgreedVaultMetaHash(),
    });
  } catch {
    // Transport failure. The wrapping is changed here and the server still
    // holds the old one; the bookmark records the base, so the next session
    // retries this push rather than reading the divergence as somebody
    // else's change.
    return { changedLocally: true, push: { kind: 'unreachable' } };
  }

  if (push.kind === 'pushed') {
    await handle.recordVaultMetaAgreement({ meta });
  }

  return { changedLocally: true, push };
}

/**
 * Change this Vault's passphrase from an unlocked session, and make that
 * change the server's too.
 *
 * Authorized by the current passphrase, which is verified against the wrapping
 * this device holds before anything is written. That check is not
 * cryptographic — the Master Key is already unlocked — it is the only thing
 * standing between an unattended unlocked session and a passphrase change that
 * now reaches every device the owner has.
 *
 * Throws `VaultSecretMismatchError` for a wrong current passphrase, leaving the
 * Local Vault byte-identical. Never throws for a failed push.
 */
export async function changePassphraseWithCurrent(options: {
  api: VaultMetaApi;
  handle: VaultHandle;
  currentPassphrase: string;
  newPassphrase: string;
}): Promise<WrappingChangeResult> {
  const { handle } = options;
  return rewrapAndPush({
    api: options.api,
    handle,
    rewrap: () =>
      handle.changePassphrase({
        currentPassphrase: options.currentPassphrase,
        newPassphrase: options.newPassphrase,
      }),
  });
}

/**
 * Set a new passphrase after unlocking with a recovery key, and make that
 * change the server's too.
 *
 * Named apart from {@link changePassphraseWithCurrent} rather than reached by
 * omitting its current passphrase, because a User here has just proved they do
 * not know the current one — asking for it is not a check that could be
 * skipped, it is a check that cannot be met. The recovery key already
 * presented is what authorizes this.
 *
 * Never throws for a failed push.
 */
export async function resetPassphraseAfterRecovery(options: {
  api: VaultMetaApi;
  handle: VaultHandle;
  newPassphrase: string;
}): Promise<WrappingChangeResult> {
  const { handle } = options;
  return rewrapAndPush({
    api: options.api,
    handle,
    rewrap: () =>
      handle.resetPassphrase({ newPassphrase: options.newPassphrase }),
  });
}

/**
 * Retire this Vault's Recovery Key in favour of a freshly minted one, and make
 * that the server's wrapping too.
 *
 * The commit half of Recovery Key Rotation. `mintRecoveryKey` is the other
 * half and it is a separate call on purpose: the User has to record the new
 * key before the old one stops working, so nothing is written between the mint
 * and this, and abandoning the flow after seeing the key leaves the old
 * Recovery Key working. The two are two functions rather than one taking a
 * confirmation callback — a library that raises the User-facing confirmation
 * from underneath its caller is the shape ADR 0057 was written against.
 *
 * Authorized by the current passphrase, verified against the wrapping this
 * device holds before anything is written, and never by the key being
 * replaced: a User rotating because the old key is lost cannot produce it.
 * Throws `VaultSecretMismatchError` for a wrong current passphrase, leaving
 * the Local Vault byte-identical.
 *
 * Retirement is not instant everywhere, and this function does not make it so.
 * It holds here and on any device signing in afterwards; a device already
 * holding the old wrapping keeps honouring the old key until the User confirms
 * the change there, and a Vault Export taken beforehand stays openable by the
 * retired key for as long as that file exists (CONTEXT.md, "Recovery Key
 * Rotation").
 *
 * Never throws for a failed push.
 */
export async function rotateRecoveryKeyWithPassphrase(options: {
  api: VaultMetaApi;
  handle: VaultHandle;
  currentPassphrase: string;
  /** A key from `mintRecoveryKey`, already shown to the User. */
  recoveryKey: MintedRecoveryKey;
}): Promise<WrappingChangeResult> {
  const { handle } = options;
  return rewrapAndPush({
    api: options.api,
    handle,
    rewrap: () =>
      handle.rotateRecoveryKey({
        currentPassphrase: options.currentPassphrase,
        recoveryKey: options.recoveryKey,
      }),
  });
}

export type SettleVaultMetaResult =
  | { kind: 'skipped-no-local-vault' }
  | { kind: 'skipped-not-authenticated' }
  /** This device owed the server a wrapping, and the server took it. */
  | { kind: 'pushed-local-wrapping' }
  | { kind: 'noop-already-in-sync' }
  /**
   * The User chose the server's wrapping, and the Local Vault now carries it
   * over whatever Ciphertext was stored at the moment of the write.
   */
  | { kind: 'adopted-remote'; change: VaultMetaChange }
  /**
   * The User chose the server's wrapping and nothing was written: the Local
   * Vault no longer held the wrapping the decision was made against, or no
   * longer existed. The settle must run again — it is a decision about a
   * state that is gone, not a failure, and not an adoption.
   */
  | {
      kind: 'adoption-superseded';
      change: VaultMetaChange;
      reason: Exclude<VaultMetaAdoptionWrite, 'adopted'>;
    }
  /**
   * Nothing was owed, or what was owed could not be pushed, and Vault Meta
   * Converge decided something other than an adoption. Its result is carried
   * verbatim. An adoption never comes back here: `settleVaultMeta` performs
   * it, so no caller is ever left holding a write to make.
   */
  | {
      kind: 'converged';
      result: Exclude<VaultMetaConvergeResult, { kind: 'adopted-remote' }>;
    };

/**
 * Settle one User's Vault Meta with the server: push what this device owes,
 * then converge whatever is left.
 *
 * The order is the point. A device that changed its own wrapping and could not
 * push it is indistinguishable at a glance from a device whose wrapping was
 * changed elsewhere — local and server differ either way. Asking first would
 * therefore tell a User their own change came from another device, and offer
 * them a button that reverts it. Pushing first removes that case before
 * anything is asked.
 *
 * Composed here rather than sequenced across the runners: they are siblings,
 * each with its own effect, so mounting order sequences their starts and not
 * their completions. Composing also makes the ordering testable without React.
 */
export async function settleVaultMeta(options: {
  api: VaultMetaApi;
  handle: VaultHandle;
  prompt: VaultMetaConvergePrompt;
}): Promise<SettleVaultMetaResult> {
  const { api, handle } = options;

  const localVault = handle.loadVault();
  if (!localVault) return { kind: 'skipped-no-local-vault' };

  const meta = localToServerMeta(localVault);
  const baseHash = handle.lastAgreedVaultMetaHash();

  // No bookmark means this device has never agreed on a Vault Meta with the
  // server, so it can prove nothing about whether the server moved and owes
  // nothing it can demonstrate. Falling straight through is what makes a
  // device that has never pushed behave exactly as it did before bookmarks
  // existed.
  if (baseHash) {
    // Not wrapped in a `try`: `pushLocalVaultMeta` converts a lost Session
    // into `skipped-not-authenticated` itself and rethrows everything else,
    // so a catch here could only re-test a condition that never reaches it.
    const push = await pushLocalVaultMeta({ api, meta, baseHash });

    if (push.kind === 'skipped-not-authenticated') {
      return { kind: 'skipped-not-authenticated' };
    }

    if (push.kind === 'pushed') {
      await handle.recordVaultMetaAgreement({ meta });
      // Both sides hold this Vault Meta by construction now, so there is
      // nothing left to converge and no reason to read the server again —
      // and the identity both sides hold is this device's own, which is what
      // clears a standoff recorded by an earlier pass.
      handle.recordObservedVaultIdentity({ identity: vaultIdentityOf(meta) });
      return { kind: 'pushed-local-wrapping' };
    }

    if (push.kind === 'noop-already-in-sync') {
      await handle.recordVaultMetaAgreement({ meta });
      handle.recordObservedVaultIdentity({ identity: vaultIdentityOf(meta) });
      return { kind: 'noop-already-in-sync' };
    }
  }

  // Recorded through `onObserved` rather than from the result below.
  // `convergeVaultMeta` holds no handle and cannot write by design, so the
  // write still happens here — but it happens the moment the server's Vault
  // Meta is read, before the User is asked anything. Taking it from the
  // result instead meant a User who left the `different-vault` dialog open
  // recorded nothing at all, and the standoff their Vault Blobs were already
  // being refused for never appeared (ADR 0067's amendment, #691).
  const result = await convergeVaultMeta({
    api,
    localVault,
    prompt: options.prompt,
    onObserved: ({ identity }) => {
      handle.recordObservedVaultIdentity({ identity });
    },
  });

  if (result.kind !== 'adopted-remote') return { kind: 'converged', result };

  // The `localVault` read above is from before the prompt, which has no
  // timeout, so it is never written back. The handle re-reads the Local Vault
  // and writes the adopted wrapping over that read's Ciphertext with no await
  // between, and writes nothing if the wrapping moved meanwhile (ADR 0143).
  const write = handle.adoptVaultMetaWrapping({
    remoteMeta: result.remoteMeta,
    comparedLocalMeta: result.comparedLocalMeta,
  });

  if (write !== 'adopted') {
    return {
      kind: 'adoption-superseded',
      change: result.change,
      reason: write,
    };
  }

  return { kind: 'adopted-remote', change: result.change };
}
