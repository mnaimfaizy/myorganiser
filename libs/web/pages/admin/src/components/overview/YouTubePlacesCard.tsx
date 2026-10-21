import type { AdminOverviewResponse } from '@myorganiser/app-api-client';

import { arePlacesLow, placesLeftNote } from '../../lib/overview';

export interface YouTubePlacesCardProps {
  used: AdminOverviewResponse['youtubeAccessPlacesUsed'];
  ceiling: AdminOverviewResponse['youtubeAccessCeiling'];
  left: AdminOverviewResponse['youtubeAccessPlacesLeft'];
}

/**
 * The YouTube Access places card on desktop. Plain, not a link: the places
 * are read-only here, and the holders list is one click away from attention.
 */
export function YouTubePlacesCard({
  used,
  ceiling,
  left,
}: YouTubePlacesCardProps) {
  const low = arePlacesLow({
    youtubeAccessPlacesLeft: left,
    youtubeAccessCeiling: ceiling,
  });
  // Lifetime grants can exceed the ceiling, so the ARIA value is clamped to
  // the ceiling. The visible "used / ceiling" text keeps the raw count.
  const ariaUsed = Math.min(used, ceiling);
  const fill = ceiling > 0 ? (ariaUsed / ceiling) * 100 : 0;

  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-panel border border-border bg-raised-surface p-4 shadow-card">
      <span className="text-label-caps text-muted-foreground">
        YOUTUBE ACCESS PLACES
      </span>
      <p className="font-display text-display text-foreground">
        {used}
        <span className="text-body text-muted-foreground"> / {ceiling}</span>
      </p>
      <div
        role="progressbar"
        aria-label="YouTube Access places used"
        aria-valuenow={ariaUsed}
        aria-valuemin={0}
        aria-valuemax={ceiling}
        className="h-2 overflow-hidden rounded-full bg-subtle"
      >
        <div
          className={
            low
              ? 'h-full rounded-full bg-warning'
              : 'h-full rounded-full bg-brand'
          }
          style={{ width: `${fill}%` }}
        />
      </div>
      <span
        className={
          low
            ? 'text-caption text-warning-text'
            : 'text-caption text-muted-foreground'
        }
      >
        {placesLeftNote(left)}
      </span>
    </div>
  );
}
