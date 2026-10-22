const UNITS = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['week', 60 * 60 * 24 * 7],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
] as const satisfies readonly [Intl.RelativeTimeFormatUnit, number][];

/**
 * How long ago an upload was published, as "2 hours ago" in the reader's
 * locale. Returns an empty string for an unparseable timestamp so the caller
 * can drop the segment rather than show "Invalid Date".
 */
export function formatPublishedAgo(
  publishedAt: string,
  now: Date = new Date(),
): string {
  const publishedMs = Date.parse(publishedAt);
  if (Number.isNaN(publishedMs)) return '';

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const seconds = Math.round((publishedMs - now.getTime()) / 1000);

  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return formatter.format(0, 'second');
}
