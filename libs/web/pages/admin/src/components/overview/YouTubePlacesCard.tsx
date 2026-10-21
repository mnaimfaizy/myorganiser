import type { AdminOverviewResponse } from '@myorganiser/app-api-client';

import { placesLeftNote } from '../../lib/overview';

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
  const fill = ceiling > 0 ? Math.min(100, (used / ceiling) * 100) : 0;

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
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={ceiling}
        className="h-2 overflow-hidden rounded-full bg-subtle"
      >
        <div
          className="h-full rounded-full bg-warning"
          style={{ width: `${fill}%` }}
        />
      </div>
      <span className="text-caption text-warning-text">
        {placesLeftNote(left)}
      </span>
    </div>
  );
}
