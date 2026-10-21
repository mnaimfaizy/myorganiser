'use client';

import Link from 'next/link';
import * as React from 'react';

import type { AdminOverviewResponse } from '@myorganiser/app-api-client';
import { cn } from '@myorganiser/web-ui';
import { ChevronRight } from 'lucide-react';

import {
  ATTENTION_HREF,
  type AttentionRow,
  attentionTone,
  deriveAttentionRows,
  phoneAttentionCopy,
} from '../../lib/overview';

export interface PhoneNeedsAttentionProps {
  overview: AdminOverviewResponse;
}

/**
 * The phone Needs attention list: each row is a whole link with a chevron.
 * Hidden from md up, where the desktop list takes over.
 */
export function PhoneNeedsAttention({ overview }: PhoneNeedsAttentionProps) {
  const headingId = React.useId();
  const rows = deriveAttentionRows(overview);

  if (rows.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 md:hidden"
    >
      <h2 id={headingId} className="text-label-caps text-muted-foreground">
        {`NEEDS ATTENTION · ${rows.length}`}
      </h2>
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-panel border border-border bg-raised-surface">
        {rows.map((row) => (
          <PhoneAttentionItem key={row.id} row={row} />
        ))}
      </ul>
    </section>
  );
}

interface PhoneAttentionItemProps {
  row: AttentionRow;
}

function PhoneAttentionItem({ row }: PhoneAttentionItemProps) {
  const copy = phoneAttentionCopy(row);

  return (
    <li>
      <Link
        href={ATTENTION_HREF}
        className="flex min-h-11 items-center gap-3 px-4 py-3"
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-2.5 shrink-0 rounded-full',
            attentionTone(row) === 'danger' ? 'bg-destructive' : 'bg-warning',
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-sm font-semibold text-foreground">
            {copy.title}
          </span>
          <span className="truncate text-caption text-muted-foreground">
            {copy.detail}
          </span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      </Link>
    </li>
  );
}
