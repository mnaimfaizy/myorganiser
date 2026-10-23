import {
  AddressStatusEnum,
  type AddressRecord,
  type AddressStatus,
} from '@myorganiser/vault-core';
import {
  formatShortDate,
  placeProgress,
} from '@myorganiser/web-usage-locations';

import { formatAddress } from './formatAddress';
import { isStructuredAddress } from './addressHelpers';

/** The list's status chips: every Address, or only one status. */
export type AddressListFilter = 'all' | AddressStatus;

/** One line on the copy list: what it is, and the text that goes on the clipboard. */
export interface CopyField {
  label: string;
  value: string;
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
  return items.reduce(
    (sum, a) => sum + placeProgress(a.usageLocations).left,
    0,
  );
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
