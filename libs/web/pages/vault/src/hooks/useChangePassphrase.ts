'use client';

import { useCallback, useState } from 'react';

import {
  changePassphraseWithCurrent,
  createVaultApi,
  VaultSecretMismatchError,
  type VaultHandle,
} from '@myorganiser/web-vault';
import {
  announcePassphraseChange,
  resetPassphraseAfterRecoveryAndAnnounce,
  useOptionalVaultSession,
  type PassphraseRewriteToast,
  type VaultUnlockSecret,
} from '@myorganiser/web-vault-ui';

import { getErrorMessage } from '../utils/getErrorMessage';
import { useToast } from '@myorganiser/web-ui';

export type ChangePassphraseOutcome = 'ok' | 'wrong-passphrase' | 'error';

type PassphraseRewriteOptions = {
  handle: VaultHandle;
  currentPassphrase: string;
  newPassphrase: string;
  toast: PassphraseRewriteToast;
  onRecoveryComplete?: () => void;
};

/**
 * How a passphrase rewrite is authorized, pinned on the Vault Unlock Secret.
 * `changePassphraseWithCurrent` verifies the current passphrase;
 * `resetPassphraseAfterRecoveryAndAnnounce` does not.
 */
async function changeWithCurrentPassphrase(
  options: PassphraseRewriteOptions,
): Promise<ChangePassphraseOutcome> {
  const result = await changePassphraseWithCurrent({
    api: createVaultApi(),
    handle: options.handle,
    currentPassphrase: options.currentPassphrase,
    newPassphrase: options.newPassphrase,
  });
  announcePassphraseChange(result, options.toast);
  return 'ok';
}

const PASSPHRASE_REWRITE_FOR_UNLOCK_SECRET = {
  passphrase: changeWithCurrentPassphrase,
  // A passkey unlock never counts as knowing the passphrase (ADR 0136): the
  // change still verifies the current one, exactly as a passphrase unlock.
  passkey: changeWithCurrentPassphrase,
  'recovery-key': (
    options: PassphraseRewriteOptions,
  ): Promise<ChangePassphraseOutcome> =>
    // A reset from the Vault card answers the same question as the prompt.
    // The Vault Unlock Secret stays recovery-key (ADR 0095).
    resetPassphraseAfterRecoveryAndAnnounce({
      handle: options.handle,
      newPassphrase: options.newPassphrase,
      toast: options.toast,
      onComplete: options.onRecoveryComplete,
    }),
} as const satisfies Record<
  VaultUnlockSecret,
  (options: PassphraseRewriteOptions) => Promise<ChangePassphraseOutcome>
>;

/**
 * Hook for rewriting a vault passphrase from an unlocked session.
 * Authorization follows the Vault Unlock Secret: a passphrase unlock
 * verifies the current passphrase; a recovery-key unlock resets without it.
 *
 * Returns `{ changing, unlockSecret, changePassphrase }` where:
 * - `changing`: boolean indicating if a change is in progress
 * - `unlockSecret`: which secret unlocked this session, or null while locked
 * - `changePassphrase`: async function that rewrites the passphrase
 */
export function useChangePassphrase() {
  const { toast } = useToast();
  const vaultSession = useOptionalVaultSession();
  const handle = vaultSession?.handle ?? null;
  const masterKeyBytes = vaultSession?.masterKeyBytes ?? null;
  const unlockSecret = vaultSession?.unlockSecret ?? null;
  const completePassphraseResetPrompt =
    vaultSession?.completePassphraseResetPrompt;

  const [changing, setChanging] = useState(false);

  const changePassphrase = useCallback(
    async (input: {
      currentPassphrase: string;
      newPassphrase: string;
    }): Promise<ChangePassphraseOutcome> => {
      if (!handle || masterKeyBytes === null) {
        toast({
          title: 'Cannot change passphrase',
          description: 'Unlock your vault first.',
          variant: 'destructive',
        });
        return 'error';
      }

      const authorizedBy: VaultUnlockSecret = unlockSecret ?? 'passphrase';

      setChanging(true);

      try {
        return await PASSPHRASE_REWRITE_FOR_UNLOCK_SECRET[authorizedBy]({
          handle,
          currentPassphrase: input.currentPassphrase,
          newPassphrase: input.newPassphrase,
          toast,
          onRecoveryComplete: completePassphraseResetPrompt,
        });
      } catch (error) {
        if (error instanceof VaultSecretMismatchError) {
          return 'wrong-passphrase';
        }

        toast({
          title: 'Passphrase change failed',
          description: getErrorMessage(error),
          variant: 'destructive',
        });
        return 'error';
      } finally {
        setChanging(false);
      }
    },
    [
      handle,
      masterKeyBytes,
      unlockSecret,
      completePassphraseResetPrompt,
      toast,
    ],
  );

  return { changing, unlockSecret, changePassphrase };
}
