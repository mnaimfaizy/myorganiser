'use client';

import type {
  AddressRecord,
  UsageLocationRecord,
} from '@myorganiser/vault-core';
import {
  Button,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  ListGroup,
  ListGroupRow,
  Progress,
  StatusPill,
  cn,
} from '@myorganiser/web-ui';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { useCallback, useState } from 'react';

import {
  filterPlaces,
  formatPlacePhoneMeta,
  placeProgress,
  sortPlaces,
} from '../utils/address-summary';
import { PLACE_PRIORITY_PILL, PLACE_UPDATED_PILL } from '../utils/presentation';

export interface AddressPlacesPhoneProps {
  address: AddressRecord;
  /** Usage Locations whose tick is being saved; their checkboxes are disabled. */
  pendingPlaceIds: ReadonlySet<string>;
  onAddPlace: () => void;
  onEditPlace: (location: UsageLocationRecord) => void;
  onSetPlaceChanged: (locationId: string, changed: boolean) => void;
  onRequestDeletePlace: (location: UsageLocationRecord) => void;
}

const HEADING_PLACES = 'address-places-heading';

interface PlaceChecklistRowProps {
  location: UsageLocationRecord;
  pending: boolean;
  onSetChanged: (locationId: string, changed: boolean) => void;
  onEdit: (location: UsageLocationRecord) => void;
  onRequestDelete: (location: UsageLocationRecord) => void;
}

/**
 * One Usage Location on the phone checklist. The whole label is the tick
 * target; the menu keeps edit and delete reachable on a phone.
 */
function PlaceChecklistRow({
  location,
  pending,
  onSetChanged,
  onEdit,
  onRequestDelete,
}: PlaceChecklistRowProps) {
  const pillSpec = location.changed
    ? PLACE_UPDATED_PILL
    : PLACE_PRIORITY_PILL[location.priority];

  return (
    <ListGroupRow size="default" className="gap-1 pr-2 pl-0">
      <label className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-4">
        <Checkbox
          aria-label={`Updated at ${location.organisationName}`}
          checked={location.changed}
          disabled={pending}
          onCheckedChange={(next) => onSetChanged(location.id, next === true)}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              'text-body',
              location.changed ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {location.organisationName}
          </span>
          <span className="text-caption text-muted-foreground">
            {formatPlacePhoneMeta(location)}
          </span>
        </span>
        <StatusPill size="sm" tone={pillSpec.tone}>
          {pillSpec.label}
        </StatusPill>
      </label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            variant="ghost"
            label={`More for ${location.organisationName}`}
          >
            <MoreHorizontal aria-hidden="true" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onEdit(location)}>
            Edit place
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => onRequestDelete(location)}
          >
            Delete place…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ListGroupRow>
  );
}

/**
 * The phone "Places to update" section: the count line, the Add action, the
 * progress bar, the checklist of places still to update, and the collapsed Updated disclosure.
 */
export function AddressPlacesPhone({
  address,
  pendingPlaceIds,
  onAddPlace,
  onEditPlace,
  onSetPlaceChanged,
  onRequestDeletePlace,
}: AddressPlacesPhoneProps) {
  const [showUpdated, setShowUpdated] = useState(false);
  const handleUpdatedOpenChange = useCallback((open: boolean) => {
    setShowUpdated(open);
  }, []);

  const { done, total } = placeProgress(address);
  const ordered = sortPlaces(address.usageLocations);
  const toDo = filterPlaces(ordered, 'todo');
  const updated = ordered.filter((location) => location.changed);

  return (
    <section aria-labelledby={HEADING_PLACES} className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-3">
        <h2
          id={HEADING_PLACES}
          className="text-label-caps text-foreground-secondary"
        >
          {total === 0
            ? 'PLACES TO UPDATE'
            : `PLACES TO UPDATE · ${done} OF ${total}`}
        </h2>
        <Button
          variant="link"
          className="h-11 px-2 font-bold"
          onClick={onAddPlace}
        >
          Add
          <span className="sr-only"> place</span>
        </Button>
      </div>

      {total > 0 ? (
        <Progress
          aria-label="Places updated"
          value={done}
          max={total}
          className="h-1.5"
        />
      ) : (
        <p className="text-body-sm text-muted-foreground">No places yet</p>
      )}

      {toDo.length > 0 ? (
        <ListGroup>
          {toDo.map((location) => (
            <PlaceChecklistRow
              key={location.id}
              location={location}
              pending={pendingPlaceIds.has(location.id)}
              onSetChanged={onSetPlaceChanged}
              onEdit={onEditPlace}
              onRequestDelete={onRequestDeletePlace}
            />
          ))}
        </ListGroup>
      ) : total > 0 ? (
        <p className="text-body-sm text-muted-foreground">
          Every place is updated.
        </p>
      ) : null}

      {updated.length > 0 ? (
        <Collapsible open={showUpdated} onOpenChange={handleUpdatedOpenChange}>
          <CollapsibleTrigger asChild>
            <Button
              variant="outline"
              className="w-full justify-start gap-2 px-4"
            >
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  'size-3 transition-transform',
                  showUpdated && 'rotate-90',
                )}
              />
              {`Updated · ${updated.length}`}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <ListGroup>
              {updated.map((location) => (
                <PlaceChecklistRow
                  key={location.id}
                  location={location}
                  pending={pendingPlaceIds.has(location.id)}
                  onSetChanged={onSetPlaceChanged}
                  onEdit={onEditPlace}
                  onRequestDelete={onRequestDeletePlace}
                />
              ))}
            </ListGroup>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </section>
  );
}
