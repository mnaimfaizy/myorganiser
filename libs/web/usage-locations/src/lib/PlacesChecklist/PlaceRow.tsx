'use client';

import {
  openableLink,
  type UsageLocationRecord,
} from '@myorganiser/vault-core';
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  StatusPill,
  cn,
} from '@myorganiser/web-ui';
import { MoreHorizontal } from 'lucide-react';

import {
  formatPlaceMeta,
  PLACE_PRIORITY_PILL,
  PLACE_UPDATED_PILL,
} from './placeChecklist';

export interface PlaceRowProps {
  location: UsageLocationRecord;
  today: Date;
  /** True while this row's tick is being saved. */
  pending: boolean;
  onSetChanged: (locationId: string, changed: boolean) => void;
  onEdit: (location: UsageLocationRecord) => void;
  onRequestDelete: (location: UsageLocationRecord) => void;
}

/** One line on the desktop Places checklist: tick it, read it, or open its menu. */
export function PlaceRow({
  location,
  today,
  pending,
  onSetChanged,
  onEdit,
  onRequestDelete,
}: PlaceRowProps) {
  const pillSpec = location.changed
    ? PLACE_UPDATED_PILL
    : PLACE_PRIORITY_PILL[location.priority];
  const link = openableLink(location.link);

  return (
    <li
      className={cn(
        'flex min-h-17 items-center gap-3 border-b border-border-subtle py-2 pr-3 pl-5',
        location.changed && 'bg-subtle',
      )}
    >
      <Checkbox
        aria-label={`Updated at ${location.organisationName}`}
        checked={location.changed}
        disabled={pending}
        onCheckedChange={(next) => onSetChanged(location.id, next === true)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            'text-body',
            location.changed ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {location.organisationName}
        </span>
        <span className="text-caption text-muted-foreground">
          {formatPlaceMeta(location, today)}
        </span>
      </div>
      <StatusPill tone={pillSpec.tone}>{pillSpec.label}</StatusPill>
      {link && !location.changed ? (
        <Button asChild variant="outline" size="sm">
          <a href={link} target="_blank" rel="noreferrer">
            Update online <span aria-hidden="true">↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </Button>
      ) : null}
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
    </li>
  );
}
