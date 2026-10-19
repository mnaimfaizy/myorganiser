'use client';

import type { AdminFeedbackReportDetailDto } from '@myorganiser/app-api-client';
import { useCallback, useState } from 'react';

import {
  deliveredStatusForKind,
  formatFeedbackReportStatus,
  isFinalStatus,
} from '../lib/formatFeedbackReport';
import { ChangeStatusForm } from './ChangeStatusForm';
import { MarkDeliveredForm } from './MarkDeliveredForm';
import { ReopenReportForm } from './ReopenReportForm';
import { TrackingIssueForm } from './TrackingIssueForm';

interface FeedbackReportTriageActionsProps {
  report: AdminFeedbackReportDetailDto;
  onUpdated: (report: AdminFeedbackReportDetailDto) => void;
}

export function FeedbackReportTriageActions({
  report,
  onUpdated,
}: FeedbackReportTriageActionsProps) {
  // The reopen confirmation must outlive the reopen form, which unmounts once
  // the parent swaps the final-report view for the triage forms. Scoped to the
  // report it was produced from, so a later sibling update hides it.
  const [reopenedReport, setReopenedReport] =
    useState<AdminFeedbackReportDetailDto | null>(null);

  const handleReopened = useCallback(
    (updated: AdminFeedbackReportDetailDto) => {
      setReopenedReport(updated);
      onUpdated(updated);
    },
    [onUpdated],
  );

  if (isFinalStatus(report.status)) {
    const statusLabel = formatFeedbackReportStatus(report.status).toLowerCase();
    const releaseClause = report.releaseTag ? ` in ${report.releaseTag}` : '';

    return (
      <section className="max-w-2xl space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Triage</h2>
        <p className="text-sm text-muted-foreground">
          This report is {statusLabel}
          {releaseClause}. It stays final unless you reopen it.
        </p>

        <div className="space-y-4">
          <h3 className="text-base font-semibold tracking-tight">Reopen</h3>
          <p className="text-sm text-muted-foreground">
            Reopen a report that was marked by mistake. It goes back to Under
            review and its Release is cleared.
          </p>
          <ReopenReportForm report={report} onReopened={handleReopened} />
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-2xl space-y-8">
      {reopenedReport === report && (
        <p className="text-sm text-muted-foreground">
          Report reopened. It is back in Under review.
        </p>
      )}

      <div className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Change status</h2>
        <ChangeStatusForm report={report} onUpdated={onUpdated} />
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Tracking issue</h2>
        <TrackingIssueForm report={report} onUpdated={onUpdated} />
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">
          Mark{' '}
          {formatFeedbackReportStatus(
            deliveredStatusForKind(report.kind),
          ).toLowerCase()}
        </h2>
        <MarkDeliveredForm report={report} onUpdated={onUpdated} />
      </div>
    </section>
  );
}
