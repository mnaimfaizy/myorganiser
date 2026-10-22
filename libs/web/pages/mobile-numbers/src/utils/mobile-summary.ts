import type { MobileNumberRecord } from '@myorganiser/vault-core';
import {
  formatShortDate,
  type PillSpec,
  placeProgress,
} from '@myorganiser/web-usage-locations';

import { countryNameForCode } from '../data/countryCodes';
import { formatMobileNumber } from './formatMobileNumber';

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Usage Locations still to update, across every Mobile Number. */
function countPlacesToUpdate(items: readonly MobileNumberRecord[]): number {
  return items.reduce(
    (sum, m) => sum + placeProgress(m.usageLocations).left,
    0,
  );
}

/** The desktop header line, e.g. "4 numbers · 1 place still to update". */
export function formatMobileNumbersSummary(
  items: readonly MobileNumberRecord[],
): string {
  return `${plural(items.length, 'number', 'numbers')} · ${plural(
    countPlacesToUpdate(items),
    'place',
    'places',
  )} still to update`;
}

/** The phone header line, e.g. "4 saved · 1 place to update". */
export function formatMobileNumbersPhoneSummary(
  items: readonly MobileNumberRecord[],
): string {
  return `${items.length} saved · ${plural(
    countPlacesToUpdate(items),
    'place',
    'places',
  )} to update`;
}

/**
 * Keeps the Mobile Numbers whose label or formatted number contains `query`,
 * ignoring case. A query with digits also matches when those digits appear in
 * the number's digits, so "412 345" finds "+61 412 345 678".
 */
export function filterMobileNumbers(
  items: readonly MobileNumberRecord[],
  query: string,
): MobileNumberRecord[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  const digits = needle.replace(/\D/g, '');

  return items.filter((item) => {
    if (item.label.toLowerCase().includes(needle)) return true;
    const formatted = formatMobileNumber(item);
    if (formatted.toLowerCase().includes(needle)) return true;
    return digits.length > 0 && formatted.replace(/\D/g, '').includes(digits);
  });
}

/** The row's place-status pill: no places, all updated, or how many are done. */
export function mobilePlaceStatus(item: MobileNumberRecord): PillSpec {
  const { done, total, left } = placeProgress(item.usageLocations);
  if (total === 0) return { label: 'No places', tone: 'neutral' };
  if (left === 0) return { label: `All ${total} updated`, tone: 'success' };
  return { label: `${done} of ${total} places updated`, tone: 'warning' };
}

/** The delete confirmation's description, saying how many places go too. */
export function describeMobileNumberDeletion(item: MobileNumberRecord): string {
  const count = item.usageLocations.length;
  if (count === 0) {
    return 'This action cannot be undone. The mobile number will be permanently removed.';
  }
  if (count === 1) {
    return 'This action cannot be undone. The mobile number and its 1 usage location will be permanently removed.';
  }
  return `This action cannot be undone. The mobile number and its ${count} usage locations will be permanently removed.`;
}

/** The danger zone's line, e.g. "Its 2 places go with it, on every device." */
export function describeMobileDangerZone(item: MobileNumberRecord): string {
  const count = item.usageLocations.length;
  if (count === 0) return 'It is removed from every device.';
  if (count === 1) return 'Its 1 place goes with it, on every device.';
  return `Its ${count} places go with it, on every device.`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The detail header line, e.g. "Australia · updated 3 Oct". Falls back to the
 * date added. A legacy record with no country code drops the country and
 * starts the line with a capital.
 */
export function formatMobileUpdatedLine(
  item: MobileNumberRecord,
  today: Date,
): string {
  const country = item.countryCode
    ? countryNameForCode(item.countryCode)
    : undefined;
  const updated = formatShortDate(item.updatedAt, today);
  const added = formatShortDate(item.createdAt, today);
  const timing = updated
    ? `updated ${updated}`
    : added
      ? `added ${added}`
      : null;

  if (country && timing) return `${country} · ${timing}`;
  if (timing) return capitalise(timing);
  return country ?? '';
}

/** The digits to dial: country code and number for a structured record, the legacy field kept to + and digits. */
function dialNumber(item: MobileNumberRecord): string {
  if (item.countryCode && item.phoneNumber) {
    return `${item.countryCode}${item.phoneNumber.replace(/\D/g, '')}`;
  }
  return (item.mobileNumber ?? '').replace(/[^+\d]/g, '');
}

/** `tel:+61412345678` for the Call link; null when there is nothing to dial. */
export function telHref(item: MobileNumberRecord): string | null {
  const dial = dialNumber(item);
  return dial ? `tel:${dial}` : null;
}

/** `sms:+61412345678` for the Message link; null when there is nothing to dial. */
export function smsHref(item: MobileNumberRecord): string | null {
  const dial = dialNumber(item);
  return dial ? `sms:${dial}` : null;
}
