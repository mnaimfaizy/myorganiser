'use client';

import { useEffect, useState } from 'react';

import { type FeedbackReportListItemDto } from '@myorganiser/app-api-client';
import { useIsMobileState } from '@myorganiser/web-ui';

import type { AccountVariant } from '../account-view';
import { createFeedbackApi } from '../lib/apiClient';
import { YourReportCard } from './YourReportCard';
import { YourReportsEmptyCard } from './YourReportsEmptyCard';
import { YourReportsHeader } from './YourReportsHeader';

const DESKTOP_LAYOUT = 'mx-auto flex w-full max-w-[880px] flex-col gap-5 p-8';
const PHONE_LAYOUT =
  'flex flex-col gap-3 px-4 pt-3 pb-6 pl-[calc(1rem_+_env(safe-area-inset-left))] pr-[calc(1rem_+_env(safe-area-inset-right))]';

type ListState =
  | { status: 'loading'; items: null }
  | { status: 'loaded'; items: FeedbackReportListItemDto[] }
  | { status: 'error'; items: null; error: unknown };

export function YourReportsPageClient() {
  const isPhone = useIsMobileState();
  const [state, setState] = useState<ListState>({
    status: 'loading',
    items: null,
  });

  useEffect(() => {
    const fetchReports = async () => {
      try {
        const api = createFeedbackApi();
        const response = await api.listReports();
        setState({
          status: 'loaded',
          items: response.data.items,
        });
      } catch (error: unknown) {
        setState({
          status: 'error',
          items: null,
          error,
        });
      }
    };

    const markReportsSeen = async () => {
      try {
        const api = createFeedbackApi();
        await api.markReportsSeen();
      } catch (error: unknown) {
        // Fire-and-forget: swallow errors silently
        console.debug('Failed to mark reports as seen:', error);
      }
    };

    void Promise.all([fetchReports(), markReportsSeen()]);
  }, []);

  // Hold the first frame until the breakpoint is known, so a phone never
  // flashes the desktop layout.
  if (isPhone === undefined) return null;

  const variant: AccountVariant = isPhone ? 'phone' : 'desktop';

  return (
    <div className={isPhone ? PHONE_LAYOUT : DESKTOP_LAYOUT}>
      <YourReportsHeader variant={variant} />

      {state.status === 'loading' && (
        <div className="flex items-center justify-center py-8">
          <p className="text-body-sm text-muted-foreground">Loading…</p>
        </div>
      )}

      {state.status === 'error' && (
        <div className="rounded-panel border border-destructive-edge bg-destructive-soft p-4">
          <p className="text-body-sm text-destructive-text">
            Failed to load your reports. Please try refreshing the page.
          </p>
        </div>
      )}

      {state.status === 'loaded' && state.items.length === 0 && (
        <YourReportsEmptyCard variant={variant} />
      )}

      {state.status === 'loaded' && state.items.length > 0 && (
        <div className="flex flex-col gap-3">
          {state.items.map((report) => (
            <YourReportCard key={report.id} report={report} variant={variant} />
          ))}
        </div>
      )}
    </div>
  );
}
