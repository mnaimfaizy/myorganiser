'use client';

import type { AdminFeedbackReportListItemDto } from '@myorganiser/app-api-client';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

import {
  FEEDBACK_INBOX_MESSAGES,
  formatFeedbackPhoneSent,
} from '../../../lib/feedbackInbox';
import { formatFeedbackReportKind } from '../../../lib/formatFeedbackReport';

export interface FeedbackInboxPhoneListProps {
  /** Every report loaded so far. */
  reports: AdminFeedbackReportListItemDto[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: boolean;
  /** The last append failed. The rows stay; the sentinel does not retry. */
  loadMoreError: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

/**
 * The phone inbox: one card of report rows. The list grows as the sentinel
 * below it scrolls into view. There is no pager on phone.
 */
export function FeedbackInboxPhoneList({
  reports,
  total,
  loading,
  loadingMore,
  error,
  loadMoreError,
  hasMore,
  onLoadMore,
}: FeedbackInboxPhoneListProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let observer: IntersectionObserver | undefined;
    const node = sentinelRef.current;

    // jsdom has no IntersectionObserver; there the list simply does not grow.
    // After a failed append the sentinel stays quiet: no retry loop.
    if (
      node !== null &&
      hasMore &&
      !loadingMore &&
      !loadMoreError &&
      typeof IntersectionObserver !== 'undefined'
    ) {
      observer = new IntersectionObserver((observed) => {
        if (observed.some((item) => item.isIntersecting)) {
          onLoadMore();
        }
      });
      observer.observe(node);
    }

    return () => observer?.disconnect();
  }, [hasMore, loadingMore, loadMoreError, onLoadMore]);

  const countLabel =
    reports.length === 0
      ? null
      : hasMore
        ? `Scroll for more · ${reports.length} of ${total}`
        : `${reports.length} of ${total}`;

  return (
    <>
      <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-raised-surface">
        {loading ? (
          <p
            role="status"
            className="px-4 py-6 text-body-sm text-muted-foreground"
          >
            {FEEDBACK_INBOX_MESSAGES.loading}
          </p>
        ) : error ? (
          <p className="px-4 py-6 text-body-sm text-destructive">
            {FEEDBACK_INBOX_MESSAGES.error}
          </p>
        ) : reports.length === 0 ? (
          <p className="px-4 py-6 text-body-sm text-muted-foreground">
            {FEEDBACK_INBOX_MESSAGES.empty}
          </p>
        ) : (
          <ul>
            {reports.map((report) => {
              const sender =
                report.reporter?.name || report.reporter?.email || 'Deleted';
              return (
                <li
                  key={report.id}
                  className="border-b border-border-subtle last:border-b-0"
                >
                  <Link
                    href={`/admin/feedback/${report.id}`}
                    className="flex min-h-[72px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="break-words text-body font-semibold text-foreground">
                        {report.title}
                      </span>
                      <span className="truncate text-caption text-muted-foreground">
                        {`${formatFeedbackReportKind(report.kind)} · ${sender} · ${formatFeedbackPhoneSent(report.createdAt)}`}
                      </span>
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-icon shrink-0 text-muted-foreground"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      {loadMoreError ? (
        <p className="text-center text-caption text-destructive">
          {FEEDBACK_INBOX_MESSAGES.error}
        </p>
      ) : countLabel !== null ? (
        <p className="text-center text-caption text-muted-foreground">
          {countLabel}
        </p>
      ) : null}
    </>
  );
}
