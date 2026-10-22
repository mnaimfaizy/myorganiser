'use client';

import type { AdminUserIdentity } from '@myorganiser/app-api-client';
import { StatusPill } from '@myorganiser/web-ui';

import { formatUserDisplayName } from '../../lib/formatUserIdentity';
import {
  USER_ROLE_PILLS,
  USER_STATUS_PILLS,
  userDirectoryStatus,
} from '../../lib/userDirectory';
import { identityMeta, type UserDetailVariant } from '../../lib/userDetail';
import { UserAvatar } from '../users/UserAvatar';

export interface UserIdentityCardProps {
  user: AdminUserIdentity;
  variant: UserDetailVariant;
}

/**
 * The User's name, status and access at a glance. Desktop is a bordered card.
 * Phone has no card: the avatar and name sit on the page, with the pills
 * beside them and the meta line below.
 */
export function UserIdentityCard({ user, variant }: UserIdentityCardProps) {
  const isPhone = variant === 'phone';
  const pillSize = isPhone ? 'sm' : 'default';
  const status = USER_STATUS_PILLS[userDirectoryStatus(user)];
  const role = USER_ROLE_PILLS[user.role];
  const name = formatUserDisplayName(user);
  const meta = identityMeta(user, variant);

  const statusPill = (
    <StatusPill tone={status.tone} size={pillSize}>
      {status.label}
    </StatusPill>
  );
  const youtubePill = user.youtubeAccess ? (
    <StatusPill tone="brand" size={pillSize}>
      {isPhone ? 'YouTube' : 'YouTube Access'}
    </StatusPill>
  ) : null;

  if (isPhone) {
    // The role pill shows only for a Platform Admin, so an admin stays visible.
    const adminPill =
      user.role === 'platform_admin' ? (
        <StatusPill tone={role.tone} size="sm">
          {role.label}
        </StatusPill>
      ) : null;

    return (
      <section aria-label="Identity" className="flex flex-col gap-2">
        <div className="flex items-center gap-3.5">
          <UserAvatar user={user} size={56} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="font-display text-title-lg text-foreground">
              {name}
            </h1>
            <div className="flex flex-wrap gap-1.5">
              {statusPill}
              {youtubePill}
              {adminPill}
            </div>
          </div>
        </div>
        <p className="text-caption text-muted-foreground">{meta}</p>
      </section>
    );
  }

  return (
    <section
      aria-label="Identity"
      className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-raised-surface p-6"
    >
      <UserAvatar user={user} size={72} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h1 className="font-display text-title-lg text-foreground">{name}</h1>
        <p className="text-body-sm text-muted-foreground">{meta}</p>
        <div className="flex flex-wrap gap-2">
          {statusPill}
          <StatusPill tone={role.tone} size="default">
            {role.label}
          </StatusPill>
          {youtubePill}
        </div>
      </div>
    </section>
  );
}
