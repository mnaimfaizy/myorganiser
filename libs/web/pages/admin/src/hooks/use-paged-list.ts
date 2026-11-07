import { useCallback, useState } from 'react';

import { type KeyedFetchOutcome, useKeyedFetch } from './use-keyed-fetch';

/**
 * `pages`: desktop, `rows` is the current page. `append`: phone, `rows` is
 * every page loaded so far and `loadMore()` fetches the next one.
 */
export type PagedListMode = 'pages' | 'append';

/** One page from the server: its rows and the total across every page. */
export interface PagedListPage<Row> {
  rows: Row[];
  total: number;
}

export interface UsePagedListOptions<Row> {
  mode: PagedListMode;
  pageSize: number;
  /**
   * Names the filters, query, and sort. Two different filter sets must give
   * two different keys. A change to it does not reset the page by itself:
   * call `resetToFirstPage` with the filter change.
   */
  filterKey: string;
  /** Fetches one page with the current filters. Read only when the key changes. */
  fetchPage: (page: number) => Promise<PagedListPage<Row>>;
}

export interface PagedListState<Row> {
  rows: Row[];
  total: number;
  page: number;
  /** The first load, or a filter or page change. */
  loading: boolean;
  /** An append (phone) fetch is in flight. */
  loadingMore: boolean;
  error: boolean;
  /** The last append failed. The rows are kept; cleared by any filter change. */
  loadMoreError: boolean;
  hasMore: boolean;
  /** Back to page 1, replacing the list. Call it with every filter change. */
  resetToFirstPage: () => void;
  goToPage: (next: number) => void;
  loadMore: () => void;
  /** Re-requests the page that just failed to append. No-op unless loadMoreError is set. */
  retryLoadMore: () => void;
}

interface Paging {
  mode: PagedListMode;
  page: number;
  /** Set only by loadMore. Every other change replaces the list. */
  append: boolean;
}

interface PagedListSettled<Row> {
  rows: Row[];
  total: number;
  /** A replace failed: the list is blank and the error shows. */
  error: boolean;
  /** An append failed: the rows loaded so far are kept. */
  appendError: boolean;
}

/**
 * Pages or appends one server list. The caller owns the filters and says how
 * to fetch a page; this owns the page, the append, and every pending and
 * error flag. A response for an old filter key or page never overwrites the
 * current list.
 *
 * Paging remembers which mode it was set in, so a mode switch reads as page 1
 * without a reset effect. A failed append is not retried by a loop: loadMore
 * holds until a filter change replaces the request, or retryLoadMore
 * re-requests the same page.
 */
export function usePagedList<Row>({
  mode,
  pageSize,
  filterKey,
  fetchPage,
}: UsePagedListOptions<Row>): PagedListState<Row> {
  const [paging, setPaging] = useState<Paging>({
    mode,
    page: 1,
    append: false,
  });
  const page = paging.mode === mode ? paging.page : 1;
  const append = paging.mode === mode && paging.append;
  // Bumped only by retryLoadMore, so a retry re-requests the same page
  // without the page or the filters changing.
  const [retryToken, setRetryToken] = useState(0);

  const { state: settled, pending } = useKeyedFetch<
    PagedListPage<Row>,
    PagedListSettled<Row>
  >({
    key: JSON.stringify([filterKey, page, retryToken]),
    initial: { rows: [], total: 0, error: false, appendError: false },
    load: () => fetchPage(page),
    settle: (previous, outcome: KeyedFetchOutcome<PagedListPage<Row>>) => {
      if (outcome.ok) {
        return {
          rows: append
            ? [...previous.rows, ...outcome.value.rows]
            : outcome.value.rows,
          total: outcome.value.total,
          error: false,
          appendError: false,
        };
      }
      // A failed append keeps the rows and total already loaded.
      return append
        ? { ...previous, error: false, appendError: true }
        : { rows: [], total: 0, error: true, appendError: false };
    },
  });

  const loadingMore = pending && append;
  const loading = pending && !loadingMore;
  const error = !pending && settled.error;
  const loadMoreError = !pending && settled.appendError;
  const total = settled.total;
  const hasMore = page * pageSize < total;

  const resetToFirstPage = useCallback(() => {
    setPaging({ mode, page: 1, append: false });
  }, [mode]);

  const goToPage = useCallback(
    (next: number) => {
      setPaging({ mode, page: Math.max(1, Math.floor(next)), append: false });
    },
    [mode],
  );

  const loadMore = useCallback(() => {
    if (!hasMore || pending || loadMoreError) return;
    setPaging({ mode, page: page + 1, append: true });
  }, [hasMore, pending, loadMoreError, mode, page]);

  const retryLoadMore = useCallback(() => {
    if (!loadMoreError) return;
    setRetryToken((token) => token + 1);
  }, [loadMoreError]);

  return {
    rows: settled.rows,
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
    retryLoadMore,
  };
}
