'use client';

import { useCallback } from 'react';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@myorganiser/web-ui';

export interface PasskeyUnlockOfferProps {
  open: boolean;
  enrolling: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

/**
 * The one-time Passkey Unlock offer (ADR 0136), shown after a passphrase
 * unlock. Presentation only: the owner that decides when to open it and runs
 * the enrolment is `PasskeyUnlockOfferRunner`. Escape, the overlay, and the
 * close button are a decline, except while the enrolment is in flight.
 */
export function PasskeyUnlockOffer({
  open,
  enrolling,
  onAccept,
  onDecline,
}: PasskeyUnlockOfferProps) {
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen || enrolling) return;
      onDecline();
    },
    [onDecline, enrolling],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unlock faster with a passkey?</DialogTitle>
          <DialogDescription>
            Set up a passkey on this device and unlock your vault with your
            fingerprint, face, or device PIN. Your passphrase and Recovery Key
            still work. Nothing is sent to the server.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onDecline}
            disabled={enrolling}
          >
            Not now
          </Button>
          <Button
            type="button"
            variant="brand"
            onClick={onAccept}
            disabled={enrolling}
          >
            {enrolling ? 'Setting up…' : 'Set up passkey'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
