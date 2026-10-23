'use client';

import { cn } from '@myorganiser/web-ui';
import type { KeyboardEvent, MutableRefObject } from 'react';
import type { ChannelCarousel } from '../types';

interface ChannelListProps {
  channels: ChannelCarousel[];
  selectedChannelId: string | null;
  /** Id of the detail pane these tabs swap, for `aria-controls`. */
  panelId: string;
  channelRefs: MutableRefObject<(HTMLButtonElement | null)[]>;
  onSelect: (channelId: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>, index: number) => void;
}

/**
 * Channel selector for the locked channel-first directory.
 *
 * Rendered as a tab set rather than a nav landmark. Decision #261 requires
 * arrow-key movement within the channel list with a single tab stop for the
 * whole set, which is the ARIA tabs keyboard contract; announcing the same
 * controls as navigation left the behaviour and the role disagreeing. The
 * locked prototype predates #261 and has no arrow keys at all, so it is not
 * authority against this.
 *
 * One horizontal chip row on every width. It scrolls inside itself rather than
 * wrapping, so a long channel list never pushes the page wider than the screen.
 */
export function ChannelList({
  channels,
  selectedChannelId,
  panelId,
  channelRefs,
  onSelect,
  onKeyDown,
}: ChannelListProps) {
  return (
    <div
      role="tablist"
      aria-label="Enabled channels"
      aria-orientation="horizontal"
      className="flex min-w-0 max-w-full gap-2 overflow-x-auto pb-1"
    >
      {channels.map((channel, index) => {
        const isSelected = channel.channelId === selectedChannelId;
        const newCount = channel.videos.filter((v) => !v.watched).length;
        return (
          <button
            key={channel.channelId}
            ref={(el) => {
              channelRefs.current[index] = el;
            }}
            id={`channel-tab-${channel.channelId}`}
            role="tab"
            type="button"
            tabIndex={isSelected ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, index)}
            onClick={() => onSelect(channel.channelId)}
            aria-selected={isSelected}
            aria-controls={panelId}
            aria-label={
              newCount > 0
                ? `${channel.channelTitle}, ${newCount} new`
                : undefined
            }
            className={cn(
              'flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control border px-3 text-body-sm font-medium transition-colors motion-reduce:transition-none',
              isSelected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-control-edge bg-raised-surface text-foreground hover:bg-ghost-hover',
            )}
          >
            {channel.channelTitle}
            {newCount > 0 && (
              <span aria-hidden="true" className="tabular-nums text-caption">
                · {newCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
