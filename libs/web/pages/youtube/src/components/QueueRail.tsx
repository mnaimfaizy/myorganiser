'use client';

import { Button } from '@myorganiser/web-ui';
import { ChevronDown, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { updateVideoWatched } from '../hooks';
import type { VideoQueue } from '../hooks/useVideoQueue';
import { formatPublishedAgo } from '../lib/formatPublishedAgo';
import { formatRuntimeSeconds } from '../lib/formatRuntimeSeconds';
import type { YouTubeVideo } from '../types';
import { QueueRailItem } from './QueueRailItem';
import { YouTubeVideoPlayer } from './YouTubeVideoPlayer';

/**
 * The three places the queue renders. QueueRail owns the state once and hands
 * out the markup; the caller decides where each one sits and when it shows.
 */
export interface QueueRailSlots {
  /** The Now playing card. Null when nothing is queued. */
  player: ReactNode;
  /** The Queue panel as a side column. Visibility is the caller's to set. */
  rail: ReactNode;
  /** The Queue panel as a disclosure, for narrow screens. Visibility is the caller's to set. */
  disclosure: ReactNode;
}

type Placement = 'desktop' | 'mobile';

interface QueueRailProps {
  queue: VideoQueue;
  onWatchedToggle?: (videoId: string, watched: boolean) => void;
  /**
   * Called when the User starts playback here, so the page can hand this
   * surface the single active player and stop whatever else was playing.
   */
  onPlaybackClaim?: () => void;
  /** Places the slots in the caller's layout. */
  children: (slots: QueueRailSlots) => ReactNode;
}

function computeRemainingMinutes(
  videos: YouTubeVideo[],
  startIndex: number,
): number | null {
  if (startIndex >= videos.length || startIndex < 0) {
    return null;
  }

  let totalSeconds = 0;
  for (let i = startIndex; i < videos.length; i++) {
    const duration = videos[i]?.durationSeconds;
    if (duration == null) {
      return null;
    }
    totalSeconds += duration;
  }

  const minutes = Math.round(totalSeconds / 60);
  return Math.max(minutes, 1);
}

export function QueueRail({
  queue,
  onWatchedToggle,
  onPlaybackClaim,
  children,
}: QueueRailProps) {
  const current = queue.current;
  const nowPlayingTitleRef = useRef<HTMLHeadingElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const lastFocusSignalRef = useRef<number>(queue.focusSignal);
  const [focusedRowIndex, setFocusedRowIndex] = useState<number>(0);
  const [watched, setWatched] = useState<boolean>(!!current?.watched);
  const [updating, setUpdating] = useState<boolean>(false);
  // The watched flag and the in-flight guard reset whenever the playing video
  // changes. Tracked during render so the reset needs no effect.
  const currentVideoId = current?.videoId;
  const [trackedVideoId, setTrackedVideoId] = useState(currentVideoId);
  if (trackedVideoId !== currentVideoId) {
    setTrackedVideoId(currentVideoId);
    setWatched(!!current?.watched);
    setUpdating(false);
  }
  // One ref array per placement. The desktop rail and the phone disclosure
  // both mount the rows, and a shared array would let the hidden copy's
  // buttons win the arrow-key focus target.
  const playButtonRefs = useRef<
    Record<Placement, (HTMLButtonElement | null)[]>
  >({
    desktop: [],
    mobile: [],
  });

  useEffect(() => {
    if (queue.focusSignal !== lastFocusSignalRef.current && current) {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) {
        previousFocusRef.current = activeElement;
      }
      nowPlayingTitleRef.current?.focus();
      lastFocusSignalRef.current = queue.focusSignal;
    }
  }, [queue.focusSignal, current]);

  useEffect(() => {
    setFocusedRowIndex((prev) =>
      Math.min(prev, Math.max(queue.items.length - 1, 0)),
    );
  }, [queue.items.length]);

  const handleCompletion = useCallback(
    async (videoId: string) => {
      if (updating) return;

      setWatched(true);
      setUpdating(true);

      try {
        const result = await updateVideoWatched(videoId, true);
        setWatched(result.watched);
        onWatchedToggle?.(videoId, result.watched);
      } catch {
        setWatched(false);
      } finally {
        setUpdating(false);
      }

      queue.completeAndNext(videoId);
    },
    [queue, updating, onWatchedToggle],
  );

  const handleNearEnd = useCallback(async () => {
    if (!current || watched || updating) return;
    await handleCompletion(current.videoId);
  }, [current, watched, updating, handleCompletion]);

  const handleMarkWatchedAndNext = useCallback(async () => {
    if (!current || watched || updating) return;
    await handleCompletion(current.videoId);
  }, [current, watched, updating, handleCompletion]);

  // Claiming happens in the same event as the play, not in an effect after it,
  // so the surface that was playing is torn down in the same commit and two
  // embeds are never mounted together — not even for a frame.
  const handlePlay = useCallback(
    (videoId: string) => {
      onPlaybackClaim?.();
      queue.playId(videoId);
    },
    [onPlaybackClaim, queue],
  );

  const registerPlayButton = useCallback(
    (placement: Placement, index: number, el: HTMLButtonElement | null) => {
      playButtonRefs.current[placement][index] = el;
    },
    [],
  );

  const handleRowKeyDown = useCallback(
    (
      placement: Placement,
      e: React.KeyboardEvent<HTMLButtonElement>,
      index: number,
    ) => {
      const refs = playButtonRefs.current[placement];
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = Math.min(index + 1, queue.items.length - 1);
        setFocusedRowIndex(nextIndex);
        refs[nextIndex]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = Math.max(index - 1, 0);
        setFocusedRowIndex(prevIndex);
        refs[prevIndex]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        setFocusedRowIndex(0);
        refs[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        const lastIndex = queue.items.length - 1;
        setFocusedRowIndex(lastIndex);
        refs[lastIndex]?.focus();
      }
    },
    [queue.items.length],
  );

  const handleDesktopRegisterPlayButton = useCallback(
    (index: number, el: HTMLButtonElement | null) =>
      registerPlayButton('desktop', index, el),
    [registerPlayButton],
  );
  const handleMobileRegisterPlayButton = useCallback(
    (index: number, el: HTMLButtonElement | null) =>
      registerPlayButton('mobile', index, el),
    [registerPlayButton],
  );
  const handleDesktopRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, index: number) =>
      handleRowKeyDown('desktop', e, index),
    [handleRowKeyDown],
  );
  const handleMobileRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, index: number) =>
      handleRowKeyDown('mobile', e, index),
    [handleRowKeyDown],
  );

  const handlePlayerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        previousFocusRef.current?.focus();
      }
    },
    [],
  );

  const startIdx = queue.activeIndex >= 0 ? queue.activeIndex : 0;
  const remainingMinutes = computeRemainingMinutes(queue.items, startIdx);

  const currentMeta = current
    ? [
        current.channelTitle,
        formatPublishedAgo(current.publishedAt),
        formatRuntimeSeconds(current.durationSeconds),
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  const playerContent = current ? (
    <section
      aria-label="Now playing"
      onKeyDown={handlePlayerKeyDown}
      className="flex flex-col overflow-hidden rounded-panel border border-border bg-raised-surface motion-reduce:transition-none"
    >
      <YouTubeVideoPlayer
        key={current.videoId}
        video={current}
        watched={watched}
        onNearEnd={handleNearEnd}
        defaultPlaying
      />

      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1">
          <h3
            ref={nowPlayingTitleRef}
            tabIndex={-1}
            className="text-body font-semibold text-foreground"
          >
            {current.title}
          </h3>
          {currentMeta && (
            <p className="text-body-sm text-muted-foreground">{currentMeta}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <a
              href={`https://www.youtube.com/watch?v=${encodeURIComponent(current.videoId)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open on YouTube
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>

          <Button
            type="button"
            variant="default"
            onClick={handleMarkWatchedAndNext}
            disabled={updating || watched}
          >
            Mark watched & next
          </Button>
        </div>
      </div>
    </section>
  ) : null;

  // The rail is rendered twice — once for the desktop column, once inside the
  // mobile disclosure — so the heading id has to be per-instance. A single
  // shared id would be duplicated in the DOM and `aria-labelledby` would resolve
  // to whichever copy came first, which on mobile is the hidden desktop one.
  const renderRail = (placement: Placement, headingId: string) => {
    const onRegister =
      placement === 'desktop'
        ? handleDesktopRegisterPlayButton
        : handleMobileRegisterPlayButton;
    const onRowKeyDown =
      placement === 'desktop'
        ? handleDesktopRowKeyDown
        : handleMobileRowKeyDown;
    return (
      <aside className="flex flex-col gap-3" aria-labelledby={headingId}>
        <div className="flex items-baseline justify-between gap-3">
          <h2
            id={headingId}
            className="font-display text-title font-bold text-foreground"
          >
            Queue
          </h2>
          <span className="text-body-sm text-muted-foreground">
            {queue.items.length} of 4
            {remainingMinutes !== null && <> · ~{remainingMinutes} min</>}
          </span>
        </div>

        {queue.isFull && (
          <div className="rounded-control border border-dashed border-border-strong p-3 text-body-sm text-foreground">
            Queue is full — 4 is the point.
          </div>
        )}

        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {queue.items.length === 1
            ? '1 Cached Upload queued'
            : `${queue.items.length} Cached Uploads queued`}
        </div>

        {queue.items.length > 0 ? (
          <ol className="flex flex-col gap-2 lg:max-h-[60vh] lg:overflow-y-auto">
            {queue.items.map((video, index) => {
              const isCurrentlyPlaying = index === queue.activeIndex;

              return (
                <QueueRailItem
                  key={video.videoId}
                  video={video}
                  index={index}
                  isCurrentlyPlaying={isCurrentlyPlaying}
                  focusedRowIndex={focusedRowIndex}
                  onRegisterPlayButton={onRegister}
                  onPlay={handlePlay}
                  onRemove={queue.remove}
                  onMoveUp={queue.moveUp}
                  onMoveDown={queue.moveDown}
                  onKeyDown={onRowKeyDown}
                  queueLength={queue.items.length}
                />
              );
            })}
          </ol>
        ) : (
          <div className="rounded-control border border-subtle bg-muted p-3">
            <p className="text-body-sm text-foreground">Your queue is empty.</p>
            <p className="mt-1 text-caption text-muted-foreground">
              Add a Cached Upload from a channel row to line up what you want to
              watch.
            </p>
          </div>
        )}

        {queue.items.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={queue.clear}
            className="w-full"
          >
            Clear queue
          </Button>
        )}
      </aside>
    );
  };

  const railSlot = renderRail('desktop', 'queue-rail-heading-desktop');

  const disclosureSlot = (
    <details className="group rounded-control border border-border bg-raised-surface">
      <summary className="flex h-12 cursor-pointer list-none select-none items-center justify-between gap-3 rounded-control px-4 text-body-sm font-semibold text-foreground hover:bg-muted [&::-webkit-details-marker]:hidden">
        <span>Queue · {queue.items.length} of 4</span>
        <span className="flex items-center gap-2 text-caption font-normal text-muted-foreground">
          {remainingMinutes !== null && <>~{remainingMinutes} min</>}
          <ChevronDown
            aria-hidden="true"
            className="size-icon transition-transform group-open:rotate-180 motion-reduce:transition-none"
          />
        </span>
      </summary>
      <div className="p-4 pt-0">
        {renderRail('mobile', 'queue-rail-heading-mobile')}
      </div>
    </details>
  );

  return (
    <>
      {children({
        player: playerContent,
        rail: railSlot,
        disclosure: disclosureSlot,
      })}
    </>
  );
}
