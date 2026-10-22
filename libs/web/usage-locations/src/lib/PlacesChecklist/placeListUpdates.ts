import type { UsageLocationRecord } from '@myorganiser/vault-core';

import {
  type PlaceFormValues,
  usageLocationFormValuesToRecordFields,
} from '../placeForm';

/**
 * Pure transforms over a Usage Location list. They do not save, sync or
 * encrypt: the page hook that owns the Address or Mobile Number persists the
 * list these return.
 */

/** Adds a place from the form, or replaces the one `editingId` names. */
export function upsertPlace(
  locations: readonly UsageLocationRecord[],
  values: PlaceFormValues,
  editingId: string | null,
  now: string,
  newId: () => string,
): UsageLocationRecord[] {
  const fields = usageLocationFormValuesToRecordFields(values);

  if (editingId) {
    return locations.map((loc) =>
      loc.id === editingId
        ? {
            ...loc,
            ...fields,
            changedAt: values.changed && !loc.changed ? now : loc.changedAt,
          }
        : loc,
    );
  }

  return [
    {
      id: newId(),
      ...fields,
      createdAt: now,
      changedAt: values.changed ? now : undefined,
    } satisfies UsageLocationRecord,
    ...locations,
  ];
}

/**
 * Ticks or unticks one place; ticking stamps `now` unless already ticked,
 * unticking keeps the old date. As the edit form does: ticking stamps today,
 * unticking keeps the date it was last updated.
 */
export function setPlaceChanged(
  locations: readonly UsageLocationRecord[],
  locationId: string,
  changed: boolean,
  now: string,
): UsageLocationRecord[] {
  return locations.map((loc) =>
    loc.id === locationId
      ? {
          ...loc,
          changed,
          changedAt: changed && !loc.changed ? now : loc.changedAt,
        }
      : loc,
  );
}

export function removePlace(
  locations: readonly UsageLocationRecord[],
  locationId: string,
): UsageLocationRecord[] {
  return locations.filter((l) => l.id !== locationId);
}
