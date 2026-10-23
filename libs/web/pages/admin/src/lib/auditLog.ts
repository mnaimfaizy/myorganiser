import type {
  AdminAuditAction,
  AdminAuditLogEntry,
} from '@myorganiser/app-api-client';

import { AUDIT_ACTION_LABELS, formatAuditAction } from './formatAuditLog';
import { formatDayMonth, formatShowingRange } from './userDirectory';

/** Rows per page. Desktop pages through it; phone appends one page at a time. */
export const AUDIT_LOG_PAGE_SIZE = 25;

/** The strings the audit log shows in its body states. Today's wording, kept, plus the filtered empty state. */
export const AUDIT_LOG_MESSAGES = {
  loading: 'Loading…',
  error: 'Unable to load audit log. Please try again.',
  empty: 'No audit log entries yet.',
  filteredEmpty: 'No audit log entries match these filters.',
} as const;

export type AuditLogVariant = 'desktop' | 'phone';

/** Every action, in the label table's order. The request key relies on this order. */
export const AUDIT_ACTION_VALUES = Object.keys(
  AUDIT_ACTION_LABELS,
) as AdminAuditAction[];

export type AuditPartySide = 'actor' | 'target';

export interface AuditParty {
  userId: string | null;
  name: string;
  deleted: boolean;
}

/** The name a party shows once its User is gone, or when no name is held. */
const DELETED_PARTY_NAME = 'Deleted user';

/** One side of an entry: the actor, or the target. A deleted side reads "Deleted user". */
export function auditParty(
  entry: AdminAuditLogEntry,
  side: AuditPartySide,
): AuditParty {
  const isActor = side === 'actor';
  const userId = isActor ? entry.actorUserId : entry.targetUserId;
  const rawName = isActor ? entry.actorName : entry.targetName;
  const deleted = isActor ? entry.actorDeleted : entry.targetDeleted;

  return {
    userId,
    name: deleted || rawName === null ? DELETED_PARTY_NAME : rawName,
    deleted,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 24-hour local time, "10:42". */
export function formatAuditTime(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The local calendar day as "YYYY-MM-DD". */
function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "Today" or "Yesterday" for a local day; `null` for any other day. */
export function relativeDayLabel(
  date: Date,
  now: Date,
): 'Today' | 'Yesterday' | null {
  const key = localDayKey(date);
  if (key === localDayKey(now)) return 'Today';

  // Day 0 of the month is the last day of the previous month, so the day
  // arithmetic crosses month and year boundaries correctly.
  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
  );
  if (key === localDayKey(yesterday)) return 'Yesterday';

  return null;
}

/** "Today 09:58", "Yesterday 17:20", "14 Oct 11:03", or "14 Oct 2025 11:03" across a year boundary. */
export function formatAuditWhen(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const day = relativeDayLabel(date, now) ?? formatDayMonth(date, now);
  return `${day} ${formatAuditTime(iso)}`;
}

export interface AuditLogDayGroup {
  key: string;
  label: string;
  entries: AdminAuditLogEntry[];
}

/** Groups entries by local day. Input order is kept, so the groups run newest first. */
export function groupAuditEntriesByDay(
  entries: AdminAuditLogEntry[],
  now: Date = new Date(),
): AuditLogDayGroup[] {
  const groups: AuditLogDayGroup[] = [];
  const byKey = new Map<string, AuditLogDayGroup>();

  for (const entry of entries) {
    const date = new Date(entry.createdAt);
    const key = localDayKey(date);
    let group = byKey.get(key);

    if (!group) {
      group = {
        key,
        label: relativeDayLabel(date, now) ?? formatDayMonth(date, now),
        entries: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }

    group.entries.push(entry);
  }

  return groups;
}

/** "Showing 1–8 of 36 matching entries" when filtered; "Showing 1–8 of 36 entries" when not. */
export function formatAuditShowingRange(
  page: number,
  pageSize: number,
  shownCount: number,
  total: number,
  filtered: boolean,
): string {
  const noun = filtered ? 'matching entries' : 'entries';
  return `${formatShowingRange(page, pageSize, shownCount, total)} ${noun}`;
}

/** "Any action", the labels for one or two actions, or "{n} actions". */
export function formatActionFilterSummary(
  actions: readonly AdminAuditAction[],
): string {
  if (actions.length === 0) return 'Any action';
  if (actions.length <= 2) {
    return actions.map((action) => formatAuditAction(action)).join(', ');
  }
  return `${actions.length} actions`;
}

/** The user filter: the picked User's id, and the name the picker shows. */
export interface AuditLogUserFilter {
  id: string;
  name: string;
}

/** Each selected action counts once, and the user filter counts once. */
export function countActiveAuditFilters(
  actions: readonly AdminAuditAction[],
  user: AuditLogUserFilter | undefined,
): number {
  return actions.length + (user ? 1 : 0);
}
