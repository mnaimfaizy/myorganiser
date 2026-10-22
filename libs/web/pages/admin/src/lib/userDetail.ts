import type {
  AdminUserIdentity,
  UserRole,
  YouTubeAccessUsageResponse,
} from '@myorganiser/app-api-client';

import { formatJoinedDate } from './userDirectory';

/** The two layouts the User detail page draws. Phone is below the md breakpoint. */
export type UserDetailVariant = 'desktop' | 'phone';

/** Audit entries the Recent activity card shows. The full log is one link away. */
export const RECENT_ACTIVITY_LIMIT = 5;

export const RECENT_ACTIVITY_EMPTY = 'No activity yet.';

/** Shown under the Sign-in group, and described by the self-guarded buttons. */
export const SELF_GUARD_NOTE = "You can't disable or demote yourself.";

/** Under every lifecycle confirmation: each of these actions writes an audit entry. */
export const CONFIRM_AUDIT_NOTE =
  'The action is written to the audit log under your name.';

export type LifecycleAction =
  | 'disable'
  | 'enable'
  | 'forceLogout'
  | 'resendVerification'
  | 'promote'
  | 'demote'
  | 'grantYouTubeAccess'
  | 'withdrawYouTubeAccess';

export interface LifecycleActionCopy {
  /** The row's title. Shared by both layouts. */
  rowTitle: string;
  /** Static row descriptions. Rows whose text depends on state are computed by the helpers below. */
  rowDescription?: { desktop: string; phone: string };
  /** Button text before the action runs, per layout. */
  desktopLabel: string;
  phoneLabel: string;
  /** Accessible name of the row button. Overrides the visible text. */
  ariaLabel: string;
  /** Button text while the action runs. Same on both layouts. */
  loadingLabel: string;
  confirmTitle: (displayName: string) => string;
  confirmDescription: string;
  confirmLabel: string;
  tone: 'default' | 'destructive';
}

/** One table for every lifecycle action's row and confirmation copy. */
export const LIFECYCLE_ACTION_COPY = {
  disable: {
    rowTitle: 'Disable account',
    rowDescription: {
      desktop: 'Blocks sign-in until re-enabled.',
      phone: 'Blocks sign-in',
    },
    desktopLabel: 'Disable…',
    phoneLabel: 'Disable',
    ariaLabel: 'Disable account',
    loadingLabel: 'Disabling…',
    confirmTitle: () => 'Disable user?',
    confirmDescription:
      'This will prevent the user from signing in until they are re-enabled.',
    confirmLabel: 'Disable user',
    tone: 'destructive',
  },
  enable: {
    rowTitle: 'Enable account',
    rowDescription: {
      desktop: 'Sign-in is blocked until re-enabled.',
      phone: 'Sign-in blocked',
    },
    desktopLabel: 'Enable…',
    phoneLabel: 'Enable',
    ariaLabel: 'Enable account',
    loadingLabel: 'Enabling…',
    confirmTitle: () => 'Enable user?',
    confirmDescription: 'This will allow the user to sign in again.',
    confirmLabel: 'Enable user',
    tone: 'default',
  },
  forceLogout: {
    rowTitle: 'Force logout',
    rowDescription: {
      desktop: 'Ends every session. Their data stays.',
      phone: 'Ends every session',
    },
    desktopLabel: 'Log out everywhere…',
    phoneLabel: 'Log out',
    ariaLabel: 'Log out everywhere',
    loadingLabel: 'Revoking…',
    confirmTitle: () => 'Force logout?',
    confirmDescription:
      'This will revoke all active sessions for this user immediately.',
    confirmLabel: 'Force logout',
    tone: 'default',
  },
  resendVerification: {
    rowTitle: 'Email',
    desktopLabel: 'Resend verification',
    phoneLabel: 'Resend',
    ariaLabel: 'Resend verification',
    loadingLabel: 'Sending…',
    confirmTitle: () => 'Resend verification email?',
    confirmDescription: 'This will send a new verification email to the user.',
    confirmLabel: 'Resend email',
    tone: 'default',
  },
  promote: {
    rowTitle: 'Platform admin',
    desktopLabel: 'Promote…',
    phoneLabel: 'Promote',
    ariaLabel: 'Promote to Platform Admin',
    loadingLabel: 'Promoting…',
    confirmTitle: () => 'Promote to Platform Admin?',
    confirmDescription:
      'This will grant Platform Admin privileges to this user.',
    confirmLabel: 'Promote user',
    tone: 'default',
  },
  demote: {
    rowTitle: 'Platform admin',
    desktopLabel: 'Demote…',
    phoneLabel: 'Demote',
    ariaLabel: 'Demote Platform Admin',
    loadingLabel: 'Demoting…',
    confirmTitle: () => 'Demote Platform Admin?',
    confirmDescription:
      'This will remove Platform Admin privileges from this user.',
    confirmLabel: 'Demote user',
    tone: 'destructive',
  },
  grantYouTubeAccess: {
    rowTitle: 'YouTube Access',
    desktopLabel: 'Grant…',
    phoneLabel: 'Grant',
    ariaLabel: 'Grant YouTube Access',
    loadingLabel: 'Granting…',
    confirmTitle: () => 'Grant YouTube Access?',
    confirmDescription:
      'This will let the user connect and use YouTube in MyOrganiser. A first grant uses one of the limited YouTube Access places.',
    confirmLabel: 'Grant access',
    tone: 'default',
  },
  withdrawYouTubeAccess: {
    rowTitle: 'YouTube Access',
    desktopLabel: 'Withdraw…',
    phoneLabel: 'Withdraw',
    ariaLabel: 'Withdraw YouTube Access',
    loadingLabel: 'Withdrawing…',
    confirmTitle: (displayName) =>
      `Withdraw YouTube Access from ${displayName}?`,
    confirmDescription:
      "This will end the user's YouTube connection and revoke MyOrganiser's access at Google. Their YouTube data will be deleted: followed channels, cached uploads, watched marks and digest settings. Nothing is kept for a later reconnect.",
    confirmLabel: 'Withdraw access',
    tone: 'destructive',
  },
} as const satisfies Record<LifecycleAction, LifecycleActionCopy>;

/** The row description for a row whose text does not depend on the User's state. */
export function lifecycleRowDescription(
  action: LifecycleAction,
  variant: UserDetailVariant,
): string | undefined {
  const copy: LifecycleActionCopy = LIFECYCLE_ACTION_COPY[action];
  return copy.rowDescription?.[variant];
}

/** "7 of 25 places left": the places not yet taken, out of the ceiling. */
export function formatYouTubePlacesLeft(
  usage: YouTubeAccessUsageResponse,
): string {
  return `${usage.ceiling - usage.everGranted} of ${usage.ceiling} places left`;
}

/**
 * The YouTube Access row's description: "Loading…" while pending (no usage,
 * no failure), "Unavailable" when the usage call failed. Once loaded, desktop names the places out of the
 * ceiling and phone only the places left.
 */
export function youtubeAccessDescription(
  granted: boolean,
  usage: YouTubeAccessUsageResponse | null,
  usageFailed: boolean,
  variant: UserDetailVariant,
): string {
  const state = granted ? 'Granted' : 'Not granted';
  if (usage === null) {
    return `${state} · ${usageFailed ? 'Unavailable' : 'Loading…'}`;
  }
  if (variant === 'phone') {
    return `${state} · ${usage.ceiling - usage.everGranted} left`;
  }
  return `${state} · ${formatYouTubePlacesLeft(usage)}`;
}

export function platformAdminDescription(
  role: UserRole,
  variant: UserDetailVariant,
): string {
  if (variant === 'phone') {
    return role === 'platform_admin' ? 'Admin' : 'Not an admin';
  }
  return 'Can see accounts and the audit log. Never vault contents.';
}

export function emailVerificationDescription(verified: boolean): string {
  return verified ? 'Verified' : 'Not verified';
}

function formatDayMonthYear(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('day')} ${pick('month')} ${pick('year')}`;
}

/**
 * The identity meta line: email, phone when set, then the join date. Desktop
 * always states the year. Phone states it only when it is not this year.
 */
export function identityMeta(
  user: AdminUserIdentity,
  variant: UserDetailVariant,
  now: Date = new Date(),
): string {
  const joined =
    variant === 'desktop'
      ? `Joined ${formatDayMonthYear(new Date(user.createdAt))}`
      : `Joined ${formatJoinedDate(user.createdAt, now)}`;
  const parts = user.phone
    ? [user.email, user.phone, joined]
    : [user.email, joined];
  return parts.join(' · ');
}
