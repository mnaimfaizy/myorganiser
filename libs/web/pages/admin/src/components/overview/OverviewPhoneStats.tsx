import type { AdminOverviewResponse } from '@myorganiser/app-api-client';

import {
  phonePlacesLeftNote,
  phoneUnverifiedNote,
  usersJoinedNote,
} from '../../lib/overview';
import { OverviewLinkCard } from './OverviewLinkCard';

export interface OverviewPhoneStatsProps {
  overview: AdminOverviewResponse;
}

/** The phone key numbers: a two-column grid of four link cards. */
export function OverviewPhoneStats({ overview }: OverviewPhoneStatsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 md:hidden">
      <OverviewLinkCard
        compact
        label="USERS"
        value={String(overview.users)}
        note={usersJoinedNote(overview.usersJoinedLast7Days)}
        noteTone="trust"
      />
      <OverviewLinkCard
        compact
        label="UNVERIFIED"
        value={String(overview.unverified)}
        note={phoneUnverifiedNote(overview.unverifiedOverAWeek)}
        noteTone="warning"
      />
      <OverviewLinkCard
        compact
        label="DISABLED"
        value={String(overview.disabled)}
        note="Cannot sign in"
        noteTone="danger"
      />
      <OverviewLinkCard
        compact
        label="YOUTUBE PLACES"
        value={`${overview.youtubeAccessPlacesUsed}/${overview.youtubeAccessCeiling}`}
        note={phonePlacesLeftNote(overview.youtubeAccessPlacesLeft)}
        noteTone="warning"
      />
    </div>
  );
}
