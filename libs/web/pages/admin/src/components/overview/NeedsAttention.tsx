'use client';

import Link from 'next/link';
import * as React from 'react';

import { Button } from '@myorganiser/web-ui';

import type { AdminOverviewResponse } from '@myorganiser/app-api-client';

import {
  ATTENTION_HREF,
  type AttentionRow,
  attentionTone,
  deriveAttentionRows,
  desktopAttentionCopy,
} from '../../lib/overview';
import { AttentionDot } from './AttentionDot';

export interface NeedsAttentionProps {
  overview: AdminOverviewResponse;
}

/**
 * The desktop Needs attention list. Count-based: each row shows only when its
 * condition holds, and the whole section is absent when none does.
 */
export function NeedsAttention({ overview }: NeedsAttentionProps) {
  const headingId = React.useId();
  const rows = deriveAttentionRows(overview);

  if (rows.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="hidden flex-col gap-3 md:flex"
    >
      <div className="flex items-center gap-2.5">
        <h2 id={headingId} className="font-display text-title text-foreground">
          Needs attention
        </h2>
        <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-caption font-semibold text-warning-text">
          {rows.length}
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-raised-surface">
        {rows.map((row) => (
          <AttentionItem key={row.id} row={row} />
        ))}
      </ul>
    </section>
  );
}

interface AttentionItemProps {
  row: AttentionRow;
}

function AttentionItem({ row }: AttentionItemProps) {
  const copy = desktopAttentionCopy(row);

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <AttentionDot tone={attentionTone(row)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-body-sm font-semibold text-foreground">
          {copy.title}
        </span>
        <span className="text-caption text-muted-foreground">
          {copy.detail}
        </span>
      </div>
      <Button
        asChild
        variant="outline"
        size="sm"
        className="shrink-0 rounded-control px-3"
      >
        <Link href={ATTENTION_HREF}>{copy.action}</Link>
      </Button>
    </li>
  );
}
