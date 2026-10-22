'use client';

import { Button, cn } from '@myorganiser/web-ui';
import { ChevronDown, ChevronUp, Play, Trash2 } from 'lucide-react';
import { useCallback } from 'react';
import type { YouTubeVideo } from '../types';

interface QueueRailItemProps {
  video: YouTubeVideo;
  index: number;
  isCurrentlyPlaying: boolean;
  focusedRowIndex: number;
  onRegisterPlayButton: (index: number, el: HTMLButtonElement | null) => void;
  onPlay: (videoId: string) => void;
  onRemove: (videoId: string) => void;
  onMoveUp: (videoId: string) => void;
  onMoveDown: (videoId: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => void;
  queueLength: number;
}

export function QueueRailItem({
  video,
  index,
  isCurrentlyPlaying,
  focusedRowIndex,
  onRegisterPlayButton,
  onPlay,
  onRemove,
  onMoveUp,
  onMoveDown,
  onKeyDown,
  queueLength,
}: QueueRailItemProps) {
  const handlePlayClick = useCallback(() => {
    onPlay(video.videoId);
  }, [video.videoId, onPlay]);

  const handleRemoveClick = useCallback(() => {
    onRemove(video.videoId);
  }, [video.videoId, onRemove]);

  const handleMoveUpClick = useCallback(() => {
    onMoveUp(video.videoId);
  }, [video.videoId, onMoveUp]);

  const handleMoveDownClick = useCallback(() => {
    onMoveDown(video.videoId);
  }, [video.videoId, onMoveDown]);

  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      onKeyDown(e, index);
    },
    [index, onKeyDown],
  );

  const handleRegisterPlayButton = useCallback(
    (el: HTMLButtonElement | null) => {
      onRegisterPlayButton(index, el);
    },
    [index, onRegisterPlayButton],
  );

  const watchedState = video.watched ? 'Watched' : 'New';
  const canMoveUp = index > 0;
  const canMoveDown = index < queueLength - 1;

  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-control border p-2 transition-colors motion-reduce:transition-none',
        isCurrentlyPlaying
          ? 'border-brand bg-brand-soft'
          : 'border-border bg-raised-surface hover:bg-muted',
      )}
      aria-current={isCurrentlyPlaying ? 'true' : undefined}
    >
      <div className="relative shrink-0">
        {video.thumbnail ? (
          <img
            src={video.thumbnail}
            alt=""
            className="h-10 w-[72px] rounded-control-sm object-cover"
          />
        ) : (
          <div className="flex h-10 w-[72px] items-center justify-center rounded-control-sm bg-muted text-muted-foreground">
            <span aria-hidden="true">▶</span>
          </div>
        )}
        {isCurrentlyPlaying && (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-control-sm bg-navy/60"
            aria-hidden="true"
          >
            <span className="text-caption font-semibold text-navy-foreground">
              Playing
            </span>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="min-w-0">
          <p className="line-clamp-1 text-body-sm font-semibold text-foreground">
            {video.title}
          </p>
          <p className="flex min-w-0 items-center gap-1 text-caption text-muted-foreground">
            {isCurrentlyPlaying && (
              <span className="shrink-0 font-semibold text-brand-text">
                Now playing
              </span>
            )}
            {isCurrentlyPlaying && video.channelTitle && (
              <span aria-hidden="true">·</span>
            )}
            {video.channelTitle && (
              <span className="line-clamp-1 min-w-0">{video.channelTitle}</span>
            )}
            {!isCurrentlyPlaying && (
              <span className="shrink-0">{watchedState}</span>
            )}
          </p>
        </div>

        <div className="-ml-2 flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleMoveUpClick}
            disabled={!canMoveUp}
            className="size-9 p-0 text-muted-foreground hover:text-foreground disabled:opacity-40"
            aria-label={`Move ${video.title} up`}
            title={canMoveUp ? `Move ${video.title} up` : 'Cannot move up'}
          >
            <ChevronUp />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleMoveDownClick}
            disabled={!canMoveDown}
            className="size-9 p-0 text-muted-foreground hover:text-foreground disabled:opacity-40"
            aria-label={`Move ${video.title} down`}
            title={
              canMoveDown ? `Move ${video.title} down` : 'Cannot move down'
            }
          >
            <ChevronDown />
          </Button>

          <Button
            ref={handleRegisterPlayButton}
            type="button"
            variant="ghost"
            size="sm"
            onClick={handlePlayClick}
            onKeyDown={handleRowKeyDown}
            tabIndex={focusedRowIndex === index ? 0 : -1}
            className="size-9 p-0 text-brand-text hover:text-brand-text-strong"
            aria-label={`Play ${video.title}`}
          >
            <Play />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRemoveClick}
            className="size-9 p-0 text-muted-foreground hover:text-destructive-text"
            aria-label={`Remove ${video.title} from queue`}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
    </li>
  );
}
