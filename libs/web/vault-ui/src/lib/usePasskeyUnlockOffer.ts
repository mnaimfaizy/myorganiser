'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getCurrentUser } from '@myorganiser/auth';
import { useToast } from '@myorganiser/web-ui';
import {
  canOfferPasskeyUnlock,
  enrolPasskeyUnlock,
  recordPasskeyUnlockOffered,
  type PasskeyEnrolmentOutcome,
} from '@myorganiser/web-vault';

import { useOptionalVaultSession, type VaultUnlockSecret } from './session';
import { usePasskeyPlatform } from './passkeyPlatformContext';

/**
 * Which unlocks are followed by the one-time offer. Only a passphrase unlock
 * is: a passkey unlock is already enrolled, and a Recovery Key unlock owes the
 * Passphrase Reset Prompt instead (ADR 0095, ADR 0136).
 */
const PASSKEY_UNLOCK_OFFERED_AFTER = {
  passphrase: true,
  'recovery-key': false,
  passkey: false,
} as const satisfies Record<VaultUnlockSecret, boolean>;

export type EnrolmentToast = {
  title: string;
  description: string;
  variant?: 'destructive';
};

/** The toast each enrolment outcome ends in; shared by the offer and the Vault page card. */
export const ENROLMENT_TOAST = {
  enrolled: {
    title: 'Passkey Unlock is on',
    description:
      'Next time, unlock your vault on this device with your passkey.',
  },
  unsupported: {
    title: "This passkey can't unlock your vault",
    description:
      'Your browser or passkey provider does not support it. Nothing was saved; keep using your passphrase.',
  },
  failed: {
    title: 'Passkey Unlock was not set up',
    description: 'Nothing was saved. Keep using your passphrase.',
    variant: 'destructive',
  },
} as const satisfies Record<PasskeyEnrolmentOutcome, EnrolmentToast>;

export type PasskeyUnlockOfferState = {
  /** The offer is owed for the current passphrase unlock. */
  open: boolean;
  enrolling: boolean;
  /** Set up a passkey on this device. Ends the offer whatever happens. */
  accept: () => Promise<PasskeyEnrolmentOutcome | null>;
  /** Decline. Remembered for this owner on this device. */
  decline: () => void;
};

/**
 * The one-time Passkey Unlock offer (ADR 0136). Owed after a passphrase
 * unlock when the browser can create passkeys and this owner has neither a
 * wrapping record nor an answered offer on this device. Asked at most once
 * per unlock, and answering it — either way — is recorded for this owner.
 */
export function usePasskeyUnlockOffer(): PasskeyUnlockOfferState {
  const session = useOptionalVaultSession();
  const platform = usePasskeyPlatform();
  const { toast } = useToast();

  const owner = session?.handle?.owner ?? null;
  const masterKeyBytes = session?.masterKeyBytes ?? null;
  const unlockSecret = session?.unlockSecret ?? null;

  // The unlock — identified by its Master Key bytes — the offer is owed for.
  const [offeredFor, setOfferedFor] = useState<Uint8Array | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const askedFor = useRef<Uint8Array | null>(null);

  useEffect(() => {
    if (owner === null || masterKeyBytes === null || unlockSecret === null) {
      return;
    }
    if (!PASSKEY_UNLOCK_OFFERED_AFTER[unlockSecret]) return;
    if (askedFor.current === masterKeyBytes) return;
    askedFor.current = masterKeyBytes;

    let cancelled = false;
    void canOfferPasskeyUnlock({ owner, platform }).then((offerable) => {
      if (!cancelled && offerable) setOfferedFor(masterKeyBytes);
    });
    return () => {
      cancelled = true;
    };
  }, [owner, masterKeyBytes, unlockSecret, platform]);

  const open =
    owner !== null &&
    offeredFor !== null &&
    offeredFor === masterKeyBytes &&
    unlockSecret !== null &&
    PASSKEY_UNLOCK_OFFERED_AFTER[unlockSecret];

  const decline = useCallback(() => {
    if (owner !== null) recordPasskeyUnlockOffered(owner);
    setOfferedFor(null);
  }, [owner]);

  const accept =
    useCallback(async (): Promise<PasskeyEnrolmentOutcome | null> => {
      if (owner === null || masterKeyBytes === null) return null;
      recordPasskeyUnlockOffered(owner);
      setEnrolling(true);
      try {
        const outcome = await enrolPasskeyUnlock({
          owner,
          masterKeyBytes,
          userName: getCurrentUser()?.email ?? 'MyOrganiser vault',
          platform,
        });
        toast(ENROLMENT_TOAST[outcome]);
        return outcome;
      } finally {
        setEnrolling(false);
        setOfferedFor(null);
      }
    }, [owner, masterKeyBytes, platform, toast]);

  return { open, enrolling, accept, decline };
}
