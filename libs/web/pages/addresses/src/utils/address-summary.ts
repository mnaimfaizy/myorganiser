import {
  AddressStatusEnum,
  PriorityEnum,
  type AddressRecord,
  type AddressStatus,
  type Priority,
  type UsageLocationRecord,
} from '@myorganiser/vault-core';
import {
  ORGANISATION_TYPE_LABELS,
  UPDATE_METHOD_LABELS,
} from '@myorganiser/web-usage-locations';
import { format, isSameYear, isValid, parseISO } from 'date-fns';

import { formatAddress } from './formatAddress';
import { isStructuredAddress } from './addressHelpers';

/** The list's status chips: every Address, or only one status. */
export type AddressListFilter = 'all' | AddressStatus;

/** The detail checklist's chips: every Usage Location, or only the ones not yet updated. */
export type PlaceListFilter = 'all' | 'todo';

/** How far an Address's change-of-address checklist has got. */
export interface PlaceProgress {
  /** Usage Locations already updated. */
  done: number;
  total: number;
  /** Usage Locations still to update. */
  left: number;
}

/** One line on the copy list: what it is, and the text that goes on the clipboard. */
export interface CopyField {
  label: string;
  value: string;
}

export function placeProgress(address: AddressRecord): PlaceProgress {
  const total = address.usageLocations.length;
  const done = address.usageLocations.filter((l) => l.changed).length;
  return { done, total, left: total - done };
}

export function countAddressesByStatus(
  items: readonly AddressRecord[],
): Record<AddressListFilter, number> {
  return {
    all: items.length,
    [AddressStatusEnum.Current]: items.filter(
      (a) => a.status === AddressStatusEnum.Current,
    ).length,
    [AddressStatusEnum.Old]: items.filter(
      (a) => a.status === AddressStatusEnum.Old,
    ).length,
  };
}

/** Usage Locations still to update, across every Address. */
export function countPlacesToUpdate(items: readonly AddressRecord[]): number {
  return items.reduce((sum, a) => sum + placeProgress(a).left, 0);
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The desktop header line, e.g. "3 addresses · 1 current · 2 places still to update". */
export function formatAddressesSummary(
  items: readonly AddressRecord[],
): string {
  const counts = countAddressesByStatus(items);
  return [
    plural(counts.all, 'address', 'addresses'),
    `${counts[AddressStatusEnum.Current]} current`,
    `${plural(countPlacesToUpdate(items), 'place', 'places')} still to update`,
  ].join(' · ');
}

/** The phone header line, e.g. "3 saved · 2 places to update". */
export function formatAddressesPhoneSummary(
  items: readonly AddressRecord[],
): string {
  return `${items.length} saved · ${plural(
    countPlacesToUpdate(items),
    'place',
    'places',
  )} to update`;
}

/**
 * Keeps the Addresses whose status matches `filter` and whose label, street,
 * country or full address contains `query`, ignoring case.
 */
export function filterAddresses(
  items: readonly AddressRecord[],
  query: string,
  filter: AddressListFilter,
): AddressRecord[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter !== 'all' && item.status !== filter) return false;
    if (!needle) return true;
    return [item.label, item.street, item.country, formatAddress(item)].some(
      (value) =>
        typeof value === 'string' && value.toLowerCase().includes(needle),
    );
  });
}

/** "14 Rose Lane": the property number and street. */
function streetLine(item: AddressRecord): string {
  return [item.propertyNumber, item.street].filter(Boolean).join(' ');
}

/** "Richmond VIC 3121": the suburb, state and postcode. */
function localityLine(item: AddressRecord): string {
  return [item.suburb, item.state, item.zipCode].filter(Boolean).join(' ');
}

/**
 * The address on two lines, as the card and the add sheet's preview show it:
 * "14 Rose Lane" then "Richmond VIC 3121, Australia". A legacy single-line
 * address is one line.
 */
export function formatAddressLines(item: AddressRecord): string[] {
  if (!isStructuredAddress(item)) {
    return [item.address || 'No address provided'];
  }

  const line2 = [localityLine(item), item.country].filter(Boolean).join(', ');
  return [streetLine(item), line2].filter(Boolean);
}

/**
 * The address on one line, e.g. "14 Rose Lane, Richmond VIC 3121", for the
 * phone row. The country shows only when nothing else is set.
 */
export function formatAddressShortLine(item: AddressRecord): string {
  if (!isStructuredAddress(item)) {
    return item.address || 'No address provided';
  }
  // A record with only a country still needs something on its row.
  return (
    [streetLine(item), localityLine(item)].filter(Boolean).join(', ') ||
    (item.country ?? '')
  );
}

/** Every line of the address, joined with newlines, for "Copy all". */
export function formatAddressForCopy(item: AddressRecord): string {
  return formatAddressLines(item).join('\n');
}

/**
 * The desktop copy list: one line per filled field, in postal order. A legacy
 * single-line address is one "Address" line.
 */
export function addressCopyFields(item: AddressRecord): CopyField[] {
  if (!isStructuredAddress(item)) {
    return item.address ? [{ label: 'Address', value: item.address }] : [];
  }

  const fields: Array<[string, string | undefined]> = [
    ['Property number', item.propertyNumber],
    ['Street', item.street],
    ['Suburb', item.suburb],
    ['State', item.state],
    ['Postcode', item.zipCode],
    ['Country', item.country],
  ];
  return fields.flatMap(([label, value]) => (value ? [{ label, value }] : []));
}

/**
 * The phone copy list, grouped the way a form asks for them: the street line,
 * then suburb with state and postcode, then the country.
 */
export function addressPhoneCopyFields(item: AddressRecord): CopyField[] {
  if (!isStructuredAddress(item)) {
    return addressCopyFields(item);
  }

  const fields: Array<[string, string | undefined]> = [
    ['Street', streetLine(item)],
    ['Suburb', localityLine(item)],
    ['Country', item.country],
  ];
  return fields.flatMap(([label, value]) => (value ? [{ label, value }] : []));
}

function parseDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const date = parseISO(iso);
  return isValid(date) ? date : null;
}

/** "3 Oct" this year, "3 Oct 2025" in any other; null for a missing or bad date. */
export function formatShortDate(
  iso: string | undefined,
  today: Date,
): string | null {
  const date = parseDate(iso);
  if (!date) return null;
  return format(date, isSameYear(date, today) ? 'd MMM' : 'd MMM yyyy');
}

/** The detail header line, e.g. "Updated 3 Oct · encrypted on this device". */
export function formatAddressUpdatedLine(
  item: AddressRecord,
  today: Date,
): string {
  const updated = formatShortDate(item.updatedAt, today);
  if (updated) return `Updated ${updated} · encrypted on this device`;
  const added = formatShortDate(item.createdAt, today);
  return added
    ? `Added ${added} · encrypted on this device`
    : 'Encrypted on this device';
}

/**
 * The desktop place row's second line, e.g. "Government · online · updated
 * 2 Oct". The method is lower case because it reads as part of a phrase.
 */
export function formatPlaceMeta(
  location: UsageLocationRecord,
  today: Date,
): string {
  const parts = [
    ORGANISATION_TYPE_LABELS[location.organisationType],
    UPDATE_METHOD_LABELS[location.updateMethod].toLowerCase(),
  ];
  if (location.changed) {
    const on = formatShortDate(location.changedAt, today);
    parts.push(on ? `updated ${on}` : 'updated');
  }
  return parts.join(' · ');
}

/** The phone place row's second line, e.g. "Online · link saved". */
export function formatPlacePhoneMeta(location: UsageLocationRecord): string {
  const method = UPDATE_METHOD_LABELS[location.updateMethod];
  return location.link ? `${method} · link saved` : method;
}

/** Highest first, so the most urgent place to update sits at the top. */
const PRIORITY_RANK = {
  [PriorityEnum.High]: 0,
  [PriorityEnum.Medium]: 1,
  [PriorityEnum.Normal]: 2,
  [PriorityEnum.Low]: 3,
} as const satisfies Record<Priority, number>;

/**
 * The checklist order: places still to update first, most urgent first; then
 * the updated ones. Ties keep their saved order.
 */
export function sortPlaces(
  locations: readonly UsageLocationRecord[],
): UsageLocationRecord[] {
  return locations
    .map((location, index) => ({ location, index }))
    .sort((a, b) => {
      if (a.location.changed !== b.location.changed) {
        return a.location.changed ? 1 : -1;
      }
      if (!a.location.changed) {
        const rank =
          PRIORITY_RANK[a.location.priority] -
          PRIORITY_RANK[b.location.priority];
        if (rank !== 0) return rank;
      }
      return a.index - b.index;
    })
    .map(({ location }) => location);
}

export function filterPlaces(
  locations: readonly UsageLocationRecord[],
  filter: PlaceListFilter,
): UsageLocationRecord[] {
  return filter === 'todo'
    ? locations.filter((l) => !l.changed)
    : [...locations];
}

/** The delete confirmation's description, saying how many places go too. */
export function describeAddressDeletion(address: AddressRecord): string {
  const count = address.usageLocations.length;
  if (count === 0) {
    return 'This action cannot be undone. The address will be permanently removed.';
  }
  if (count === 1) {
    return 'This action cannot be undone. The address and its 1 usage location will be permanently removed.';
  }
  return `This action cannot be undone. The address and its ${count} usage locations will be permanently removed.`;
}

/** The danger zone's line, e.g. "Its 5 places go with it, on every device." */
export function describeDangerZone(address: AddressRecord): string {
  const count = address.usageLocations.length;
  if (count === 0) return 'It is removed from every device.';
  if (count === 1) return 'Its 1 place goes with it, on every device.';
  return `Its ${count} places go with it, on every device.`;
}
