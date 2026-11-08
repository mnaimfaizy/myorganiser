import type {
  FeedbackReportKind,
  FeedbackReportStatus,
} from '@myorganiser/app-api-client';

export const REPORT_KIND_LABELS = {
  bug_report: 'Bug report',
  suggestion: 'Suggestion',
} as const satisfies Record<FeedbackReportKind, string>;

/** The status each kind reaches once a Release delivers it (ADR 0133) — mirrors the backend's FEEDBACK_REPORT_KIND_RULES. */
export const DELIVERED_STATUS_BY_KIND = {
  bug_report: 'fixed',
  suggestion: 'shipped',
} as const satisfies Record<FeedbackReportKind, FeedbackReportStatus>;

// The tone comes from the shared FEEDBACK_REPORT_STATUS_TONES in @myorganiser/web-ui.
export const REPORT_STATUS_CONFIG = {
  received: { label: 'Received' },
  under_review: { label: 'Under review' },
  planned: { label: 'Planned' },
  fixed: { label: 'Fixed' },
  shipped: { label: 'Shipped' },
  wont_do: { label: "Won't do" },
  cannot_reproduce: { label: "Can't reproduce" },
} as const satisfies Record<FeedbackReportStatus, { label: string }>;
