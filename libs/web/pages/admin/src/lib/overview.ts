import type {
  AdminAuditAction,
  AdminOverviewResponse,
} from '@myorganiser/app-api-client';
import type { StatusPillTone } from '@myorganiser/web-ui';

import { ADMIN_SECTIONS } from './adminNav';

/**
 * The audit action pill tone. Grants and feedback actions are brand, promote
 * is trust, force logout is warning, and the removals are danger. Enable and
 * resend verification are neutral.
 */
export const AUDIT_ACTION_TONE = {
  disable: 'danger',
  enable: 'neutral',
  force_logout: 'warning',
  resend_verification: 'neutral',
  promote: 'trust',
  demote: 'danger',
  youtube_access_grant: 'brand',
  youtube_access_withdraw: 'danger',
  feedback_status_change: 'brand',
  feedback_tracking_issue_link: 'brand',
  feedback_tracking_issue_unlink: 'brand',
  feedback_manual_delivery: 'brand',
  feedback_reopen: 'brand',
} as const satisfies Record<AdminAuditAction, StatusPillTone>;

/** Places are "running low" once at or under this share of the ceiling. */
export const PLACES_LOW_RATIO = 0.25;

type OverviewCounts = Pick<
  AdminOverviewResponse,
  'youtubeAccessPlacesLeft' | 'youtubeAccessCeiling'
>;

/**
 * True when the YouTube Access places left are at or under a quarter of the
 * ceiling. A zero ceiling has no places to run low, so it is never low.
 */
export function arePlacesLow(overview: OverviewCounts): boolean {
  if (overview.youtubeAccessCeiling <= 0) return false;
  return (
    overview.youtubeAccessPlacesLeft <=
    overview.youtubeAccessCeiling * PLACES_LOW_RATIO
  );
}

export type AttentionRow =
  | { id: 'unverified'; count: number }
  | { id: 'places'; left: number; ceiling: number }
  | { id: 'disabled'; count: number };

export type AttentionTone = 'warning' | 'danger';

/**
 * The Needs attention rows that apply, in ruling order. Each row shows only
 * when its condition holds, so the list can be empty.
 */
export function deriveAttentionRows(
  overview: AdminOverviewResponse,
): AttentionRow[] {
  const rows: AttentionRow[] = [];

  if (overview.unverifiedOverAWeek > 0) {
    rows.push({ id: 'unverified', count: overview.unverifiedOverAWeek });
  }
  if (arePlacesLow(overview)) {
    rows.push({
      id: 'places',
      left: overview.youtubeAccessPlacesLeft,
      ceiling: overview.youtubeAccessCeiling,
    });
  }
  if (overview.disabled > 0) {
    rows.push({ id: 'disabled', count: overview.disabled });
  }

  return rows;
}

export function attentionTone(row: AttentionRow): AttentionTone {
  return row.id === 'disabled' ? 'danger' : 'warning';
}

export interface AttentionCopy {
  title: string;
  detail: string;
  action: string;
}

function accountsWord(count: number): string {
  return count === 1 ? 'account' : 'accounts';
}

/** Desktop Needs attention copy, with the action link's text. */
export function desktopAttentionCopy(row: AttentionRow): AttentionCopy {
  switch (row.id) {
    case 'unverified':
      return {
        title: `${row.count} ${accountsWord(row.count)} unverified for over a week`,
        detail: 'They cannot sign in until they verify.',
        action: 'Review',
      };
    case 'places':
      return {
        title: 'YouTube Access places running low',
        detail: `${row.left} of ${row.ceiling} left.`,
        action: 'See holders',
      };
    case 'disabled':
      return {
        title: `${row.count} ${accountsWord(row.count)} disabled`,
        detail: 'Cannot sign in',
        action: 'Open users',
      };
  }
}

/** Phone Needs attention copy. The phone row has no separate action text. */
export function phoneAttentionCopy(row: AttentionRow): {
  title: string;
  detail: string;
} {
  switch (row.id) {
    case 'unverified':
      return {
        title: `${row.count} unverified over a week`,
        detail: 'They cannot sign in yet',
      };
    case 'places':
      return {
        title: 'YouTube places running low',
        detail: `${row.left} of ${row.ceiling} left`,
      };
    case 'disabled':
      return {
        title: `${row.count} ${accountsWord(row.count)} disabled`,
        detail: 'Cannot sign in',
      };
  }
}

/** Every attention row links to the user directory. */
export const ATTENTION_HREF = ADMIN_SECTIONS.users.url;

export function usersJoinedNote(joined: number): string {
  return `+${joined} this week`;
}

/**
 * "You and N others" for the platform admins. The viewer is always one admin,
 * so the note is about the rest. No note when the viewer is the only admin.
 */
export function platformAdminsNote(platformAdmins: number): string | null {
  const others = platformAdmins - 1;
  if (others <= 0) return null;
  return others === 1 ? 'You and 1 other' : `You and ${others} others`;
}

export function unverifiedOverWeekNote(count: number): string {
  return `${count} for more than 7 days`;
}

export function placesLeftNote(left: number): string {
  return `${left} left · a first grant uses one`;
}

export function phoneUnverifiedNote(count: number): string {
  return `${count} over a week`;
}

export function phonePlacesLeftNote(left: number): string {
  return `${left} left`;
}
