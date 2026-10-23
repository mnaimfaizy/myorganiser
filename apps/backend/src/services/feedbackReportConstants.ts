import type {
  FeedbackReportKind as PrismaFeedbackReportKind,
  FeedbackReportStatus as PrismaFeedbackReportStatus,
} from '@prisma/client';
import {
  FEEDBACK_REPORT_TITLE_MAX_LENGTH as CORE_FEEDBACK_REPORT_TITLE_MAX_LENGTH,
  FEEDBACK_REPORT_TEXT_MAX_LENGTH as CORE_FEEDBACK_REPORT_TEXT_MAX_LENGTH,
  FEEDBACK_REPORT_FOLLOW_UP_MAX_LENGTH as CORE_FEEDBACK_REPORT_FOLLOW_UP_MAX_LENGTH,
  FEEDBACK_REPORTS_PER_DAY_LIMIT as CORE_FEEDBACK_REPORTS_PER_DAY_LIMIT,
  FEEDBACK_REPORT_RATE_WINDOW_MS as CORE_FEEDBACK_REPORT_RATE_WINDOW_MS,
} from '@myorganiser/core';

/** A Feedback Report is a Bug Report or a Suggestion (CONTEXT.md: Feedback). */
export type FeedbackReportKind = 'bug_report' | 'suggestion';

/** Where a Feedback Report stands as its reporter sees it. There is no Duplicate status. */
export type FeedbackReportStatus =
  | 'received'
  | 'under_review'
  | 'planned'
  | 'fixed'
  | 'shipped'
  | 'wont_do'
  | 'cannot_reproduce';

export interface FeedbackReportKindRule {
  /** The kind in the reader's own words, mid-sentence — "Only a bug report …". */
  label: string;
  /** Only a Bug Report carries what its sender expected to happen. */
  allowsExpectedOutcome: boolean;
  /** The status this kind reaches once a Release delivers it (ADR 0133). */
  deliveredStatus: FeedbackReportStatus;
}

export interface FeedbackReportStatusRule {
  /** The status as a reader sees it, so a refusal never spells one out twice. */
  label: string;
  /** Who moves a report into this status. */
  setBy: readonly ('system' | 'admin' | 'release' | 'reporter')[];
  /** The kinds the status can apply to. */
  kinds: readonly FeedbackReportKind[];
  /** Whether the status change always carries a Status Note for the reporter. */
  requiresStatusNote: boolean;
  /** Whether the status is final — re-marking it for the same Release is a no-op, and only a Reopen leaves it. */
  isFinal: boolean;
}

const BOTH_KINDS = ['bug_report', 'suggestion'] as const;

/**
 * The one table every fan-out over the report kind reaches (ADR 0053).
 *
 * It satisfies both the hand-written union above and the Prisma enum, so the
 * two lists cannot drift: a third kind in the schema fails to compile here
 * until it is given a home.
 */
export const FEEDBACK_REPORT_KIND_RULES = {
  bug_report: {
    label: 'bug report',
    allowsExpectedOutcome: true,
    deliveredStatus: 'fixed',
  },
  suggestion: {
    label: 'suggestion',
    allowsExpectedOutcome: false,
    deliveredStatus: 'shipped',
  },
} as const satisfies Record<FeedbackReportKind, FeedbackReportKindRule> &
  Record<PrismaFeedbackReportKind, FeedbackReportKindRule>;

/**
 * The one table every fan-out over the Report Status reaches (ADR 0053), and
 * the single place the status semantics from PRD #1206 and ADR 0133 live:
 *
 * - the system sets Received; an admin moves a report between Under review,
 *   Planned, Won't do, and Can't reproduce; a reporter's Follow-up also moves
 *   a Can't reproduce report back to Under review;
 * - Fixed applies only to a Bug Report, Shipped only to a Suggestion, and
 *   Can't reproduce only to a Bug Report;
 * - Won't do and Can't reproduce always carry a Status Note;
 * - Fixed and Shipped are final, set by the Release-marking path or an admin;
 *   only an admin Reopen (issue #1228) moves a report out of them.
 *
 * Later slices (the reporter's own list, the Platform Admin inbox, the
 * Release-marking endpoint) read this table rather than re-enumerating it.
 * Like the kind table it satisfies the Prisma enum too, so a status added to
 * the schema fails to compile until it declares who sets it.
 */
export const FEEDBACK_REPORT_STATUS_RULES = {
  received: {
    label: 'Received',
    setBy: ['system'] as const,
    kinds: BOTH_KINDS,
    requiresStatusNote: false,
    isFinal: false,
  },
  under_review: {
    label: 'Under review',
    setBy: ['admin', 'reporter'] as const,
    kinds: BOTH_KINDS,
    requiresStatusNote: false,
    isFinal: false,
  },
  planned: {
    label: 'Planned',
    setBy: ['admin'] as const,
    kinds: BOTH_KINDS,
    requiresStatusNote: false,
    isFinal: false,
  },
  fixed: {
    label: 'Fixed',
    setBy: ['release', 'admin'] as const,
    kinds: ['bug_report'],
    requiresStatusNote: false,
    isFinal: true,
  },
  shipped: {
    label: 'Shipped',
    setBy: ['release', 'admin'] as const,
    kinds: ['suggestion'],
    requiresStatusNote: false,
    isFinal: true,
  },
  wont_do: {
    label: "Won't do",
    setBy: ['admin'] as const,
    kinds: BOTH_KINDS,
    requiresStatusNote: true,
    isFinal: false,
  },
  cannot_reproduce: {
    label: "Can't reproduce",
    setBy: ['admin'] as const,
    kinds: ['bug_report'],
    requiresStatusNote: true,
    isFinal: false,
  },
} as const satisfies Record<FeedbackReportStatus, FeedbackReportStatusRule> &
  Record<PrismaFeedbackReportStatus, FeedbackReportStatusRule>;

/** Derived from the kind table, so the members are never listed twice. */
export const FEEDBACK_REPORT_KINDS = Object.keys(
  FEEDBACK_REPORT_KIND_RULES,
) as FeedbackReportKind[];

/** Derived from the status table, so the members are never listed twice. */
export const FEEDBACK_REPORT_STATUSES = Object.keys(
  FEEDBACK_REPORT_STATUS_RULES,
) as FeedbackReportStatus[];

/**
 * The status whose rule says the system sets it, read out of the table by the
 * type checker rather than written a second time. It resolves to exactly the
 * one member marked with `'system'` in its `setBy` list, so moving that mark —
 * or marking two members — fails to compile on the line below instead of
 * silently giving new reports the wrong status.
 */
type SystemSetFeedbackReportStatus = {
  [Status in FeedbackReportStatus]: (typeof FEEDBACK_REPORT_STATUS_RULES)[Status]['setBy'][number] extends 'system'
    ? Status
    : never;
}[FeedbackReportStatus];

/** The Report Status a newly created Feedback Report carries. */
export const INITIAL_FEEDBACK_REPORT_STATUS: SystemSetFeedbackReportStatus =
  'received';

/**
 * Which app sent a Feedback Report, as the Report Context platform: `web` for
 * the dashboard, `ios` and `android` for the mobile app. The database column
 * stays a plain string, so rows stored before this type are still readable.
 */
export type FeedbackReportPlatform = 'web' | 'ios' | 'android';

/**
 * The one table every fan-out over the report platform reaches (ADR 0053).
 * It is the only list of the platform members.
 */
export const FEEDBACK_REPORT_PLATFORM_RULES = {
  web: { label: 'Web' },
  ios: { label: 'iOS' },
  android: { label: 'Android' },
} as const satisfies Record<FeedbackReportPlatform, { label: string }>;

/** Derived from the platform table, so the members are never listed twice. */
export const FEEDBACK_REPORT_PLATFORMS = Object.keys(
  FEEDBACK_REPORT_PLATFORM_RULES,
) as FeedbackReportPlatform[];

/** Membership test against the platform table — the only list of the members. */
export function isFeedbackReportPlatform(
  value: unknown,
): value is FeedbackReportPlatform {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(FEEDBACK_REPORT_PLATFORM_RULES, value)
  );
}

/** Membership test against the kind table — the only list of the members. */
export function isFeedbackReportKind(
  value: unknown,
): value is FeedbackReportKind {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(FEEDBACK_REPORT_KIND_RULES, value)
  );
}

/** Membership test against the status table — the only list of the members. */
export function isFeedbackReportStatus(
  value: unknown,
): value is FeedbackReportStatus {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(FEEDBACK_REPORT_STATUS_RULES, value)
  );
}

/** Re-exported from the shared core package so both sides of the boundary enforce the same caps. */
export const FEEDBACK_REPORT_TITLE_MAX_LENGTH =
  CORE_FEEDBACK_REPORT_TITLE_MAX_LENGTH;
export const FEEDBACK_REPORT_TEXT_MAX_LENGTH =
  CORE_FEEDBACK_REPORT_TEXT_MAX_LENGTH;
export const FEEDBACK_REPORT_FOLLOW_UP_MAX_LENGTH =
  CORE_FEEDBACK_REPORT_FOLLOW_UP_MAX_LENGTH;
/** Defensive cap on each Report Context field, so a client cannot store an unbounded string. */
export const FEEDBACK_REPORT_CONTEXT_FIELD_MAX_LENGTH = 120;
export const FEEDBACK_REPORT_CONTEXT_PATH_MAX_LENGTH = 512;
/** Re-exported from the shared core package so both sides of the boundary enforce the same rate limit. */
export const FEEDBACK_REPORTS_PER_DAY_LIMIT =
  CORE_FEEDBACK_REPORTS_PER_DAY_LIMIT;
export const FEEDBACK_REPORT_RATE_WINDOW_MS =
  CORE_FEEDBACK_REPORT_RATE_WINDOW_MS;

/** The admin list's page size when the caller names none, and its ceiling. */
export const FEEDBACK_REPORT_LIST_DEFAULT_PAGE_SIZE = 25;
export const FEEDBACK_REPORT_LIST_MAX_PAGE_SIZE = 100;

/**
 * A Release tag (`v1.4.0`) or a Mobile Release tag (`mobile-v1.4.0`) — the
 * Release an admin names when marking a report delivered by hand (ADR 0133).
 */
export const FEEDBACK_RELEASE_TAG_PATTERN =
  /^(?:mobile-)?v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The refusal an admin or the Production deploy gets for a missing or malformed Release tag. */
export const FEEDBACK_RELEASE_TAG_REFUSAL_MESSAGE =
  'Name the release this shipped in, such as v1.4.0 or mobile-v1.4.0.';

/**
 * Trims a Release tag and returns it when it matches FEEDBACK_RELEASE_TAG_PATTERN,
 * or null when it is missing, not a string, or malformed.
 */
export function parseReleaseTag(value: unknown): string | null {
  const releaseTag = typeof value === 'string' ? value.trim() : '';
  return releaseTag && FEEDBACK_RELEASE_TAG_PATTERN.test(releaseTag)
    ? releaseTag
    : null;
}

/**
 * The Report Status a report transitions to when an admin links a Tracking
 * Issue (PRD #1206).
 */
export const TRACKING_ISSUE_LINKED_STATUS: FeedbackReportStatus = 'planned';

/**
 * The Report Status a wrongly Fixed or Shipped report returns to when an admin
 * Reopens it (issue #1228): back to triage, not straight to Planned.
 */
export const REOPENED_STATUS: FeedbackReportStatus = 'under_review';
