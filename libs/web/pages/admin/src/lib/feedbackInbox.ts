import {
  FeedbackReportPlatform,
  type FeedbackReportKind,
  type FeedbackReportStatus,
} from '@myorganiser/app-api-client';

import { formatAuditTime, relativeDayLabel } from './auditLog';
import { formatDayMonth, formatShowingRange } from './userDirectory';

/** Rows per page. Desktop pages through it; phone appends one page at a time. */
export const FEEDBACK_INBOX_PAGE_SIZE = 25;

/** The strings the inbox shows in its body states. */
export const FEEDBACK_INBOX_MESSAGES = {
  loading: 'Loading…',
  error: 'Unable to load feedback reports. Please try again.',
  empty: 'No feedback reports match these filters.',
} as const;

export type FeedbackInboxVariant = 'desktop' | 'phone';

/**
 * The Platform filter's labels. The backend owns the same labels but does not
 * expose them, so the inbox keeps its own copy.
 */
export const FEEDBACK_REPORT_PLATFORM_LABELS = {
  web: 'Web',
  ios: 'iOS',
  android: 'Android',
} as const satisfies Record<FeedbackReportPlatform, string>;

/** Every platform, in the label table's order. */
export const FEEDBACK_REPORT_PLATFORMS = Object.keys(
  FEEDBACK_REPORT_PLATFORM_LABELS,
) as FeedbackReportPlatform[];

export function formatFeedbackReportPlatform(
  platform: FeedbackReportPlatform,
): string {
  return FEEDBACK_REPORT_PLATFORM_LABELS[platform];
}

export interface FeedbackInboxFilters {
  status: FeedbackReportStatus | undefined;
  kind: FeedbackReportKind | undefined;
  platform: FeedbackReportPlatform | undefined;
  /** The Tracking issue field as typed. Only a whole number from 1 filters. */
  trackingIssue: string;
}

export const NO_FEEDBACK_INBOX_FILTERS: FeedbackInboxFilters = {
  status: undefined,
  kind: undefined,
  platform: undefined,
  trackingIssue: '',
};

/**
 * The issue number the Tracking issue field filters by, or `undefined` when
 * the text is not a whole number from 1. Such text does not filter.
 */
export function parseTrackingIssueFilter(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number.parseInt(trimmed, 10);
  return value > 0 ? value : undefined;
}

/** True when any filter narrows the list. Unparseable issue text does not count. */
export function isFeedbackInboxFiltered(
  filters: FeedbackInboxFilters,
): boolean {
  return (
    filters.status !== undefined ||
    filters.kind !== undefined ||
    filters.platform !== undefined ||
    parseTrackingIssueFilter(filters.trackingIssue) !== undefined
  );
}

/**
 * The filters inside the phone sheet that are set: Kind, Platform and
 * Tracking issue. Status is not counted; its chips sit outside the sheet.
 */
export function countFeedbackSheetFilters(
  filters: FeedbackInboxFilters,
): number {
  return [
    filters.kind !== undefined,
    filters.platform !== undefined,
    parseTrackingIssueFilter(filters.trackingIssue) !== undefined,
  ].filter(Boolean).length;
}

/** "Showing 1–25 of 40 reports", or "… matching reports" under a filter. */
export function formatFeedbackShowingRange(
  page: number,
  pageSize: number,
  shownCount: number,
  total: number,
  filtered: boolean,
): string {
  const noun = filtered ? 'matching reports' : 'reports';
  return `${formatShowingRange(page, pageSize, shownCount, total)} ${noun}`;
}

/**
 * The desktop subtitle. The Received count ignores the filters; until it is
 * known, only the first sentence shows.
 */
export function formatFeedbackInboxSubtitle(
  receivedCount: number | undefined,
): string {
  const lead = 'Bug Reports and Suggestions, newest first.';
  if (receivedCount === undefined) return lead;
  const verb = receivedCount === 1 ? 'is' : 'are';
  return `${lead} ${receivedCount} ${verb} Received and waiting for triage.`;
}

/** The phone subtitle, "5 Received, waiting for triage". `null` until the count is known. */
export function formatFeedbackInboxPhoneSubtitle(
  receivedCount: number | undefined,
): string | null {
  if (receivedCount === undefined) return null;
  return `${receivedCount} Received, waiting for triage`;
}

/** The phone row's sent time: "10:42" today, "Yesterday", else "17 Oct". */
export function formatFeedbackPhoneSent(
  iso: string,
  now: Date = new Date(),
): string {
  const date = new Date(iso);
  const day = relativeDayLabel(date, now);
  if (day === 'Today') return formatAuditTime(iso);
  return day ?? formatDayMonth(date, now);
}
