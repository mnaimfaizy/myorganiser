'use client';

import { Button, Skeleton, useIsMobileState } from '@myorganiser/web-ui';
import { useCallback, useEffect, useState } from 'react';
import {
  updateVideoWatched,
  useShortsBudget,
  useYouTubeAvailability,
  useYouTubeShorts,
  useYouTubeStatus,
} from '../hooks';
import { ShortsEntryWarning } from './ShortsEntryWarning';
import { ShortsBudgetMeter } from './ShortsBudgetMeter';
import { ShortsHardStop } from './ShortsHardStop';
import { YouTubeConnectPrompt } from './YouTubeConnectPrompt';
import { YouTubeSectionNav } from './YouTubeSectionNav';
import { YouTubeUnavailableNotice } from './YouTubeUnavailableNotice';
import { ShortsList } from './ShortsList';
import { ShortsPlayerPanel } from './ShortsPlayerPanel';

/** The page gutter: the shell provides none inside its content area. */
const SHORTS_PAGE_CLASS =
  'mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-5 px-4 pb-8 pt-4 md:p-8';

/**
 * Shorts page client — orchestrates the focused Shorts watching experience.
 *
 * The page follows this flow:
 *
 * 1. Availability gate: if YouTube is unavailable, show the unavailable notice.
 * 2. Connection gate: if not connected to YouTube, show a prompt to connect.
 * 3. Entry warning: on first mount or navigation, block the page with an entry
 *    gate that explains the Shorts time cap and requires acknowledgement.
 * 4. Budget meter: render the meter in both active and locked states, wired to
 *    `budget.setLimitMinutes`.
 * 5. Active state: if acknowledged and not locked, render the active Short with
 *    Previous/Next navigation, wrapping, and a side list of all Shorts.
 * 6. Locked state: if budget is exhausted, render the Hard Stop surface.
 *
 * Watched/New state is independent of budgeting and uses the same rules as
 * long-form. Failures to update watched state do not crash the page.
 *
 * Metering must not run behind the entry warning or the Hard Stop, so `active`
 * is false until acknowledged and not locked.
 */
export function ShortsPageClient() {
  const { available, error: availabilityError } = useYouTubeAvailability();

  // Availability gate — fail closed. The Shorts list, budget meter and
  // keyboard listener live below it, so a User without YouTube Access makes no
  // YouTube request and starts no budget clock.
  if (available !== true) {
    return (
      <YouTubeUnavailableNotice
        reason={availabilityError ? 'unreachable' : 'unavailable'}
      />
    );
  }

  return <ShortsWatchExperience />;
}

function ShortsWatchExperience() {
  const isPhone = useIsMobileState() === true;
  const variant: 'desktop' | 'phone' = isPhone ? 'phone' : 'desktop';
  const { connected, status } = useYouTubeStatus();
  const {
    shorts,
    loading,
    error,
    updateWatched,
    refresh: refreshShorts,
  } = useYouTubeShorts();
  const [acknowledged, setAcknowledged] = useState(false);
  const [selectedShortId, setSelectedShortId] = useState<string | null>(null);
  const [playbackStarted, setPlaybackStarted] = useState(false);
  const [reportedPlaying, setReportedPlaying] = useState<boolean | null>(null);
  const [lockedAtLastRender, setLockedAtLastRender] = useState(false);

  // The Shorts Daily Budget is a guardrail, so it has to fail *closed*: a
  // metering signal that never arrives must not hand the User unlimited Shorts.
  //
  // `playbackStarted` comes from the Play click itself — a local React event
  // that cannot fail. `reportedPlaying` comes from the embed's `onStateChange`
  // postMessage, which is a best-effort channel: a blocked third-party frame, a
  // player API change, or a browser that drops the message all leave it `null`
  // forever. Treating `null` as "still playing" means precise metering when the
  // embed talks to us, and metering from the click when it does not, which is
  // how the locked prototype behaved.
  const meteringActive = playbackStarted && reportedPlaying !== false;

  // `budget.locked` cannot be part of this expression — it comes out of the very
  // hook being fed — so the Hard Stop case is covered from both sides instead:
  // the render adjustment below clears playback the moment the budget locks,
  // and `useShortsBudget` refuses to accrue against an exhausted budget anyway.
  const budget = useShortsBudget(acknowledged && meteringActive);

  // Derive the active Short: use selection if it exists in the list, otherwise fall back to first.
  // This handles both initial load (selection is null, use first) and refresh (selection may vanish).
  const activeShort =
    shorts.find((s) => s.videoId === selectedShortId) ?? shorts[0] ?? null;
  const activeShortId = activeShort?.videoId ?? null;
  const activeIndex = activeShort ? shorts.indexOf(activeShort) : -1;

  // Adjust state during render: reset playback when the budget locks, so the
  // Hard Stop cannot leave a stale metering signal behind.
  if (budget.locked && !lockedAtLastRender) {
    setLockedAtLastRender(true);
    setPlaybackStarted(false);
    setReportedPlaying(null);
  } else if (!budget.locked && lockedAtLastRender) {
    setLockedAtLastRender(false);
  }

  const handleContinueToShorts = useCallback(() => {
    setAcknowledged(true);
  }, []);

  // Moving to another Short discards the previous Short's reported state but
  // deliberately keeps `playbackStarted`: the embed is reused and autoplays the
  // new Short without a second click, so clearing it would silently stop
  // metering for the rest of the session.
  const forgetReportedPlaying = useCallback(() => {
    setReportedPlaying(null);
  }, []);

  const handleRetry = useCallback(() => {
    refreshShorts();
  }, [refreshShorts]);

  const handlePreviousShort = useCallback(() => {
    if (shorts.length === 0) return;
    const previousIndex =
      activeIndex <= 0 ? shorts.length - 1 : activeIndex - 1;
    setSelectedShortId(shorts[previousIndex].videoId);
    forgetReportedPlaying();
  }, [activeIndex, shorts, forgetReportedPlaying]);

  const handleNextShort = useCallback(() => {
    if (shorts.length === 0) return;
    const nextIndex = activeIndex >= shorts.length - 1 ? 0 : activeIndex + 1;
    setSelectedShortId(shorts[nextIndex].videoId);
    forgetReportedPlaying();
  }, [activeIndex, shorts, forgetReportedPlaying]);

  const handleSelectShort = useCallback(
    (videoId: string) => {
      setSelectedShortId(videoId);
      forgetReportedPlaying();
    },
    [forgetReportedPlaying],
  );

  const handlePlaybackStart = useCallback(() => {
    setPlaybackStarted(true);
    setReportedPlaying(null);
  }, []);

  const handlePlayingChange = useCallback((playing: boolean) => {
    setReportedPlaying(playing);
  }, []);

  // The embed refused this Short outright, so nothing is playing behind the
  // "Playback unavailable" card and the click must stop counting as playback.
  const handlePlaybackUnavailable = useCallback(() => {
    setPlaybackStarted(false);
    setReportedPlaying(null);
  }, []);

  const handleNearEnd = useCallback(() => {
    // Mark as watched when near the end.
    if (!activeShort) return;
    updateWatched(activeShort.videoId, true);
    void updateVideoWatched(activeShort.videoId, true).catch(() => {
      // Failure does not crash the page; local state already updated optimistically.
    });
  }, [activeShort, updateWatched]);

  const handleWatchedToggle = useCallback(
    (videoId: string, watched: boolean) => {
      updateWatched(videoId, watched);
      void updateVideoWatched(videoId, watched).catch(() => {
        // Failure does not crash the page; local state already updated optimistically.
      });
    },
    [updateWatched],
  );

  const handleWatchedToggleClick = useCallback(() => {
    if (!activeShort) return;
    handleWatchedToggle(activeShort.videoId, !activeShort.watched);
  }, [activeShort, handleWatchedToggle]);

  // Arrow key navigation: ArrowUp/Left → previous, ArrowDown/Right → next
  // Only active when viewing Shorts and not in Hard Stop state.
  useEffect(() => {
    if (!acknowledged || budget.locked || shorts.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if focus is in an editable field
      if (!(e.target instanceof HTMLElement)) return;
      const target = e.target as HTMLElement;
      const isInEditableField =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;

      if (isInEditableField) return;

      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePreviousShort();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        handleNextShort();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    acknowledged,
    budget.locked,
    shorts.length,
    handlePreviousShort,
    handleNextShort,
  ]);

  // Connection gate
  if (status === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!connected) {
    return <YouTubeConnectPrompt fallbackHref="/dashboard/youtube" />;
  }

  // The section navigation carries the page's visible identity; the h1 stays
  // for the document outline and is visually hidden on both variants, because
  // the shell draws the title.
  const header = (
    <div className="flex flex-col gap-5">
      <h1 className="sr-only">Shorts</h1>
      <YouTubeSectionNav current="shorts" variant={variant} />
    </div>
  );

  // Entry warning gate
  if (!acknowledged) {
    return (
      <div className={SHORTS_PAGE_CLASS}>
        {header}
        <div className="flex flex-1 items-center justify-center">
          <ShortsEntryWarning
            limitMs={budget.limitMs}
            remainingMs={budget.remainingMs}
            onContinue={handleContinueToShorts}
          />
        </div>
      </div>
    );
  }

  // Render budget meter in both active and locked states
  const meterSection = (
    <ShortsBudgetMeter
      spentMs={budget.spentMs}
      limitMs={budget.limitMs}
      remainingMs={budget.remainingMs}
      usedPercent={budget.usedPercent}
      locked={budget.locked}
      metering={budget.metering}
      onLimitMinutesChange={budget.setLimitMinutes}
    />
  );

  // Hard Stop: locked state
  if (budget.locked) {
    return (
      <div className={SHORTS_PAGE_CLASS}>
        {header}
        {meterSection}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
          <ShortsHardStop limitMs={budget.limitMs} />
        </div>
      </div>
    );
  }

  // Main content: player + navigation + list
  return (
    <div className={SHORTS_PAGE_CLASS}>
      {header}
      {meterSection}

      {/* Loading state */}
      {loading && !shorts.length ? (
        <div className="flex w-full max-w-sm flex-col gap-2">
          <Skeleton className="aspect-[340/604] rounded-panel" />
          <Skeleton className="h-11 w-full rounded-control" />
        </div>
      ) : error && !shorts.length ? (
        <div className="rounded-panel border border-destructive-edge bg-destructive-soft p-4 text-center">
          <p className="text-body-sm font-semibold text-destructive-text">
            Failed to load Shorts
          </p>
          <p className="mt-1 text-caption text-destructive-text">{error}</p>
          <Button onClick={handleRetry} variant="outline" className="mt-3">
            Retry
          </Button>
        </div>
      ) : shorts.length === 0 ? (
        <div className="rounded-panel border border-border bg-card p-8 text-center">
          <p className="font-display text-title text-foreground">
            No Shorts to Watch
          </p>
          <p className="mt-2 text-body-sm text-muted-foreground">
            None of your Enabled Channels have recent Shorts. Visit your
            long-form videos or check back later.
          </p>
        </div>
      ) : (
        // Desktop: player row beside the Up next aside from `lg`. Phone and
        // narrower desktops stack the player above the list.
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-center">
          <ShortsPlayerPanel
            activeShort={activeShort}
            activeIndex={activeIndex}
            shortsLength={shorts.length}
            remainingMs={budget.remainingMs}
            watched={activeShort?.watched ?? false}
            onNearEnd={handleNearEnd}
            onPlaybackStart={handlePlaybackStart}
            onPlayingChange={handlePlayingChange}
            onPlaybackUnavailable={handlePlaybackUnavailable}
            onPrevious={handlePreviousShort}
            onNext={handleNextShort}
            onWatchedToggle={handleWatchedToggleClick}
            variant={variant}
          />

          <ShortsList
            shorts={shorts}
            selectedShortId={activeShortId}
            onSelectShort={handleSelectShort}
          />
        </div>
      )}
    </div>
  );
}
