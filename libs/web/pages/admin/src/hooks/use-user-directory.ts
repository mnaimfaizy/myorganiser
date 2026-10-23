import type {
  AdminUserIdentity,
  AdminUserSort,
  UserRole,
} from '@myorganiser/app-api-client';
import { useCallback, useEffect, useState } from 'react';

import { createPlatformAdminApi } from '../lib/apiClient';
import {
  USER_DIRECTORY_PAGE_SIZE,
  type UserDirectoryFilterValues,
  type UserDirectoryStatus,
} from '../lib/userDirectory';

/**
 * `pages`: desktop, `users` is the current page. `append`: phone, `users` is
 * every page loaded so far and `loadMore()` fetches the next one.
 */
export type UserDirectoryMode = 'pages' | 'append';

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
}

interface UserDirectoryPaging {
  mode: UserDirectoryMode;
  page: number;
  /** Set only by loadMore. Every other change replaces the list. */
  append: boolean;
}

/** The last settled fetch. `key` names the request it answers. */
interface UserDirectorySettled {
  key: string | null;
  users: AdminUserIdentity[];
  total: number;
  /** A replace failed: the list is blank and the error shows. */
  error: boolean;
  /** An append failed: the rows loaded so far are kept. */
  appendError: boolean;
}

const NO_USERS: AdminUserIdentity[] = [];

/**
 * Owns the directory's query, filters, sort, and paging, and fetches the
 * list. Every filter, query, sort, or mode change resets to page 1 and
 * replaces the list. Setting a value to what it already is changes nothing,
 * so a pressed chip stays pressed.
 *
 * Pending and error flags are derived, not stored. A result is settled only
 * when its request key matches the current key, so a stale response can never
 * overwrite a newer one.
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
  // Paging remembers which mode it was set in. A mode switch then reads as
  // page 1 without a reset effect.
  const [paging, setPaging] = useState<UserDirectoryPaging>({
    mode,
    page: 1,
    append: false,
  });
  const page = paging.mode === mode ? paging.page : 1;
  const append = paging.mode === mode && paging.append;

  const requestKey = JSON.stringify([query, status, role, sort, page]);

  const [settled, setSettled] = useState<UserDirectorySettled>({
    key: null,
    users: NO_USERS,
    total: 0,
    error: false,
    appendError: false,
  });

  useEffect(() => {
    let cancelled = false;

    createPlatformAdminApi()
      .listUsers({
        q: query,
        status,
        role,
        sort,
        page,
        pageSize: USER_DIRECTORY_PAGE_SIZE,
      })
      .then((response) => {
        // A newer request has started; this response is stale.
        if (cancelled) return;
        const data = response.data;
        setSettled((previous) => ({
          key: requestKey,
          users: append ? [...previous.users, ...data.users] : data.users,
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
                users: previous.users,
                total: previous.total,
                error: false,
                appendError: true,
              }
            : {
                key: requestKey,
                users: NO_USERS,
                total: 0,
                error: true,
                appendError: false,
              },
        );
      });

    return () => {
      cancelled = true;
    };
  }, [requestKey, query, status, role, sort, page, append]);

  const pending = settled.key !== requestKey;
  const loadingMore = pending && append;
  const loading = pending && !loadingMore;
  const error = !pending && settled.error;
  const loadMoreError = !pending && settled.appendError;
  const users = settled.error ? NO_USERS : settled.users;
  const total = settled.total;

  const resetToFirstPage = useCallback(() => {
    setPaging({ mode, page: 1, append: false });
  }, [mode]);

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

  const goToPage = useCallback(
    (next: number) => {
      setPaging({ mode, page: Math.max(1, Math.floor(next)), append: false });
    },
    [mode],
  );

  const hasMore = page * USER_DIRECTORY_PAGE_SIZE < total;

  // A failed append is not retried by a loop: loadMore holds until a filter,
  // query, or sort change replaces the request.
  const loadMore = useCallback(() => {
    if (!hasMore || pending || loadMoreError) return;
    setPaging({ mode, page: page + 1, append: true });
  }, [hasMore, pending, loadMoreError, mode, page]);

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
  };
}
