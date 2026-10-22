'use client';

import type { AdminFeedbackReportDetailDto } from '@myorganiser/app-api-client';
import { Button, useIsMobileState } from '@myorganiser/web-ui';
import { isAxiosError } from 'axios';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { createPlatformAdminApi } from '../lib/apiClient';
import { FeedbackReportTriageActions } from './FeedbackReportTriageActions';
import { ReportBackLink } from './feedback/report/ReportBackLink';
import { ReportHeader } from './feedback/report/ReportHeader';
import { ReportReadingColumn } from './feedback/report/ReportReadingColumn';
import type { ReportVariant } from '../lib/feedbackReportView';

/**
 * One admin feedback report. The reading column (what was reported) sits
 * beside the Triage panel (every action on it) from md up, and stacks above it
 * on phone. The page loads the report; the children own their own state.
 */
export function FeedbackReportDetailPageClient() {
  const params = useParams();
  const reportId =
    typeof params.reportId === 'string'
      ? params.reportId
      : params.reportId?.[0];

  // The breakpoint is decided in the first effect, before the report fetch can
  // resolve, so the report body never renders with it undecided. Until then the
  // back link takes the desktop wording.
  const isPhone = useIsMobileState();
  const variant: ReportVariant = isPhone ? 'phone' : 'desktop';

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
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-4 md:gap-5 md:p-8">
      <ReportBackLink variant={variant} />

      {loading ? (
        <p className="text-body-sm text-muted-foreground">Loading…</p>
      ) : notFound ? (
        <div className="flex flex-col gap-4">
          <p className="text-body-sm text-muted-foreground">
            That feedback report does not exist.
          </p>
          <Button variant="outline" asChild className="self-start">
            <Link href="/admin/feedback">Back to Feedback</Link>
          </Button>
        </div>
      ) : error ? (
        <p className="text-body-sm text-destructive">{error}</p>
      ) : report ? (
        <>
          <ReportHeader report={report} />

          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-start md:gap-5">
            <ReportReadingColumn report={report} variant={variant} />
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
