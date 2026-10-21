'use client';

import { Button, Illustration } from '@myorganiser/web-ui';
import { Plus } from 'lucide-react';
import type { GroceriesLayout } from '../../shared/utils';
import { formatMoney, pluralize } from '../../shared/utils';
import type { GroceriesTab } from './GroceriesTabs';

const CATALOG_SUMMARY =
  'Your Catalog keeps names, prices and notes so every list can reuse them.';

export interface GroceriesHeaderProps {
  /** Desktop shows the illustration, title, and action; phone shows the summary only. */
  variant: GroceriesLayout;
  tab: GroceriesTab;
  listCount: number;
  knownSpend: number;
  unpricedCount: number;
  onNewList: () => void;
  onNewCatalogItem: () => void;
}

/** The Lists summary, worded for the breakpoint the header renders at. */
function listsSummary(
  variant: GroceriesLayout,
  listCount: number,
  knownSpend: number,
  unpricedCount: number,
): string {
  const head = `${pluralize(listCount, 'list')} · ${formatMoney(knownSpend)} known`;
  if (variant === 'phone') return head;
  const spend = `${head} spend`;
  return unpricedCount > 0
    ? `${spend} · ${pluralize(unpricedCount, 'item')} unpriced`
    : spend;
}

/**
 * The Groceries page heading. On phone the app shell already draws the large
 * title and illustration, so the `<h1>` is kept for the document outline but
 * visually hidden, and the page's FAB replaces the action button.
 */
export function GroceriesHeader({
  variant,
  tab,
  listCount,
  knownSpend,
  unpricedCount,
  onNewList,
  onNewCatalogItem,
}: GroceriesHeaderProps) {
  const isLists = tab === 'lists';
  const summary = isLists
    ? listsSummary(variant, listCount, knownSpend, unpricedCount)
    : CATALOG_SUMMARY;

  if (variant === 'phone') {
    return (
      <div>
        <h1 className="sr-only">Groceries</h1>
        <p className="text-body-sm text-muted-foreground">{summary}</p>
      </div>
    );
  }

  const handleNew = isLists ? onNewList : onNewCatalogItem;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Illustration kind="groceries" size={64} />
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="m-0 font-display text-title-lg text-foreground">
          Groceries
        </h1>
        <p className="text-body text-muted-foreground">{summary}</p>
      </div>
      <Button variant="brand" onClick={handleNew}>
        <Plus aria-hidden="true" />
        {isLists ? 'New list' : 'New Catalog Item'}
      </Button>
    </div>
  );
}
