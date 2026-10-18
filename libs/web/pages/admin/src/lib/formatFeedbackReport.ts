import type {
  FeedbackReportKind,
  FeedbackReportStatus,
} from '@myorganiser/app-api-client';

const FEEDBACK_REPORT_STATUS_LABELS = {
  received: { label: 'Received', variant: 'default' },
  under_review: { label: 'Under review', variant: 'default' },
  planned: { label: 'Planned', variant: 'default' },
  fixed: { label: 'Fixed', variant: 'secondary' },
  shipped: { label: 'Shipped', variant: 'secondary' },
  wont_do: { label: "Won't do", variant: 'destructive' },
  cannot_reproduce: { label: "Can't reproduce", variant: 'outline' },
} as const satisfies Record<
  FeedbackReportStatus,
  {
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
  }
>;

const FEEDBACK_REPORT_KIND_LABELS = {
  bug_report: 'Bug report',
  suggestion: 'Suggestion',
} as const satisfies Record<FeedbackReportKind, string>;

export const FEEDBACK_REPORT_STATUSES = Object.keys(
  FEEDBACK_REPORT_STATUS_LABELS,
) as FeedbackReportStatus[];

export const FEEDBACK_REPORT_KINDS = Object.keys(
  FEEDBACK_REPORT_KIND_LABELS,
) as FeedbackReportKind[];

export function formatFeedbackReportStatus(
  status: FeedbackReportStatus,
): string {
  return FEEDBACK_REPORT_STATUS_LABELS[status].label;
}

export function formatFeedbackReportKind(kind: FeedbackReportKind): string {
  return FEEDBACK_REPORT_KIND_LABELS[kind];
}

export function formatFeedbackReportTimestamp(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function trackingIssueUrl(issueNumber: number): string {
  return `https://github.com/mnaimfaizy/myorganiser/issues/${issueNumber}`;
}

export function getStatusLabelVariant(
  status: FeedbackReportStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  return FEEDBACK_REPORT_STATUS_LABELS[status].variant;
}
