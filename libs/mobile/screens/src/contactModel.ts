import { formatDayMonth, toCalendarDate } from './calendarDate';
import {
  compareUsageLocationsByPriority,
  openableLink,
  type AddressRecord,
  type AddressStatus,
  type MobileNumberRecord,
  type OrganisationType,
  type Priority,
  type UpdateMethod,
  type UsageLocationRecord,
} from '@myorganiser/vault-core/portable';

/**
 * What the Details screens read out of a decrypted Addresses or Mobile
 * Numbers Vault Blob.
 *
 * The payload is decrypted JSON written by some build of some client, so
 * every field but `id` is a claim — the same defensive reading
 * `taskModel.ts` and `subscriptionModel.ts` do for their own Vault Blob
 * Types. This module holds no React and imports no `react-native`, which is
 * what lets `libs/mobile/screens`' Jest project — a `node` environment with
 * no renderer — cover it.
 */
export type DecryptedAddress = Partial<AddressRecord> & { id: string };
export type DecryptedMobileNumber = Partial<MobileNumberRecord> & {
  id: string;
};
export type DecryptedUsageLocation = Partial<UsageLocationRecord> & {
  id: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasUsableId(entry: unknown): entry is { id: string } {
  return (
    isRecord(entry) &&
    typeof entry.id === 'string' &&
    (entry as { id: string }).id.length > 0
  );
}

/** Every Address in the payload, dropping any entry with no usable `id`. */
export function readVisibleAddresses(records: unknown): DecryptedAddress[] {
  if (!Array.isArray(records)) return [];
  return records.filter(hasUsableId) as DecryptedAddress[];
}

/** Every Mobile Number in the payload, dropping any entry with no usable `id`. */
export function readVisibleMobileNumbers(
  records: unknown,
): DecryptedMobileNumber[] {
  if (!Array.isArray(records)) return [];
  return records.filter(hasUsableId) as DecryptedMobileNumber[];
}

/** The one Address or Mobile Number with `id`, or `null` — for an edit that
 * applies to either. See `findVisibleAddress`. */
export function findVisibleContact(
  records: unknown,
  id: string,
): (Record<string, unknown> & { id: string }) | null {
  if (!Array.isArray(records)) return null;
  const found: unknown = records.find(
    (entry) => hasUsableId(entry) && entry.id === id,
  );
  return (
    (found as (Record<string, unknown> & { id: string }) | undefined) ?? null
  );
}

/** The one Address with `id`, or `null` when the payload holds none —
 * deleted on another device while this screen was open. */
export function findVisibleAddress(
  records: unknown,
  id: string,
): DecryptedAddress | null {
  return readVisibleAddresses(records).find((a) => a.id === id) ?? null;
}

/** The one Mobile Number with `id`, or `null`. See `findVisibleAddress`. */
export function findVisibleMobileNumber(
  records: unknown,
  id: string,
): DecryptedMobileNumber | null {
  return readVisibleMobileNumbers(records).find((m) => m.id === id) ?? null;
}

/** An Address's status, defaulting to `current` when the payload carries
 * none — the same "oldest data has no opinion" default `taskModel.ts` gives
 * a missing Task status. */
export function addressStatus(address: DecryptedAddress): AddressStatus {
  return address.status ?? 'current';
}

/** Current Addresses, then old ones — the split the Details list draws as
 * one section and one collapsed section. Order within each half is the
 * order the payload carried them in. */
export interface SplitAddresses {
  current: DecryptedAddress[];
  old: DecryptedAddress[];
}

export function splitAddressesByStatus(records: unknown): SplitAddresses {
  const current: DecryptedAddress[] = [];
  const old: DecryptedAddress[] = [];
  for (const address of readVisibleAddresses(records)) {
    (addressStatus(address) === 'old' ? old : current).push(address);
  }
  return { current, old };
}

/** The Usage Locations carried by an Address or Mobile Number, dropping any
 * entry with no usable `id` — the same defensive read as the top-level
 * records, applied one level in. */
export function readUsageLocations(contact: {
  usageLocations?: unknown;
}): DecryptedUsageLocation[] {
  const raw = contact.usageLocations;
  if (!Array.isArray(raw)) return [];
  return raw.filter(hasUsableId) as DecryptedUsageLocation[];
}

/** Whether a Usage Location has been notified. Defaults to not notified — a
 * record written before this field existed still needs telling. */
export function isNotified(location: DecryptedUsageLocation): boolean {
  return location.changed === true;
}

/** A Usage Location's link, only when it is safe to open — `null` otherwise,
 * including a stored value with an unsafe scheme (issue #1281). */
export function openableUsageLocationLink(
  location: DecryptedUsageLocation,
): string | null {
  return openableLink(location.link);
}

/** Hands a Usage Location's link to `open` only when it is safe to open, so
 * the row's tap and its test share one guard (issue #1281). */
export function openUsageLocationLink(
  location: DecryptedUsageLocation,
  open: (url: string) => unknown,
): void {
  const link = openableUsageLocationLink(location);
  if (link != null) void open(link);
}

/** How many of `locations` still need notifying. */
export function countUnnotified(
  locations: readonly DecryptedUsageLocation[],
): number {
  return locations.filter((location) => !isNotified(location)).length;
}

/** The List row's own line — "3 to notify" — or `undefined` when every
 * Usage Location is notified, which is when the row prints nothing extra
 * and shows no amber dot. */
export function describeToNotify(
  locations: readonly DecryptedUsageLocation[],
): string | undefined {
  const count = countUnnotified(locations);
  return count > 0 ? `${count} to notify` : undefined;
}

/** "n of m notified" — the Usage Locations section's own progress meta. */
export interface NotifiedProgress {
  notified: number;
  total: number;
}

export function notifiedProgress(
  locations: readonly DecryptedUsageLocation[],
): NotifiedProgress {
  return {
    notified: locations.length - countUnnotified(locations),
    total: locations.length,
  };
}

/** When a notified Usage Location was ticked, as epoch milliseconds, or
 * `null` when it carries no readable `changedAt`. */
function notifiedAtMs(location: DecryptedUsageLocation): number | null {
  if (location.changedAt == null) return null;
  const ms = Date.parse(location.changedAt);
  return Number.isNaN(ms) ? null : ms;
}

/** Most recently notified first; one with no readable `changedAt` after every
 * one that has, and priority breaks a tie. */
function compareByMostRecentlyNotified(
  a: DecryptedUsageLocation,
  b: DecryptedUsageLocation,
): number {
  const aMs = notifiedAtMs(a);
  const bMs = notifiedAtMs(b);
  if (aMs !== bMs) {
    if (aMs === null) return 1;
    if (bMs === null) return -1;
    return bMs - aMs;
  }
  return compareUsageLocationsByPriority(a, b);
}

/** A contact's Usage Locations as the approved design lists them: every one
 * still to notify by priority (High, Medium, Normal, Low — the pinned table
 * `usageLocationOrder.ts` carries), and every notified one, most recently
 * notified first (Det-UL: "Notified 24 Sep" above "Notified 22 Sep"). */
export interface UsageLocationGroups {
  toNotify: DecryptedUsageLocation[];
  notified: DecryptedUsageLocation[];
}

export function groupUsageLocations(
  locations: readonly DecryptedUsageLocation[],
  /**
   * The one Usage Location whose tick is still an Unconfirmed Edit. It stays
   * in the group it was ticked in — ticked, "Saving…" — until the server
   * confirms it (Det-UL-Unconfirmed), rather than jumping groups on an edit
   * that may yet be reverted.
   */
  pendingId: string | null = null,
): UsageLocationGroups {
  const inToNotify = (location: DecryptedUsageLocation): boolean =>
    isNotified(location) === (location.id === pendingId);
  return {
    toNotify: locations
      .filter(inToNotify)
      .sort(compareUsageLocationsByPriority),
    notified: locations
      .filter((location) => !inToNotify(location))
      .sort(compareByMostRecentlyNotified),
  };
}

/**
 * The Usage Locations detail order: every unnotified one first, by priority,
 * then every notified one, most recently notified first — the two groups of
 * `groupUsageLocations`, run together.
 */
export function selectUsageLocationsForDetail(
  locations: readonly DecryptedUsageLocation[],
): DecryptedUsageLocation[] {
  const { toNotify, notified } = groupUsageLocations(locations);
  return [...toNotify, ...notified];
}

/** The progress line over a contact's Usage Locations — "5 of 8 notified"
 * and "3 to go", or "All done" once nobody is left (Det-UL, Det-UL-AllDone).
 * `null` when there is no Usage Location to count. */
export interface NotifiedProgressCopy {
  label: string;
  meta: string;
  complete: boolean;
  fraction: number;
}

export function describeNotifiedProgress(
  locations: readonly DecryptedUsageLocation[],
): NotifiedProgressCopy | null {
  const { notified, total } = notifiedProgress(locations);
  if (total === 0) return null;
  const toGo = total - notified;
  return {
    label: `${notified} of ${total} notified`,
    meta: toGo === 0 ? 'All done' : `${toGo} to go`,
    complete: toGo === 0,
    fraction: notified / total,
  };
}

/** A notified row's meta line — "Notified today", "Notified 24 Sep", or
 * "Notified 3 Mar 2025" for another year — read from `changedAt` in the
 * device's own time zone. A record with no readable `changedAt` still says
 * it was notified; it never invents a day. */
export function describeNotifiedOn(
  location: DecryptedUsageLocation,
  now: Date,
): string {
  const ms = notifiedAtMs(location);
  if (ms === null) return 'Notified';
  const day = toCalendarDate(new Date(ms));
  if (day === toCalendarDate(now)) return 'Notified today';
  return `Notified ${formatDayMonth(day, now)}`;
}

/** One field a Detail screen shows as one tap-to-copy row. */
export interface CopyableField {
  id: string;
  label: string;
  /** What the row shows. */
  value: string;
  /** What a tap copies, when that is not the shown value — the Country code
   * row shows "+61 · Australia" and copies "+61". */
  copyValue?: string;
  /** Set in tabular figures: a number that is read digit by digit. */
  numeric?: boolean;
  /** The one value a screen is opened for, set large — the whole Mobile
   * Number on its detail. */
  headline?: boolean;
}

function field(
  id: string,
  label: string,
  value: string | undefined,
  extra: Pick<CopyableField, 'copyValue' | 'numeric' | 'headline'> = {},
): CopyableField | null {
  const trimmed = value?.trim();
  return trimmed != null && trimmed.length > 0
    ? { id, label, value: trimmed, ...extra }
    : null;
}

function compact<T>(values: readonly (T | null | undefined)[]): T[] {
  return values.filter((value): value is T => value != null);
}

function joinPresent(
  values: readonly (string | undefined)[],
  separator: string,
): string {
  return compact(values.map((value) => value?.trim()))
    .filter((value) => value.length > 0)
    .join(separator);
}

/** Whether an Address carries any of the structured fields. One that carries
 * none was saved as a single line before those fields existed. */
function hasStructuredAddress(address: DecryptedAddress): boolean {
  return (
    joinPresent(
      [
        address.propertyNumber,
        address.street,
        address.suburb,
        address.state,
        address.zipCode,
        address.country,
      ],
      '',
    ).length > 0
  );
}

/** An Address saved as one line, before the structured fields existed — the
 * detail says so and points at the web to split it (Det-Address-Legacy). */
export function isLegacyAddress(address: DecryptedAddress): boolean {
  return (
    !hasStructuredAddress(address) && (address.address?.trim().length ?? 0) > 0
  );
}

/** "12 Wattlebird Lane" — the property number and street, the line an
 * Address is recognised by. The legacy single line when there is no street. */
export function formatStreetLine(address: DecryptedAddress): string {
  const street = joinPresent([address.propertyNumber, address.street], ' ');
  if (street.length > 0) return street;
  return hasStructuredAddress(address)
    ? formatAddressSummary(address)
    : (address.address?.trim() ?? '');
}

/**
 * "12 Wattlebird Lane, Paddington QLD 4064" — an Address as its list row
 * summarises it, in postal order without the country. The legacy single line
 * when the record has no structured fields.
 */
export function formatAddressSummary(address: DecryptedAddress): string {
  if (!hasStructuredAddress(address)) return address.address?.trim() ?? '';
  return joinPresent(
    [
      joinPresent([address.propertyNumber, address.street], ' '),
      joinPresent([address.suburb, address.state, address.zipCode], ' '),
    ],
    ', ',
  );
}

/**
 * An Address as one printable line — "12 Wattlebird Lane, Paddington QLD
 * 4064, Australia" — what Copy all, Share and Open in Maps hand on. The
 * structured fields in postal order when any are present, or the legacy
 * single-line `address` when they are not. Never both: a record written before
 * the structured fields existed carries only the legacy line, and one written
 * since carries the structured fields as the ones a User actually edited.
 */
export function formatAddressLine(address: DecryptedAddress): string {
  if (!hasStructuredAddress(address)) return address.address?.trim() ?? '';
  return joinPresent([formatAddressSummary(address), address.country], ', ');
}

/** The individually copyable fields of an Address, in the order they read
 * on a postal address, skipping any the record does not carry. A legacy
 * Address is its one line. */
export function addressFields(address: DecryptedAddress): CopyableField[] {
  if (!hasStructuredAddress(address)) {
    return compact([field('address', 'Address', address.address)]);
  }
  return compact([
    field('propertyNumber', 'Property number', address.propertyNumber, {
      numeric: true,
    }),
    field('street', 'Street', address.street),
    field('suburb', 'Suburb', address.suburb),
    field('state', 'State', address.state),
    field('zipCode', 'Postcode', address.zipCode, { numeric: true }),
    field('country', 'Country', address.country),
  ]);
}

/**
 * The country each calling code belongs to, for the Country code row's
 * "+61 · Australia". The codes the web's Mobile Number form offers; a code
 * two countries share (+1) names neither, and an unknown one prints alone.
 */
const COUNTRY_BY_CALLING_CODE: Readonly<Record<string, string>> = {
  '+44': 'United Kingdom',
  '+61': 'Australia',
  '+64': 'New Zealand',
  '+91': 'India',
  '+86': 'China',
  '+81': 'Japan',
  '+82': 'South Korea',
  '+65': 'Singapore',
  '+60': 'Malaysia',
  '+62': 'Indonesia',
  '+63': 'Philippines',
  '+66': 'Thailand',
  '+84': 'Vietnam',
  '+92': 'Pakistan',
  '+880': 'Bangladesh',
  '+94': 'Sri Lanka',
  '+93': 'Afghanistan',
  '+49': 'Germany',
  '+33': 'France',
  '+39': 'Italy',
  '+34': 'Spain',
  '+31': 'Netherlands',
  '+32': 'Belgium',
  '+41': 'Switzerland',
  '+43': 'Austria',
  '+48': 'Poland',
  '+7': 'Russia',
  '+380': 'Ukraine',
  '+90': 'Turkey',
  '+20': 'Egypt',
  '+27': 'South Africa',
  '+234': 'Nigeria',
  '+254': 'Kenya',
  '+966': 'Saudi Arabia',
  '+971': 'UAE',
  '+972': 'Israel',
  '+55': 'Brazil',
  '+54': 'Argentina',
  '+52': 'Mexico',
  '+57': 'Colombia',
  '+56': 'Chile',
  '+51': 'Peru',
};

/** "+61 · Australia", or the bare code when it names no one country. */
export function describeCountryCode(countryCode: string): string {
  const code = countryCode.trim();
  const country = COUNTRY_BY_CALLING_CODE[code];
  return country == null ? code : `${code} · ${country}`;
}

/** A Mobile Number saved as one value, before the country code existed — the
 * detail says so and points at the web (Det-Mobile-Legacy). */
export function isLegacyMobileNumber(mobile: DecryptedMobileNumber): boolean {
  return (
    joinPresent([mobile.countryCode, mobile.phoneNumber], '').length === 0 &&
    (mobile.mobileNumber?.trim().length ?? 0) > 0
  );
}

/** A Mobile Number as one printable line — country code and number joined,
 * or the legacy single field when the structured ones are absent. */
export function formatMobileNumber(mobile: DecryptedMobileNumber): string {
  const structured = joinPresent([mobile.countryCode, mobile.phoneNumber], ' ');
  if (structured.length > 0) return structured;
  return mobile.mobileNumber?.trim() ?? '';
}

/**
 * The individually copyable fields of a Mobile Number: the whole number set
 * large, then its country code and its number (Det-Mobile). A legacy record
 * has only the whole number.
 */
export function mobileNumberFields(
  mobile: DecryptedMobileNumber,
): CopyableField[] {
  const countryCode = mobile.countryCode?.trim();
  return compact([
    field('mobileNumber', 'Mobile number', formatMobileNumber(mobile), {
      numeric: true,
      headline: true,
    }),
    countryCode != null && countryCode.length > 0
      ? field('countryCode', 'Country code', describeCountryCode(countryCode), {
          copyValue: countryCode,
          numeric: true,
        })
      : null,
    field('phoneNumber', 'Number', mobile.phoneNumber, { numeric: true }),
  ]);
}

/**
 * What the toast says after Copy all, naming what was copied — "Address
 * copied — clears in 60 s" (Det-Address-CopyAll) — from the platform's own
 * confirmation. `null` stays `null`: where the system confirms a copy itself,
 * the app says nothing (Android 13+).
 */
export function describeCopiedAll(
  confirmation: string | null,
  noun: string,
): string | null {
  if (confirmation == null) return null;
  return confirmation.startsWith('Copied')
    ? `${noun} copied${confirmation.slice('Copied'.length)}`
    : confirmation;
}

/** Which kind of record a set of Usage Locations belongs to. */
export type ContactKind = 'address' | 'mobileNumber';

/**
 * What the Usage Locations screen says about the record it lists, per kind.
 * The design draws the Address wording (Det-UL, Det-UL-AllDone); a Mobile
 * Number changes rather than moves, and follows the same shape.
 */
export const USAGE_LOCATIONS_COPY = {
  address: {
    subtitle: (label: string, line: string) =>
      joinPresent([`Who to tell that ${label} moved`, line], ' · '),
    allDone: 'Everyone on this list knows about the move.',
  },
  mobileNumber: {
    subtitle: (label: string, line: string) =>
      joinPresent([`Who to tell that ${label} changed`, line], ' · '),
    allDone: 'Everyone on this list has the new number.',
  },
} as const satisfies Record<
  ContactKind,
  { subtitle: (label: string, line: string) => string; allDone: string }
>;

/** "See all 8, including notified" — the detail's way to the whole list,
 * which the detail itself previews only the Usage Locations still to
 * notify of. */
export function describeSeeAllUsageLocations(total: number): string {
  return `See all ${total}, including notified`;
}

/** Readable labels for `OrganisationType`, pinned to the enum (ADR 0053). */
export const ORGANISATION_TYPE_LABEL = {
  government: 'Government',
  private: 'Private',
  bank: 'Bank',
  insurance: 'Insurance',
  school: 'School',
  university: 'University',
  employer: 'Employer',
  utility: 'Utility',
  healthcare: 'Healthcare',
  telecom: 'Telecom',
  housing: 'Housing',
  email: 'Email',
  other: 'Other',
} as const satisfies Record<OrganisationType, string>;

/** Readable labels for `UpdateMethod`, pinned to the enum. */
export const UPDATE_METHOD_LABEL = {
  online: 'Online',
  inPerson: 'In person',
  phone: 'By phone',
  mail: 'By mail',
} as const satisfies Record<UpdateMethod, string>;

/** Readable labels for `Priority`, pinned to the enum. */
export const PRIORITY_LABEL = {
  high: 'High',
  medium: 'Medium',
  normal: 'Normal',
  low: 'Low',
} as const satisfies Record<Priority, string>;

/** A Usage Location row's own meta line: what it is, how it is reached, and
 * how urgent it is — the three facts the row carries besides its name and
 * its notified state. */
export function describeUsageLocationMeta(
  location: DecryptedUsageLocation,
): string {
  return compact([
    location.organisationType != null
      ? ORGANISATION_TYPE_LABEL[location.organisationType]
      : null,
    location.updateMethod != null
      ? UPDATE_METHOD_LABEL[location.updateMethod]
      : null,
    location.priority != null ? PRIORITY_LABEL[location.priority] : null,
  ]).join(' · ');
}

/**
 * The system maps app URL for an Address, so "Open in Maps" never renders
 * web content of its own — Apple Maps on iOS, Google Maps elsewhere, both
 * opened through the system browser handler rather than an in-app view.
 */
export function mapsUrlForAddress(
  address: DecryptedAddress,
  os: 'ios' | 'android',
): string {
  const query = encodeURIComponent(formatAddressLine(address));
  return os === 'ios'
    ? `https://maps.apple.com/?q=${query}`
    : `https://www.google.com/maps/search/?api=1&query=${query}`;
}
