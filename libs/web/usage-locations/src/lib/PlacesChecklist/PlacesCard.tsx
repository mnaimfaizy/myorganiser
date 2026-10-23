'use client';

import type { UsageLocationRecord } from '@myorganiser/vault-core';
import { Button, ChoiceChip, Progress } from '@myorganiser/web-ui';
import { Plus } from 'lucide-react';
import { useId, useState } from 'react';

import type { PlaceNoun } from '../PlaceDialog/PlaceDialog';
import { PlaceRow } from './PlaceRow';
import {
  filterPlaces,
  type PlaceListFilter,
  placeProgress,
  sortPlaces,
} from './placeChecklist';

export interface PlacesCardProps {
  /** The Usage Locations of the subject: an Address's places, or a mobile number's. */
  locations: readonly UsageLocationRecord[];
  noun: PlaceNoun;
  today: Date;
  /** Usage Locations whose tick is being saved; their checkboxes are disabled. */
  pendingPlaceIds: ReadonlySet<string>;
  onAddPlace: () => void;
  onEditPlace: (location: UsageLocationRecord) => void;
  onSetPlaceChanged: (locationId: string, changed: boolean) => void;
  onRequestDeletePlace: (location: UsageLocationRecord) => void;
}

/** The checklist chips, in chip order. */
const PLACE_FILTER_LABELS = {
  all: 'All',
  todo: 'To do',
} as const satisfies Record<PlaceListFilter, string>;

const PLACE_FILTER_KEYS = Object.keys(PLACE_FILTER_LABELS) as PlaceListFilter[];

/** The words that differ between the Address and mobile number pages. */
const PLACES_COPY = {
  address: {
    subtitle: 'Everyone who needs to know about this address',
    emptyLine:
      'Add every organisation that needs to be told about this address.',
  },
  number: {
    subtitle: 'Everyone who has this number on file',
    emptyLine:
      'Add every organisation that needs to be told about this mobile number.',
  },
} as const satisfies Record<PlaceNoun, { subtitle: string; emptyLine: string }>;

/**
 * The Places checklist on the desktop detail: how far the subject has got, the
 * filter chips, and one row per Usage Location to tick, edit or delete.
 */
export function PlacesCard({
  locations,
  noun,
  today,
  pendingPlaceIds,
  onAddPlace,
  onEditPlace,
  onSetPlaceChanged,
  onRequestDeletePlace,
}: PlacesCardProps) {
  const [placeFilter, setPlaceFilter] = useState<PlaceListFilter>('all');
  const headingId = useId();
  const copy = PLACES_COPY[noun];

  const { done, total, left } = placeProgress(locations);
  const complete = total > 0 && done === total;
  const places = filterPlaces(sortPlaces(locations), placeFilter);
  const placeCounts = { all: total, todo: left } satisfies Record<
    PlaceListFilter,
    number
  >;

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 basis-130 grow-999 flex-col overflow-hidden rounded-panel border border-border bg-card shadow-card"
    >
      <div className="flex flex-col gap-3 border-b border-border p-5">
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <h2
              id={headingId}
              className="font-display text-title text-foreground"
            >
              Places to update
            </h2>
            <p className="text-caption text-muted-foreground">
              {copy.subtitle}
            </p>
          </div>
          <Button variant="brand" onClick={onAddPlace}>
            <Plus aria-hidden="true" />
            Add place
          </Button>
        </div>

        {total > 0 ? (
          <>
            <div className="flex items-center justify-between gap-3 text-body-sm">
              <span className="text-foreground-secondary">
                <span className="font-semibold tabular-nums text-foreground">
                  {`${done} of ${total}`}
                </span>{' '}
                updated
              </span>
              {complete ? (
                <span className="font-semibold text-success-text">
                  All updated
                </span>
              ) : (
                <span className="font-semibold text-warning-text">
                  {`${left} to go`}
                </span>
              )}
            </div>
            <Progress
              aria-label="Places updated"
              value={done}
              max={total}
              tone={complete ? 'success' : 'brand'}
            />
          </>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {PLACE_FILTER_KEYS.map((key) => (
            <ChoiceChip
              key={key}
              pressed={placeFilter === key}
              onPressedChange={() => setPlaceFilter(key)}
            >
              {`${PLACE_FILTER_LABELS[key]} · ${placeCounts[key]}`}
            </ChoiceChip>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <div className="flex flex-col items-start gap-2 p-5">
          <p className="font-semibold text-foreground">No places yet</p>
          <p className="text-body-sm text-muted-foreground">{copy.emptyLine}</p>
          <Button variant="brand" onClick={onAddPlace}>
            <Plus aria-hidden="true" />
            Add place
          </Button>
        </div>
      ) : places.length === 0 ? (
        <p className="p-5 text-body-sm text-muted-foreground">
          Every place is updated.
        </p>
      ) : (
        <ul className="flex flex-col">
          {places.map((location) => (
            <PlaceRow
              key={location.id}
              location={location}
              today={today}
              pending={pendingPlaceIds.has(location.id)}
              onSetChanged={onSetPlaceChanged}
              onEdit={onEditPlace}
              onRequestDelete={onRequestDeletePlace}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
