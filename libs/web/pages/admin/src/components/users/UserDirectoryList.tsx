import type { AdminUserIdentity } from '@myorganiser/app-api-client';
import { cn, StatusPill } from '@myorganiser/web-ui';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { formatUserDisplayName } from '../../lib/formatUserIdentity';
import {
  formatJoinedDate,
  USER_DIRECTORY_MESSAGES,
  USER_ROLE_PILLS,
  USER_STATUS_PILLS,
  userDirectoryStatus,
} from '../../lib/userDirectory';
import { UserAvatar } from './UserAvatar';

export interface UserDirectoryListProps {
  users: AdminUserIdentity[];
  loading: boolean;
  error: boolean;
  /** The pager, rendered under the rows. */
  footer?: ReactNode;
}

const ROW_GRID =
  'grid grid-cols-[minmax(0,2.4fr)_120px_130px_120px_24px] items-center gap-4 px-5';

/** The desktop user table, drawn as a card of grid rows. Each row is a link. */
export function UserDirectoryList({
  users,
  loading,
  error,
  footer,
}: UserDirectoryListProps) {
  return (
    <section
      aria-label="Users"
      className="overflow-hidden rounded-panel border border-border bg-raised-surface"
    >
      <div
        aria-hidden="true"
        className={cn(
          ROW_GRID,
          'border-b border-border bg-subtle py-3 text-label-caps text-muted-foreground',
        )}
      >
        <span>NAME</span>
        <span>ROLE</span>
        <span>STATUS</span>
        <span>JOINED</span>
        <span />
      </div>
      {loading ? (
        <p className="px-5 py-6 text-body-sm text-muted-foreground">
          {USER_DIRECTORY_MESSAGES.loading}
        </p>
      ) : error ? (
        <p className="px-5 py-6 text-body-sm text-destructive">
          {USER_DIRECTORY_MESSAGES.error}
        </p>
      ) : users.length === 0 ? (
        <p className="px-5 py-6 text-body-sm text-muted-foreground">
          {USER_DIRECTORY_MESSAGES.empty}
        </p>
      ) : (
        <ul>
          {users.map((user) => {
            const role = USER_ROLE_PILLS[user.role];
            const status = USER_STATUS_PILLS[userDirectoryStatus(user)];
            return (
              <li key={user.id} className="border-b border-border-subtle">
                <Link
                  href={`/admin/users/${user.id}`}
                  className={cn(
                    ROW_GRID,
                    'py-3 transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <UserAvatar user={user} size={36} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-body-sm font-semibold text-foreground">
                        {formatUserDisplayName(user)}
                      </span>
                      <span className="truncate text-caption text-muted-foreground">
                        {user.email}
                      </span>
                    </span>
                  </span>
                  <StatusPill tone={role.tone} className="justify-self-start">
                    {role.label}
                  </StatusPill>
                  <StatusPill tone={status.tone} className="justify-self-start">
                    {status.label}
                  </StatusPill>
                  <span className="text-body-sm text-muted-foreground">
                    <span className="sr-only">Joined </span>
                    {formatJoinedDate(user.createdAt)}
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-icon text-muted-foreground"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {footer}
    </section>
  );
}
