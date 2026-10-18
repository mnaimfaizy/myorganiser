'use client';

import type { AdminFeedbackReportDetailDto } from '@myorganiser/app-api-client';

import {
  deliveredStatusForKind,
  formatFeedbackReportStatus,
} from '../lib/formatFeedbackReport';
import { ChangeStatusForm } from './ChangeStatusForm';
import { MarkDeliveredForm } from './MarkDeliveredForm';
import { TrackingIssueForm } from './TrackingIssueForm';

interface FeedbackReportTriageActionsProps {
  report: AdminFeedbackReportDetailDto;
  onUpdated: (report: AdminFeedbackReportDetailDto) => void;
}

export function FeedbackReportTriageActions({
  report,
  onUpdated,
}: FeedbackReportTriageActionsProps) {
  return (
    <section className="max-w-2xl space-y-8">
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
