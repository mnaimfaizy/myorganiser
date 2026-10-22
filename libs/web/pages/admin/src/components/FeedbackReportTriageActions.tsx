'use client';

import type { AdminFeedbackReportDetailDto } from '@myorganiser/app-api-client';
import { NewTabLink } from '@myorganiser/web-ui';
import { useCallback } from 'react';

import { useReportScoped } from '../hooks/use-report-scoped';
import {
  deliveredStatusForKind,
  formatFeedbackReportStatus,
  isFinalStatus,
  trackingIssueUrl,
} from '../lib/formatFeedbackReport';
import { ChangeStatusForm } from './ChangeStatusForm';
import { MarkDeliveredForm } from './MarkDeliveredForm';
import { ReopenReportForm } from './ReopenReportForm';
import { TrackingIssueForm } from './TrackingIssueForm';
import { TriagePanel } from './feedback/report/TriagePanel';
import { TriageSection } from './feedback/report/TriageSection';

interface FeedbackReportTriageActionsProps {
  report: AdminFeedbackReportDetailDto;
  onUpdated: (report: AdminFeedbackReportDetailDto) => void;
}

export function FeedbackReportTriageActions({
  report,
  onUpdated,
}: FeedbackReportTriageActionsProps) {
  // The reopen confirmation must outlive the reopen form, which unmounts once
  // the parent swaps the final-report view for the triage forms. Keyed to the
  // reopened report, so a later sibling update hides it.
  const { value: reopened, set: setReopened } = useReportScoped<true>(report);

  const handleReopened = useCallback(
    (updated: AdminFeedbackReportDetailDto) => {
      setReopened(true, updated);
      onUpdated(updated);
    },
    [setReopened, onUpdated],
  );

  if (isFinalStatus(report.status)) {
    const statusLabel = formatFeedbackReportStatus(report.status).toLowerCase();
    const releaseClause = report.releaseTag ? ` in ${report.releaseTag}` : '';

    return (
      <TriagePanel>
        <TriageSection>
          <p className="rounded-xl border border-trust-edge bg-trust-faint px-3.5 py-3 text-body-sm text-trust-text">
            This report is {statusLabel}
            {releaseClause}. It stays final unless you reopen it.
          </p>
          {report.trackingIssueNumber ? (
            <p className="text-body-sm">
              <span className="font-semibold">Tracking Issue:</span>{' '}
              <NewTabLink
                href={trackingIssueUrl(report.trackingIssueNumber)}
                className="font-semibold text-brand-text hover:underline"
              >
                #{report.trackingIssueNumber}
              </NewTabLink>
            </p>
          ) : null}
        </TriageSection>

        <TriageSection title="Reopen">
          <p className="text-body-sm text-muted-foreground">
            Reopen a report that was marked by mistake. It goes back to Under
            review and its Release is cleared.
          </p>
          <ReopenReportForm report={report} onReopened={handleReopened} />
        </TriageSection>
      </TriagePanel>
    );
  }

  return (
    <TriagePanel>
      {reopened && (
        <TriageSection>
          <p className="text-body-sm text-muted-foreground">
            Report reopened. It is back in Under review.
          </p>
        </TriageSection>
      )}

      <TriageSection title="Change status">
        <ChangeStatusForm report={report} onUpdated={onUpdated} />
      </TriageSection>

      <TriageSection title="Tracking issue">
        <TrackingIssueForm report={report} onUpdated={onUpdated} />
      </TriageSection>

      <TriageSection
        title={`Mark ${formatFeedbackReportStatus(
          deliveredStatusForKind(report.kind),
        ).toLowerCase()}`}
      >
        <MarkDeliveredForm report={report} onUpdated={onUpdated} />
      </TriageSection>
    </TriagePanel>
  );
}
