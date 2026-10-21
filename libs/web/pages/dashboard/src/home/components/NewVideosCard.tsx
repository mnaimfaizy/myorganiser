import { Play } from 'lucide-react';
import Link from 'next/link';

import type { HomeVideoRow, YouTubeState } from '../home-view';

export interface NewVideosCardProps {
  state: YouTubeState;
  rows: readonly HomeVideoRow[];
}

/** Up to three recent uploads, each opening on YouTube in a new tab. */
export function NewVideosCard({ state, rows }: NewVideosCardProps) {
  return (
    <section
      aria-labelledby="home-new-videos-title"
      className="flex flex-col rounded-panel border border-border bg-raised-surface p-5"
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2
          id="home-new-videos-title"
          className="m-0 font-display text-title text-foreground"
        >
          New videos
        </h2>
        <Link
          href="/dashboard/youtube"
          className="text-caption font-semibold text-brand-text"
        >
          YouTube
        </Link>
      </div>
      <VideoBody state={state} rows={rows} />
    </section>
  );
}

function VideoBody({ state, rows }: NewVideosCardProps) {
  if (state.status === 'loading') {
    return <p className="m-0 text-body-sm text-muted-foreground">Loading…</p>;
  }
  if (state.status === 'disconnected') {
    return (
      <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-body-sm text-muted-foreground">
        YouTube is not connected.
        <Link
          href="/dashboard/youtube"
          className="font-semibold text-brand-text"
        >
          Connect YouTube
        </Link>
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <p className="m-0 text-body-sm text-muted-foreground">
        Could not load videos. Try again later.
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="m-0 text-body-sm text-muted-foreground">
        No videos yet. Sync your subscriptions to see recent uploads.
      </p>
    );
  }
  return (
    <ul className="m-0 list-none p-0">
      {rows.map((row) => (
        <li key={row.videoId} className="border-t border-border-subtle">
          <a
            href={row.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[60px] items-center gap-3 text-foreground no-underline"
          >
            <span
              aria-hidden="true"
              className="flex h-[42px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-navy-raised"
            >
              {row.thumbnail ? (
                // Thumbnails come from YouTube's CDN; alt is empty because the title beside it names the video.
                <img
                  src={row.thumbnail}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
              ) : (
                <Play className="size-3.5 fill-current text-navy-foreground" />
              )}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-body-sm text-foreground">
                {row.title}
              </span>
              <span className="truncate text-caption text-muted-foreground">
                {row.meta}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
