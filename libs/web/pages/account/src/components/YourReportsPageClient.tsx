'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';

import {
  type FeedbackReportListItemDto,
  type FeedbackReportKind,
  type FeedbackReportStatus,
} from '@myorganiser/app-api-client';
import { Badge, Card, CardTitle } from '@myorganiser/web-ui';

import { createFeedbackApi } from '../lib/apiClient';
import { FollowUpForm } from './FollowUpForm';

type ListState =
  | { status: 'loading'; items: null }
  | { status: 'loaded'; items: FeedbackReportListItemDto[] }
  | { status: 'error'; items: null; error: unknown };

const REPORT_KIND_LABELS = {
  bug_report: 'Bug report',
  suggestion: 'Suggestion',
} as const satisfies Record<FeedbackReportKind, string>;

/** The status each kind reaches once a Release delivers it (ADR 0133) — mirrors the backend's FEEDBACK_REPORT_KIND_RULES. */
const DELIVERED_STATUS_BY_KIND = {
  bug_report: 'fixed',
  suggestion: 'shipped',
} as const satisfies Record<FeedbackReportKind, FeedbackReportStatus>;

const REPORT_STATUS_CONFIG = {
  received: { label: 'Received', variant: 'secondary' },
  under_review: { label: 'Under review', variant: 'secondary' },
  planned: { label: 'Planned', variant: 'default' },
  fixed: { label: 'Fixed', variant: 'default' },
  shipped: { label: 'Shipped', variant: 'default' },
  wont_do: { label: "Won't do", variant: 'destructive' },
  cannot_reproduce: { label: "Can't reproduce", variant: 'outline' },
} as const satisfies Record<
  FeedbackReportStatus,
  {
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
  }
>;

interface FeedbackReportListItemProps {
  report: FeedbackReportListItemDto;
}

function FeedbackReportListItem({ report }: FeedbackReportListItemProps) {
  const [currentReport, setCurrentReport] = useState(report);

  const statusConfig = REPORT_STATUS_CONFIG[currentReport.status];
  const kindLabel = REPORT_KIND_LABELS[currentReport.kind];

  const isDelivered =
    currentReport.status === DELIVERED_STATUS_BY_KIND[currentReport.kind];
  const deliveryWord = `${statusConfig.label} in`;

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3">
        <div>
          <CardTitle className="mb-2 text-base">
            {currentReport.title}
          </CardTitle>
          <div className="flex gap-2">
            <span className="text-xs text-muted-foreground">{kindLabel}</span>
            <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
          </div>
        </div>

        {currentReport.statusNote && (
          <p className="text-sm text-muted-foreground">
            {currentReport.statusNote}
          </p>
        )}

        {currentReport.status === 'cannot_reproduce' &&
          !currentReport.followUp && (
            <FollowUpForm
              reportId={currentReport.id}
              onSent={setCurrentReport}
            />
          )}

        {currentReport.followUp && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Your follow-up
            </p>
            <p className="text-sm">{currentReport.followUp}</p>
          </div>
        )}

        {isDelivered &&
          currentReport.changelogUrl &&
          currentReport.releaseTag && (
            <a
              href={currentReport.changelogUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs text-primary underline"
            >
              {deliveryWord} {currentReport.releaseTag} → View CHANGELOG
            </a>
          )}

        <p className="text-xs text-muted-foreground">
          {format(new Date(currentReport.createdAt), 'PP')}
        </p>
      </div>
    </Card>
  );
}

export function YourReportsPageClient() {
  const [state, setState] = useState<ListState>({
    status: 'loading',
    items: null,
  });

  useEffect(() => {
    const fetchReports = async () => {
      try {
        const api = createFeedbackApi();
        const response = await api.listReports();
        setState({
          status: 'loaded',
          items: response.data.items,
        });
      } catch (error: unknown) {
        setState({
          status: 'error',
          items: null,
          error,
        });
      }
    };

    const markReportsSeen = async () => {
      try {
        const api = createFeedbackApi();
        await api.markReportsSeen();
      } catch (error: unknown) {
        // Fire-and-forget: swallow errors silently
        console.debug('Failed to mark reports as seen:', error);
      }
    };

    void Promise.all([fetchReports(), markReportsSeen()]);
  }, []);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <CardTitle className="text-lg">Your reports</CardTitle>

      {state.status === 'loading' && (
        <div className="flex items-center justify-center py-8">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      )}

      {state.status === 'error' && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">
            Failed to load your reports. Please try refreshing the page.
          </p>
        </div>
      )}

      {state.status === 'loaded' && state.items.length === 0 && (
        <div className="rounded-md border border-border bg-muted/50 p-3">
          <p className="text-sm text-muted-foreground">
            You haven't sent any feedback yet.
          </p>
        </div>
      )}

      {state.status === 'loaded' && state.items.length > 0 && (
        <div className="flex flex-col gap-3">
          {state.items.map((report) => (
            <FeedbackReportListItem key={report.id} report={report} />
          ))}
        </div>
      )}
    </div>
  );
}
