'use client';

import type { FeedbackReportStatus } from '@myorganiser/app-api-client';
import { useIsMobileState } from '@myorganiser/web-ui';
import { useCallback } from 'react';

import { useFeedbackInbox } from '../hooks/use-feedback-inbox';
import type { FeedbackInboxVariant } from '../lib/feedbackInbox';
import { FeedbackInboxFilterSheet } from './feedback/inbox/FeedbackInboxFilterSheet';
import { FeedbackInboxFilters } from './feedback/inbox/FeedbackInboxFilters';
import { FeedbackInboxHeader } from './feedback/inbox/FeedbackInboxHeader';
import { FeedbackInboxPager } from './feedback/inbox/FeedbackInboxPager';
import { FeedbackInboxPhoneList } from './feedback/inbox/FeedbackInboxPhoneList';
import { FeedbackInboxTable } from './feedback/inbox/FeedbackInboxTable';
import { FeedbackStatusChips } from './feedback/inbox/FeedbackStatusChips';

/**
 * The admin feedback inbox. Desktop pages through a filterable table; phone
 * appends a list behind a status chip row and a filter sheet. The state lives
 * in `useFeedbackInbox`, and its setters pass straight through to the children.
 */
export function FeedbackInboxPageClient() {
  // Until the breakpoint is known, only the header and a placeholder render.
  // The hook still runs, so it is unconditional.
  const isPhone = useIsMobileState();
  const variant: FeedbackInboxVariant = isPhone ? 'phone' : 'desktop';
  const {
    reports,
    total,
    page,
    pageSize,
    filters,
    filtered,
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
  } = useFeedbackInbox({
    mode: isPhone ? 'append' : 'pages',
  });

  const handleStatusChange = useCallback(
    (status: FeedbackReportStatus | undefined) => setFilters({ status }),
    [setFilters],
  );

  // No pager while the first load is pending (total is still 0) or on error.
  const showPager = !error && total > 0;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-4 md:gap-5 md:p-8">
      <FeedbackInboxHeader variant={variant} receivedCount={receivedCount}>
        {isPhone === true ? (
          <FeedbackInboxFilterSheet
            filters={filters}
            onChange={setFilters}
            onClear={clearFilters}
          />
        ) : null}
      </FeedbackInboxHeader>

      {isPhone === undefined ? (
        <div aria-hidden="true" className="min-h-96" />
      ) : null}

      {isPhone === false ? (
        <>
          <FeedbackInboxFilters
            filters={filters}
            onChange={setFilters}
            onClear={clearFilters}
          />
          <FeedbackInboxTable
            reports={reports}
            loading={loading}
            error={error}
            footer={
              showPager ? (
                <FeedbackInboxPager
                  page={page}
                  pageSize={pageSize}
                  shownCount={reports.length}
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
          <FeedbackStatusChips
            status={filters.status}
            onStatusChange={handleStatusChange}
          />
          <FeedbackInboxPhoneList
            reports={reports}
            total={total}
            loading={loading}
            loadingMore={loadingMore}
            error={error}
            loadMoreError={loadMoreError}
            hasMore={hasMore}
            onLoadMore={loadMore}
          />
        </>
      ) : null}
    </div>
  );
}
