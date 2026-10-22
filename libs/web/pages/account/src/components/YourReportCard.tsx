'use client';

import { useState } from 'react';
import { format } from 'date-fns';

import { type FeedbackReportListItemDto } from '@myorganiser/app-api-client';
import { NewTabLink, StatusPill } from '@myorganiser/web-ui';

import type { AccountVariant } from '../account-view';
import {
  DELIVERED_STATUS_BY_KIND,
  REPORT_KIND_LABELS,
  REPORT_STATUS_CONFIG,
} from '../your-reports-view';
import { FollowUpForm } from './FollowUpForm';

const CARD_CLASS: Record<AccountVariant, string> = {
  desktop:
    'flex flex-col gap-3 rounded-panel border border-border bg-raised-surface p-5',
  phone:
    'flex flex-col gap-3 rounded-xl border border-border bg-raised-surface px-4 py-3.5',
};

export interface YourReportCardProps {
  report: FeedbackReportListItemDto;
  variant: AccountVariant;
}

export function YourReportCard({ report, variant }: YourReportCardProps) {
  const [currentReport, setCurrentReport] = useState(report);
  const isPhone = variant === 'phone';

  const statusConfig = REPORT_STATUS_CONFIG[currentReport.status];
  const kindLabel = REPORT_KIND_LABELS[currentReport.kind];

  const isDelivered =
    currentReport.status === DELIVERED_STATUS_BY_KIND[currentReport.kind];
  const deliveryWord = `${statusConfig.label} in`;
  const dateLabel = format(new Date(currentReport.createdAt), 'PP');

  const statusPill = (
    <StatusPill tone={statusConfig.tone} className="normal-case">
      {statusConfig.label}
    </StatusPill>
  );

  return (
    <article className={CARD_CLASS[variant]}>
      {isPhone ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {statusPill}
            <span className="text-caption text-muted-foreground">
              {`${kindLabel} · ${dateLabel}`}
            </span>
          </div>
          <h2 className="text-body font-semibold text-foreground">
            {currentReport.title}
          </h2>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="min-w-0 flex-[1_1_320px] break-words text-body font-semibold text-foreground">
            {currentReport.title}
          </h2>
          <span className="text-caption text-muted-foreground">
            {kindLabel}
          </span>
          {statusPill}
        </div>
      )}

      {currentReport.statusNote && (
        <p className="rounded-md bg-subtle px-3 py-2 text-body-sm text-foreground-secondary">
          {currentReport.statusNote}
        </p>
      )}

      {currentReport.status === 'cannot_reproduce' &&
        !currentReport.followUp && (
          <FollowUpForm
            reportId={currentReport.id}
            onSent={setCurrentReport}
            variant={variant}
          />
        )}

      {currentReport.followUp && (
        <div className="flex flex-col gap-1 border-l-2 border-brand-soft pl-3">
          <p className="text-label-caps uppercase text-muted-foreground">
            Your follow-up
          </p>
          <p className="text-body-sm text-foreground">
            {currentReport.followUp}
          </p>
        </div>
      )}

      {isDelivered &&
        currentReport.changelogUrl &&
        currentReport.releaseTag && (
          <NewTabLink
            href={currentReport.changelogUrl}
            className="text-body-sm font-semibold text-brand-text no-underline"
            iconClassName="h-3 w-3"
          >
            {deliveryWord} {currentReport.releaseTag} → View CHANGELOG
          </NewTabLink>
        )}

      {!isPhone && (
        <p className="text-caption text-muted-foreground">{dateLabel}</p>
      )}
    </article>
  );
}
