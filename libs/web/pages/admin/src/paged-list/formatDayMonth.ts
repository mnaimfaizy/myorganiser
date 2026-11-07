/**
 * "2 Sep"; the year is appended (" 2025") only when it differs from `now`'s
 * year. The day and the three-letter month come from en-US formatToParts,
 * because en-GB prints "Sept" for September. Local time zone, as before.
 * Shared by the user directory, the audit log, and the feedback inbox.
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
