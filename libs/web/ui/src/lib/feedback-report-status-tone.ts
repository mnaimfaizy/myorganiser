import type { StatusPillTone } from './components/StatusPill/StatusPill';

/**
 * The feedback report statuses, declared here because web-ui cannot import the
 * API client (module boundaries). Consumers index the table with the API's
 * FeedbackReportStatus, so a status the API adds fails to compile until it
 * gets a tone here.
 */
export type FeedbackReportStatusKey =
  | 'received'
  | 'under_review'
  | 'planned'
  | 'fixed'
  | 'shipped'
  | 'wont_do'
  | 'cannot_reproduce';

/**
 * The StatusPill tone of every feedback report status, shared by the admin
 * inbox and the account "Your reports" view so the two never drift (ADR 0053).
 * Under review is info blue; Can't reproduce is the warning outline.
 */
export const FEEDBACK_REPORT_STATUS_TONES = {
  received: 'neutral',
  under_review: 'info',
  planned: 'brand',
  fixed: 'trust',
  shipped: 'trust',
  wont_do: 'danger',
  cannot_reproduce: 'outline',
} as const satisfies Record<FeedbackReportStatusKey, StatusPillTone>;
