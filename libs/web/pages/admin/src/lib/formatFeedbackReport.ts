import type {
  FeedbackReportKind,
  FeedbackReportStatus,
} from '@myorganiser/app-api-client';

const REPOSITORY_URL = 'https://github.com/mnaimfaizy/myorganiser';

export interface FeedbackReportStatusRule {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  adminSettable: boolean;
  requiresStatusNote: boolean;
  kinds: readonly FeedbackReportKind[];
}

export interface FeedbackReportKindRule {
  label: string;
  deliveredStatus: FeedbackReportStatus;
}

const FEEDBACK_REPORT_STATUS_RULES = {
  received: {
    label: 'Received',
    variant: 'secondary',
    adminSettable: false,
    requiresStatusNote: false,
    kinds: ['bug_report', 'suggestion'],
  },
  under_review: {
    label: 'Under review',
    variant: 'secondary',
    adminSettable: true,
    requiresStatusNote: false,
    kinds: ['bug_report', 'suggestion'],
  },
  planned: {
    label: 'Planned',
    variant: 'default',
    adminSettable: true,
    requiresStatusNote: false,
    kinds: ['bug_report', 'suggestion'],
  },
  fixed: {
    label: 'Fixed',
    variant: 'default',
    adminSettable: false,
    requiresStatusNote: false,
    kinds: ['bug_report'],
  },
  shipped: {
    label: 'Shipped',
    variant: 'default',
    adminSettable: false,
    requiresStatusNote: false,
    kinds: ['suggestion'],
  },
  wont_do: {
    label: "Won't do",
    variant: 'destructive',
    adminSettable: true,
    requiresStatusNote: true,
    kinds: ['bug_report', 'suggestion'],
  },
  cannot_reproduce: {
    label: "Can't reproduce",
    variant: 'outline',
    adminSettable: true,
    requiresStatusNote: true,
    kinds: ['bug_report'],
  },
} as const satisfies Record<FeedbackReportStatus, FeedbackReportStatusRule>;

const FEEDBACK_REPORT_KIND_RULES = {
  bug_report: {
    label: 'Bug report',
    deliveredStatus: 'fixed',
  },
  suggestion: {
    label: 'Suggestion',
    deliveredStatus: 'shipped',
  },
} as const satisfies Record<FeedbackReportKind, FeedbackReportKindRule>;

export const FEEDBACK_REPORT_STATUSES = Object.keys(
  FEEDBACK_REPORT_STATUS_RULES,
) as FeedbackReportStatus[];

/** The same derived list as FEEDBACK_REPORT_STATUSES, shaped as the non-empty tuple z.enum() requires. Pinned to FEEDBACK_REPORT_STATUS_RULES to prevent silent rejection at runtime (ADR 0053). */
export const FEEDBACK_REPORT_STATUS_VALUES = Object.keys(
  FEEDBACK_REPORT_STATUS_RULES,
) as [FeedbackReportStatus, ...FeedbackReportStatus[]];

export const FEEDBACK_REPORT_KINDS = Object.keys(
  FEEDBACK_REPORT_KIND_RULES,
) as FeedbackReportKind[];

export function formatFeedbackReportStatus(
  status: FeedbackReportStatus,
): string {
  return FEEDBACK_REPORT_STATUS_RULES[status].label;
}

export function formatFeedbackReportKind(kind: FeedbackReportKind): string {
  return FEEDBACK_REPORT_KIND_RULES[kind].label;
}

export function formatFeedbackReportTimestamp(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function trackingIssueUrl(issueNumber: number): string {
  return `${REPOSITORY_URL}/issues/${issueNumber}`;
}

export function getStatusLabelVariant(
  status: FeedbackReportStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  return FEEDBACK_REPORT_STATUS_RULES[status].variant;
}

/**
 * Returns the admin-settable statuses for a given report kind.
 * Derived from the status table to ensure exhaustiveness (ADR 0053).
 */
export function adminSettableStatusesForKind(
  kind: FeedbackReportKind,
): FeedbackReportStatus[] {
  return (
    Object.entries(FEEDBACK_REPORT_STATUS_RULES) as Array<
      [FeedbackReportStatus, FeedbackReportStatusRule]
    >
  )
    .filter(([, rule]) => rule.adminSettable && rule.kinds.includes(kind))
    .map(([status]) => status);
}

/**
 * Returns whether a status requires a status note when changed.
 * Derived from the status table to ensure exhaustiveness (ADR 0053).
 */
export function statusRequiresNote(status: FeedbackReportStatus): boolean {
  return FEEDBACK_REPORT_STATUS_RULES[status].requiresStatusNote;
}

/**
 * Returns the delivered status for a given report kind.
 * Derived from the kind table to ensure exhaustiveness (ADR 0053).
 */
export function deliveredStatusForKind(
  kind: FeedbackReportKind,
): FeedbackReportStatus {
  return FEEDBACK_REPORT_KIND_RULES[kind].deliveredStatus;
}
