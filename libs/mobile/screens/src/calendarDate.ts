// Calendar dates as the Vault stores them (`YYYY-MM-DD`, no time, no zone)
// and as the design prints them ("Wed 14 Oct 2026"). Pure, so the rules are
// tested in a plain Node Jest environment.
//
// A date-only value is always read as a *local* calendar day. `new
// Date('2026-10-14')` parses as UTC midnight, which is the previous evening
// anywhere west of Greenwich — the day a User picked would print as the day
// before.

import { localDateKey } from '@myorganiser/core/portable';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** The local calendar day an ISO date (or date-time's date part) names. */
export function parseCalendarDate(iso: string): Date | null {
  const match = ISO_DATE.exec(iso);
  if (match == null) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  // Rejects 2026-02-31 and the like, which `Date` would roll into March.
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null;
  }
  return date;
}

/** The `YYYY-MM-DD` of a date's local calendar day. */
export function toCalendarDate(date: Date): string {
  return localDateKey(date);
}

/** "Wed 14 Oct 2026". An unreadable value prints as it was stored. */
export function formatCalendarDate(iso: string): string {
  const date = parseCalendarDate(iso);
  if (date == null) return iso;
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "Wed 14 Oct" — the same day without the year, for a date this year. */
export function formatCalendarDateShort(iso: string): string {
  const date = parseCalendarDate(iso);
  if (date == null) return iso;
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** "14 Oct" / "3 Mar 2027" — day and month, with the year only when not `now`'s. */
export function formatDayMonth(iso: string, now: Date): string {
  const date = parseCalendarDate(iso);
  if (date == null) return iso;
  const dayMonth = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear()
    ? dayMonth
    : `${dayMonth} ${date.getFullYear()}`;
}
