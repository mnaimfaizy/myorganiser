'use client';

import type {
  AddressRecord,
  UsageLocationRecord,
} from '@myorganiser/vault-core';
import { Button, ChoiceChip, Progress } from '@myorganiser/web-ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import {
  filterPlaces,
  type PlaceListFilter,
  placeProgress,
  sortPlaces,
} from '../utils/address-summary';
import { AddressPlaceRow } from './address-place-row';

export interface AddressPlacesCardProps {
  address: AddressRecord;
  today: Date;
  /** Usage Locations whose tick is being saved; their checkboxes are disabled. */
  pendingPlaceIds: ReadonlySet<string>;
  onAddPlace: () => void;
  onEditPlace: (location: UsageLocationRecord) => void;
  onSetPlaceChanged: (locationId: string, changed: boolean) => void;
  onRequestDeletePlace: (location: UsageLocationRecord) => void;
}

const HEADING_PLACES = 'address-places-heading';

/** The checklist chips, in chip order. */
const PLACE_FILTER_LABELS = {
  all: 'All',
  todo: 'To do',
} as const satisfies Record<PlaceListFilter, string>;

const PLACE_FILTER_KEYS = Object.keys(PLACE_FILTER_LABELS) as PlaceListFilter[];

/**
 * The Places checklist on the desktop Address detail: how far the Address has
 * got, the filter chips, and one row per Usage Location to tick, edit or delete.
 */
export function AddressPlacesCard({
  address,
  today,
  pendingPlaceIds,
  onAddPlace,
  onEditPlace,
  onSetPlaceChanged,
  onRequestDeletePlace,
}: AddressPlacesCardProps) {
  const [placeFilter, setPlaceFilter] = useState<PlaceListFilter>('all');

  const { done, total, left } = placeProgress(address);
  const complete = total > 0 && done === total;
  const places = filterPlaces(sortPlaces(address.usageLocations), placeFilter);
  const placeCounts = { all: total, todo: left } satisfies Record<
    PlaceListFilter,
    number
  >;

  return (
    <section
      aria-labelledby={HEADING_PLACES}
      className="flex min-w-0 basis-130 grow-999 flex-col overflow-hidden rounded-panel border border-border bg-card shadow-card"
    >
      <div className="flex flex-col gap-3 border-b border-border p-5">
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <h2
              id={HEADING_PLACES}
              className="font-display text-title text-foreground"
            >
              Places to update
            </h2>
            <p className="text-caption text-muted-foreground">
              Everyone who needs to know about this address
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
          <p className="text-body-sm text-muted-foreground">
            Add every organisation that needs to be told about this address.
          </p>
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
            <AddressPlaceRow
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
