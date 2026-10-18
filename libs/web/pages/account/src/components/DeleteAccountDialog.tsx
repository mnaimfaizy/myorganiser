'use client';

import { useCallback, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@myorganiser/web-ui';

import { DeleteAccountConfirmForm } from './DeleteAccountConfirmForm';
import { DeleteAccountEscapeCopyStep } from './DeleteAccountEscapeCopyStep';

type DeleteAccountStep = 'escape-copy' | 'confirm';

interface DeleteAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteAccountDialog({
  open,
  onOpenChange,
}: DeleteAccountDialogProps) {
  const [step, setStep] = useState<DeleteAccountStep>('escape-copy');
  const [escapeCopyDownloaded, setEscapeCopyDownloaded] = useState(false);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        // Reset on close: the confirm form unmounts with its step, so its
        // state goes too.
        setStep('escape-copy');
        setEscapeCopyDownloaded(false);
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const handleEscapeCopyDownloaded = useCallback(() => {
    setEscapeCopyDownloaded(true);
  }, []);

  const handleContinue = useCallback(() => {
    setStep('confirm');
  }, []);

  const handleBack = useCallback(() => {
    setStep('escape-copy');
  }, []);

  const handleCancel = useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="delete-account-dialog">
        {step === 'escape-copy' ? (
          <>
            <DialogHeader>
              <DialogTitle>Delete account</DialogTitle>
              <DialogDescription>
                Before you delete your account, decide whether to keep a copy of
                your vault.
              </DialogDescription>
            </DialogHeader>
            <DeleteAccountEscapeCopyStep
              escapeCopyDownloaded={escapeCopyDownloaded}
              onEscapeCopyDownloaded={handleEscapeCopyDownloaded}
              onContinue={handleContinue}
              onCancel={handleCancel}
            />
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Confirm account deletion</DialogTitle>
              <DialogDescription>
                This cannot be undone. Your account, its Sessions, and your
                encrypted vault will be removed from our servers. Feedback
                Reports you've sent stay on our servers, but with your name and
                email removed — you won't be contacted about them again.
              </DialogDescription>
            </DialogHeader>
            <DeleteAccountConfirmForm onBack={handleBack} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
