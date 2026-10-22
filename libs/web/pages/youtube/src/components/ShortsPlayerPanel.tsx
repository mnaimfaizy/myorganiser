'use client';

import { Button } from '@myorganiser/web-ui';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from 'lucide-react';
import type { YouTubeLayoutVariant, YouTubeVideo } from '../types';
import { formatRuntimeSeconds } from '../lib/formatRuntimeSeconds';
import { formatPublishedAgo } from '../lib/formatPublishedAgo';
import { YouTubeVideoPlayer } from './YouTubeVideoPlayer';

interface ShortsPlayerPanelProps {
  activeShort: YouTubeVideo | null;
  activeIndex: number;
  shortsLength: number;
  remainingMs: number;
  /** Share of today's Shorts budget used, 0–100. Drives the phone stage's progress bar. */
  usedPercent?: number;
  watched?: boolean;
  onNearEnd?: () => void;
  /** The User pressed Play. Fires from the click itself, not from the embed. */
  onPlaybackStart?: () => void;
  /** The embed reported a playback state transition. May never fire. */
  onPlayingChange?: (playing: boolean) => void;
  /** The embed refused to play this Short at all. */
  onPlaybackUnavailable?: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onWatchedToggle: () => void;
  /**
   * Phone is a dark stage with the navigation under the Short; desktop is a
   * centred column with Previous and Next flanking the player. Defaults to
   * desktop, which is also what renders while the breakpoint is unknown.
   */
  variant?: YouTubeLayoutVariant;
}

/**
 * Portrait 9:16 player panel with title/channel block, Watched toggle,
 * Prev/Next navigation, and position indicator.
 *
 * Desktop draws Previous and Next as round buttons flanking the player, with
 * the runtime and "N of M" as pills on the player. Phone draws the player on a
 * navy stage, with runtime and position on the meta line and Previous, the
 * Watched toggle and Next in a row beneath.
 *
 * Renders the budget consequence warning when the next Short exceeds remaining
 * time.
 */
export function ShortsPlayerPanel({
  activeShort,
  activeIndex,
  shortsLength,
  remainingMs,
  usedPercent = 0,
  watched = false,
  onNearEnd,
  onPlaybackStart,
  onPlayingChange,
  onPlaybackUnavailable,
  onPrevious,
  onNext,
  onWatchedToggle,
  variant = 'desktop',
}: ShortsPlayerPanelProps) {
  if (!activeShort) {
    return null;
  }

  const isPhone = variant === 'phone';
  const runtime = formatRuntimeSeconds(activeShort.durationSeconds) || null;
  const runtimeMs =
    activeShort.durationSeconds != null
      ? activeShort.durationSeconds * 1000
      : null;
  const position = `${activeIndex >= 0 ? activeIndex + 1 : 0} of ${shortsLength}`;
  const publishedAgo = formatPublishedAgo(activeShort.publishedAt);
  const remainingMin = Math.ceil(remainingMs / 60_000);
  const barPercent = Math.min(Math.max(usedPercent, 0), 100);
  const watchedLabel = watched ? 'Mark as New' : 'Mark watched';

  const budgetWarning =
    runtimeMs != null && runtimeMs > remainingMs
      ? 'This Short is longer than the time you have left today'
      : null;

  // Portrait 9:16 player; the 340×604 artboard size is an aspect ratio, not a
  // fixed box, so it shrinks with the column.
  const player = (
    <div className="relative aspect-[340/604] w-full overflow-hidden rounded-panel bg-navy">
      <YouTubeVideoPlayer
        video={activeShort}
        watched={watched}
        onNearEnd={onNearEnd}
        onPlay={onPlaybackStart}
        onPlayingChange={onPlayingChange}
        onPlaybackUnavailable={onPlaybackUnavailable}
        defaultPlaying={false}
        className="h-full w-full"
      />
      {!isPhone && runtime && (
        <span className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-navy-raised px-2.5 py-1 text-caption font-semibold tabular-nums text-navy-foreground">
          {runtime}
        </span>
      )}
      {!isPhone && (
        <span
          className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-full bg-navy-raised px-2.5 py-1 text-caption font-semibold tabular-nums text-navy-foreground"
          aria-live="polite"
          aria-atomic="true"
        >
          {position}
        </span>
      )}
    </div>
  );

  const details = isPhone ? (
    <div className="flex min-w-0 flex-col gap-1">
      <h2 className="font-display text-title">{activeShort.title}</h2>
      <p className="flex flex-wrap items-center gap-x-1.5 text-caption text-navy-muted-foreground">
        <span>{activeShort.channelTitle}</span>
        {runtime && (
          <>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{runtime}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span aria-live="polite" aria-atomic="true">
          {position}
        </span>
      </p>
    </div>
  ) : (
    <div className="flex min-w-0 flex-col gap-1">
      <h2 className="font-display text-title">{activeShort.title}</h2>
      <p className="flex flex-wrap items-center gap-x-1.5 text-caption text-muted-foreground">
        <span>{activeShort.channelTitle}</span>
        {publishedAgo && (
          <>
            <span aria-hidden="true">·</span>
            <span>{publishedAgo}</span>
          </>
        )}
      </p>
    </div>
  );

  const budgetWarningBlock = budgetWarning && (
    <p className="rounded-control-sm bg-warning-soft p-2 text-caption text-warning-text">
      {budgetWarning}
    </p>
  );

  if (isPhone) {
    return (
      <div className="flex flex-col gap-3 rounded-panel bg-navy p-3 text-navy-foreground">
        <div className="flex flex-col gap-2">
          <p className="text-body-sm font-semibold text-warning-edge">
            {remainingMin} min left today
          </p>
          <div
            role="progressbar"
            aria-valuenow={usedPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${usedPercent}% of daily Shorts budget used`}
            className="h-1.5 overflow-hidden rounded-full bg-navy-raised"
          >
            <div
              className="h-full rounded-full bg-warning-edge transition-all duration-300 motion-reduce:transition-none"
              style={{ width: `${barPercent}%` }}
            />
          </div>
        </div>
        {player}
        {details}
        {budgetWarningBlock}
        <div className="grid grid-cols-[48px_1fr_48px] gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onPrevious}
            aria-label="Previous Short"
            className="h-12 w-full border border-navy-raised text-navy-foreground hover:bg-navy-raised"
          >
            <ChevronUp />
          </Button>
          <Button
            variant="ghost"
            onClick={onWatchedToggle}
            className="h-12 w-full rounded-control bg-navy-raised text-navy-foreground hover:bg-navy-raised"
          >
            {watchedLabel}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onNext}
            aria-label="Next Short"
            className="h-12 w-full border border-navy-raised text-navy-foreground hover:bg-navy-raised"
          >
            <ChevronDown />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="flex items-center justify-center gap-4">
        <Button
          variant="outline"
          size="icon"
          onClick={onPrevious}
          aria-label="Previous Short"
          className="size-12 rounded-full"
        >
          <ChevronLeft />
        </Button>

        <div className="flex w-[340px] max-w-full flex-col gap-3">
          {player}
          {details}
          {budgetWarningBlock}
          <Button
            variant="ghost"
            onClick={onWatchedToggle}
            className="h-11 w-full rounded-control bg-muted text-foreground hover:bg-border-subtle"
          >
            {watchedLabel}
          </Button>
        </div>

        <Button
          variant="outline"
          size="icon"
          onClick={onNext}
          aria-label="Next Short"
          className="size-12 rounded-full"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
