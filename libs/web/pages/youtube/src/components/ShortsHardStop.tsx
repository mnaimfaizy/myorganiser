'use client';

import { Button } from '@myorganiser/web-ui';
import Link from 'next/link';
import { formatShortsDuration } from '../lib/shortsBudget';

interface ShortsHardStopProps {
  limitMs: number;
}

/**
 * Locked surface shown when the Shorts Daily Budget is exhausted.
 *
 * This is the anti-escape surface: it explains that today's budget is spent
 * and Shorts unlock at local midnight. The only actionable CTA is to return
 * to long-form videos. No player, no Short thumbnails, no video ids, and no
 * "Open on YouTube" links — nothing that links to youtube.com.
 *
 * Announced with role="status" and aria-live="polite" so assistive tech
 * announces the state when the page enters Hard Stop.
 */
export function ShortsHardStop({ limitMs }: ShortsHardStopProps) {
  return (
    <div
      className="flex w-full max-w-md flex-col items-center justify-center gap-4 rounded-panel border border-warning-edge bg-warning-faint p-8 text-center"
      role="status"
      aria-live="polite"
      aria-label="Shorts budget exhausted"
    >
      <div className="rounded-full bg-warning-soft p-4">
        <svg
          className="size-12 text-warning"
          fill="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" />
        </svg>
      </div>

      <div className="flex max-w-sm flex-col gap-2 text-center">
        <h2 className="font-display text-title text-warning-text">
          Today's Shorts Budget Is Exhausted
        </h2>
        <p className="text-body-sm text-warning-text">
          You've watched {formatShortsDuration(limitMs)} of Shorts today.
        </p>
        <p className="text-body-sm text-warning-text">
          Shorts will be available again at midnight local time.
        </p>
        <p className="text-caption text-warning-text">
          Raising your daily time limit gives you time back today immediately.
        </p>
      </div>

      <Button asChild className="mt-2">
        <Link href="/dashboard/youtube">Back to Videos</Link>
      </Button>
    </div>
  );
}
