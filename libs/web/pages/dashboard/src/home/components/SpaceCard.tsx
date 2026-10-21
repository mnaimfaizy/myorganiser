'use client';

import { Illustration } from '@myorganiser/web-ui';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useId } from 'react';

import type { HomeSpace } from '../home-view';
import { HomeStatePill } from './HomeStatePill';

export interface SpaceCardProps {
  space: HomeSpace;
}

/**
 * One space on desktop. The link is named by its visible title, summary and
 * pill, in that order, so the name reads "Tasks, 12 open, 4 due today" whatever
 * the DOM order of the pill. "Open" is hidden from the name.
 */
export function SpaceCard({ space }: SpaceCardProps) {
  const id = useId();
  const labelIds = [`${id}-title`, `${id}-summary`];
  if (space.pill) labelIds.push(`${id}-pill`);

  return (
    <Link
      href={space.href}
      aria-labelledby={labelIds.join(' ')}
      className="flex flex-col gap-3.5 rounded-panel border border-border bg-raised-surface p-5 text-foreground no-underline shadow-card"
    >
      <span className="flex items-start justify-between gap-2">
        <Illustration kind={space.kind} size={64} />
        {space.pill && (
          <span id={`${id}-pill`}>
            <HomeStatePill pill={space.pill} surface="desktop" />
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span
          id={`${id}-title`}
          className="font-display text-title text-foreground"
        >
          {space.title}
        </span>
        <span
          id={`${id}-summary`}
          className="text-body-sm text-muted-foreground"
        >
          {space.summary}
        </span>
      </span>
      <span
        aria-hidden="true"
        className="inline-flex items-center gap-1.5 text-body-sm font-semibold text-brand-text"
      >
        Open
        <ChevronRight aria-hidden="true" className="size-3" />
      </span>
    </Link>
  );
}
