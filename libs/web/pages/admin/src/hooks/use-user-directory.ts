import type {
  AdminUserIdentity,
  AdminUserSort,
  UserRole,
} from '@myorganiser/app-api-client';
import { useCallback, useState } from 'react';

import { createPlatformAdminApi } from '../lib/apiClient';
import { type PagedListMode, usePagedList } from '../paged-list/use-paged-list';
import {
  USER_DIRECTORY_PAGE_SIZE,
  type UserDirectoryFilterValues,
  type UserDirectoryStatus,
} from '../lib/userDirectory';

/**
 * `pages`: desktop, `users` is the current page. `append`: phone, `users` is
 * every page loaded so far and `loadMore()` fetches the next one.
 */
export type UserDirectoryMode = PagedListMode;

export interface UseUserDirectoryOptions {
  mode: UserDirectoryMode;
}

export interface UserDirectoryState {
  users: AdminUserIdentity[];
  total: number;
  page: number;
  pageSize: number;
  query: string | undefined;
  status: UserDirectoryStatus | undefined;
  role: UserRole | undefined;
  sort: AdminUserSort;
  /** The first load, or a filter, query, or sort change. */
  loading: boolean;
  /** An append (phone) fetch is in flight. */
  loadingMore: boolean;
  error: boolean;
  /** The last append failed. The rows are kept; cleared by any filter change. */
  loadMoreError: boolean;
  hasMore: boolean;
  /** Applies the trimmed query. Empty means no query. */
  setQuery: (raw: string) => void;
  setStatus: (next: UserDirectoryStatus | undefined) => void;
  setRole: (next: UserRole | undefined) => void;
  /** Sets status and role together. Phone chips change both at once. */
  setFilters: (next: UserDirectoryFilterValues) => void;
  setSort: (next: AdminUserSort) => void;
  goToPage: (next: number) => void;
  loadMore: () => void;
  /** Re-requests the page that just failed to append. No-op unless loadMoreError is set. */
  retryLoadMore: () => void;
}

/**
 * Owns the directory's query, filters, and sort, and fetches the list through
 * `usePagedList`. Every filter, query, sort, or mode change resets to page 1
 * and replaces the list. Setting a value to what it already is changes
 * nothing, so a pressed chip stays pressed.
 */
export function useUserDirectory({
  mode,
}: UseUserDirectoryOptions): UserDirectoryState {
  const [query, setQueryValue] = useState<string | undefined>(undefined);
  const [status, setStatusValue] = useState<UserDirectoryStatus | undefined>(
    undefined,
  );
  const [role, setRoleValue] = useState<UserRole | undefined>(undefined);
  const [sort, setSortValue] = useState<AdminUserSort>('newest');

  const {
    rows: users,
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
  } = usePagedList<AdminUserIdentity>({
    mode,
    pageSize: USER_DIRECTORY_PAGE_SIZE,
    filterKey: JSON.stringify([query, status, role, sort]),
    fetchPage: (nextPage) =>
      createPlatformAdminApi()
        .listUsers({
          q: query,
          status,
          role,
          sort,
          page: nextPage,
          pageSize: USER_DIRECTORY_PAGE_SIZE,
        })
        .then(({ data }) => ({ rows: data.users, total: data.total })),
  });

  const setQuery = useCallback(
    (raw: string) => {
      const next = raw.trim() || undefined;
      if (next === query) return;
      setQueryValue(next);
      resetToFirstPage();
    },
    [query, resetToFirstPage],
  );

  const setStatus = useCallback(
    (next: UserDirectoryStatus | undefined) => {
      if (next === status) return;
      setStatusValue(next);
      resetToFirstPage();
    },
    [status, resetToFirstPage],
  );

  const setRole = useCallback(
    (next: UserRole | undefined) => {
      if (next === role) return;
      setRoleValue(next);
      resetToFirstPage();
    },
    [role, resetToFirstPage],
  );

  const setFilters = useCallback(
    (next: UserDirectoryFilterValues) => {
      if (next.status === status && next.role === role) return;
      setStatusValue(next.status);
      setRoleValue(next.role);
      resetToFirstPage();
    },
    [status, role, resetToFirstPage],
  );

  const setSort = useCallback(
    (next: AdminUserSort) => {
      if (next === sort) return;
      setSortValue(next);
      resetToFirstPage();
    },
    [sort, resetToFirstPage],
  );

  return {
    users,
    total,
    page,
    pageSize: USER_DIRECTORY_PAGE_SIZE,
    query,
    status,
    role,
    sort,
    loading,
    loadingMore,
    error,
    loadMoreError,
    hasMore,
    setQuery,
    setStatus,
    setRole,
    setFilters,
    setSort,
    goToPage,
    loadMore,
    retryLoadMore,
  };
}
