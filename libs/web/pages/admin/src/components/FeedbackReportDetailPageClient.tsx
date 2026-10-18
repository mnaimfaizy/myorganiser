'use client';

import type { AdminFeedbackReportDetailDto } from '@myorganiser/app-api-client';
import { Badge, Button } from '@myorganiser/web-ui';
import { isAxiosError } from 'axios';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { createPlatformAdminApi } from '../lib/apiClient';
import {
  formatFeedbackReportKind,
  formatFeedbackReportStatus,
  formatFeedbackReportTimestamp,
  getStatusLabelVariant,
} from '../lib/formatFeedbackReport';
import { FeedbackReportTriageActions } from './FeedbackReportTriageActions';

interface ReportFieldProps {
  label: string;
  value: string | React.ReactNode;
}

function ReportField({ label, value }: ReportFieldProps) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

interface ReportContextSectionProps {
  report: AdminFeedbackReportDetailDto;
}

function ReportContextSection({ report }: ReportContextSectionProps) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Report context</h2>
        <p className="text-sm text-muted-foreground">
          Captured when the report was sent. It never includes screenshots,
          logs, or vault contents.
        </p>
      </div>
      <dl className="grid gap-3">
        <ReportField label="Platform" value={report.context.platform} />
        {report.context.appVersion ? (
          <ReportField label="App version" value={report.context.appVersion} />
        ) : null}
        {report.context.browser ? (
          <ReportField label="Browser" value={report.context.browser} />
        ) : null}
        {report.context.operatingSystem ? (
          <ReportField
            label="Operating system"
            value={report.context.operatingSystem}
          />
        ) : null}
        {report.context.path ? (
          <ReportField label="Path" value={report.context.path} />
        ) : null}
        <ReportField
          label="Sent at"
          value={formatFeedbackReportTimestamp(report.context.sentAt)}
        />
      </dl>
    </section>
  );
}

interface ReportSenderSectionProps {
  report: AdminFeedbackReportDetailDto;
}

function ReportSenderSection({ report }: ReportSenderSectionProps) {
  if (report.reporter) {
    return (
      <section className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Sender</h2>
        <dl className="grid gap-2">
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Name</dt>
            <dd>
              <Link
                href={`/admin/users/${report.reporter.id}`}
                className="text-sm text-primary hover:underline"
              >
                {report.reporter.name || report.reporter.email}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Email</dt>
            <dd className="text-sm">{report.reporter.email}</dd>
          </div>
        </dl>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold tracking-tight">Sender</h2>
      <p className="text-sm">
        The sender was deleted. Their report stays without their name or email.
      </p>
    </section>
  );
}

export function FeedbackReportDetailPageClient() {
  const params = useParams();
  const reportId =
    typeof params.reportId === 'string'
      ? params.reportId
      : params.reportId?.[0];

  const [report, setReport] = useState<AdminFeedbackReportDetailDto | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const loadReport = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const api = createPlatformAdminApi();
      const response = await api.getFeedbackReport({ reportId: id });
      setReport(response.data);
    } catch (err) {
      setReport(null);

      if (isAxiosError(err) && err.response?.status === 404) {
        setNotFound(true);
      } else {
        setError('Unable to load feedback report. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!reportId) {
      setLoading(false);
      setNotFound(true);
      return;
    }

    void loadReport(reportId);
  }, [loadReport, reportId]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <Button variant="outline" asChild>
        <Link href="/admin/feedback">Back to Feedback</Link>
      </Button>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : notFound ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            That feedback report does not exist.
          </p>
          <Button variant="outline" asChild>
            <Link href="/admin/feedback">Back to Feedback</Link>
          </Button>
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : report ? (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-start gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                {report.title}
              </h1>
              <Badge>{formatFeedbackReportKind(report.kind)}</Badge>
              <Badge variant={getStatusLabelVariant(report.status)}>
                {formatFeedbackReportStatus(report.status)}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Sent {formatFeedbackReportTimestamp(report.createdAt)}
              {report.statusChangedAt
                ? ` • Status changed ${formatFeedbackReportTimestamp(report.statusChangedAt)}`
                : ''}
            </p>
          </div>

          <div className="max-w-2xl space-y-6">
            <section className="space-y-2">
              <h2 className="text-lg font-semibold tracking-tight">
                Description
              </h2>
              <p className="whitespace-pre-wrap text-sm">
                {report.description}
              </p>
            </section>

            {report.expectedOutcome ? (
              <section className="space-y-2">
                <h2 className="text-lg font-semibold tracking-tight">
                  What they expected
                </h2>
                <p className="whitespace-pre-wrap text-sm">
                  {report.expectedOutcome}
                </p>
              </section>
            ) : null}

            <ReportContextSection report={report} />

            {report.followUp ? (
              <section className="space-y-2">
                <h2 className="text-lg font-semibold tracking-tight">
                  Follow-up
                </h2>
                <p className="whitespace-pre-wrap text-sm">{report.followUp}</p>
              </section>
            ) : null}

            {report.statusNote ? (
              <section className="space-y-2">
                <h2 className="text-lg font-semibold tracking-tight">
                  Status note
                </h2>
                <p className="whitespace-pre-wrap text-sm">
                  {report.statusNote}
                </p>
              </section>
            ) : null}

            {report.releaseTag ? (
              <section className="space-y-2">
                <h2 className="text-lg font-semibold tracking-tight">
                  Release
                </h2>
                <p className="text-sm">{report.releaseTag}</p>
              </section>
            ) : null}

            <section className="space-y-2">
              <h2 className="text-lg font-semibold tracking-tight">
                Fix notice
              </h2>
              <p className="text-sm">
                {report.fixNoticeOptIn
                  ? 'The sender asked to be emailed when this is fixed.'
                  : 'The sender did not ask to be emailed.'}
              </p>
            </section>

            <ReportSenderSection report={report} />

            <FeedbackReportTriageActions
              report={report}
              onUpdated={setReport}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
