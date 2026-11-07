import type {
  AdminAuditAction,
  AdminAuditLogEntry,
} from '@myorganiser/app-api-client';
import { useCallback, useState } from 'react';

import { createPlatformAdminApi } from '../lib/apiClient';
import { type PagedListMode, usePagedList } from '../paged-list/use-paged-list';
import {
  AUDIT_ACTION_VALUES,
  AUDIT_LOG_PAGE_SIZE,
  type AuditLogUserFilter,
} from '../lib/auditLog';

/**
 * `pages`: desktop, `entries` is the current page. `append`: phone, `entries`
 * is every page loaded so far and `loadMore()` fetches the next one.
 */
export type AuditLogMode = PagedListMode;

export interface UseAuditLogOptions {
  mode: AuditLogMode;
  /**
   * Locks the log to one User, for a page about that User. The user filter is then
   * fixed and `setUser` does nothing.
   */
  userId?: string;
}

export interface AuditLogState {
  entries: AdminAuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  /** Selected actions, in `AUDIT_ACTION_VALUES` order. Empty means any action. */
  actions: AdminAuditAction[];
  /** The picked user. Undefined when unset, and always undefined under a fixed `userId`. */
  user: AuditLogUserFilter | undefined;
  /** At least one action is selected, or a user is set (fixed or picked). */
  filtered: boolean;
  /** The first load, or a filter change. */
  loading: boolean;
  /** An append (phone) fetch is in flight. */
  loadingMore: boolean;
  error: boolean;
  /** The last append failed. The rows are kept; cleared by any filter change. */
  loadMoreError: boolean;
  hasMore: boolean;
  /** Replaces the selected actions. Any order is accepted; the state is kept in table order. */
  setActions: (next: AdminAuditAction[]) => void;
  /** Adds the action when it is off, removes it when it is on. */
  toggleAction: (action: AdminAuditAction) => void;
  /** Sets the user filter. A no-op under a fixed `userId`. */
  setUser: (next: AuditLogUserFilter | undefined) => void;
  /** Clears the actions and, unless the log is fixed to a User, the user. */
  clearFilters: () => void;
  goToPage: (next: number) => void;
  loadMore: () => void;
}

/**
 * Owns the audit log's action and user filters, and fetches the list through
 * `usePagedList`. Every filter change resets to page 1 and replaces the list.
 * Setting a value to what it already is changes nothing.
 */
export function useAuditLog({
  mode,
  userId: fixedUserId,
}: UseAuditLogOptions): AuditLogState {
  const [actions, setActionsValue] = useState<AdminAuditAction[]>([]);
  const [user, setUserValue] = useState<AuditLogUserFilter | undefined>(
    undefined,
  );

  // A fixed User wins over a picked one. The picker is never set under a fixed id.
  const effectiveUserId = fixedUserId ?? user?.id;

  const {
    rows: entries,
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
  } = usePagedList<AdminAuditLogEntry>({
    mode,
    pageSize: AUDIT_LOG_PAGE_SIZE,
    // `actions` is kept in table order, so one selection is always one key.
    filterKey: JSON.stringify([effectiveUserId, actions]),
    fetchPage: (nextPage) =>
      createPlatformAdminApi()
        .listAuditLogs({
          userId: effectiveUserId,
          action: actions.length > 0 ? actions : undefined,
          page: nextPage,
          pageSize: AUDIT_LOG_PAGE_SIZE,
        })
        .then(({ data }) => ({ rows: data.entries, total: data.total })),
  });

  const setActions = useCallback(
    (next: AdminAuditAction[]) => {
      // Table order, so the same selection always produces the same key.
      const ordered = AUDIT_ACTION_VALUES.filter((value) =>
        next.includes(value),
      );
      if (JSON.stringify(ordered) === JSON.stringify(actions)) return;
      setActionsValue(ordered);
      resetToFirstPage();
    },
    [actions, resetToFirstPage],
  );

  const toggleAction = useCallback(
    (action: AdminAuditAction) => {
      setActions(
        actions.includes(action)
          ? actions.filter((value) => value !== action)
          : [...actions, action],
      );
    },
    [actions, setActions],
  );

  const setUser = useCallback(
    (next: AuditLogUserFilter | undefined) => {
      if (fixedUserId !== undefined) return;
      if (next?.id === user?.id) return;
      setUserValue(next);
      resetToFirstPage();
    },
    [fixedUserId, user, resetToFirstPage],
  );

  const clearFilters = useCallback(() => {
    const clearsUser = fixedUserId === undefined && user !== undefined;
    if (actions.length === 0 && !clearsUser) return;
    setActionsValue([]);
    if (clearsUser) setUserValue(undefined);
    resetToFirstPage();
  }, [actions, fixedUserId, user, resetToFirstPage]);

  return {
    entries,
    total,
    page,
    pageSize: AUDIT_LOG_PAGE_SIZE,
    actions,
    user,
    filtered: actions.length > 0 || effectiveUserId !== undefined,
    loading,
    loadingMore,
    error,
    loadMoreError,
    hasMore,
    setActions,
    toggleAction,
    setUser,
    clearFilters,
    goToPage,
    loadMore,
  };
}
