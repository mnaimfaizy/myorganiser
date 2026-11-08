'use client';

import { useCallback } from 'react';

import { PasskeyUnlockOffer } from './PasskeyUnlockOffer';
import { usePasskeyUnlockOffer } from './usePasskeyUnlockOffer';

/**
 * The binding for the one-time Passkey Unlock offer (ADR 0136). Owns the
 * offer's state through `usePasskeyUnlockOffer` and hands it to the
 * presentational `PasskeyUnlockOffer`. Mount once, in the dashboard layout.
 */
export function PasskeyUnlockOfferRunner() {
  const { open, enrolling, accept, decline } = usePasskeyUnlockOffer();

  const handleAccept = useCallback(() => {
    void accept();
  }, [accept]);

  return (
    <PasskeyUnlockOffer
      open={open}
      enrolling={enrolling}
      onAccept={handleAccept}
      onDecline={decline}
    />
  );
}
