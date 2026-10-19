'use client';

import { useCallback } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@myorganiser/web-ui';

import {
  useFeedbackDialogOpen,
  setFeedbackDialogOpen,
} from '../hooks/use-feedback-dialog';
import { FeedbackReportForm } from './FeedbackReportForm';

export function FeedbackDialog() {
  const isOpen = useFeedbackDialogOpen();

  const handleOpenChange = useCallback((open: boolean) => {
    setFeedbackDialogOpen(open);
  }, []);

  const handleSent = useCallback(() => {
    setFeedbackDialogOpen(false);
  }, []);

  const handleCancel = useCallback(() => {
    setFeedbackDialogOpen(false);
  }, []);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            Help us improve MyOrganiser by sharing your thoughts.
          </DialogDescription>
        </DialogHeader>

        <FeedbackReportForm onSent={handleSent} onCancel={handleCancel} />
      </DialogContent>
    </Dialog>
  );
}
