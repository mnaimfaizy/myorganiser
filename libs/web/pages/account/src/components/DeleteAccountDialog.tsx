'use client';

import { useCallback, useState } from 'react';

import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetHeader,
  BottomSheetTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@myorganiser/web-ui';

import type { AccountVariant } from '../account-view';
import { DeleteAccountConfirmForm } from './DeleteAccountConfirmForm';
import { DeleteAccountEscapeCopyStep } from './DeleteAccountEscapeCopyStep';

type DeleteAccountStep = 'escape-copy' | 'confirm';

interface DeleteAccountDialogProps {
  variant?: AccountVariant;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteAccountDialog({
  variant = 'desktop',
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

  const isPhone = variant === 'phone';
  const isEscapeCopyStep = step === 'escape-copy';

  // The shell is the only thing that differs by variant; the header and the
  // step bodies share one set of strings.
  const Header = isPhone ? BottomSheetHeader : DialogHeader;
  const Title = isPhone ? BottomSheetTitle : DialogTitle;
  const Description = isPhone ? BottomSheetDescription : DialogDescription;
  const headerClass = isPhone
    ? 'px-4 pt-2 pb-3'
    : 'gap-2 border-b border-border pt-6 pr-12 pb-4 pl-6';

  const header = (
    <Header className={headerClass}>
      <span className="text-caption font-semibold text-destructive-text">
        {isEscapeCopyStep ? 'Step 1 of 2' : 'Step 2 of 2'}
      </span>
      <Title>
        {isEscapeCopyStep ? 'Delete account' : 'Confirm account deletion'}
      </Title>
      <Description>
        {isEscapeCopyStep
          ? 'Before you delete your account, decide whether to keep a copy of your vault.'
          : "This cannot be undone. Your account, its Sessions, and your encrypted vault will be removed from our servers. Feedback Reports you've sent stay on our servers, but with your name and email removed — you won't be contacted about them again."}
      </Description>
    </Header>
  );

  const body = isEscapeCopyStep ? (
    <DeleteAccountEscapeCopyStep
      variant={variant}
      escapeCopyDownloaded={escapeCopyDownloaded}
      onEscapeCopyDownloaded={handleEscapeCopyDownloaded}
      onContinue={handleContinue}
      onCancel={handleCancel}
    />
  ) : (
    <DeleteAccountConfirmForm variant={variant} onBack={handleBack} />
  );

  if (isPhone) {
    return (
      <BottomSheet open={open} onOpenChange={handleOpenChange}>
        <BottomSheetContent
          data-testid="delete-account-dialog"
          className="gap-0 px-0"
        >
          {header}
          {body}
        </BottomSheetContent>
      </BottomSheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="delete-account-dialog"
        className="gap-0 rounded-2xl p-0 sm:max-w-[520px]"
      >
        {header}
        {body}
      </DialogContent>
    </Dialog>
  );
}
