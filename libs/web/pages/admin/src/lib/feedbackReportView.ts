import type { AdminFeedbackReportDetailDto } from '@myorganiser/app-api-client';

/**
 * Which reading-column layout a report renders. The page client decides it
 * from `useIsMobileState()`: desktop is 768px and up, phone is below.
 */
export type ReportVariant = 'desktop' | 'phone';

/** Body copy inside a report card. Keeps the line breaks the reporter typed. */
export const REPORT_BODY_CLASS_NAME =
  'whitespace-pre-wrap break-words text-body-sm text-foreground-secondary';

/** The heading of a report card or a triage section (one h2 or h3 per card). */
export const REPORT_HEADING_CLASS_NAME =
  'font-display text-body font-bold text-foreground';

/** The muted note under a heading. */
export const REPORT_NOTE_CLASS_NAME = 'text-caption text-muted-foreground';

export function getFixNoticeSentence(report: AdminFeedbackReportDetailDto) {
  return report.fixNoticeOptIn
    ? 'The sender asked to be emailed when this is fixed.'
    : 'The sender did not ask to be emailed.';
}
