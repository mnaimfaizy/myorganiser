'use client';

import type { CatalogItem, GroceryList } from '@myorganiser/vault-core';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Progress,
} from '@myorganiser/web-ui';
import { Check, ChevronRight, MoreVertical } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { GroceryCategoryIllustration } from '../../shared/components';
import {
  formatListActivity,
  formatMoney,
  resolveCatalogItem,
  UNKNOWN_ITEM_NAME,
  summarizeListProgress,
  summarizeListSpend,
  toKnownCategory,
} from '../../shared/utils';

/** How many open items a card names before it falls back to "+n more". */
const STILL_TO_BUY_LIMIT = 4;

export interface GroceryListCardProps {
  list: GroceryList;
  catalog: CatalogItem[];
  onRenameList: (listId: string) => void;
  onDeleteList: (listId: string) => void;
  onUncheckAll: (listId: string) => void;
}

/** One Grocery List on the desktop lists grid: spend, progress, what is left to buy. */
export function GroceryListCard({
  list,
  catalog,
  onRenameList,
  onDeleteList,
  onUncheckAll,
}: GroceryListCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const spend = useMemo(
    () => summarizeListSpend(list.lines, catalog),
    [catalog, list.lines],
  );
  const progress = useMemo(
    () => summarizeListProgress(list.lines),
    [list.lines],
  );
  const openLines = useMemo(
    () => list.lines.filter((line) => !line.checked),
    [list.lines],
  );
  const shownOpenLines = openLines.slice(0, STILL_TO_BUY_LIMIT);
  const moreCount = openLines.length - shownOpenLines.length;
  const href = `/dashboard/groceries/${list.id}`;

  const handleMenuOpenChange = useCallback((open: boolean) => {
    setMenuOpen(open);
  }, []);

  const handleRename = useCallback(() => {
    setMenuOpen(false);
    onRenameList(list.id);
  }, [list.id, onRenameList]);

  const handleDelete = useCallback(() => {
    setMenuOpen(false);
    onDeleteList(list.id);
  }, [list.id, onDeleteList]);

  const handleUncheckAll = useCallback(() => {
    onUncheckAll(list.id);
  }, [list.id, onUncheckAll]);

  return (
    <article className="flex flex-col gap-3.5 rounded-panel border border-border bg-card p-5 shadow-card">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="m-0 min-w-0 font-display text-title text-foreground">
            <Link href={href} className="no-underline">
              {list.name}
            </Link>
          </h2>
          <span className="text-caption text-muted-foreground">
            {formatListActivity(list)}
          </span>
        </div>
        <DropdownMenu open={menuOpen} onOpenChange={handleMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <IconButton variant="ghost" label={`Actions for ${list.name}`}>
              <MoreVertical aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={handleRename}>
              Rename list
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={handleDelete}>
              Delete Grocery List…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {progress.total > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-title-lg font-extrabold tabular-nums text-foreground">
              {formatMoney(spend.known)}
            </span>
            <span
              className={cn(
                'text-caption font-semibold',
                spend.unpricedCount > 0
                  ? 'text-warning-text'
                  : 'text-muted-foreground',
              )}
            >
              {spend.unpricedCount > 0
                ? `${spend.unpricedCount} unpriced`
                : 'all priced'}
            </span>
          </div>
          <Progress
            value={progress.checked}
            max={progress.total}
            tone={progress.allBought ? 'success' : 'brand'}
            aria-label={`${list.name} progress`}
          />
          <span className="text-caption text-foreground-secondary">
            {`${progress.checked} of ${progress.total} checked · ${progress.left} left`}
          </span>
        </div>
      )}

      {!progress.allBought && openLines.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-label-caps text-muted-foreground">
            STILL TO BUY
          </span>
          <div className="flex flex-wrap gap-1.5">
            {shownOpenLines.map((line) => {
              const item = resolveCatalogItem(line, catalog);
              return (
                <span
                  key={line.id}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-muted px-2.5 text-caption text-foreground-secondary"
                >
                  <GroceryCategoryIllustration
                    category={toKnownCategory(item?.category)}
                    size={20}
                  />
                  {item?.name ?? UNKNOWN_ITEM_NAME}
                </span>
              );
            })}
            {moreCount > 0 && (
              <span className="inline-flex h-7 items-center px-1.5 text-caption text-muted-foreground">
                {`+${moreCount} more`}
              </span>
            )}
          </div>
        </div>
      )}

      {progress.allBought && (
        <div className="flex items-center gap-2.5 rounded-control bg-success-faint px-3 py-2.5">
          <Check aria-hidden="true" className="size-4 shrink-0 text-success" />
          <span className="flex-1 text-caption text-success-text">
            All bought. Uncheck All to use it again.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="border-success-edge bg-card text-success-text"
            onClick={handleUncheckAll}
          >
            Uncheck All
          </Button>
        </div>
      )}

      {progress.total === 0 && (
        <div className="flex flex-col items-start gap-2 rounded-menu border border-dashed border-border-strong p-3.5">
          <span className="font-semibold text-body-sm text-foreground">
            Nothing on this list yet
          </span>
          <span className="text-caption text-muted-foreground">
            Add what you need, or pick from your Catalog.
          </span>
          <Button asChild size="sm">
            <Link href={href}>Add items</Link>
          </Button>
        </div>
      )}

      <Link
        href={href}
        className="mt-auto inline-flex items-center gap-1.5 text-body-sm font-semibold text-brand-text"
      >
        Open list
        <ChevronRight aria-hidden="true" className="size-3" />
      </Link>
    </article>
  );
}
