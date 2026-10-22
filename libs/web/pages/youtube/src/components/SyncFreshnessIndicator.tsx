'use client';

import { cn } from '@myorganiser/web-ui';
import { AlertTriangle, CircleAlert, Clock } from 'lucide-react';
import { describeSyncFreshness } from '../lib/syncFreshness';
import type { YouTubeSyncStatus } from '../types';

interface SyncFreshnessIndicatorProps {
  /** Persisted sync status, or null while it is still being fetched. */
  status: YouTubeSyncStatus | null;
  className?: string;
  /**
   * `panel` (default) stacks the last-synced line above the state, right
   * aligned. `inline` drops the last-synced line, for a page whose header
   * subtitle already states it, and left-aligns the state beneath.
   */
  variant?: 'panel' | 'inline';
}

const TONE_TEXT_CLASS = {
  ok: 'text-muted-foreground',
  pending: 'text-muted-foreground',
  warning: 'text-warning',
  error: 'text-destructive',
} as const;

const TONE_ICON = {
  ok: null,
  pending: Clock,
  warning: AlertTriangle,
  error: CircleAlert,
} as const;

/**
 * Library-level freshness for Cached Uploads (PRD #264, user story 27).
 *
 * Renders the "Last synced" line the page always had, and — when the reading
 * is anything other than current and healthy — the state behind it: failed,
 * partially failed, quota-stalled, or delayed. Without this, a nightly sync
 * that has been failing for a week is indistinguishable from a healthy one.
 *
 * State is never carried by color alone: every tone ships a text label and an
 * icon, per the accessibility decision on issue #261.
 *
 * The Retry control lives on the page next to this indicator rather than
 * inside it, because Retry also drives the manual-refresh cooldown and the
 * subscription list — this component only reports.
 */
export function SyncFreshnessIndicator({
  status,
  className,
  variant = 'panel',
}: SyncFreshnessIndicatorProps) {
  const reading = describeSyncFreshness(status);
  const isInline = variant === 'inline';
  const Icon = TONE_ICON[reading.tone];

  // A healthy library announces nothing. The polite region carries only states
  // the User would want to hear about, so a background status refresh on a
  // working sync stays silent for assistive tech.
  const announcement = reading.label
    ? [reading.label, reading.detail].filter(Boolean).join('. ')
    : '';

  return (
    <div
      className={cn(
        'flex max-w-xs flex-col gap-1',
        isInline ? 'items-start' : 'items-end',
        className,
      )}
    >
      {!isInline && (
        <p className="text-body-sm text-muted-foreground">
          {reading.lastSyncedLabel}
        </p>
      )}

      {reading.label && (
        <p
          className={cn(
            'flex items-center gap-1.5 text-body-sm font-medium',
            TONE_TEXT_CLASS[reading.tone],
          )}
        >
          {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
          {reading.label}
        </p>
      )}

      {reading.detail && (
        <p
          className={cn(
            'text-caption text-muted-foreground',
            isInline ? 'text-left' : 'text-right',
          )}
        >
          {reading.detail}
        </p>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
