'use client';

import type {
  AddressRecord,
  UsageLocationRecord,
} from '@myorganiser/vault-core';
import { Button, StatusPill } from '@myorganiser/web-ui';
import { CopyStatus, PlacesPhone } from '@myorganiser/web-usage-locations';

import { getGoogleMapsUrl } from '../utils/addressHelpers';
import { addressPhoneCopyFields } from '../utils/address-summary';
import { ADDRESS_STATUS_PILL } from '../utils/presentation';
import { AddressCopyList } from './address-copy-list';

export interface AddressDetailScreenProps {
  address: AddressRecord;
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

const PHONE_CONTAINER =
  'flex min-h-full flex-1 flex-col gap-4 pt-1 pb-[calc(6rem_+_env(safe-area-inset-bottom))]';

/**
 * The phone Address detail, pushed over the Addresses list. The shell draws
 * the back bar; this screen draws the title with its Edit action, the copy
 * lines, the Places checklist and the footer actions.
 */
export function AddressDetailScreen({
  address,
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
}: AddressDetailScreenProps) {
  const pill = ADDRESS_STATUS_PILL[address.status];

  return (
    <div className={PHONE_CONTAINER}>
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-3">
          <h1 className="min-w-0 flex-1 break-words font-display text-display text-foreground">
            {address.label}
          </h1>
          <Button
            variant="link"
            className="h-11 shrink-0 px-2"
            onClick={onEdit}
          >
            Edit
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
        </div>
        <p className="text-caption text-muted-foreground">
          Tap a line to copy it
        </p>
      </div>

      <AddressCopyList
        fields={addressPhoneCopyFields(address)}
        variant="phone"
        onCopy={onCopyField}
      />

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onCopyAll}>
          Copy all
        </Button>
        <Button asChild variant="secondary">
          <a href={getGoogleMapsUrl(address)} target="_blank" rel="noreferrer">
            Open in Maps
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </Button>
      </div>

      <PlacesPhone
        locations={address.usageLocations}
        pendingPlaceIds={pendingPlaceIds}
        onAddPlace={onAddPlace}
        onEditPlace={onEditPlace}
        onSetPlaceChanged={onSetPlaceChanged}
        onRequestDeletePlace={onRequestDeletePlace}
      />

      <div className="mt-auto grid grid-cols-2 gap-2 pb-2">
        <Button
          variant="secondary"
          className="min-w-0 whitespace-normal px-2"
          onClick={onToggleStatus}
        >
          {statusActionLabel}
        </Button>
        <Button
          variant="outline"
          className="min-w-0 border-destructive-edge px-2 text-destructive-text hover:bg-destructive-soft"
          onClick={onRequestDeleteAddress}
        >
          Delete…
        </Button>
      </div>

      <CopyStatus message={copyMessage} variant="phone" />
    </div>
  );
}
