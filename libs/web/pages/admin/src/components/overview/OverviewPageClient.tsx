'use client';

import { Illustration } from '@myorganiser/web-ui';

import { useAdminOverview } from '../../hooks/use-admin-overview';
import { NeedsAttention } from './NeedsAttention';
import { OverviewHero } from './OverviewHero';
import { OverviewPhoneStats } from './OverviewPhoneStats';
import { OverviewStatCards } from './OverviewStatCards';
import { OverviewStatus } from './OverviewStatus';
import { PhoneNeedsAttention } from './PhoneNeedsAttention';
import { RecentAdminActivity } from './RecentAdminActivity';

/**
 * The admin Overview. Both breakpoints hold one h1: the desktop hero is
 * `hidden md:flex` and the phone heading is `md:hidden`. The overview numbers
 * come from the shell's provider; the recent activity fetches its own.
 */
export function OverviewPageClient() {
  const { overview, loading, error, reload } = useAdminOverview();

  return (
    <div className="flex flex-col gap-6 p-4 md:gap-7 md:p-8">
      <OverviewHero />
      <div className="flex items-center gap-3 md:hidden">
        <Illustration kind="admin" size={48} />
        <h1 className="font-display text-display text-foreground">Overview</h1>
      </div>
      <OverviewStatus
        loading={loading && overview === null}
        error={error}
        onRetry={reload}
      />
      {overview !== null && !error ? (
        <>
          <OverviewStatCards overview={overview} />
          <OverviewPhoneStats overview={overview} />
          <NeedsAttention overview={overview} />
          <PhoneNeedsAttention overview={overview} />
        </>
      ) : null}
      <RecentAdminActivity />
    </div>
  );
}
