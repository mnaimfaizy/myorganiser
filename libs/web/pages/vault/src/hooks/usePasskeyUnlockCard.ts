'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getCurrentUser } from '@myorganiser/auth';
import { useToast } from '@myorganiser/web-ui';
import {
  disablePasskeyUnlock,
  enrolPasskeyUnlock,
  isPasskeyUnlockEnrolled,
  VaultSecretMismatchError,
  type PasskeyEnrolmentOutcome,
} from '@myorganiser/web-vault';
import {
  ENROLMENT_TOAST,
  type EnrolmentToast,
  useOptionalVaultSession,
  usePasskeyPlatform,
} from '@myorganiser/web-vault-ui';

/** How turning Passkey Unlock on ended. Only `ok` leaves a wrapping record. */
export type PasskeyUnlockEnableOutcome =
  | 'ok'
  | 'wrong-passphrase'
  | Exclude<PasskeyEnrolmentOutcome, 'enrolled'>;

export interface PasskeyUnlockCardState {
  /** `null` while the browser is being asked; `true` only if it can create passkeys. */
  supported: boolean | null;
  /** This owner holds a passkey wrapping record on this device. */
  enrolled: boolean;
  /** An enable is in flight. */
  busy: boolean;
  /** Verify the passphrase, then enrol a passkey wrapping the verified Master Key. */
  enable: (passphrase: string) => Promise<PasskeyUnlockEnableOutcome>;
  /** Delete this device's wrapping record for the owner. */
  disable: () => void;
}

const DISABLED_TOAST: EnrolmentToast = {
  title: 'Passkey Unlock is off',
  description: 'This device unlocks with your passphrase again.',
};

const DISABLE_FAILED_TOAST: EnrolmentToast = {
  title: "Passkey Unlock couldn't be turned off",
  description: 'Nothing changed. Try again.',
  variant: 'destructive',
};

/**
 * The Settings-side Passkey Unlock state for the Vault page (ADR 0136). Turning
 * it on is a passphrase-authorized act: the passphrase is verified first, and
 * the passkey wraps the Master Key that verification returned, never the
 * session's. Turning it off deletes this device's record only.
 */
export function usePasskeyUnlockCard(): PasskeyUnlockCardState {
  const session = useOptionalVaultSession();
  const platform = usePasskeyPlatform();
  const { toast } = useToast();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped after an enable or disable so the render re-reads the record.
  const [, setRevision] = useState(0);
  const inFlight = useRef(false);

  const handle = session?.handle ?? null;
  const owner = handle?.owner ?? null;
  // Read at render, like the unlock hooks: the write it accompanies re-renders.
  const enrolled = owner !== null && isPasskeyUnlockEnrolled(owner);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const can = await platform.canCreatePasskeys();
        if (!cancelled) setSupported(can);
      } catch {
        if (!cancelled) setSupported(false);
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [platform]);

  const enable = useCallback(
    async (passphrase: string): Promise<PasskeyUnlockEnableOutcome> => {
      if (handle === null || owner === null) return 'failed';
      if (inFlight.current) return 'failed';
      inFlight.current = true;
      setBusy(true);
      try {
        // The passphrase is checked before any passkey ceremony, so a wrong
        // passphrase never reaches enrolPasskeyUnlock.
        let masterKeyBytes: Uint8Array;
        try {
          const unlocked = await handle.unlockWithPassphrase({ passphrase });
          masterKeyBytes = unlocked.masterKeyBytes;
        } catch (error) {
          if (error instanceof VaultSecretMismatchError) {
            return 'wrong-passphrase';
          }
          toast(ENROLMENT_TOAST.failed);
          return 'failed';
        }

        const outcome = await enrolPasskeyUnlock({
          owner,
          masterKeyBytes,
          userName: getCurrentUser()?.email ?? 'MyOrganiser vault',
          platform,
        });
        toast(ENROLMENT_TOAST[outcome]);
        setRevision((n) => n + 1);
        return outcome === 'enrolled' ? 'ok' : outcome;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [handle, owner, platform, toast],
  );

  const disable = useCallback(() => {
    if (owner === null) return;
    if (disablePasskeyUnlock(owner)) {
      toast(DISABLED_TOAST);
    } else {
      toast(DISABLE_FAILED_TOAST);
    }
    setRevision((n) => n + 1);
  }, [owner, toast]);

  return { supported, enrolled, busy, enable, disable };
}
