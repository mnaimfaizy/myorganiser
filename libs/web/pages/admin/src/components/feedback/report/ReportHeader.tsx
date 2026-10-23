import type { AdminFeedbackReportDetailDto } from '@myorganiser/app-api-client';
import { StatusPill } from '@myorganiser/web-ui';

import {
  formatFeedbackReportKind,
  formatFeedbackReportStatus,
  formatFeedbackReportTimestamp,
  getStatusPillTone,
} from '../../../lib/formatFeedbackReport';

export interface ReportHeaderProps {
  report: AdminFeedbackReportDetailDto;
}

/**
 * The title row and the sent line. The one h1 on the page. Desktop puts the
 * pills beside the title; phone (below md) moves them above it with order.
 */
export function ReportHeader({ report }: ReportHeaderProps) {
  const statusChanged = report.statusChangedAt
    ? ` • Status changed ${formatFeedbackReportTimestamp(report.statusChangedAt)}`
    : '';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-3">
        <h1 className="min-w-0 break-words font-display text-display text-foreground">
          {report.title}
        </h1>
        <div className="order-first flex flex-wrap items-center gap-2 md:order-none">
          <span className="inline-flex h-6 items-center whitespace-nowrap rounded-full border border-border-strong px-2.5 text-label-caps normal-case text-foreground-secondary">
            {formatFeedbackReportKind(report.kind)}
          </span>
          <StatusPill
            tone={getStatusPillTone(report.status)}
            className="normal-case"
          >
            {formatFeedbackReportStatus(report.status)}
          </StatusPill>
        </div>
      </div>
      <p className="text-body-sm text-muted-foreground">
        Sent {formatFeedbackReportTimestamp(report.createdAt)}
        {statusChanged}
      </p>
    </div>
  );
}
