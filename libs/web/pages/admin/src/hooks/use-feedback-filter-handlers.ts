'use client';

import { type ChangeEvent, useCallback } from 'react';

import {
  FEEDBACK_REPORT_KINDS,
  FEEDBACK_REPORT_STATUSES,
} from '../lib/formatFeedbackReport';
import {
  FEEDBACK_REPORT_PLATFORMS,
  type FeedbackInboxFilters as FeedbackFilterValues,
} from '../lib/feedbackInbox';

export interface FeedbackFilterHandlers {
  handleStatusChange: (value: string) => void;
  handleKindChange: (value: string) => void;
  handlePlatformChange: (value: string) => void;
  handleTrackingIssueChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

/**
 * The change handlers shared by the desktop filter toolbar and the phone
 * filter sheet. Each maps a control's value onto a partial filter and hands it
 * to `onChange`, which merges it in and resets paging.
 */
export function useFeedbackFilterHandlers(
  onChange: (next: Partial<FeedbackFilterValues>) => void,
): FeedbackFilterHandlers {
  const handleStatusChange = useCallback(
    (value: string) => {
      onChange({
        status: FEEDBACK_REPORT_STATUSES.find((status) => status === value),
      });
    },
    [onChange],
  );

  const handleKindChange = useCallback(
    (value: string) => {
      onChange({
        kind: FEEDBACK_REPORT_KINDS.find((kind) => kind === value),
      });
    },
    [onChange],
  );

  const handlePlatformChange = useCallback(
    (value: string) => {
      onChange({
        platform: FEEDBACK_REPORT_PLATFORMS.find(
          (platform) => platform === value,
        ),
      });
    },
    [onChange],
  );

  const handleTrackingIssueChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onChange({ trackingIssue: event.target.value });
    },
    [onChange],
  );

  return {
    handleStatusChange,
    handleKindChange,
    handlePlatformChange,
    handleTrackingIssueChange,
  };
}
