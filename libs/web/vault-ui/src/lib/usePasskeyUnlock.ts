'use client';

import { useCallback, useRef, useState } from 'react';

import { useToast } from '@myorganiser/web-ui';
import {
  createVaultApi,
  isPasskeyUnlockEnrolled,
  masterKeyOpensVault,
  unlockWithPasskey,
  type PasskeyUnlockOutcome,
} from '@myorganiser/web-vault';

import { useOptionalVaultSession } from './session';
import { usePasskeyPlatform } from './passkeyPlatformContext';

type UnlockToast = {
  title: string;
  description: string;
  variant?: 'destructive';
};

const FAILED_TOAST: UnlockToast = {
  title: "Your passkey didn't unlock the vault",
  description:
    'Nothing was changed. Enter your passphrase, or try the passkey again.',
  variant: 'destructive',
};

/**
 * The toast each passkey check ends with (ADR 0053). `stale` and
 * `credential-gone` already deleted the record, so the passkey option is gone
 * and the passphrase is offered: informational, never an error the User must
 * dismiss before they can type.
 */
const UNLOCK_TOAST = {
  unlocked: {
    title: 'Unlocked',
    description: 'Vault unlocked with your passkey for this session.',
  },
  stale: {
    title: 'Passkey Unlock was turned off',
    description:
      'This passkey no longer matches your vault. Enter your passphrase.',
  },
  'credential-gone': {
    title: 'Passkey Unlock was turned off',
    description: 'This passkey is no longer available. Enter your passphrase.',
  },
  'not-enrolled': FAILED_TOAST,
  failed: FAILED_TOAST,
} as const satisfies Record<PasskeyUnlockOutcome['outcome'], UnlockToast>;

export type PasskeyUnlockState = {
  /** This owner holds a passkey wrapping record on this device. */
  available: boolean;
  unlocking: boolean;
  /** Run the passkey check; a success unlocks the session with `'passkey'`. */
  unlock: () => Promise<PasskeyUnlockOutcome['outcome']>;
};

/**
 * The vault gate's passkey option (ADR 0136). Offered only to the owner whose
 * record is on this device, and only with a Vault Session mounted. A cancelled
 * or failed check deletes nothing: the passphrase and Recovery Key stay.
 */
export function usePasskeyUnlock(): PasskeyUnlockState {
  const session = useOptionalVaultSession();
  const platform = usePasskeyPlatform();
  const { toast } = useToast();
  const [unlocking, setUnlocking] = useState(false);
  const inFlight = useRef(false);

  const owner = session?.handle?.owner ?? null;
  const setMasterKeyBytes = session?.setMasterKeyBytes ?? null;
  // Read at render, like the gate's own `vaultStatus()`: a record written or
  // removed re-renders through the unlock it accompanies.
  const available = owner !== null && isPasskeyUnlockEnrolled(owner);

  const unlock = useCallback(async (): Promise<
    PasskeyUnlockOutcome['outcome']
  > => {
    if (owner === null || setMasterKeyBytes === null) return 'not-enrolled';
    if (inFlight.current) return 'failed';
    inFlight.current = true;
    setUnlocking(true);
    try {
      const result = await unlockWithPasskey({
        owner,
        platform,
        verifyMasterKey: (masterKeyBytes) =>
          masterKeyOpensVault({
            owner,
            masterKeyBytes,
            api: createVaultApi(),
          }),
      });
      if (result.outcome === 'unlocked') {
        setMasterKeyBytes(result.masterKeyBytes, 'passkey');
      }
      toast(UNLOCK_TOAST[result.outcome]);
      return result.outcome;
    } finally {
      inFlight.current = false;
      setUnlocking(false);
    }
  }, [owner, platform, setMasterKeyBytes, toast]);

  return { available, unlocking, unlock };
}
