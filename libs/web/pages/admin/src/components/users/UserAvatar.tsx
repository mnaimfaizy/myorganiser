import type { AdminUserIdentity } from '@myorganiser/app-api-client';
import { cn } from '@myorganiser/web-ui';

import { avatarFillFor, userInitials } from '../../lib/userDirectory';

export type UserAvatarSize = 36 | 40;

export interface UserAvatarProps {
  user: AdminUserIdentity;
  size: UserAvatarSize;
}

const SIZE_CLASSES: Record<UserAvatarSize, string> = {
  36: 'size-9 text-caption',
  40: 'size-10 text-control-sm',
};

/** A decorative initials circle. The name beside it carries the meaning. */
export function UserAvatar({ user, size }: UserAvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-bold',
        SIZE_CLASSES[size],
        avatarFillFor(user.id),
      )}
    >
      {userInitials(user)}
    </span>
  );
}
