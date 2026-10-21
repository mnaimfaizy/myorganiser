'use client';

import type { AdminUserIdentity } from '@myorganiser/app-api-client';
import { StatusPill } from '@myorganiser/web-ui';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

import { formatUserDisplayName } from '../../lib/formatUserIdentity';
import {
  phoneUserMeta,
  USER_DIRECTORY_MESSAGES,
  USER_STATUS_PILLS,
  userDirectoryStatus,
} from '../../lib/userDirectory';
import { UserAvatar } from './UserAvatar';

export interface UserDirectoryPhoneListProps {
  /** Every user loaded so far. */
  users: AdminUserIdentity[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

/**
 * The phone user list: a card of rows that grows as the sentinel below it
 * scrolls into view. There is no pager on phone.
 */
export function UserDirectoryPhoneList({
  users,
  total,
  loading,
  loadingMore,
  error,
  hasMore,
  onLoadMore,
}: UserDirectoryPhoneListProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let observer: IntersectionObserver | undefined;
    const node = sentinelRef.current;

    // jsdom has no IntersectionObserver; there the list simply does not grow.
    if (
      node !== null &&
      hasMore &&
      !loadingMore &&
      typeof IntersectionObserver !== 'undefined'
    ) {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore();
        }
      });
      observer.observe(node);
    }

    return () => observer?.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  const countLabel =
    users.length === 0
      ? null
      : hasMore
        ? `Scroll for more · ${users.length} of ${total}`
        : `${users.length} of ${total}`;

  return (
    <>
      <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-raised-surface">
        {loading ? (
          <p className="px-4 py-6 text-body-sm text-muted-foreground">
            {USER_DIRECTORY_MESSAGES.loading}
          </p>
        ) : error ? (
          <p className="px-4 py-6 text-body-sm text-destructive">
            {USER_DIRECTORY_MESSAGES.error}
          </p>
        ) : users.length === 0 ? (
          <p className="px-4 py-6 text-body-sm text-muted-foreground">
            {USER_DIRECTORY_MESSAGES.empty}
          </p>
        ) : (
          <ul>
            {users.map((user) => {
              const status = USER_STATUS_PILLS[userDirectoryStatus(user)];
              return (
                <li key={user.id} className="border-b border-border-subtle">
                  <Link
                    href={`/admin/users/${user.id}`}
                    className="flex min-h-16 items-center gap-3 px-3.5 transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
                  >
                    <UserAvatar user={user} size={40} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-body font-semibold text-foreground">
                        {formatUserDisplayName(user)}
                      </span>
                      <span className="truncate text-caption text-muted-foreground">
                        {phoneUserMeta(user)}
                      </span>
                    </span>
                    <StatusPill
                      tone={status.tone}
                      size="sm"
                      className="shrink-0"
                    >
                      {status.label}
                    </StatusPill>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-icon shrink-0 text-muted-foreground"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      {countLabel !== null ? (
        <p className="text-center text-caption text-muted-foreground">
          {countLabel}
        </p>
      ) : null}
    </>
  );
}
