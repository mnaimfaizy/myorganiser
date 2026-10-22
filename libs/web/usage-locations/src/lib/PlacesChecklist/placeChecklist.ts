import {
  PriorityEnum,
  type Priority,
  type UsageLocationRecord,
} from '@myorganiser/vault-core';
import type { StatusPillTone } from '@myorganiser/web-ui';
import { format, isSameYear, isValid, parseISO } from 'date-fns';

import { ORGANISATION_TYPE_LABELS, UPDATE_METHOD_LABELS } from '../labels';

/** The detail checklist's chips: every Usage Location, or only the ones not yet updated. */
export type PlaceListFilter = 'all' | 'todo';

/** How far a Usage Location checklist has got. */
export interface PlaceProgress {
  /** Usage Locations already updated. */
  done: number;
  total: number;
  /** Usage Locations still to update. */
  left: number;
}

export interface PillSpec {
  label: string;
  tone: StatusPillTone;
}

/**
 * Display words and tones for the priority. The table is pinned to its enum
 * (ADR 0053): a member added to the enum and not here fails to compile,
 * instead of falling back to a guessed label.
 */
export const PLACE_PRIORITY_PILL = {
  [PriorityEnum.High]: { label: 'HIGH', tone: 'danger' },
  [PriorityEnum.Medium]: { label: 'MEDIUM', tone: 'warning' },
  [PriorityEnum.Normal]: { label: 'NORMAL', tone: 'neutral' },
  [PriorityEnum.Low]: { label: 'LOW', tone: 'neutral' },
} as const satisfies Record<Priority, PillSpec>;

/** The pill on a place that is already updated, in place of its priority. */
export const PLACE_UPDATED_PILL = {
  label: 'UPDATED',
  tone: 'success',
} as const satisfies PillSpec;

export function placeProgress(
  locations: readonly UsageLocationRecord[],
): PlaceProgress {
  const total = locations.length;
  const done = locations.filter((l) => l.changed).length;
  return { done, total, left: total - done };
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
