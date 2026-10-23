'use client';

import { Button, Skeleton } from '@myorganiser/web-ui';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { updateVideoWatched } from '../hooks';
import { useCachedUploadExpansion } from '../hooks/useCachedUploadExpansion';
import { useEnabledChannelSelection } from '../hooks/useEnabledChannelSelection';
import type { ChannelCarousel } from '../types';
import { ActivePlayerPanel } from './ActivePlayerPanel';
import { ChannelList } from './ChannelList';
import { UploadListItem } from './UploadListItem';

export { CHANNEL_LIST_UPLOAD_CAP } from '../hooks/useCachedUploadExpansion';

/** The single detail pane the channel tab set swaps. */
const CHANNEL_PANEL_ID = 'channel-directory-panel';

interface ChannelDirectoryProps {
  channels: ChannelCarousel[];
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  onWatchedToggle?: (videoId: string, watched: boolean) => void;
  onAddToQueue?: (videoId: string) => void;
  isQueued?: (videoId: string) => boolean;
  queueFull?: boolean;
  /**
   * True while another surface on the page owns the single active player.
   * The directory closes its own player rather than letting two YouTube
   * embeds play over each other.
   */
  playbackSuspended?: boolean;
  /**
   * Called when the User plays an upload here, so the page can hand this
   * surface the active player and stop whatever else was playing.
   */
  onPlaybackClaim?: () => void;
  /**
   * Channel to open on first render, from the `?channel=` deep link that
   * digest mail and the subscription list point at. Ignored once the User
   * picks a channel themselves, and falls back to the first channel when the
   * id is not among the Enabled Channels (disabled since the mail was sent).
   */
  initialChannelId?: string | null;
  /**
   * Asks the page to load the rest of a channel's Cached Uploads. The channel
   * list arrives capped, so a channel with more uploads than that is
   * incomplete until this resolves.
   */
  onLoadMoreUploads?: (channelId: string) => void;
  /** Channel ids currently being expanded by {@link onLoadMoreUploads}. */
  loadingMoreChannelIds?: ReadonlySet<string>;
  /** Channel ids known to be fully loaded — no more uploads to fetch. */
  fullyLoadedChannelIds?: ReadonlySet<string>;
}

export function ChannelDirectory({
  channels,
  loading,
  error,
  onRetry,
  onWatchedToggle,
  onAddToQueue,
  isQueued,
  queueFull,
  playbackSuspended = false,
  onPlaybackClaim,
  initialChannelId = null,
  onLoadMoreUploads,
  loadingMoreChannelIds,
  fullyLoadedChannelIds,
}: ChannelDirectoryProps) {
  const { effectiveSelectedChannelId, selectedChannel, selectChannel } =
    useEnabledChannelSelection({ channels, initialChannelId });

  const [pickedVideoId, setPickedVideoId] = useState<string | null>(null);
  const [focusedVideoIndex, setFocusedVideoIndex] = useState<number>(0);

  const channelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const videoRowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const playerTriggerRef = useRef<HTMLButtonElement | null>(null);

  const { isLoadingMoreUploads, canLoadMoreUploads, handleLoadMoreUploads } =
    useCachedUploadExpansion({
      effectiveSelectedChannelId,
      selectedChannel,
      onLoadMoreUploads,
      loadingMoreChannelIds,
      fullyLoadedChannelIds,
    });

  // Playback is derived, not synced: while another surface owns the single
  // active player this one renders none, whatever the User last picked here.
  // Suspension only lifts when this surface claims playback again, which sets
  // a fresh id in the same commit — so nothing stale can resume on its own.
  // Deriving rather than clearing in an effect also means focus is never
  // yanked back: the surface that claimed playback owns where focus lands.
  const activeVideoId = playbackSuspended ? null : pickedVideoId;

  const handleRetryClick = useCallback(() => {
    onRetry?.();
  }, [onRetry]);

  const handleChannelSelect = useCallback(
    (channelId: string) => {
      selectChannel(channelId);
      setPickedVideoId(null);
      setFocusedVideoIndex(0);
    },
    [selectChannel],
  );

  const handleChannelKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (channels.length === 0) return;

      // The channel tab set is one horizontal chip row, so it answers to the
      // horizontal axis only, per the WAI-ARIA tabs keyboard convention.
      let targetIndex: number | null = null;
      if (e.key === 'ArrowRight') {
        targetIndex = Math.min(index + 1, channels.length - 1);
      } else if (e.key === 'ArrowLeft') {
        targetIndex = Math.max(index - 1, 0);
      } else if (e.key === 'Home') {
        targetIndex = 0;
      } else if (e.key === 'End') {
        targetIndex = channels.length - 1;
      }

      if (targetIndex === null) return;

      e.preventDefault();
      channelRefs.current[targetIndex]?.focus();
      selectChannel(channels[targetIndex].channelId);
      setPickedVideoId(null);
      setFocusedVideoIndex(0);
    },
    [channels, selectChannel],
  );

  const handleVideoKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLDivElement>,
      index: number,
      selectedChannel: ChannelCarousel,
    ) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = Math.min(
          index + 1,
          selectedChannel.videos.length - 1,
        );
        setFocusedVideoIndex(nextIndex);
        videoRowRefs.current[nextIndex]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = Math.max(index - 1, 0);
        setFocusedVideoIndex(prevIndex);
        videoRowRefs.current[prevIndex]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        setFocusedVideoIndex(0);
        videoRowRefs.current[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        const lastIndex = selectedChannel.videos.length - 1;
        setFocusedVideoIndex(lastIndex);
        videoRowRefs.current[lastIndex]?.focus();
      } else if (e.key === 'Escape' && activeVideoId) {
        e.preventDefault();
        setPickedVideoId(null);
        playerTriggerRef.current?.focus();
      }
    },
    [activeVideoId],
  );

  const handlePlayVideo = useCallback(
    (videoId: string, triggerElement: HTMLButtonElement) => {
      // Claim before opening, so whatever else was playing is stopped in the
      // same commit and the two players never overlap for a frame.
      onPlaybackClaim?.();
      setPickedVideoId(videoId);
      playerTriggerRef.current = triggerElement;
    },
    [onPlaybackClaim],
  );

  const handleClosePlayer = useCallback(() => {
    setPickedVideoId(null);
    playerTriggerRef.current?.focus();
  }, []);

  const handleVideoNearEnd = useCallback(() => {
    if (!activeVideoId || !effectiveSelectedChannelId) return;
    const video = channels
      .find((c) => c.channelId === effectiveSelectedChannelId)
      ?.videos.find((v) => v.videoId === activeVideoId);
    if (video && !video.watched) {
      void updateVideoWatched(video.videoId, true).then(() => {
        onWatchedToggle?.(video.videoId, true);
      });
    }
  }, [activeVideoId, effectiveSelectedChannelId, channels, onWatchedToggle]);

  if (error) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="flex flex-col items-start gap-3 rounded-panel border border-destructive-edge bg-destructive-faint p-4"
      >
        <p className="text-body-sm text-destructive-text">{error}</p>
        {onRetry && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRetryClick}
          >
            Retry
          </Button>
        )}
      </div>
    );
  }

  if (loading && channels.length === 0) {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-4">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 shrink-0 rounded-control" />
          ))}
        </div>
        <Skeleton className="h-6 w-48 rounded" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[84px] w-full rounded-panel" />
        ))}
      </div>
    );
  }

  if (channels.length === 0) {
    return (
      <div className="rounded-panel border border-border bg-muted p-6 text-center">
        <p className="text-body-sm text-muted-foreground">
          No Enabled Channels yet. Turn on a channel in{' '}
          <Link
            href="/dashboard/youtube/channels"
            className="font-semibold text-brand-text underline"
          >
            Channels
          </Link>{' '}
          to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ChannelList
        channels={channels}
        selectedChannelId={effectiveSelectedChannelId}
        panelId={CHANNEL_PANEL_ID}
        channelRefs={channelRefs}
        onSelect={handleChannelSelect}
        onKeyDown={handleChannelKeyDown}
      />

      {/* Detail pane: Selected channel videos */}
      {selectedChannel && (
        <div
          id={CHANNEL_PANEL_ID}
          role="tabpanel"
          // Every channel tab points at this one panel, so it cannot be
          // labelled by a single tab element. The channel name is the same
          // name those tabs carry, so it is stated directly instead.
          aria-label={selectedChannel.channelTitle}
          className="flex min-w-0 flex-col gap-4"
        >
          <h2 className="sr-only">{selectedChannel.channelTitle}</h2>

          {/* Active player */}
          {activeVideoId && (
            <ActivePlayerPanel
              activeVideoId={activeVideoId}
              video={selectedChannel.videos.find(
                (v) => v.videoId === activeVideoId,
              )}
              channelTitle={selectedChannel.channelTitle}
              onClose={handleClosePlayer}
              onNearEnd={handleVideoNearEnd}
            />
          )}

          {/* Uploads list */}
          {selectedChannel.videos.length === 0 ? (
            <div className="rounded-panel border border-border bg-raised-surface p-4">
              <p className="text-body-sm text-muted-foreground">
                No uploads for this channel.
              </p>
              <a
                href={`https://www.youtube.com/channel/${encodeURIComponent(selectedChannel.channelId)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-body-sm font-semibold text-brand-text hover:text-brand-text-strong"
              >
                <ExternalLink className="size-icon" aria-hidden="true" />
                Open channel on YouTube
              </a>
            </div>
          ) : (
            <>
              <div className="flex min-w-0 flex-col overflow-hidden rounded-panel border border-border bg-raised-surface">
                <h3 className="sr-only">Cached Uploads</h3>
                {selectedChannel.videos.map((video, index) => (
                  <UploadListItem
                    key={video.id}
                    video={video}
                    index={index}
                    ref={(el) => {
                      videoRowRefs.current[index] = el;
                    }}
                    tabIndex={focusedVideoIndex === index ? 0 : -1}
                    onKeyDown={(e) =>
                      handleVideoKeyDown(e, index, selectedChannel)
                    }
                    onPlay={(triggerEl) =>
                      handlePlayVideo(video.videoId, triggerEl)
                    }
                    onWatchedToggle={onWatchedToggle}
                    onAddToQueue={onAddToQueue}
                    isQueued={isQueued?.(video.videoId) ?? false}
                    queueFull={queueFull ?? false}
                  />
                ))}
              </div>

              {/* End-of-list disclosure */}
              <div className="rounded-panel border border-border bg-raised-surface p-4">
                {canLoadMoreUploads && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleLoadMoreUploads}
                    disabled={isLoadingMoreUploads}
                    className="mb-3 w-full"
                  >
                    {isLoadingMoreUploads
                      ? 'Loading older uploads…'
                      : 'Show older uploads'}
                  </Button>
                )}
                <p className="text-caption text-muted-foreground">
                  MyOrganiser stores only recent uploads from each channel.
                  Older uploads are not cached here.
                </p>
                <a
                  href={`https://www.youtube.com/channel/${encodeURIComponent(selectedChannel.channelId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-body-sm font-semibold text-brand-text hover:text-brand-text-strong"
                >
                  <ExternalLink className="size-icon" aria-hidden="true" />
                  Open channel on YouTube
                </a>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
