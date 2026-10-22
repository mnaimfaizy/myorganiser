import type { AdminFeedbackReportDetailDto } from '@myorganiser/app-api-client';
import { Fragment } from 'react';

import { formatFeedbackReportTimestamp } from '../../../lib/formatFeedbackReport';
import { ReportCard } from './ReportCard';
import {
  REPORT_NOTE_CLASS_NAME,
  type ReportVariant,
} from '../../../lib/feedbackReportView';

export interface ReportContextProps {
  report: AdminFeedbackReportDetailDto;
  variant: ReportVariant;
}

interface ContextRow {
  label: string;
  value: string | null | undefined;
  /** Platform and Sent at always show, as they do today. */
  required: boolean;
}

/**
 * What the reporter's device and page looked like when they sent the report.
 * Desktop lists label and value rows. Phone folds the same values into two
 * compact lines, without labels.
 */
export function ReportContext({ report, variant }: ReportContextProps) {
  const { context } = report;
  const sentAt = formatFeedbackReportTimestamp(context.sentAt);
  const note = (
    <p className={REPORT_NOTE_CLASS_NAME}>
      Captured when the report was sent. It never includes screenshots, logs, or
      vault contents.
    </p>
  );

  if (variant === 'phone') {
    const environment = [
      context.platform,
      context.appVersion,
      context.browser,
      context.operatingSystem,
    ]
      .filter(Boolean)
      .join(' · ');
    const location = [context.path, sentAt].filter(Boolean).join(' · ');

    return (
      <ReportCard title="Report context">
        {note}
        <div className="break-words text-body-sm text-foreground-secondary">
          <p>{environment}</p>
          <p>{location}</p>
        </div>
      </ReportCard>
    );
  }

  const rows: ContextRow[] = [
    { label: 'Platform', value: context.platform, required: true },
    { label: 'App version', value: context.appVersion, required: false },
    { label: 'Browser', value: context.browser, required: false },
    {
      label: 'Operating system',
      value: context.operatingSystem,
      required: false,
    },
    { label: 'Path', value: context.path, required: false },
    { label: 'Sent at', value: sentAt, required: true },
  ];

  return (
    <ReportCard title="Report context">
      {note}
      <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-2 text-body-sm">
        {rows
          .filter((row) => row.required || row.value)
          .map((row) => (
            <Fragment key={row.label}>
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 break-words text-foreground">
                {row.value}
              </dd>
            </Fragment>
          ))}
      </dl>
    </ReportCard>
  );
}
