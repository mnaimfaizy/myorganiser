import type {
  AdminOverviewResponse,
  AdminUserIdentity,
  AdminUserSort,
  UserRole,
} from '@myorganiser/app-api-client';
import type { StatusPillTone } from '@myorganiser/web-ui';

import { formatUserDisplayName } from './formatUserIdentity';

/** Rows per page. Desktop pages through it; phone appends one page at a time. */
export const USER_DIRECTORY_PAGE_SIZE = 25;

/** The strings the directory shows in its body states. Today's wording, kept. */
export const USER_DIRECTORY_MESSAGES = {
  loading: 'Loading…',
  error: 'Unable to load users. Please try again.',
  empty: 'No users found.',
} as const;

export type UserDirectoryVariant = 'desktop' | 'phone';

export type UserDirectoryStatus = 'active' | 'unverified' | 'disabled';

/** The filter values the endpoint takes. `undefined` means no filter. */
export interface UserDirectoryFilterValues {
  status?: UserDirectoryStatus;
  role?: UserRole;
}

/** Disabled wins, then unverified, then active. Matches the endpoint's filter. */
export function userDirectoryStatus(
  user: Pick<AdminUserIdentity, 'disabled' | 'emailVerified'>,
): UserDirectoryStatus {
  if (user.disabled) return 'disabled';
  if (!user.emailVerified) return 'unverified';
  return 'active';
}

export const USER_STATUS_PILLS = {
  active: { label: 'Active', tone: 'trust' },
  unverified: { label: 'Unverified', tone: 'warning' },
  disabled: { label: 'Disabled', tone: 'danger' },
} as const satisfies Record<
  UserDirectoryStatus,
  { label: string; tone: StatusPillTone }
>;

export const USER_ROLE_PILLS = {
  platform_admin: { label: 'Admin', tone: 'brand' },
  user: { label: 'User', tone: 'neutral' },
} as const satisfies Record<UserRole, { label: string; tone: StatusPillTone }>;

export interface UserDirectoryStatusChip {
  label: string;
  status: UserDirectoryStatus | undefined;
}

/** "All", then one chip per status in the pills table, in its order. */
export const USER_STATUS_CHIPS: readonly UserDirectoryStatusChip[] = [
  { label: 'All', status: undefined },
  ...(Object.keys(USER_STATUS_PILLS) as UserDirectoryStatus[]).map(
    (status) => ({ label: USER_STATUS_PILLS[status].label, status }),
  ),
];

export interface UserDirectoryRoleChip {
  label: string;
  role: UserRole | undefined;
}

/** "Any", then one chip per role in the pills table, in its order. */
export const USER_ROLE_CHIPS: readonly UserDirectoryRoleChip[] = [
  { label: 'Any', role: undefined },
  ...(Object.keys(USER_ROLE_PILLS) as UserRole[]).map((role) => ({
    label: USER_ROLE_PILLS[role].label,
    role,
  })),
];

export type UserDirectoryPhoneChipId =
  | 'all'
  | 'active'
  | 'unverified'
  | 'disabled'
  | 'admins';

export interface UserDirectoryPhoneChip {
  id: UserDirectoryPhoneChipId;
  label: string;
  filters: UserDirectoryFilterValues;
}

/** Phone has one row of chips. Each one is a whole filter combination. */
export const USER_DIRECTORY_PHONE_CHIPS: readonly UserDirectoryPhoneChip[] = [
  { id: 'all', label: 'All', filters: {} },
  { id: 'active', label: 'Active', filters: { status: 'active' } },
  { id: 'unverified', label: 'Unverified', filters: { status: 'unverified' } },
  { id: 'disabled', label: 'Disabled', filters: { status: 'disabled' } },
  { id: 'admins', label: 'Admins', filters: { role: 'platform_admin' } },
];

/**
 * The phone chip that is pressed for a set of filters. `undefined` when the
 * combination has no phone chip (for example, desktop set Admin plus Active
 * and the window then shrank). No chip is pressed then, and that is fine.
 */
export function phoneChipIdFor(
  filters: UserDirectoryFilterValues,
): UserDirectoryPhoneChipId | undefined {
  return USER_DIRECTORY_PHONE_CHIPS.find(
    (chip) =>
      chip.filters.status === filters.status &&
      chip.filters.role === filters.role,
  )?.id;
}

export const USER_SORT_LABELS = {
  newest: 'Newest first',
  name: 'Name',
} as const satisfies Record<AdminUserSort, string>;

export const USER_SORT_VALUES = Object.keys(
  USER_SORT_LABELS,
) as AdminUserSort[];

export function isAdminUserSort(value: string): value is AdminUserSort {
  return Object.prototype.hasOwnProperty.call(USER_SORT_LABELS, value);
}

/**
 * "2 Sep"; the year is appended (" 2025") only when it differs from `now`'s
 * year. The day and the three-letter month come from en-US formatToParts,
 * because en-GB prints "Sept" for September. Local time zone, as before.
 * Shared by the user directory and the audit log.
 */
export function formatDayMonth(date: Date, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
  }).formatToParts(date);
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const base = `${day} ${month}`;
  return date.getFullYear() === now.getFullYear()
    ? base
    : `${base} ${date.getFullYear()}`;
}

export function formatJoinedDate(iso: string, now: Date = new Date()): string {
  return formatDayMonth(new Date(iso), now);
}

const LAST_ACTIVE_RELATIVE = new Intl.RelativeTimeFormat('en-US', {
  numeric: 'auto',
});

const MS_PER_DAY = 86_400_000;

/**
 * The local calendar day as a whole-day number. Date.UTC of the local date
 * parts ignores the clock and any DST shift, so the difference between two
 * of these is the count of calendar days.
 */
function localDayNumber(date: Date): number {
  return Math.round(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY,
  );
}

/**
 * How long ago the User's last active day was, lowercase and sentence-ready:
 * "today", "yesterday", "3 days ago", "2 weeks ago", "5 months ago",
 * "2 years ago". A future day (clock skew) reads "today". `undefined` when the
 * User has no last-active day or it does not parse.
 */
export function lastActiveAgo(
  iso: string | null,
  now: Date = new Date(),
): string | undefined {
  if (iso === null) return undefined;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return undefined;

  const days = Math.max(0, localDayNumber(now) - localDayNumber(then));
  if (days < 7) return LAST_ACTIVE_RELATIVE.format(-days, 'day');
  if (days < 30) {
    return LAST_ACTIVE_RELATIVE.format(-Math.floor(days / 7), 'week');
  }
  if (days < 365) {
    return LAST_ACTIVE_RELATIVE.format(-Math.floor(days / 30), 'month');
  }
  return LAST_ACTIVE_RELATIVE.format(-Math.floor(days / 365), 'year');
}

/** "Today", "Yesterday", "3 days ago"; "Never" when there is no last-active day. */
export function formatLastActive(
  iso: string | null,
  now: Date = new Date(),
): string {
  const ago = lastActiveAgo(iso, now);
  if (ago === undefined) return 'Never';
  return ago.charAt(0).toUpperCase() + ago.slice(1);
}

/** "Last active today", "Last active 3 days ago"; "Never active" when there is none. */
export function formatLastActivePhrase(
  iso: string | null,
  now: Date = new Date(),
): string {
  const ago = lastActiveAgo(iso, now);
  return ago === undefined ? 'Never active' : `Last active ${ago}`;
}

/** "Showing 1–25 of 148"; zero rows reads "Showing 0 of {total}". */
export function formatShowingRange(
  page: number,
  pageSize: number,
  shownCount: number,
  total: number,
): string {
  if (shownCount === 0) {
    return `Showing 0 of ${total}`;
  }
  const start = (page - 1) * pageSize + 1;
  const end = start + shownCount - 1;
  return `Showing ${start}–${end} of ${total}`;
}

/** Initials from the first two words of the display name; one letter otherwise. */
export function userInitials(user: AdminUserIdentity): string {
  const name = formatUserDisplayName(user).trim();
  const words = name.includes('@')
    ? []
    : name.split(/\s+/).filter((word) => word.length > 0);

  if (words.length === 0) {
    return firstLetter(name || user.email);
  }

  return words
    .slice(0, 2)
    .map((word) => firstLetter(word))
    .join('')
    .toUpperCase();
}

function firstLetter(text: string): string {
  return Array.from(text)[0]?.toUpperCase() ?? '';
}

/**
 * Avatar fills, each a -foreground ink on its token ground. Brand violet,
 * trust teal, cyan, warning amber, and a navy neutral for the strong slate.
 */
export const USER_AVATAR_FILLS = [
  'bg-brand text-brand-foreground',
  'bg-trust text-trust-foreground',
  'bg-cyan text-cyan-foreground',
  'bg-warning text-warning-foreground',
  'bg-navy text-navy-foreground',
] as const;

/** A stable pick: the same user always gets the same fill. */
export function avatarFillFor(userId: string): string {
  let hash = 0;
  for (const char of userId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  const fill = USER_AVATAR_FILLS[hash % USER_AVATAR_FILLS.length];
  return fill ?? USER_AVATAR_FILLS[0];
}

/**
 * The phone row's second line: "Active 3 days ago" once the User has a
 * last-active day, otherwise the join date. Platform admins take an "Admin ·"
 * prefix in either case.
 */
export function phoneUserMeta(
  user: AdminUserIdentity,
  now: Date = new Date(),
): string {
  const isAdmin = user.role === 'platform_admin';
  const ago = lastActiveAgo(user.lastActiveAt, now);
  if (ago === undefined) {
    const joined = `Joined ${formatJoinedDate(user.createdAt, now)}`;
    return isAdmin ? `Admin · ${joined}` : joined;
  }
  return isAdmin ? `Admin · ${ago}` : `Active ${ago}`;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${pluralForm}`;
}

/** "148 accounts · 3 platform admins" on desktop, "148 accounts" on phone. */
export function formatAccountsSummary(
  overview: Pick<AdminOverviewResponse, 'users' | 'platformAdmins'>,
  variant: UserDirectoryVariant,
): string {
  const accounts = plural(overview.users, 'account', 'accounts');
  if (variant === 'phone') {
    return accounts;
  }
  const admins = plural(
    overview.platformAdmins,
    'platform admin',
    'platform admins',
  );
  return `${accounts} · ${admins}`;
}
