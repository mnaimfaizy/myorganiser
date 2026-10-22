'use client';

import { Illustration } from '@myorganiser/web-ui';
import type { ReactNode } from 'react';

import { useAdminOverview } from '../../hooks/use-admin-overview';
import {
  formatAccountsSummary,
  type UserDirectoryVariant,
} from '../../lib/userDirectory';

export interface UsersHeaderProps {
  variant: UserDirectoryVariant;
  /** The search form. It sits right of the title on desktop, below it on phone. */
  children?: ReactNode;
}

/**
 * The Users title row. The one h1 for every width. The account counts come
 * from the shell's overview, and show only once it has loaded.
 */
export function UsersHeader({ variant, children }: UsersHeaderProps) {
  const { overview, loading, error } = useAdminOverview();
  const isPhone = variant === 'phone';
  const summary =
    overview !== null && !loading && !error
      ? formatAccountsSummary(overview, variant)
      : null;

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3 md:gap-4">
        <Illustration kind="users" size={isPhone ? 48 : 64} />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-display text-foreground">Users</h1>
          {summary !== null ? (
            <p
              className={
                isPhone
                  ? 'text-caption text-muted-foreground'
                  : 'text-body-sm text-muted-foreground'
              }
            >
              {summary}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}
