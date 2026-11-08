import type {
  AdminFeedbackReportListItemDto,
  FeedbackReportStatus,
} from '@myorganiser/app-api-client';
import { useCallback, useEffect, useState } from 'react';

import { createPlatformAdminApi } from '../lib/apiClient';
import { type PagedListMode, usePagedList } from './use-paged-list';
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
export type FeedbackInboxMode = PagedListMode;

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

const RECEIVED: FeedbackReportStatus = 'received';

/**
 * Owns the inbox's Status, Kind, Platform and Tracking issue filters, and
 * fetches the list through `usePagedList`. Every filter change resets to
 * page 1 and replaces the list. Tracking issue text that is not a whole number
 * from 1 is ignored, so typing it changes no request.
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

  const { status, kind, platform } = filters;
  const trackingIssueNumber = parseTrackingIssueFilter(filters.trackingIssue);

  const {
    rows: reports,
    total,
    page,
    loading,
    loadingMore,
    error,
    loadMoreError,
    hasMore,
    resetToFirstPage,
    goToPage,
    loadMore,
  } = usePagedList<AdminFeedbackReportListItemDto>({
    mode,
    pageSize: FEEDBACK_INBOX_PAGE_SIZE,
    filterKey: JSON.stringify([status, kind, platform, trackingIssueNumber]),
    fetchPage: (nextPage) =>
      createPlatformAdminApi()
        .listFeedbackReports({
          status,
          kind,
          platform,
          trackingIssueNumber,
          page: nextPage,
          pageSize: FEEDBACK_INBOX_PAGE_SIZE,
        })
        .then(({ data }) => ({ rows: data.items, total: data.total })),
  });

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

  const setFilters = useCallback(
    (next: Partial<FeedbackInboxFilters>) => {
      const merged = { ...filters, ...next };
      if (JSON.stringify(merged) === JSON.stringify(filters)) return;
      setFiltersValue(merged);
      resetToFirstPage();
    },
    [filters, resetToFirstPage],
  );

  const clearFilters = useCallback(() => {
    setFilters(NO_FEEDBACK_INBOX_FILTERS);
  }, [setFilters]);

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
