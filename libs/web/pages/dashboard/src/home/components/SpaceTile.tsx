'use client';

import { Illustration } from '@myorganiser/web-ui';
import Link from 'next/link';
import { useId } from 'react';

import type { HomeSpace } from '../home-view';
import { HomeStatePill } from './HomeStatePill';

export interface SpaceTileProps {
  space: HomeSpace;
}

/**
 * One space on phone, in the two-column grid. The link is named by its title,
 * meta and pill, in that order, whatever the DOM order of the pill.
 */
export function SpaceTile({ space }: SpaceTileProps) {
  const id = useId();
  const labelIds = [`${id}-title`, `${id}-meta`];
  if (space.phonePill) labelIds.push(`${id}-pill`);

  return (
    <Link
      href={space.href}
      aria-labelledby={labelIds.join(' ')}
      className="flex flex-col gap-2 rounded-panel border border-border bg-raised-surface p-3.5 text-foreground no-underline"
    >
      <span className="flex items-start justify-between gap-2">
        <Illustration kind={space.kind} size={48} />
        {space.phonePill && (
          <span id={`${id}-pill`}>
            <HomeStatePill pill={space.phonePill} surface="phone" />
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          id={`${id}-title`}
          className="truncate text-body-sm font-semibold text-foreground"
        >
          {space.title}
        </span>
        <span
          id={`${id}-meta`}
          className="truncate text-caption text-muted-foreground"
        >
          {space.meta}
        </span>
      </span>
    </Link>
  );
}
