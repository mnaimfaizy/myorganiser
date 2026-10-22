import type { AdminFeedbackReportDetailDto } from '@myorganiser/app-api-client';
import Link from 'next/link';

import { ReportCard } from './ReportCard';
import {
  getFixNoticeSentence,
  REPORT_NOTE_CLASS_NAME,
  type ReportVariant,
} from '../../../lib/feedbackReportView';

export interface ReportSenderProps {
  report: AdminFeedbackReportDetailDto;
  variant: ReportVariant;
}

/**
 * Who sent the report. Phone also carries the fix-notice sentence here, since
 * the desktop Fix notice card is not rendered on phone.
 */
export function ReportSender({ report, variant }: ReportSenderProps) {
  const { reporter } = report;
  const isPhone = variant === 'phone';

  const profileLink = reporter ? (
    <Link
      href={`/admin/users/${reporter.id}`}
      className="font-semibold text-brand-text hover:underline"
    >
      {reporter.name || reporter.email}
    </Link>
  ) : null;

  return (
    <ReportCard title="Sender">
      {reporter && isPhone ? (
        <p className="break-words text-body-sm text-foreground-secondary">
          {profileLink}
          {reporter.name ? ` · ${reporter.email}` : null}
        </p>
      ) : null}
      {reporter && !isPhone ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-body-sm">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="min-w-0 break-words">{profileLink}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd className="min-w-0 break-words text-foreground">
            {reporter.email}
          </dd>
        </dl>
      ) : null}
      {reporter ? null : (
        <p className="text-body-sm text-foreground-secondary">
          The sender was deleted. Their report stays without their name or
          email.
        </p>
      )}
      {isPhone ? (
        <p className={REPORT_NOTE_CLASS_NAME}>{getFixNoticeSentence(report)}</p>
      ) : null}
    </ReportCard>
  );
}
