import type { AdminFeedbackReportDetailDto } from '@myorganiser/app-api-client';

import { ReportCard } from './ReportCard';
import { ReportContext } from './ReportContext';
import { ReportSender } from './ReportSender';
import {
  getFixNoticeSentence,
  REPORT_BODY_CLASS_NAME,
  type ReportVariant,
} from '../../../lib/feedbackReportView';

export interface ReportReadingColumnProps {
  report: AdminFeedbackReportDetailDto;
  variant: ReportVariant;
}

/**
 * The left column of the report: what was reported, in the artboard's order.
 * Desktop closes with a two-up grid of Fix notice and Sender. Phone has no Fix
 * notice card; its sentence sits under the Sender.
 */
export function ReportReadingColumn({
  report,
  variant,
}: ReportReadingColumnProps) {
  const isPhone = variant === 'phone';

  return (
    <div className="flex min-w-0 flex-col gap-3 md:flex-1 md:basis-[520px] md:gap-4">
      <ReportCard title="Description">
        <p className={REPORT_BODY_CLASS_NAME}>{report.description}</p>
      </ReportCard>

      {report.expectedOutcome ? (
        <ReportCard title="What they expected">
          <p className={REPORT_BODY_CLASS_NAME}>{report.expectedOutcome}</p>
        </ReportCard>
      ) : null}

      {report.followUp ? (
        <ReportCard title="Follow-up" tinted>
          <p className={REPORT_BODY_CLASS_NAME}>{report.followUp}</p>
        </ReportCard>
      ) : null}

      {report.statusNote ? (
        <ReportCard title="Status note">
          <p className={REPORT_BODY_CLASS_NAME}>{report.statusNote}</p>
        </ReportCard>
      ) : null}

      {report.releaseTag ? (
        <ReportCard title="Release">
          <p className={REPORT_BODY_CLASS_NAME}>{report.releaseTag}</p>
        </ReportCard>
      ) : null}

      <ReportContext report={report} variant={variant} />

      {isPhone ? (
        <ReportSender report={report} variant={variant} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
          <ReportCard title="Fix notice">
            <p className={REPORT_BODY_CLASS_NAME}>
              {getFixNoticeSentence(report)}
            </p>
          </ReportCard>
          <ReportSender report={report} variant={variant} />
        </div>
      )}
    </div>
  );
}
