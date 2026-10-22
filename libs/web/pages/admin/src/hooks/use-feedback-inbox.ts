import type {
  AdminFeedbackReportListItemDto,
  FeedbackReportStatus,
} from '@myorganiser/app-api-client';
import { useCallback, useEffect, useState } from 'react';

import { createPlatformAdminApi } from '../lib/apiClient';
import {
  FEEDBACK_INBOX_PAGE_SIZE,
  type FeedbackInboxFilters,
  isFeedbackInboxFiltered,
  NO_FEEDBACK_INBOX_FILTERS,
  parseTrackingIssueFilter,
} from '../lib/feedbackInbox';

/**
 * `pages`: desktop, `reports` is the current page. `append`: phone, `reports`
 * is every page loaded so far and `loadMore()` fetches the next one.
 */
export type FeedbackInboxMode = 'pages' | 'append';

export interface UseFeedbackInboxOptions {
  mode: FeedbackInboxMode;
}

export interface FeedbackInboxState {
  reports: AdminFeedbackReportListItemDto[];
  total: number;
  page: number;
  pageSize: number;
  filters: FeedbackInboxFilters;
  /** Any filter narrows the list. Tracking issue text that is not a number does not. */
  filtered: boolean;
  /** Received reports across the whole inbox, ignoring the filters. Undefined until loaded, or after its request failed. */
  receivedCount: number | undefined;
  /** The first load, or a filter change. */
  loading: boolean;
  /** An append (phone) fetch is in flight. */
  loadingMore: boolean;
  error: boolean;
  /** The last append failed. The rows are kept; cleared by any filter change. */
  loadMoreError: boolean;
  hasMore: boolean;
  /** Merges the given filters in. A change resets to page 1. */
  setFilters: (next: Partial<FeedbackInboxFilters>) => void;
  clearFilters: () => void;
  goToPage: (next: number) => void;
  loadMore: () => void;
}

interface FeedbackInboxPaging {
  mode: FeedbackInboxMode;
  page: number;
  /** Set only by loadMore. Every other change replaces the list. */
  append: boolean;
}

/** The last settled fetch. `key` names the request it answers. */
interface FeedbackInboxSettled {
  key: string | null;
  reports: AdminFeedbackReportListItemDto[];
  total: number;
  /** A replace failed: the list is blank and the error shows. */
  error: boolean;
  /** An append failed: the rows loaded so far are kept. */
  appendError: boolean;
}

const NO_REPORTS: AdminFeedbackReportListItemDto[] = [];
const RECEIVED: FeedbackReportStatus = 'received';

/**
 * Owns the inbox's Status, Kind, Platform and Tracking issue filters, and
 * paging, and fetches the list. Every filter change resets to page 1 and
 * replaces the list. Tracking issue text that is not a whole number from 1 is
 * ignored, so typing it changes no request.
 *
 * Pending and error flags are derived, not stored. A result is settled only
 * when its request key matches the current key, so a stale response can never
 * overwrite a newer one.
 *
 * The Received count for the subtitle is a separate request, made once: it
 * ignores the filters.
 */
export function useFeedbackInbox({
  mode,
}: UseFeedbackInboxOptions): FeedbackInboxState {
  const [filters, setFiltersValue] = useState<FeedbackInboxFilters>(
    NO_FEEDBACK_INBOX_FILTERS,
  );
  // Paging remembers which mode it was set in. A mode switch then reads as
  // page 1 without a reset effect.
  const [paging, setPaging] = useState<FeedbackInboxPaging>({
    mode,
    page: 1,
    append: false,
  });
  const page = paging.mode === mode ? paging.page : 1;
  const append = paging.mode === mode && paging.append;

  const { status, kind, platform } = filters;
  const trackingIssueNumber = parseTrackingIssueFilter(filters.trackingIssue);
  const requestKey = JSON.stringify([
    status,
    kind,
    platform,
    trackingIssueNumber,
    page,
  ]);

  const [settled, setSettled] = useState<FeedbackInboxSettled>({
    key: null,
    reports: NO_REPORTS,
    total: 0,
    error: false,
    appendError: false,
  });

  useEffect(() => {
    let cancelled = false;

    createPlatformAdminApi()
      .listFeedbackReports({
        status,
        kind,
        platform,
        trackingIssueNumber,
        page,
        pageSize: FEEDBACK_INBOX_PAGE_SIZE,
      })
      .then((response) => {
        // A newer request has started; this response is stale.
        if (cancelled) return;
        const data = response.data;
        setSettled((previous) => ({
          key: requestKey,
          reports: append ? [...previous.reports, ...data.items] : data.items,
          total: data.total,
          error: false,
          appendError: false,
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setSettled((previous) =>
          append
            ? // A failed append keeps the rows and total already loaded.
              {
                key: requestKey,
                reports: previous.reports,
                total: previous.total,
                error: false,
                appendError: true,
              }
            : {
                key: requestKey,
                reports: NO_REPORTS,
                total: 0,
                error: true,
                appendError: false,
              },
        );
      });

    return () => {
      cancelled = true;
    };
  }, [requestKey, status, kind, platform, trackingIssueNumber, page, append]);

  const [receivedCount, setReceivedCount] = useState<number | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;

    createPlatformAdminApi()
      .listFeedbackReports({ status: RECEIVED, pageSize: 1 })
      .then((response) => {
        if (!cancelled) setReceivedCount(response.data.total);
      })
      .catch(() => {
        // The subtitle drops its count sentence; the list is unaffected.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const pending = settled.key !== requestKey;
  const loadingMore = pending && append;
  const loading = pending && !loadingMore;
  const error = !pending && settled.error;
  const loadMoreError = !pending && settled.appendError;
  const reports = settled.error ? NO_REPORTS : settled.reports;
  const total = settled.total;

  const setFilters = useCallback(
    (next: Partial<FeedbackInboxFilters>) => {
      const merged = { ...filters, ...next };
      if (JSON.stringify(merged) === JSON.stringify(filters)) return;
      setFiltersValue(merged);
      setPaging({ mode, page: 1, append: false });
    },
    [filters, mode],
  );

  const clearFilters = useCallback(() => {
    setFilters(NO_FEEDBACK_INBOX_FILTERS);
  }, [setFilters]);

  const goToPage = useCallback(
    (next: number) => {
      setPaging({ mode, page: Math.max(1, Math.floor(next)), append: false });
    },
    [mode],
  );

  const hasMore = page * FEEDBACK_INBOX_PAGE_SIZE < total;

  // A failed append is not retried by a loop: loadMore holds until a filter
  // change replaces the request.
  const loadMore = useCallback(() => {
    if (!hasMore || pending || loadMoreError) return;
    setPaging({ mode, page: page + 1, append: true });
  }, [hasMore, pending, loadMoreError, mode, page]);

  return {
    reports,
    total,
    page,
    pageSize: FEEDBACK_INBOX_PAGE_SIZE,
    filters,
    filtered: isFeedbackInboxFiltered(filters),
    receivedCount,
    loading,
    loadingMore,
    error,
    loadMoreError,
    hasMore,
    setFilters,
    clearFilters,
    goToPage,
    loadMore,
  };
}
