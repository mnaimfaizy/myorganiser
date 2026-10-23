'use client';

import type { FeedbackReportStatus } from '@myorganiser/app-api-client';
import { ChoiceChip } from '@myorganiser/web-ui';

import {
  FEEDBACK_REPORT_STATUSES,
  formatFeedbackReportStatus,
} from '../../../lib/formatFeedbackReport';

export interface FeedbackStatusChipsProps {
  status: FeedbackReportStatus | undefined;
  /** `undefined` is "All statuses". Pressing the pressed chip changes nothing. */
  onStatusChange: (next: FeedbackReportStatus | undefined) => void;
}

/**
 * The phone Status filter: one scrolling row of single-select chips. It sits
 * outside the filter sheet, as the status control always has on phone.
 */
export function FeedbackStatusChips({
  status,
  onStatusChange,
}: FeedbackStatusChipsProps) {
  return (
    <div
      role="toolbar"
      aria-label="Status"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <ChoiceChip
        pressed={status === undefined}
        onPressedChange={() => onStatusChange(undefined)}
      >
        All statuses
      </ChoiceChip>
      {FEEDBACK_REPORT_STATUSES.map((chipStatus) => (
        <ChoiceChip
          key={chipStatus}
          pressed={status === chipStatus}
          onPressedChange={() => onStatusChange(chipStatus)}
        >
          {formatFeedbackReportStatus(chipStatus)}
        </ChoiceChip>
      ))}
    </div>
  );
}
