'use client';

import { Button, cn, useIsMobileState } from '@myorganiser/web-ui';
import { Check, Play, Plus } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { updateVideoWatched } from '../hooks';
import { formatPublishedAgo } from '../lib/formatPublishedAgo';
import { formatRuntimeSeconds } from '../lib/formatRuntimeSeconds';
import type { YouTubeVideo } from '../types';

interface UploadListItemProps {
  video: YouTubeVideo;
  index: number;
  tabIndex: number;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onPlay: (triggerElement: HTMLButtonElement) => void;
  onWatchedToggle?: (videoId: string, watched: boolean) => void;
  onAddToQueue?: (videoId: string) => void;
  isQueued: boolean;
  queueFull: boolean;
}

export const UploadListItem = React.forwardRef<
  HTMLDivElement,
  UploadListItemProps
>(
  (
    {
      video,
      onPlay,
      onWatchedToggle,
      onAddToQueue,
      isQueued,
      queueFull,
      tabIndex,
      onKeyDown,
    },
    ref,
  ) => {
    const isPhone = useIsMobileState() === true;
    const [watched, setWatched] = useState<boolean>(!!video.watched);
    const [updating, setUpdating] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const playButtonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
      setWatched(!!video.watched);
    }, [video.watched]);

    const publishedAgo = formatPublishedAgo(video.publishedAt);
    const durationLabel = formatRuntimeSeconds(video.durationSeconds);

    const youtubeWatchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(
      video.videoId,
    )}`;

    const handleToggleWatched = useCallback(
      async (e?: React.MouseEvent) => {
        e?.preventDefault();
        e?.stopPropagation();

        const nextWatched = !watched;
        const prevWatched = watched;

        setWatched(nextWatched);
        setUpdating(true);
        setError(null);

        try {
          const result = await updateVideoWatched(video.videoId, nextWatched);
          setWatched(result.watched);
          onWatchedToggle?.(video.videoId, result.watched);
        } catch {
          setWatched(prevWatched);
          setError('Failed to update status');
        } finally {
          setUpdating(false);
        }
      },
      [watched, video.videoId, onWatchedToggle],
    );

    const handlePlayClick = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        if (playButtonRef.current) {
          onPlay(playButtonRef.current);
        }
      },
      [onPlay],
    );

    const handleAddToQueue = useCallback(() => {
      onAddToQueue?.(video.videoId);
    }, [onAddToQueue, video.videoId]);

    const queueAriaLabel = isQueued
      ? `${video.title} is already queued`
      : queueFull
        ? `Queue is full — remove an upload to add ${video.title}`
        : `Add ${video.title} to queue`;

    const toggleWatchedButton = (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleToggleWatched}
        disabled={updating}
        className={cn(
          'h-[22px] shrink-0 rounded-full px-2.5 text-label-caps uppercase',
          watched
            ? 'bg-subtle text-subtle-foreground'
            : 'bg-brand-soft text-brand-text',
        )}
        aria-label={
          watched
            ? `Mark ${video.title} as new`
            : `Mark ${video.title} as watched`
        }
      >
        {watched ? 'Watched' : 'New'}
      </Button>
    );

    const title = (
      <h4 className="line-clamp-2 text-body-sm font-semibold text-foreground md:text-body">
        <a
          href={youtubeWatchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          {video.title}
        </a>
      </h4>
    );

    const errorNotice = error && (
      <p role="alert" className="basis-full text-caption text-destructive-text">
        {error}
      </p>
    );

    if (isPhone) {
      // One line per row: thumbnail (the play control), title and meta with
      // the watched pill inline, then a single 44px queue control.
      return (
        <div
          ref={ref}
          tabIndex={tabIndex}
          onKeyDown={onKeyDown}
          className="flex min-h-[72px] flex-wrap items-center gap-3 border-b border-subtle bg-raised-surface py-2.5 pl-4 pr-3 transition-colors last:border-b-0 focus-visible:bg-brand-soft focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus focus-visible:outline-none"
        >
          <button
            type="button"
            ref={playButtonRef}
            onClick={handlePlayClick}
            aria-label={`Play ${video.title} in app`}
            className="relative flex h-[50px] w-[88px] shrink-0 items-center justify-center overflow-hidden rounded-control-sm bg-navy text-navy-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
          >
            {video.thumbnail ? (
              <img
                src={video.thumbnail}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : null}
            <span
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center bg-navy/30"
            >
              <Play className="size-4 fill-current" />
            </span>
          </button>

          <div className="flex min-w-0 flex-[1_1_0] flex-col gap-1">
            {title}
            <div className="flex min-w-0 items-center gap-2 text-caption text-muted-foreground">
              <p className="min-w-0 truncate">
                <time dateTime={video.publishedAt}>{publishedAgo}</time>
                {durationLabel && <> · {durationLabel}</>}
              </p>
              {toggleWatchedButton}
            </div>
          </div>

          {onAddToQueue && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleAddToQueue}
              disabled={isQueued || queueFull}
              className="shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label={queueAriaLabel}
            >
              {isQueued ? (
                <Check aria-hidden="true" />
              ) : (
                <Plus aria-hidden="true" />
              )}
            </Button>
          )}

          {errorNotice}
        </div>
      );
    }

    const queueLabel = isQueued
      ? 'Queued'
      : queueFull
        ? 'Queue full'
        : '+ Queue';

    return (
      <div
        ref={ref}
        tabIndex={tabIndex}
        onKeyDown={onKeyDown}
        className="group flex min-h-[84px] flex-wrap items-center gap-3 border-b border-subtle bg-raised-surface py-2.5 pl-4 pr-3 transition-colors last:border-b-0 hover:bg-muted focus-visible:bg-brand-soft focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus focus-visible:outline-none"
      >
        {/* Thumbnail */}
        <div className="flex h-[63px] w-[112px] shrink-0 items-center justify-center overflow-hidden rounded-control-sm bg-navy text-navy-foreground">
          {video.thumbnail ? (
            <img
              src={video.thumbnail}
              alt={video.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <Play aria-hidden="true" className="size-4" />
          )}
        </div>

        {/* Content */}
        <div className="flex min-w-0 flex-[1_1_180px] flex-col gap-0.5">
          {title}
          {(publishedAgo || durationLabel) && (
            <p className="truncate text-caption text-muted-foreground">
              <time dateTime={video.publishedAt}>{publishedAgo}</time>
              {durationLabel && <> · {durationLabel}</>}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {toggleWatchedButton}

          {onAddToQueue && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddToQueue}
              disabled={isQueued || queueFull}
              className="h-9 px-3.5 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label={queueAriaLabel}
            >
              {queueLabel}
            </Button>
          )}

          <Button
            type="button"
            ref={playButtonRef}
            variant="ghost"
            size="sm"
            onClick={handlePlayClick}
            className="size-10 bg-brand-soft p-0 text-brand-text hover:bg-brand-soft"
            aria-label={`Play ${video.title} in app`}
          >
            <Play />
          </Button>
        </div>

        {errorNotice}
      </div>
    );
  },
);
UploadListItem.displayName = 'UploadListItem';
