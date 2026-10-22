'use client';

import { useCallback } from 'react';

import { Button, Illustration, openFeedbackDialog } from '@myorganiser/web-ui';

import type { AccountVariant } from '../account-view';

export interface YourReportsEmptyCardProps {
  variant: AccountVariant;
}

export function YourReportsEmptyCard({ variant }: YourReportsEmptyCardProps) {
  const handleSendFeedback = useCallback(() => {
    openFeedbackDialog();
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 rounded-panel border border-border bg-card px-6 py-14 text-center">
      <Illustration kind="feedback" size={variant === 'phone' ? 96 : 112} />
      <h2 className="font-display text-title text-foreground">
        You haven't sent any feedback yet.
      </h2>
      <Button variant="brand" onClick={handleSendFeedback}>
        Send feedback
      </Button>
    </div>
  );
}
