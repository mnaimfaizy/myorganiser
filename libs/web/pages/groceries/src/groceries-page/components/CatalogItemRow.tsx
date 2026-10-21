'use client';

import type { CatalogItem } from '@myorganiser/vault-core';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from '@myorganiser/web-ui';
import { MoreVertical, Pencil } from 'lucide-react';
import { useCallback, useState } from 'react';
import { formatMoney, pluralize } from '../../shared/utils';

export interface CatalogItemRowProps {
  item: CatalogItem;
  /** How many Grocery Lists currently carry this item. */
  listCount: number;
  /** True when there is no list to add to, or the item is already on every list. */
  addDisabled: boolean;
  /** True while a vault write is in flight; holds every action on the row. */
  busy: boolean;
  onAddToLists: (catalogItemId: string) => void;
  onEditItem: (catalogItemId: string) => void;
  onDeleteItem: (catalogItemId: string) => void;
}

/**
 * One Catalog Item. Phone stacks the name over a wrap row of price, list
 * status and actions; desktop lays the same parts out as one grid row. The
 * wrap row is `md:contents`, so on desktop its children are the grid cells.
 */
export function CatalogItemRow({
  item,
  listCount,
  addDisabled,
  busy,
  onAddToLists,
  onEditItem,
  onDeleteItem,
}: CatalogItemRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const priceLabel =
    typeof item.price === 'number' ? formatMoney(item.price) : null;

  const handleMenuOpenChange = useCallback((open: boolean) => {
    setMenuOpen(open);
  }, []);

  const handleAddToLists = useCallback(() => {
    onAddToLists(item.id);
  }, [item.id, onAddToLists]);

  const handleEdit = useCallback(() => {
    onEditItem(item.id);
  }, [item.id, onEditItem]);

  const handleDelete = useCallback(() => {
    setMenuOpen(false);
    onDeleteItem(item.id);
  }, [item.id, onDeleteItem]);

  return (
    <div className="flex flex-col gap-2 px-4 py-3 md:grid md:min-h-16 md:grid-cols-[minmax(0,2fr)_90px_minmax(0,1fr)_auto] md:items-center md:gap-4 md:py-0 md:pr-3 md:pl-4">
      <div className="flex min-w-0 flex-col">
        <span className="text-body text-foreground">{item.name}</span>
        <span className="truncate text-caption text-muted-foreground">
          {item.notes || 'No notes'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 md:contents">
        <span
          className={cn(
            'font-semibold tabular-nums md:text-right',
            priceLabel === null && 'text-warning-text',
          )}
        >
          {priceLabel ?? 'No price'}
        </span>
        <span
          className={cn(
            'inline-flex h-6 w-fit items-center rounded-full px-2.5 text-label-sm font-semibold',
            listCount > 0
              ? 'bg-brand-soft text-brand-text-strong'
              : 'bg-muted text-foreground-secondary',
          )}
        >
          {listCount > 0
            ? `On ${pluralize(listCount, 'list')}`
            : 'Not on a list'}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={addDisabled || busy}
            onClick={handleAddToLists}
          >
            Add to lists
          </Button>
          <IconButton
            variant="ghost"
            label={`Edit ${item.name}`}
            disabled={busy}
            onClick={handleEdit}
          >
            <Pencil aria-hidden="true" />
          </IconButton>
          <DropdownMenu open={menuOpen} onOpenChange={handleMenuOpenChange}>
            <DropdownMenuTrigger asChild>
              <IconButton
                variant="ghost"
                label={`More for ${item.name}`}
                disabled={busy}
              >
                <MoreVertical aria-hidden="true" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={handleDelete}>
                Delete from Catalog
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
