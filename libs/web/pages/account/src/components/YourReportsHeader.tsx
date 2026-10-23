'use client';

import { Plus } from 'lucide-react';

import {
  Button,
  IconButton,
  Illustration,
  openFeedbackDialog,
} from '@myorganiser/web-ui';

import type { AccountVariant } from '../account-view';

const SUBTITLE =
  "See the status of every Bug Report and Suggestion you've sent.";

export interface YourReportsHeaderProps {
  variant: AccountVariant;
}

export function YourReportsHeader({ variant }: YourReportsHeaderProps) {
  if (variant === 'phone') {
    // The app shell draws the pushed title, so the h1 is visually hidden.
    return (
      <div className="flex items-start gap-3">
        <Illustration kind="feedback" size={48} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="sr-only">Your reports</h1>
          <p className="text-caption text-muted-foreground">{SUBTITLE}</p>
        </div>
        <IconButton
          variant="brand"
          label="Send feedback"
          icon={<Plus />}
          onClick={openFeedbackDialog}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Illustration kind="feedback" size={64} />
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="m-0 font-display text-title-lg text-foreground">
          Your reports
        </h1>
        <p className="text-body text-muted-foreground">{SUBTITLE}</p>
      </div>
      <Button variant="brand" onClick={openFeedbackDialog}>
        Send feedback
      </Button>
    </div>
  );
}
