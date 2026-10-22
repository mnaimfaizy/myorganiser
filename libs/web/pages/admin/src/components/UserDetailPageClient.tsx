'use client';

import { getCurrentUser } from '@myorganiser/auth';
import { cn, useIsMobileState } from '@myorganiser/web-ui';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useState } from 'react';

import { useAdminUser } from '../hooks/use-admin-user';
import { ADMIN_SECTIONS } from '../lib/adminNav';
import type { UserDetailVariant } from '../lib/userDetail';
import { UserIdentityCard } from './user-detail/UserIdentityCard';
import { UserRecentActivity } from './user-detail/UserRecentActivity';
import { UserLifecycleActions } from './UserLifecycleActions';

const PAGE_CLASS: Record<UserDetailVariant, string> = {
  desktop: 'mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-8',
  phone: 'mx-auto flex w-full max-w-[1200px] flex-col gap-3 px-4 py-3',
};

const ACTIONS_CLASS: Record<UserDetailVariant, string> = {
  desktop:
    'grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] items-start gap-5',
  phone: 'flex flex-col gap-3',
};

/**
 * The admin User detail page. Identity, then the lifecycle actions (two cards
 * on desktop, stacked groups on phone), then recent activity. The layout is
 * chosen once the breakpoint is known; until then only a placeholder shows.
 */
export function UserDetailPageClient() {
  const params = useParams();
  const userId =
    typeof params.userId === 'string' ? params.userId : params.userId?.[0];

  const isPhone = useIsMobileState();
  const {
    user,
    setUser,
    loading,
    notFound,
    error,
    youtubeUsage,
    youtubeUsageFailed,
  } = useAdminUser(userId);

  // Each completed lifecycle action bumps this. Recent activity is keyed on it,
  // so it remounts and refetches the audit log that now holds the new entry.
  const [activityRevision, setActivityRevision] = useState(0);
  const handleActionCompleted = useCallback(() => {
    setActivityRevision((revision) => revision + 1);
  }, []);

  if (isPhone === undefined) {
    return <div aria-hidden="true" className="min-h-96" />;
  }

  const variant: UserDetailVariant = isPhone ? 'phone' : 'desktop';
  const currentUserId = getCurrentUser()?.id;
  const isSelf = user !== null && user.id === currentUserId;

  return (
    <div className={PAGE_CLASS[variant]}>
      <Link
        href={ADMIN_SECTIONS.users.url}
        className={cn(
          'inline-flex items-center gap-1.5 text-brand-text',
          isPhone ? 'min-h-11 text-body' : 'text-body-sm font-semibold',
        )}
      >
        <ChevronLeft aria-hidden="true" className="size-3.5 shrink-0" />
        {isPhone ? 'Users' : 'All users'}
      </Link>

      {loading ? (
        <p className="text-body-sm text-muted-foreground">Loading…</p>
      ) : notFound ? (
        <p className="text-body-sm text-muted-foreground">User not found.</p>
      ) : error ? (
        <p className="text-body-sm text-destructive">{error}</p>
      ) : user ? (
        <>
          <UserIdentityCard user={user} variant={variant} />

          <div className={ACTIONS_CLASS[variant]}>
            <UserLifecycleActions
              user={user}
              onUserUpdated={setUser}
              isSelf={isSelf}
              youtubeUsage={youtubeUsage}
              youtubeUsageFailed={youtubeUsageFailed}
              variant={variant}
              onActionCompleted={handleActionCompleted}
            />
          </div>

          <UserRecentActivity
            key={activityRevision}
            userId={user.id}
            variant={variant}
          />
        </>
      ) : null}
    </div>
  );
}
