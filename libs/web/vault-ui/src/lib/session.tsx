'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { getCurrentUser } from '@myorganiser/auth';
import {
  createLocalVaultRevision,
  createVaultApi,
  createVaultHandle,
  createVaultPullTrigger,
  createVaultSyncQueue,
  type LocalVaultRevision,
  type VaultHandle,
  type VaultPullTrigger,
  type VaultSyncQueue,
} from '@myorganiser/web-vault';

import {
  useVaultAbsentEvidence,
  type VaultAbsentEvidenceState,
} from './useVaultAbsentEvidence';
import { useLocalVaultRevisionOf } from './useLocalVaultRevisionOf';
import {
  useVaultClaimEvidence,
  type VaultClaimEvidenceState,
} from './useVaultClaimEvidence';

/**
 * Which secret produced the current in-memory Vault Unlock.
 * Session-scoped only — never persisted into the Local Vault.
 */
export type VaultUnlockSecret = 'passphrase' | 'recovery-key';

/**
 * How this recovery-unlocked session answered the Passphrase Reset Prompt.
 * Absent until the User skips or a reset completes. Never persisted.
 */
type PassphraseResetPromptAnswer = 'skipped' | 'completed';

type VaultSessionContextValue = {
  masterKeyBytes: Uint8Array | null;
  /**
   * Null while locked. Set with the Master Key when unlocking, and cleared
   * by `lock` or an owner change. A later passphrase unlock overwrites a
   * recovery-key unlock; the Local Vault never records this.
   */
  unlockSecret: VaultUnlockSecret | null;
  /**
   * True on the first paint after a recovery-key Vault Unlock, until the
   * Passphrase Reset Prompt is skipped or a reset completes. In-memory
   * only — never written to the Local Vault, `localStorage`,
   * `sessionStorage`, or the server (ADR 0095). A lock or a later
   * passphrase unlock clears it with the Vault Unlock Secret.
   */
  passphraseResetPromptOwed: boolean;
  /** Decline the prompt for this recovery-unlocked session. */
  skipPassphraseResetPrompt: () => void;
  /**
   * The prompt's question is answered because a passphrase was set.
   * Does not change the Vault Unlock Secret — the Vault card may still
   * reset without the current passphrase for the rest of the session.
   */
  completePassphraseResetPrompt: () => void;
  /**
   * Unlock with bytes plus the secret that produced them. Passing `null`
   * locks and clears `unlockSecret`. Omitting the secret on a non-null
   * value records a passphrase unlock — the authorization that still
   * requires the current passphrase to change wrapping.
   */
  setMasterKeyBytes: (
    value: Uint8Array | null,
    unlockSecret?: VaultUnlockSecret,
  ) => void;
  lock: () => void;
  handle: VaultHandle | null;
  /** The Vault Sync Queue `handle` reports to. Exposed for a sync status reading. */
  syncQueue: VaultSyncQueue | null;
  /**
   * The Vault Pull trigger `VaultPullRunner` asks on mount and on window
   * focus. Created once per owner beside `syncQueue`, so `VaultPullRunner`
   * no longer builds its own — one instance per owner is also what removes
   * the double pass two instances cost
   * ([#616](https://github.com/mnaimfaizy/myorganiser/issues/616)). Exposed
   * for a sync status reading the same way `syncQueue` is (ADR 0088,
   * decision 7).
   */
  pullTrigger: VaultPullTrigger | null;
  /**
   * Moves whenever the Local Vault is replaced under whoever is reading it —
   * convergence taking the server's Ciphertext, an import, a removal. Exposed
   * so a page holding decrypted records can read them again.
   */
  revision: LocalVaultRevision | null;
  /**
   * What proves the Unclaimed Local Vault on this device is this User's,
   * asked once per owner here rather than once per gate. Held on the session
   * because it has two readers: `VaultGate`, which offers nothing about an
   * Unclaimed Local Vault until it settles, and `VaultReconcileRunner`, which
   * starts no pass over one until it settles — a pass that read `unclaimed` as
   * absent downloaded the server's wrapping ahead of the claim
   * ([#673](https://github.com/mnaimfaizy/myorganiser/issues/673); ADR 0066's
   * amendment).
   */
  claimEvidence: VaultClaimEvidenceState;
  /**
   * Whether the server holds a Vault for this User while this device holds
   * none. Its one reader is `VaultGate`'s `absent` branch; it lives beside the
   * claim check because the two are the same shape and splitting them across
   * the session and the gate would leave nothing to explain the split.
   */
  absentEvidence: VaultAbsentEvidenceState;
};

const VaultSessionContext = createContext<VaultSessionContextValue | null>(
  null,
);

export interface VaultSessionProviderProps {
  children: React.ReactNode;
}

export function VaultSessionProvider({ children }: VaultSessionProviderProps) {
  const [masterKeyBytes, setMasterKeyBytesState] = useState<Uint8Array | null>(
    null,
  );
  const [unlockSecret, setUnlockSecretState] =
    useState<VaultUnlockSecret | null>(null);
  const [passphraseResetPromptAnswer, setPassphraseResetPromptAnswerState] =
    useState<PassphraseResetPromptAnswer | null>(null);

  const owner = getCurrentUser()?.id ?? null;
  const ownerRef = useRef(owner);

  const setMasterKeyBytes = useCallback(
    (value: Uint8Array | null, nextUnlockSecret?: VaultUnlockSecret) => {
      if (value === null) {
        setMasterKeyBytesState(null);
        setUnlockSecretState(null);
        setPassphraseResetPromptAnswerState(null);
        return;
      }
      setMasterKeyBytesState(value);
      setUnlockSecretState(nextUnlockSecret ?? 'passphrase');
      // A new unlock starts the prompt over. A recovery-key unlock owes
      // it; a passphrase unlock must not keep an answer from an earlier
      // recovery-unlocked session.
      setPassphraseResetPromptAnswerState(null);
    },
    [],
  );

  const lock = useCallback(() => {
    setMasterKeyBytesState(null);
    setUnlockSecretState(null);
    setPassphraseResetPromptAnswerState(null);
  }, []);

  const skipPassphraseResetPrompt = useCallback(() => {
    setPassphraseResetPromptAnswerState((current) => {
      if (unlockSecret !== 'recovery-key' || current !== null) {
        return current;
      }
      return 'skipped';
    });
  }, [unlockSecret]);

  const completePassphraseResetPrompt = useCallback(() => {
    setPassphraseResetPromptAnswerState((current) => {
      if (unlockSecret !== 'recovery-key') {
        return current;
      }
      return 'completed';
    });
  }, [unlockSecret]);

  let currentMasterKeyBytes = masterKeyBytes;
  let currentUnlockSecret = unlockSecret;
  let currentPassphraseResetPromptAnswer = passphraseResetPromptAnswer;
  if (ownerRef.current !== owner) {
    ownerRef.current = owner;
    if (masterKeyBytes !== null) {
      currentMasterKeyBytes = null;
      currentUnlockSecret = null;
      currentPassphraseResetPromptAnswer = null;
      setMasterKeyBytesState(null);
      setUnlockSecretState(null);
      setPassphraseResetPromptAnswerState(null);
    }
  }

  const passphraseResetPromptOwed =
    currentUnlockSecret === 'recovery-key' &&
    currentPassphraseResetPromptAnswer === null;

  // Keyed on `owner` alone, unlike the handle below: locking and unlocking
  // build a new handle, and a queue rebuilt with it would drop the types an
  // edit had marked but no drain had sent yet. Those types are still unsent —
  // the Sync Bookmark says so — but nothing would come back for them until the
  // next edit or the next reconcile.
  const syncQueue = useMemo(() => {
    if (owner === null) return null;

    return createVaultSyncQueue({
      api: createVaultApi(),
      // A push does not prompt. The Vault Blob Types pinned `promptOnConflict`
      // reach this on a genuine conflict, and deferring writes nothing on
      // either side, so the divergence survives for the reconcile on the next
      // sign-in to put to the User with the dialog built for it.
      prompt: () => 'defer',
    });
  }, [owner]);

  // Keyed on `owner` alone, like `syncQueue` and for the same reason: locking
  // and unlocking build a new handle over the same Local Vault, and a
  // trigger rebuilt with it would forget it had ever stopped on a 401/403 and
  // drop whatever debounce window was mid-flight.
  const pullTrigger = useMemo(() => {
    if (owner === null) return null;

    return createVaultPullTrigger({
      api: createVaultApi(),
      // Same reasoning as the queue's prompt: a pull never interrupts the
      // User with a dialog.
      prompt: () => 'defer',
    });
  }, [owner]);

  // Keyed on `owner` alone, like the queue and for the same reason: locking
  // and unlocking build a new handle over the same Local Vault, and a revision
  // rebuilt with it would drop every subscriber a page had registered.
  const revision = useMemo(() => {
    if (owner === null) return null;
    return createLocalVaultRevision();
  }, [owner]);

  // Construct the handle
  const handle = useMemo<VaultHandle | null>(() => {
    if (owner === null) {
      return null;
    }
    return createVaultHandle({
      owner,
      masterKeyBytes: currentMasterKeyBytes,
      syncSink: syncQueue,
      revision,
    });
  }, [owner, currentMasterKeyBytes, syncQueue, revision]);

  // What a save reports covers edits made while this queue existed. Ciphertext
  // left unsent by an earlier browser session — or by a version that had no
  // Sync Bookmarks at all, which is every User's first load after Vault Push
  // ships — is unsent all the same, and no save is coming to say so. Asking
  // the bookmarks at session start is what gets those types drained instead of
  // sitting in the sync indicator with nothing able to clear them.
  //
  // Runs again whenever the handle changes, which is what a lock or an unlock
  // produces: a conflict met while locked writes nothing and leaves its type
  // marked, so the unlock is exactly when it is worth another attempt.
  useEffect(() => {
    if (!syncQueue || !handle) return;
    void syncQueue.markUnsentFromBookmarks(handle);
  }, [syncQueue, handle]);

  // Subscribed for the re-render alone — the number is not read. Vault Absent
  // Evidence reads `vaultStatus()` at render and gates its own check on
  // `absent`, so a provider that did not re-render when the Local Vault is
  // replaced would go on reporting the status the device had at sign-in.
  // Cheap: the context value below does not depend on the revision number, so
  // a bump that changes no evidence re-renders nothing beneath this provider.
  useLocalVaultRevisionOf(revision);

  // Both keyed on the owner inside, so a lock or an unlock — a new handle over
  // the same Local Vault — never re-asks a question that already answered.
  const claimEvidence = useVaultClaimEvidence(handle);
  const absentEvidence = useVaultAbsentEvidence(handle);

  const value = useMemo<VaultSessionContextValue>(
    () => ({
      masterKeyBytes: currentMasterKeyBytes,
      unlockSecret: currentUnlockSecret,
      passphraseResetPromptOwed,
      skipPassphraseResetPrompt,
      completePassphraseResetPrompt,
      setMasterKeyBytes,
      lock,
      handle,
      syncQueue,
      pullTrigger,
      revision,
      claimEvidence,
      absentEvidence,
    }),
    [
      currentMasterKeyBytes,
      currentUnlockSecret,
      passphraseResetPromptOwed,
      skipPassphraseResetPrompt,
      completePassphraseResetPrompt,
      setMasterKeyBytes,
      lock,
      handle,
      syncQueue,
      pullTrigger,
      revision,
      claimEvidence,
      absentEvidence,
    ],
  );

  return (
    <VaultSessionContext.Provider value={value}>
      {children}
    </VaultSessionContext.Provider>
  );
}

export function useVaultSession(): VaultSessionContextValue {
  const ctx = useContext(VaultSessionContext);
  if (!ctx) {
    throw new Error('useVaultSession must be used within VaultSessionProvider');
  }
  return ctx;
}

export function useOptionalVaultSession(): VaultSessionContextValue | null {
  return useContext(VaultSessionContext);
}

/**
 * The lock state a shell reads for chrome: `no-session` when no Vault Session
 * is mounted (not locked, and not unlockable), otherwise `locked` or
 * `unlocked` from the Master Key.
 */
export type VaultLockState = 'no-session' | 'locked' | 'unlocked';

export function useVaultLockState(): VaultLockState {
  const session = useOptionalVaultSession();
  if (session === null) return 'no-session';
  return session.masterKeyBytes === null ? 'locked' : 'unlocked';
}
