'use client';

import { useIsMobileState } from '@myorganiser/web-ui';

import { useUserDirectory } from '../../hooks/use-user-directory';
import type { UserDirectoryVariant } from '../../lib/userDirectory';
import { UserDirectoryFilters } from './UserDirectoryFilters';
import { UserDirectoryList } from './UserDirectoryList';
import { UserDirectoryPager } from './UserDirectoryPager';
import { UserDirectoryPhoneList } from './UserDirectoryPhoneList';
import { UserDirectorySearch } from './UserDirectorySearch';
import { UsersHeader } from './UsersHeader';

/**
 * The admin Users directory. It composes the header, the search, the filters,
 * and the list. Desktop pages through the list; phone appends it. The state
 * lives in `useUserDirectory`, and its setters are stable, so they pass
 * straight through to the children.
 */
export function UserDirectoryPageClient() {
  // Until the breakpoint is known, only the header and a placeholder render.
  // The hook still runs, so it is unconditional.
  const isPhone = useIsMobileState();
  const variant: UserDirectoryVariant = isPhone ? 'phone' : 'desktop';
  const {
    users,
    total,
    page,
    pageSize,
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
  } = useUserDirectory({
    mode: isPhone ? 'append' : 'pages',
  });

  // No pager while the first load is pending (total is still 0) or on error.
  const showPager = !error && total > 0;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-4 md:gap-5 md:p-8">
      <UsersHeader variant={variant}>
        <UserDirectorySearch onSearch={setQuery} />
      </UsersHeader>

      {isPhone === undefined ? (
        <div aria-hidden="true" className="min-h-96" />
      ) : null}

      {isPhone === false ? (
        <>
          <UserDirectoryFilters
            variant="desktop"
            status={status}
            role={role}
            sort={sort}
            onStatusChange={setStatus}
            onRoleChange={setRole}
            onFiltersChange={setFilters}
            onSortChange={setSort}
          />
          <UserDirectoryList
            users={users}
            loading={loading}
            error={error}
            footer={
              showPager ? (
                <UserDirectoryPager
                  page={page}
                  pageSize={pageSize}
                  shownCount={users.length}
                  total={total}
                  onPageChange={goToPage}
                />
              ) : null
            }
          />
        </>
      ) : null}

      {isPhone === true ? (
        <>
          <UserDirectoryFilters
            variant="phone"
            status={status}
            role={role}
            sort={sort}
            onStatusChange={setStatus}
            onRoleChange={setRole}
            onFiltersChange={setFilters}
            onSortChange={setSort}
          />
          <UserDirectoryPhoneList
            users={users}
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
