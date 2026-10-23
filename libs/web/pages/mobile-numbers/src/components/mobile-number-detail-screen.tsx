'use client';

import type {
  MobileNumberRecord,
  UsageLocationRecord,
} from '@myorganiser/vault-core';
import { Button } from '@myorganiser/web-ui';
import {
  COPY_FAILED_MESSAGE,
  CopyStatus,
  PlacesPhone,
} from '@myorganiser/web-usage-locations';
import { Check, Copy } from 'lucide-react';

import { formatMobileNumber } from '../utils/formatMobileNumber';
import { smsHref, telHref } from '../utils/mobile-summary';

export interface MobileNumberDetailScreenProps {
  item: MobileNumberRecord;
  /** The copy confirmation, or null once it has faded. */
  copyMessage: string | null;
  /** Usage Locations whose tick is being saved; their checkboxes are disabled. */
  pendingPlaceIds: ReadonlySet<string>;
  onEdit: () => void;
  onCopyNumber: () => void;
  onAddPlace: () => void;
  onEditPlace: (location: UsageLocationRecord) => void;
  onSetPlaceChanged: (locationId: string, changed: boolean) => void;
  onRequestDeletePlace: (location: UsageLocationRecord) => void;
  onRequestDelete: () => void;
}

const PHONE_CONTAINER =
  'flex min-h-full flex-1 flex-col gap-4 pt-1 pb-[calc(6rem_+_env(safe-area-inset-bottom))]';
/** Call and Message share a row; a number with only one of them to dial fills the row. */
const PHONE_TWO_LINKS = 'grid grid-cols-2 gap-2';
const PHONE_ONE_LINK = 'grid grid-cols-1 gap-2';

/**
 * The phone Mobile Number detail, pushed over the list. The shell draws the
 * back bar; this screen draws the title with its Edit action, the copy
 * control, the call and message links, the Places checklist and the footer.
 */
export function MobileNumberDetailScreen({
  item,
  copyMessage,
  pendingPlaceIds,
  onEdit,
  onCopyNumber,
  onAddPlace,
  onEditPlace,
  onSetPlaceChanged,
  onRequestDeletePlace,
  onRequestDelete,
}: MobileNumberDetailScreenProps) {
  const formatted = formatMobileNumber(item);
  // A failed copy is announced too, but it must not show the success tick.
  const copied = copyMessage !== null && copyMessage !== COPY_FAILED_MESSAGE;
  // Null when there is nothing to dial, so the link is not drawn at all.
  const callHref = telHref(item);
  const messageHref = smsHref(item);
  const linksGrid = callHref && messageHref ? PHONE_TWO_LINKS : PHONE_ONE_LINK;

  return (
    <div className={PHONE_CONTAINER}>
      <div className="flex items-start gap-3">
        <h1 className="min-w-0 flex-1 break-words font-display text-display text-foreground">
          {item.label}
        </h1>
        <Button variant="link" className="h-11 shrink-0 px-2" onClick={onEdit}>
          Edit
        </Button>
      </div>

      <button
        type="button"
        aria-label={`Copy number ${formatted}`}
        onClick={onCopyNumber}
        className="flex min-h-19 items-center justify-between gap-3 rounded-2xl border-2 border-cyan bg-card py-0 pr-2.5 pl-4.5 text-left font-display text-title-lg font-bold tabular-nums text-foreground"
      >
        <span className="min-w-0 break-words">{formatted}</span>
        <span
          aria-hidden="true"
          className={
            copied
              ? 'flex size-11 shrink-0 items-center justify-center rounded-xl bg-success-soft text-success-text'
              : 'flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground'
          }
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </span>
      </button>

      {callHref || messageHref ? (
        <div className={linksGrid}>
          {callHref ? (
            <Button asChild variant="brand" size="lg">
              <a href={callHref}>Call</a>
            </Button>
          ) : null}
          {messageHref ? (
            <Button asChild variant="secondary" size="lg">
              <a href={messageHref}>Message</a>
            </Button>
          ) : null}
        </div>
      ) : null}

      <PlacesPhone
        locations={item.usageLocations}
        pendingPlaceIds={pendingPlaceIds}
        onAddPlace={onAddPlace}
        onEditPlace={onEditPlace}
        onSetPlaceChanged={onSetPlaceChanged}
        onRequestDeletePlace={onRequestDeletePlace}
      />

      <div className="mt-auto pb-2">
        <Button
          variant="outline"
          className="w-full border-destructive-edge text-destructive-text hover:bg-destructive-soft"
          onClick={onRequestDelete}
        >
          Delete…
        </Button>
      </div>

      <CopyStatus message={copyMessage} variant="phone" />
    </div>
  );
}
