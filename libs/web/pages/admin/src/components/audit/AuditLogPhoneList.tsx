'use client';

import type { AdminAuditLogEntry } from '@myorganiser/app-api-client';
import { useMemo } from 'react';

import {
  AUDIT_LOG_MESSAGES,
  formatAuditTime,
  groupAuditEntriesByDay,
} from '../../lib/auditLog';
import { PhoneLoadMoreFooter } from '../../paged-list/PhoneLoadMoreFooter';
import { AuditActionPill } from './AuditActionPill';
import { AuditPartyName } from './AuditPartyName';

export interface AuditLogPhoneListProps {
  /** Every entry loaded so far. */
  entries: AdminAuditLogEntry[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: boolean;
  /** The last append failed. The rows stay; the sentinel does not retry. */
  loadMoreError: boolean;
  hasMore: boolean;
  /** Shown when there are no rows and no error. */
  emptyMessage: string;
  onLoadMore: () => void;
}

/**
 * The phone audit log: one block per local day, each a card of rows. The list
 * grows as the sentinel below it scrolls into view. There is no pager on phone.
 */
export function AuditLogPhoneList({
  entries,
  total,
  loading,
  loadingMore,
  error,
  loadMoreError,
  hasMore,
  emptyMessage,
  onLoadMore,
}: AuditLogPhoneListProps) {
  const groups = useMemo(() => groupAuditEntriesByDay(entries), [entries]);

  return (
    <>
      {loading ? (
        <div className="rounded-xl border border-border bg-raised-surface">
          <p
            role="status"
            className="px-4 py-6 text-body-sm text-muted-foreground"
          >
            {AUDIT_LOG_MESSAGES.loading}
          </p>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-border bg-raised-surface">
          <p className="px-4 py-6 text-body-sm text-destructive">
            {AUDIT_LOG_MESSAGES.error}
          </p>
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-border bg-raised-surface">
          <p className="px-4 py-6 text-body-sm text-muted-foreground">
            {emptyMessage}
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.key} className="flex flex-col gap-2">
            <h2 className="text-label-caps uppercase text-muted-foreground">
              {group.label}
            </h2>
            <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-raised-surface">
              <ul>
                {group.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex min-w-0 flex-col gap-1 border-b border-border-subtle px-4 py-3 last:border-b-0"
                  >
                    <div className="flex items-center gap-2">
                      <AuditActionPill action={entry.action} variant="phone" />
                      <span className="flex-1" />
                      <time
                        dateTime={entry.createdAt}
                        className="text-caption text-muted-foreground"
                      >
                        {formatAuditTime(entry.createdAt)}
                      </time>
                    </div>
                    <p className="min-w-0 break-words text-body">
                      <AuditPartyName
                        entry={entry}
                        side="actor"
                        className="font-semibold"
                      />
                      <span aria-hidden="true"> → </span>
                      <span className="sr-only"> to </span>
                      <AuditPartyName entry={entry} side="target" />
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))
      )}
      <PhoneLoadMoreFooter
        shownCount={entries.length}
        total={total}
        hasMore={hasMore}
        loadingMore={loadingMore}
        loadMoreError={loadMoreError}
        errorMessage={AUDIT_LOG_MESSAGES.error}
        onLoadMore={onLoadMore}
      />
    </>
  );
}
