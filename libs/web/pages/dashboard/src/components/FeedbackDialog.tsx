'use client';

import { useCallback } from 'react';

import {
  BottomSheet,
  BottomSheetContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Illustration,
  useIsMobileState,
} from '@myorganiser/web-ui';

import {
  useFeedbackDialogOpen,
  setFeedbackDialogOpen,
} from '../hooks/use-feedback-dialog';
import { FEEDBACK_DIALOG_DESCRIPTION } from '../schemas/feedback-report';
import { FeedbackReportForm } from './FeedbackReportForm';

export function FeedbackDialog() {
  const isOpen = useFeedbackDialogOpen();
  // undefined until the breakpoint is decided (first effect); see useIsMobileState.
  const isPhone = useIsMobileState();

  const handleOpenChange = useCallback((open: boolean) => {
    setFeedbackDialogOpen(open);
  }, []);

  const handleSent = useCallback(() => {
    setFeedbackDialogOpen(false);
  }, []);

  const handleCancel = useCallback(() => {
    setFeedbackDialogOpen(false);
  }, []);

  // Render nothing until the breakpoint is known, so the phone never flashes
  // the desktop Dialog. The dialog opens from a click, after this frame.
  if (isPhone === undefined) {
    return null;
  }

  if (isPhone) {
    return (
      <BottomSheet open={isOpen} onOpenChange={handleOpenChange}>
        <BottomSheetContent className="h-[calc(100dvh_-_2.5rem)] max-h-[calc(100dvh_-_2.5rem)] gap-0 overflow-hidden px-0">
          <FeedbackReportForm
            variant="phone"
            onSent={handleSent}
            onCancel={handleCancel}
          />
        </BottomSheetContent>
      </BottomSheet>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-[640px] gap-0 overflow-y-auto p-0">
        <DialogHeader className="flex-row items-center gap-3.5 border-b border-border px-6 pt-6 pr-14 pb-4">
          <Illustration kind="feedback" size={48} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <DialogTitle>Send feedback</DialogTitle>
            <DialogDescription>{FEEDBACK_DIALOG_DESCRIPTION}</DialogDescription>
          </div>
        </DialogHeader>

        <FeedbackReportForm onSent={handleSent} onCancel={handleCancel} />
      </DialogContent>
    </Dialog>
  );
}
