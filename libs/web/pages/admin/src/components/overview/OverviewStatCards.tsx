import type { AdminOverviewResponse } from '@myorganiser/app-api-client';

import {
  platformAdminsNote,
  unverifiedOverWeekNote,
  usersJoinedNote,
} from '../../lib/overview';
import { OverviewLinkCard } from './OverviewLinkCard';
import { YouTubePlacesCard } from './YouTubePlacesCard';

export interface OverviewStatCardsProps {
  overview: AdminOverviewResponse;
}

/** The desktop key numbers: four link cards and the plain places card. */
export function OverviewStatCards({ overview }: OverviewStatCardsProps) {
  return (
    <section
      aria-label="Key numbers"
      className="hidden gap-3 md:grid md:grid-cols-2 lg:grid-cols-5"
    >
      <OverviewLinkCard
        label="USERS"
        value={String(overview.users)}
        note={usersJoinedNote(overview.usersJoinedLast7Days)}
        noteTone="trust"
      />
      <OverviewLinkCard
        label="PLATFORM ADMINS"
        value={String(overview.platformAdmins)}
        note={platformAdminsNote(overview.platformAdmins)}
        noteTone="muted"
      />
      <OverviewLinkCard
        label="UNVERIFIED"
        value={String(overview.unverified)}
        note={unverifiedOverWeekNote(overview.unverifiedOverAWeek)}
        noteTone="warning"
      />
      <OverviewLinkCard
        label="DISABLED"
        value={String(overview.disabled)}
        note="Cannot sign in"
        noteTone="danger"
      />
      <YouTubePlacesCard
        used={overview.youtubeAccessPlacesUsed}
        ceiling={overview.youtubeAccessCeiling}
        left={overview.youtubeAccessPlacesLeft}
      />
    </section>
  );
}
