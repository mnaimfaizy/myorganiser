import type {
  FeedbackReportKind,
  FeedbackReportStatus,
} from '@myorganiser/app-api-client';
import type { StatusPillTone } from '@myorganiser/web-ui';

export const REPORT_KIND_LABELS = {
  bug_report: 'Bug report',
  suggestion: 'Suggestion',
} as const satisfies Record<FeedbackReportKind, string>;

/** The status each kind reaches once a Release delivers it (ADR 0133) — mirrors the backend's FEEDBACK_REPORT_KIND_RULES. */
export const DELIVERED_STATUS_BY_KIND = {
  bug_report: 'fixed',
  suggestion: 'shipped',
} as const satisfies Record<FeedbackReportKind, FeedbackReportStatus>;

// The tones mirror FEEDBACK_REPORT_STATUS_RULES.tone in
// libs/web/pages/admin/src/lib/formatFeedbackReport.ts; page libs cannot import each other.
export const REPORT_STATUS_CONFIG = {
  received: { label: 'Received', tone: 'neutral' },
  under_review: { label: 'Under review', tone: 'neutral' },
  planned: { label: 'Planned', tone: 'brand' },
  fixed: { label: 'Fixed', tone: 'trust' },
  shipped: { label: 'Shipped', tone: 'trust' },
  wont_do: { label: "Won't do", tone: 'danger' },
  cannot_reproduce: { label: "Can't reproduce", tone: 'warning' },
} as const satisfies Record<
  FeedbackReportStatus,
  {
    label: string;
    tone: StatusPillTone;
  }
>;
