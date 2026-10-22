'use client';

import { Button } from '@myorganiser/web-ui';
import { X } from 'lucide-react';
import { useCallback } from 'react';
import type { YouTubeVideo } from '../types';
import { YouTubeVideoPlayer } from './YouTubeVideoPlayer';

interface ActivePlayerPanelProps {
  activeVideoId: string;
  video?: YouTubeVideo;
  /** The channel the player was opened from, for the section's name. */
  channelTitle: string;
  onClose: () => void;
  onNearEnd: () => void;
}

export function ActivePlayerPanel({
  activeVideoId,
  video,
  channelTitle,
  onClose,
  onNearEnd,
}: ActivePlayerPanelProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  if (!video) return null;

  return (
    <section
      aria-label={`Playing from ${channelTitle}`}
      onKeyDown={handleKeyDown}
      className="flex flex-col overflow-hidden rounded-panel border border-border bg-raised-surface lg:sticky lg:top-2 lg:z-10"
    >
      <YouTubeVideoPlayer
        key={activeVideoId}
        video={video}
        watched={video.watched ?? false}
        onNearEnd={onNearEnd}
        defaultPlaying
      />
      <div className="flex items-start justify-between gap-3 p-4">
        <h3 className="text-body font-semibold text-foreground">
          {video.title}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="size-9 shrink-0 p-0"
          aria-label="Close player"
        >
          <X />
        </Button>
      </div>
    </section>
  );
}
