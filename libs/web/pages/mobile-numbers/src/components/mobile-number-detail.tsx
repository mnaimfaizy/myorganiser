'use client';

import type {
  MobileNumberRecord,
  UsageLocationRecord,
} from '@myorganiser/vault-core';
import { Button, Illustration } from '@myorganiser/web-ui';
import { PlacesCard } from '@myorganiser/web-usage-locations';
import { Copy } from 'lucide-react';
import { useId } from 'react';

import { formatMobileNumber } from '../utils/formatMobileNumber';
import {
  describeMobileDangerZone,
  formatMobileUpdatedLine,
  smsHref,
  telHref,
} from '../utils/mobile-summary';

export interface MobileNumberDetailProps {
  item: MobileNumberRecord;
  today: Date;
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

const DESKTOP_CONTAINER = 'mx-auto flex w-full max-w-310 flex-col gap-5.5 p-8';
/** Outline buttons on the navy hero, as the Home hero draws them. */
const OUTLINE_ON_NAVY =
  'border-navy-raised bg-transparent text-navy-foreground hover:bg-navy-raised';
/**
 * The hero's action row, one column per button drawn: Edit always, plus Call
 * and Message when there is a number to dial. Indexed by the dialable links.
 */
const HERO_ACTION_GRIDS = [
  'grid grid-cols-1 gap-2',
  'grid grid-cols-2 gap-2',
  'grid grid-cols-3 gap-2',
] as const;
/** The copy confirmation on the navy hero: text only, since the hero is already navy. */
const HERO_COPY_STATUS = 'text-body-sm font-semibold text-navy-foreground';

/**
 * The desktop Mobile Number detail. The navy hero holds the number to copy and
 * the call, message and edit actions; the Places checklist sits beside it and
 * the danger zone closes the row.
 */
export function MobileNumberDetail({
  item,
  today,
  copyMessage,
  pendingPlaceIds,
  onEdit,
  onCopyNumber,
  onAddPlace,
  onEditPlace,
  onSetPlaceChanged,
  onRequestDeletePlace,
  onRequestDelete,
}: MobileNumberDetailProps) {
  const headingId = useId();
  const dangerHeadingId = useId();
  const formatted = formatMobileNumber(item);
  // Null when there is nothing to dial, so the link is not drawn at all.
  const callHref = telHref(item);
  const messageHref = smsHref(item);
  const linkCount = (callHref ? 1 : 0) + (messageHref ? 1 : 0);

  return (
    <div className={DESKTOP_CONTAINER}>
      <div className="flex flex-wrap items-start gap-5">
        <section
          aria-labelledby={headingId}
          className="flex basis-100 grow flex-col gap-4 rounded-panel bg-navy p-6 text-navy-foreground"
        >
          <div className="flex items-center gap-3.5">
            <Illustration kind="mobile" size={64} />
            <div className="flex min-w-0 flex-1 flex-col">
              <h1
                id={headingId}
                className="m-0 min-w-0 break-words font-display text-title-lg text-navy-foreground"
              >
                {item.label}
              </h1>
              <p className="text-body-sm text-navy-muted-foreground">
                {formatMobileUpdatedLine(item, today)}
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-label={`Copy number ${formatted}`}
            onClick={onCopyNumber}
            className="flex min-h-18 items-center justify-between gap-3 rounded-2xl border border-navy-foreground/20 bg-navy-raised py-0 pr-3 pl-4.5 text-left font-display text-title-lg font-bold tabular-nums text-navy-foreground"
          >
            <span className="min-w-0 break-words">{formatted}</span>
            <span
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-navy-foreground/15"
            >
              <Copy className="size-4 text-navy-foreground" />
            </span>
          </button>

          <div className={HERO_ACTION_GRIDS[linkCount]}>
            {callHref ? (
              <Button asChild variant="brand">
                <a href={callHref}>Call</a>
              </Button>
            ) : null}
            {messageHref ? (
              <Button asChild variant="outline" className={OUTLINE_ON_NAVY}>
                <a href={messageHref}>Message</a>
              </Button>
            ) : null}
            <Button
              variant="outline"
              className={OUTLINE_ON_NAVY}
              onClick={onEdit}
            >
              Edit
            </Button>
          </div>

          <div
            role="status"
            className={copyMessage ? HERO_COPY_STATUS : undefined}
          >
            {copyMessage}
          </div>
        </section>

        <PlacesCard
          locations={item.usageLocations}
          noun="number"
          today={today}
          pendingPlaceIds={pendingPlaceIds}
          onAddPlace={onAddPlace}
          onEditPlace={onEditPlace}
          onSetPlaceChanged={onSetPlaceChanged}
          onRequestDeletePlace={onRequestDeletePlace}
        />

        <section
          aria-labelledby={dangerHeadingId}
          className="flex basis-85 grow items-center gap-3 rounded-xl border border-border bg-card p-4"
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <h2
              id={dangerHeadingId}
              className="text-body-sm font-semibold text-foreground"
            >
              Delete this number
            </h2>
            <p className="text-caption text-muted-foreground">
              {describeMobileDangerZone(item)}
            </p>
          </div>
          <Button
            variant="outline"
            className="border-destructive-edge text-destructive-text hover:bg-destructive-soft"
            onClick={onRequestDelete}
          >
            Delete…
          </Button>
        </section>
      </div>
    </div>
  );
}
