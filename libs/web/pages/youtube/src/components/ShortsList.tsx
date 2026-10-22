'use client';

import type { YouTubeVideo } from '../types';
import { formatRuntimeSeconds } from '../lib/formatRuntimeSeconds';

interface ShortsListProps {
  shorts: YouTubeVideo[];
  selectedShortId: string | null;
  onSelectShort: (videoId: string) => void;
}

/**
 * "Up next" picker for the Shorts page, labelled "All Shorts".
 *
 * One row definition, rendered once. The two layouts — a horizontal scroller
 * below `lg`, a vertical side rail at `lg` and up — are a pure CSS concern, so
 * there is a single place where a row's fields, accessible name, and Watched
 * state live. Maintaining a second breakpoint-specific copy is how the mobile
 * rendering previously drifted into dropping runtime and weakening its label.
 *
 * Accessibility: every row is a `type="button"` with an explicit accessible
 * name covering title, channel, and Watched/New; the active row carries
 * `aria-current`; thumbnails are decorative (`alt=""`) inside the labelled
 * button; and Watched state is conveyed as text, never by colour alone.
 */
export function ShortsList({
  shorts,
  selectedShortId,
  onSelectShort,
}: ShortsListProps) {
  if (shorts.length === 0) return null;

  return (
    <aside
      aria-label="All Shorts"
      className="flex min-w-0 flex-col gap-2 rounded-panel border border-border bg-card p-3.5 lg:w-[300px] lg:flex-shrink-0"
    >
      <h2
        id="shorts-list-heading"
        className="mb-1 text-label-caps text-muted-foreground"
      >
        UP NEXT · {shorts.length}
      </h2>
      <div
        aria-labelledby="shorts-list-heading"
        className="flex gap-2 overflow-x-auto lg:max-h-[70vh] lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto"
      >
        {shorts.map((short) => {
          const isActive = selectedShortId === short.videoId;
          const runtime = formatRuntimeSeconds(short.durationSeconds);
          const watchedLabel = short.watched ? ' (Watched)' : ' (New)';
          const accessibleName = `${short.title}, ${short.channelTitle}${watchedLabel}`;

          return (
            <button
              key={short.videoId}
              type="button"
              onClick={() => onSelectShort(short.videoId)}
              aria-current={isActive ? 'true' : undefined}
              aria-label={accessibleName}
              className={`flex w-32 flex-shrink-0 flex-col gap-2 overflow-hidden rounded-control p-1.5 text-left transition-colors motion-reduce:transition-none lg:w-auto lg:flex-row lg:items-center lg:gap-2.5 ${
                isActive ? 'bg-brand-soft' : 'hover:bg-muted'
              }`}
            >
              <span className="block aspect-video w-full flex-shrink-0 overflow-hidden rounded-control-sm bg-muted lg:aspect-auto lg:h-[70px] lg:w-10">
                {short.thumbnail ? (
                  <img
                    src={short.thumbnail}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="line-clamp-2 block text-body-sm font-semibold text-foreground">
                  {short.title}
                </span>
                <span className="flex flex-wrap items-center gap-x-1.5 text-caption text-muted-foreground">
                  <span>{short.channelTitle}</span>
                  {runtime ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{runtime}</span>
                    </>
                  ) : null}
                  <span aria-hidden="true">·</span>
                  {short.watched ? (
                    <span>Watched</span>
                  ) : (
                    <span className="rounded-full bg-brand-soft px-2 text-label-sm font-semibold text-brand-text">
                      New
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
