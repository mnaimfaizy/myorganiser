import type {
  AdminAuditAction,
  AdminAuditLogEntry,
} from '@myorganiser/app-api-client';
import { useCallback, useEffect, useState } from 'react';

import { createPlatformAdminApi } from '../lib/apiClient';
import {
  AUDIT_ACTION_VALUES,
  AUDIT_LOG_PAGE_SIZE,
  type AuditLogUserFilter,
} from '../lib/auditLog';

/**
 * `pages`: desktop, `entries` is the current page. `append`: phone, `entries`
 * is every page loaded so far and `loadMore()` fetches the next one.
 */
export type AuditLogMode = 'pages' | 'append';

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

interface AuditLogPaging {
  mode: AuditLogMode;
  page: number;
  /** Set only by loadMore. Every other change replaces the list. */
  append: boolean;
}

/** The last settled fetch. `key` names the request it answers. */
interface AuditLogSettled {
  key: string | null;
  entries: AdminAuditLogEntry[];
  total: number;
  /** A replace failed: the list is blank and the error shows. */
  error: boolean;
  /** An append failed: the rows loaded so far are kept. */
  appendError: boolean;
}

const NO_ENTRIES: AdminAuditLogEntry[] = [];

/**
 * Owns the audit log's action and user filters, and paging, and fetches the
 * list. Every filter change resets to page 1 and replaces the list. Setting a
 * value to what it already is changes nothing.
 *
 * Pending and error flags are derived, not stored. A result is settled only
 * when its request key matches the current key, so a stale response can never
 * overwrite a newer one.
 */
export function useAuditLog({
  mode,
  userId: fixedUserId,
}: UseAuditLogOptions): AuditLogState {
  const [actions, setActionsValue] = useState<AdminAuditAction[]>([]);
  const [user, setUserValue] = useState<AuditLogUserFilter | undefined>(
    undefined,
  );
  // Paging remembers which mode it was set in. A mode switch then reads as
  // page 1 without a reset effect.
  const [paging, setPaging] = useState<AuditLogPaging>({
    mode,
    page: 1,
    append: false,
  });
  const page = paging.mode === mode ? paging.page : 1;
  const append = paging.mode === mode && paging.append;

  // A fixed User wins over a picked one. The picker is never set under a fixed id.
  const effectiveUserId = fixedUserId ?? user?.id;
  const requestKey = JSON.stringify([effectiveUserId, actions, page]);

  const [settled, setSettled] = useState<AuditLogSettled>({
    key: null,
    entries: NO_ENTRIES,
    total: 0,
    error: false,
    appendError: false,
  });

  useEffect(() => {
    let cancelled = false;

    createPlatformAdminApi()
      .listAuditLogs({
        userId: effectiveUserId,
        action: actions.length > 0 ? actions : undefined,
        page,
        pageSize: AUDIT_LOG_PAGE_SIZE,
      })
      .then((response) => {
        // A newer request has started; this response is stale.
        if (cancelled) return;
        const data = response.data;
        setSettled((previous) => ({
          key: requestKey,
          entries: append
            ? [...previous.entries, ...data.entries]
            : data.entries,
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
                entries: previous.entries,
                total: previous.total,
                error: false,
                appendError: true,
              }
            : {
                key: requestKey,
                entries: NO_ENTRIES,
                total: 0,
                error: true,
                appendError: false,
              },
        );
      });

    return () => {
      cancelled = true;
    };
    // `actions` keeps its identity until a real change, so it is a safe dependency.
  }, [requestKey, effectiveUserId, actions, page, append]);

  const pending = settled.key !== requestKey;
  const loadingMore = pending && append;
  const loading = pending && !loadingMore;
  const error = !pending && settled.error;
  const loadMoreError = !pending && settled.appendError;
  const entries = settled.error ? NO_ENTRIES : settled.entries;
  const total = settled.total;

  const resetToFirstPage = useCallback(() => {
    setPaging({ mode, page: 1, append: false });
  }, [mode]);

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

  const goToPage = useCallback(
    (next: number) => {
      setPaging({ mode, page: Math.max(1, Math.floor(next)), append: false });
    },
    [mode],
  );

  const hasMore = page * AUDIT_LOG_PAGE_SIZE < total;

  // A failed append is not retried by a loop: loadMore holds until a filter
  // change replaces the request.
  const loadMore = useCallback(() => {
    if (!hasMore || pending || loadMoreError) return;
    setPaging({ mode, page: page + 1, append: true });
  }, [hasMore, pending, loadMoreError, mode, page]);

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
