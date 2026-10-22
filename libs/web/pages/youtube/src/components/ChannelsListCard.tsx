import {
  Button,
  ChoiceChip,
  Input,
  Skeleton,
  Switch,
} from '@myorganiser/web-ui';
import { useCallback, useId, type ChangeEvent, type ReactNode } from 'react';
import type { YouTubeSubscription } from '../types';

export type ChannelFilter = 'all' | 'on' | 'off';

/** One table for the sync-state chips: label and predicate. Fans out over the filter ids. */
export const CHANNEL_FILTERS = {
  all: { label: 'All', matches: () => true },
  on: { label: 'On', matches: (sub: YouTubeSubscription) => sub.enabled },
  off: { label: 'Off', matches: (sub: YouTubeSubscription) => !sub.enabled },
} as const satisfies Record<
  ChannelFilter,
  { label: string; matches: (sub: YouTubeSubscription) => boolean }
>;

export const CHANNEL_FILTER_IDS = Object.keys(
  CHANNEL_FILTERS,
) as ChannelFilter[];

/** Count of channels each chip would show, derived from the table. */
export function countChannelFilters(
  subscriptions: YouTubeSubscription[],
): Record<ChannelFilter, number> {
  const counts = {} as Record<ChannelFilter, number>;
  for (const id of CHANNEL_FILTER_IDS) {
    counts[id] = subscriptions.filter(CHANNEL_FILTERS[id].matches).length;
  }
  return counts;
}

interface ChannelsListCardProps {
  /** Channels after the text and chip filters. */
  channels: YouTubeSubscription[];
  /** Every subscription before filtering. Zero means none have been imported. */
  totalCount: number;
  counts: Record<ChannelFilter, number>;
  filterText: string;
  onFilterTextChange: (value: string) => void;
  filter: ChannelFilter;
  onFilterChange: (filter: ChannelFilter) => void;
  loading: boolean;
  onRefresh: () => void;
  refreshDisabled: boolean;
  /** Set only while the sync cooldown is active; becomes the button's aria-label and title. */
  refreshBlockedLabel?: string;
  onSelectChannel: (channelId: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}

/** Local time for a sync that happened today, otherwise the date. */
function formatSyncedAt(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function describeChannelMeta(sub: YouTubeSubscription): string {
  if (!sub.enabled) return 'Off';
  const synced = sub.lastSyncedAt ? formatSyncedAt(sub.lastSyncedAt) : null;
  return synced ? `Synced ${synced}` : 'Not synced yet';
}

export function ChannelsListCard({
  channels,
  totalCount,
  counts,
  filterText,
  onFilterTextChange,
  filter,
  onFilterChange,
  loading,
  onRefresh,
  refreshDisabled,
  refreshBlockedLabel,
  onSelectChannel,
  onToggle,
}: ChannelsListCardProps) {
  const filterId = useId();

  const handleFilterTextChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onFilterTextChange(event.target.value);
    },
    [onFilterTextChange],
  );

  let body: ReactNode;
  if (loading && totalCount === 0) {
    body = (
      <div className="flex flex-col gap-3 p-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-control-sm" />
        ))}
      </div>
    );
  } else if (totalCount === 0) {
    body = (
      <p className="px-5 py-8 text-center text-body-sm text-muted-foreground">
        No subscriptions found. Click &quot;Refresh channels&quot; to import
        your channels.
      </p>
    );
  } else if (channels.length === 0) {
    body = (
      <p className="px-5 py-8 text-center text-body-sm text-muted-foreground">
        No channels match.
      </p>
    );
  } else {
    body = (
      <ul className="m-0 list-none p-0">
        {channels.map((sub) => (
          <li
            key={sub.id}
            className="flex min-h-[68px] items-center gap-3.5 border-b border-subtle px-5 py-3 last:border-b-0"
          >
            {sub.channelThumbnail ? (
              <img
                src={sub.channelThumbnail}
                alt=""
                aria-hidden="true"
                className="size-10 shrink-0 rounded-full"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft font-display text-body font-bold text-brand-text"
              >
                {sub.channelTitle.charAt(0)}
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              <button
                type="button"
                onClick={() => onSelectChannel(sub.channelId)}
                className="max-w-full truncate rounded-control-sm text-left text-body font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                {sub.channelTitle}
              </button>
              <span className="text-body-sm text-muted-foreground">
                {describeChannelMeta(sub)}
              </span>
            </div>
            <Switch
              checked={sub.enabled}
              onCheckedChange={() => onToggle(sub.id, !sub.enabled)}
              aria-label={`Sync ${sub.channelTitle}`}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section
      aria-label="Channels"
      className="flex min-w-0 flex-col overflow-hidden rounded-panel border border-border bg-raised-surface md:flex-[999_1_520px]"
    >
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-4">
        <label htmlFor={filterId} className="sr-only">
          Filter channels
        </label>
        <Input
          id={filterId}
          type="search"
          value={filterText}
          onChange={handleFilterTextChange}
          placeholder="Filter channels"
          className="w-full md:w-60"
        />
        <div
          role="group"
          aria-label="Filter channels by sync state"
          className="flex flex-wrap items-center gap-2.5"
        >
          {CHANNEL_FILTER_IDS.map((id) => (
            <ChoiceChip
              key={id}
              pressed={filter === id}
              onPressedChange={() => onFilterChange(id)}
            >
              {`${CHANNEL_FILTERS[id].label} · ${counts[id]}`}
            </ChoiceChip>
          ))}
        </div>
        <Button
          variant="outline"
          onClick={onRefresh}
          disabled={loading || refreshDisabled}
          aria-label={refreshBlockedLabel}
          title={refreshBlockedLabel}
          className="ml-auto"
        >
          {loading ? 'Refreshing…' : 'Refresh channels'}
        </Button>
      </div>
      {body}
    </section>
  );
}
