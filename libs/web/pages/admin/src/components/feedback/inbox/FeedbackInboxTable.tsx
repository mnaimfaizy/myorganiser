'use client';

import type { AdminFeedbackReportListItemDto } from '@myorganiser/app-api-client';
import {
  NewTabLink,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@myorganiser/web-ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  formatFeedbackReportKind,
  formatFeedbackReportStatus,
  formatFeedbackReportTimestamp,
  getStatusPillTone,
  trackingIssueUrl,
} from '../../../lib/formatFeedbackReport';
import { FEEDBACK_INBOX_MESSAGES } from '../../../lib/feedbackInbox';

const COLUMN_COUNT = 7;

export interface FeedbackInboxTableProps {
  reports: AdminFeedbackReportListItemDto[];
  loading: boolean;
  error: boolean;
  /** The pager, rendered under the rows. */
  footer?: ReactNode;
}

interface FeedbackReportRowProps {
  report: AdminFeedbackReportListItemDto;
}

/** One report row. Its title, tracking number and sender are each their own link. */
function FeedbackReportRow({ report }: FeedbackReportRowProps) {
  return (
    <TableRow>
      <TableCell className="min-w-0">
        <Link
          href={`/admin/feedback/${report.id}`}
          className="block truncate font-semibold text-foreground hover:underline"
        >
          {report.title}
        </Link>
      </TableCell>
      <TableCell className="whitespace-nowrap text-body-sm text-muted-foreground">
        {formatFeedbackReportKind(report.kind)}
      </TableCell>
      <TableCell>
        <StatusPill
          size="sm"
          tone={getStatusPillTone(report.status)}
          className="normal-case"
        >
          {formatFeedbackReportStatus(report.status)}
        </StatusPill>
      </TableCell>
      <TableCell className="text-body-sm text-muted-foreground">
        {report.platform}
      </TableCell>
      <TableCell className="text-body-sm">
        {report.trackingIssueNumber ? (
          <NewTabLink
            href={trackingIssueUrl(report.trackingIssueNumber)}
            className="font-semibold text-brand-text hover:underline"
          >
            {report.trackingIssueNumber}
          </NewTabLink>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="min-w-0">
        {report.reporter ? (
          <div className="flex min-w-0 flex-col">
            <Link
              href={`/admin/users/${report.reporter.id}`}
              className="block truncate text-body-sm font-semibold text-foreground hover:underline"
            >
              {report.reporter.name || report.reporter.email}
            </Link>
            {report.reporter.name ? (
              <span className="truncate text-caption text-muted-foreground">
                {report.reporter.email}
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-body-sm text-muted-foreground">Deleted</span>
        )}
      </TableCell>
      <TableCell className="text-body-sm text-muted-foreground">
        {formatFeedbackReportTimestamp(report.createdAt)}
      </TableCell>
    </TableRow>
  );
}

/**
 * The desktop inbox: a semantic table in a card. The body shows the loading,
 * error or empty wording in place of rows; the header row stays. The pager
 * sits under the rows, in `footer`.
 */
export function FeedbackInboxTable({
  reports,
  loading,
  error,
  footer,
}: FeedbackInboxTableProps) {
  return (
    <section
      aria-label="Feedback reports"
      className="overflow-hidden rounded-panel border border-border bg-raised-surface"
    >
      <Table className="table-fixed">
        <colgroup>
          <col />
          <col className="w-[110px]" />
          <col className="w-[130px]" />
          <col className="w-[90px]" />
          <col className="w-[110px]" />
          <col className="w-[17%]" />
          <col className="w-[150px]" />
        </colgroup>
        <TableHeader className="bg-subtle">
          <TableRow>
            <TableHead className="text-muted-foreground">Report</TableHead>
            <TableHead className="text-muted-foreground">Kind</TableHead>
            <TableHead className="text-muted-foreground">Status</TableHead>
            <TableHead className="text-muted-foreground">Platform</TableHead>
            <TableHead className="text-muted-foreground">
              Tracking issue
            </TableHead>
            <TableHead className="text-muted-foreground">Sender</TableHead>
            <TableHead className="text-muted-foreground">Sent</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading || error || reports.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={COLUMN_COUNT}
                className={
                  error
                    ? 'py-6 text-body-sm text-destructive'
                    : 'py-6 text-body-sm text-muted-foreground'
                }
              >
                {loading
                  ? FEEDBACK_INBOX_MESSAGES.loading
                  : error
                    ? FEEDBACK_INBOX_MESSAGES.error
                    : FEEDBACK_INBOX_MESSAGES.empty}
              </TableCell>
            </TableRow>
          ) : (
            reports.map((report) => (
              <FeedbackReportRow key={report.id} report={report} />
            ))
          )}
        </TableBody>
      </Table>
      {footer}
    </section>
  );
}
