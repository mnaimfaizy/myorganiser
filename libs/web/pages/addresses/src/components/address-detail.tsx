'use client';

import type {
  AddressRecord,
  UsageLocationRecord,
} from '@myorganiser/vault-core';
import { Button, Illustration, StatusPill } from '@myorganiser/web-ui';

import { getGoogleMapsUrl } from '../utils/addressHelpers';
import {
  addressCopyFields,
  describeDangerZone,
  formatAddressUpdatedLine,
} from '../utils/address-summary';
import { ADDRESS_STATUS_PILL } from '../utils/presentation';
import { AddressCopyList } from './address-copy-list';
import { AddressPlacesCard } from './address-places-card';

export interface AddressDetailProps {
  address: AddressRecord;
  today: Date;
  /** The copy confirmation, or null once it has faded. */
  copyMessage: string | null;
  /** "Mark as old" for a current Address, "Mark as current" for an old one. */
  statusActionLabel: string;
  /** Usage Locations whose tick is being saved; their checkboxes are disabled. */
  pendingPlaceIds: ReadonlySet<string>;
  onEdit: () => void;
  onToggleStatus: () => void;
  onCopyField: (label: string, value: string) => void;
  onCopyAll: () => void;
  onAddPlace: () => void;
  onEditPlace: (location: UsageLocationRecord) => void;
  onSetPlaceChanged: (locationId: string, changed: boolean) => void;
  onRequestDeletePlace: (location: UsageLocationRecord) => void;
  onRequestDeleteAddress: () => void;
}

/** The copy confirmation: a navy surface, drawn only while a message is set. */
const COPY_STATUS =
  'flex min-h-12 items-center rounded-control bg-navy px-4 text-body-sm font-semibold text-navy-foreground';
const DESKTOP_CONTAINER = 'mx-auto flex w-full max-w-310 flex-col gap-5.5 p-8';
const HEADING_DANGER = 'address-danger-heading';

/**
 * The desktop Address detail. The header and copy column sit on the left; the
 * Places checklist, which is the page's work surface, sits on the right.
 */
export function AddressDetail({
  address,
  today,
  copyMessage,
  statusActionLabel,
  pendingPlaceIds,
  onEdit,
  onToggleStatus,
  onCopyField,
  onCopyAll,
  onAddPlace,
  onEditPlace,
  onSetPlaceChanged,
  onRequestDeletePlace,
  onRequestDeleteAddress,
}: AddressDetailProps) {
  const pill = ADDRESS_STATUS_PILL[address.status];

  return (
    <div className={DESKTOP_CONTAINER}>
      <header className="flex flex-wrap items-center gap-3.5">
        <Illustration kind="addresses" size={64} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="m-0 min-w-0 break-words font-display text-title-lg text-foreground">
              {address.label}
            </h1>
            <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
          </div>
          <p className="text-body-sm text-muted-foreground">
            {formatAddressUpdatedLine(address, today)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onToggleStatus}>
            {statusActionLabel}
          </Button>
          <Button onClick={onEdit}>Edit address</Button>
        </div>
      </header>

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex basis-85 grow flex-col gap-3">
          <p className="text-caption text-muted-foreground">
            Click a line to copy it
          </p>
          <AddressCopyList
            fields={addressCopyFields(address)}
            variant="desktop"
            onCopy={onCopyField}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={onCopyAll}>
              Copy all
            </Button>
            <Button asChild variant="outline">
              <a
                href={getGoogleMapsUrl(address)}
                target="_blank"
                rel="noreferrer"
              >
                Open in Maps
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Button>
          </div>
          <div role="status" className={copyMessage ? COPY_STATUS : undefined}>
            {copyMessage}
          </div>
          <section
            aria-labelledby={HEADING_DANGER}
            className="mt-2 flex items-center gap-3 rounded-xl border border-border bg-card p-4"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <h2
                id={HEADING_DANGER}
                className="text-body-sm font-semibold text-foreground"
              >
                Delete this address
              </h2>
              <p className="text-caption text-muted-foreground">
                {describeDangerZone(address)}
              </p>
            </div>
            <Button
              variant="outline"
              className="border-destructive-edge text-destructive-text hover:bg-destructive-soft"
              onClick={onRequestDeleteAddress}
            >
              Delete…
            </Button>
          </section>
        </div>

        <AddressPlacesCard
          address={address}
          today={today}
          pendingPlaceIds={pendingPlaceIds}
          onAddPlace={onAddPlace}
          onEditPlace={onEditPlace}
          onSetPlaceChanged={onSetPlaceChanged}
          onRequestDeletePlace={onRequestDeletePlace}
        />
      </div>
    </div>
  );
}
