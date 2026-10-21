'use client';

import type { VaultUnlockSecret } from '@myorganiser/web-vault-ui';

import { useChangePassphrase } from './useChangePassphrase';

/** Title, description and submit label for the unlock secret that authorised the change. */
export interface ChangePassphraseMode {
  title: string;
  description: string;
  submitLabel: string;
}

const CHANGE_PASSPHRASE_MODE_FOR_UNLOCK_SECRET = {
  passphrase: {
    title: 'Change passphrase',
    description:
      'Choose a new passphrase for unlocking your vault on this device.',
    submitLabel: 'Change passphrase',
  },
  'recovery-key': {
    title: 'Set new passphrase',
    description:
      'You unlocked with your recovery key. Choose a passphrase you will remember for unlocking your vault on this device.',
    submitLabel: 'Set new passphrase',
  },
} as const satisfies Record<VaultUnlockSecret, ChangePassphraseMode>;

/**
 * The mode the change passphrase surfaces show, derived from the unlock secret
 * that authorised this session. Shared by the card, the form, the screen and the
 * phone row so their titles, descriptions and submit labels cannot drift apart.
 * This is the one place a missing unlock secret defaults to `passphrase`.
 */
export function useChangePassphraseMode(): ChangePassphraseMode {
  const { unlockSecret } = useChangePassphrase();
  const authorizedBy: VaultUnlockSecret = unlockSecret ?? 'passphrase';
  return CHANGE_PASSPHRASE_MODE_FOR_UNLOCK_SECRET[authorizedBy];
}
