'use client';

import { useIsMobileState } from '@myorganiser/web-ui';

import { useAuditLog } from '../hooks/use-audit-log';
import { AUDIT_LOG_MESSAGES, type AuditLogVariant } from '../lib/auditLog';
import { AuditLogFilterChips } from './audit/AuditLogFilterChips';
import { AuditLogFilterSheet } from './audit/AuditLogFilterSheet';
import { AuditLogFilters } from './audit/AuditLogFilters';
import { AuditLogHeader } from './audit/AuditLogHeader';
import { AuditLogPager } from './audit/AuditLogPager';
import { AuditLogPhoneList } from './audit/AuditLogPhoneList';
import { AuditLogTable } from './audit/AuditLogTable';

/**
 * The admin audit log. Desktop pages through a filterable table; phone appends
 * a day-grouped list behind a filter sheet. The state lives in `useAuditLog`,
 * and its setters are stable, so they pass straight through to the children.
 */
export function AuditLogPageClient() {
  // Until the breakpoint is known, only the header and a placeholder render.
  // The hook still runs, so it is unconditional.
  const isPhone = useIsMobileState();
  const variant: AuditLogVariant = isPhone ? 'phone' : 'desktop';
  const {
    entries,
    total,
    page,
    pageSize,
    actions,
    user,
    filtered,
    loading,
    loadingMore,
    error,
    loadMoreError,
    hasMore,
    toggleAction,
    setUser,
    clearFilters,
    goToPage,
    loadMore,
  } = useAuditLog({
    mode: isPhone ? 'append' : 'pages',
  });

  // No pager while the first load is pending (total is still 0) or on error.
  const showPager = !error && total > 0;
  const emptyMessage = filtered
    ? AUDIT_LOG_MESSAGES.filteredEmpty
    : AUDIT_LOG_MESSAGES.empty;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-4 md:gap-5 md:p-8">
      <AuditLogHeader variant={variant}>
        {isPhone === true ? (
          <AuditLogFilterSheet
            actions={actions}
            user={user}
            onToggleAction={toggleAction}
            onUserChange={setUser}
            onClear={clearFilters}
          />
        ) : null}
      </AuditLogHeader>

      {isPhone === undefined ? (
        <div aria-hidden="true" className="min-h-96" />
      ) : null}

      {isPhone === false ? (
        <>
          <AuditLogFilters
            actions={actions}
            user={user}
            onToggleAction={toggleAction}
            onUserChange={setUser}
            onClear={clearFilters}
          />
          <AuditLogTable
            entries={entries}
            loading={loading}
            error={error}
            emptyMessage={emptyMessage}
            footer={
              showPager ? (
                <AuditLogPager
                  page={page}
                  pageSize={pageSize}
                  shownCount={entries.length}
                  total={total}
                  filtered={filtered}
                  onPageChange={goToPage}
                />
              ) : null
            }
          />
        </>
      ) : null}

      {isPhone === true ? (
        <>
          <AuditLogFilterChips
            actions={actions}
            user={user}
            onToggleAction={toggleAction}
            onUserChange={setUser}
          />
          <AuditLogPhoneList
            entries={entries}
            total={total}
            loading={loading}
            loadingMore={loadingMore}
            error={error}
            loadMoreError={loadMoreError}
            hasMore={hasMore}
            emptyMessage={emptyMessage}
            onLoadMore={loadMore}
          />
        </>
      ) : null}
    </div>
  );
}
