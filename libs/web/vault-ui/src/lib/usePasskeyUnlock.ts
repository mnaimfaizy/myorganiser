'use client';

import { useCallback, useRef, useState } from 'react';

import { useToast } from '@myorganiser/web-ui';
import {
  isPasskeyUnlockEnrolled,
  masterKeyOpensLocalVault,
  unlockWithPasskey,
  type PasskeyUnlockOutcome,
} from '@myorganiser/web-vault';

import { useOptionalVaultSession } from './session';
import { usePasskeyPlatform } from './passkeyPlatformContext';

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
          masterKeyOpensLocalVault({ owner, masterKeyBytes }),
      });
      if (result.outcome === 'unlocked') {
        setMasterKeyBytes(result.masterKeyBytes, 'passkey');
        toast({
          title: 'Unlocked',
          description: 'Vault unlocked with your passkey for this session.',
        });
      } else if (
        result.outcome === 'stale' ||
        result.outcome === 'credential-gone'
      ) {
        // The record is already deleted, so the passkey option disappears and
        // the passphrase is what is offered. Informational, not an error the
        // User must dismiss before they can type.
        toast({
          title: 'Passkey Unlock was turned off',
          description:
            result.outcome === 'stale'
              ? 'This passkey no longer matches your vault. Enter your passphrase.'
              : 'This passkey is no longer available. Enter your passphrase.',
        });
      } else {
        toast({
          title: "Your passkey didn't unlock the vault",
          description:
            'Nothing was changed. Enter your passphrase, or try the passkey again.',
          variant: 'destructive',
        });
      }
      return result.outcome;
    } finally {
      inFlight.current = false;
      setUnlocking(false);
    }
  }, [owner, platform, setMasterKeyBytes, toast]);

  return { available, unlocking, unlock };
}
