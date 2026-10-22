'use client';

import { Illustration } from '@myorganiser/web-ui';
import type { ReactNode } from 'react';

import {
  formatFeedbackInboxPhoneSubtitle,
  formatFeedbackInboxSubtitle,
  type FeedbackInboxVariant,
} from '../../../lib/feedbackInbox';

export interface FeedbackInboxHeaderProps {
  variant: FeedbackInboxVariant;
  /** Received reports across the whole inbox. Undefined until known. */
  receivedCount: number | undefined;
  /** Phone places the Filters trigger here, at the end of the title row. */
  children?: ReactNode;
}

/**
 * The Feedback title row. The one h1 for every width. Desktop adds the
 * subtitle under the title; phone adds a shorter caption, and `children` sit at
 * the row's end, on the same line.
 */
export function FeedbackInboxHeader({
  variant,
  receivedCount,
  children,
}: FeedbackInboxHeaderProps) {
  const isPhone = variant === 'phone';
  const subtitle = isPhone
    ? formatFeedbackInboxPhoneSubtitle(receivedCount)
    : formatFeedbackInboxSubtitle(receivedCount);

  return (
    <div className="flex items-center gap-3 md:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3 md:gap-4">
        {/* IllustrationSize has no 44, so the phone uses the 48 step. */}
        <Illustration kind="inbox" size={isPhone ? 48 : 64} />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-display text-foreground">
            Feedback
          </h1>
          {subtitle !== null ? (
            <p
              className={
                isPhone
                  ? 'text-caption text-muted-foreground'
                  : 'text-body-sm text-muted-foreground'
              }
            >
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}
