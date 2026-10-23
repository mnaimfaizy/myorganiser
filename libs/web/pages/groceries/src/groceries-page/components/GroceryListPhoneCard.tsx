'use client';

import type { CatalogItem, GroceryList } from '@myorganiser/vault-core';
import { Progress } from '@myorganiser/web-ui';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import type { ListProgress, ListSpendSummary } from '../../shared/utils';
import {
  formatMoney,
  summarizeListProgress,
  summarizeListSpend,
} from '../../shared/utils';

export interface GroceryListPhoneCardProps {
  list: GroceryList;
  catalog: CatalogItem[];
}

/** The sub-line under a phone list's name: what is checked, unpriced, or done. */
function phoneSubline(progress: ListProgress, spend: ListSpendSummary): string {
  if (progress.total === 0) return 'Nothing on it yet';
  if (progress.allBought) return 'All bought · Uncheck All to reuse';
  if (spend.unpricedCount > 0) {
    return `${progress.checked} of ${progress.total} · ${spend.unpricedCount} unpriced`;
  }
  return `${progress.checked} of ${progress.total} checked`;
}

/** One Grocery List on the phone lists stack. The whole card is the link into the list. */
export function GroceryListPhoneCard({
  list,
  catalog,
}: GroceryListPhoneCardProps) {
  const spend = useMemo(
    () => summarizeListSpend(list.lines, catalog),
    [catalog, list.lines],
  );
  const progress = useMemo(
    () => summarizeListProgress(list.lines),
    [list.lines],
  );

  return (
    <Link
      href={`/dashboard/groceries/${list.id}`}
      className="flex flex-col gap-2.5 rounded-panel border border-border bg-card px-4 py-3.5 text-foreground"
    >
      <span className="flex items-center gap-2.5">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-display text-body font-bold">{list.name}</span>
          <span className="text-caption text-muted-foreground">
            {phoneSubline(progress, spend)}
          </span>
        </span>
        <span className="font-semibold tabular-nums">
          {formatMoney(spend.known)}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-3 text-subtle-foreground"
        />
      </span>
      {progress.total > 0 && (
        <Progress
          value={progress.checked}
          max={progress.total}
          tone={progress.allBought ? 'success' : 'brand'}
          aria-label={`${list.name} progress`}
          className="h-1.5"
        />
      )}
    </Link>
  );
}
