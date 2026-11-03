import { localDateKey } from '@myorganiser/core';

export function isoToDateInput(value: string | undefined): string {
  if (!value) return '';
  // Expect ISO or date-only, return YYYY-MM-DD (UTC date portion)
  return value.slice(0, 10);
}

export function dateInputToIso(value: string | undefined): string | undefined {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return undefined;

  const date = new Date(v);
  if (Number.isNaN(date.getTime())) return undefined;

  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && date.toISOString().slice(0, 10) !== v) {
    return undefined;
  }

  return date.toISOString();
}

/**
 * Returns today's date as a YYYY-MM-DD string in the user's local timezone.
 * Use this instead of isoToDateInput(new Date().toISOString()), which returns
 * the UTC date and may be off by one day for users in non-UTC timezones.
 */
export function todayAsDateInput(): string {
  return localDateKey(new Date());
}
