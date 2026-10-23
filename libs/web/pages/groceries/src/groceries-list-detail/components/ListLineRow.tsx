'use client';

import type { CatalogItem, ListLine } from '@myorganiser/vault-core';
import { Checkbox, IconButton, cn } from '@myorganiser/web-ui';
import { Pencil } from 'lucide-react';
import { useCallback } from 'react';
import { UNKNOWN_ITEM_NAME, formatMoney } from '../../shared/utils';
import type { GroceriesLayout } from '../../shared/utils';
import type { GroceryListLineActions } from '../hooks/use-grocery-list-page';
import { ListLineMenu } from './ListLineMenu';

interface ListLineRowProps {
  line: ListLine;
  item: CatalogItem | undefined;
  variant: GroceriesLayout;
  isBusy: boolean;
  actions: GroceryListLineActions;
}

/**
 * One List Line. Desktop puts the amount button and menu on the row; phone
 * makes the whole label a 44px-tall checkbox target and keeps every action in
 * the menu.
 */
export function ListLineRow({
  line,
  item,
  variant,
  isBusy,
  actions,
}: ListLineRowProps) {
  const name = item?.name ?? UNKNOWN_ITEM_NAME;
  const price = item?.price;
  const unpriced = typeof price !== 'number';

  const metaParts: string[] = [];
  if (line.amount) metaParts.push(line.amount);
  if (typeof price === 'number') metaParts.push(formatMoney(price));
  if (item?.notes) metaParts.push(item.notes);

  const handleToggle = useCallback(() => {
    actions.onToggleChecked(line.id);
  }, [actions, line.id]);

  const handleEditAmount = useCallback(() => {
    actions.onEditLine(line.id);
  }, [actions, line.id]);

  const checkbox = (
    <Checkbox
      checked={line.checked}
      onCheckedChange={handleToggle}
      disabled={isBusy}
      aria-label={`Bought ${name}`}
      className="shrink-0"
    />
  );

  const body = (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span
        className={cn(
          'text-body text-foreground',
          line.checked && 'text-muted-foreground line-through',
        )}
      >
        {name}
      </span>
      {metaParts.length > 0 || unpriced ? (
        <span className="text-caption text-muted-foreground">
          {metaParts.join(' · ')}
          {unpriced ? (
            <span className="font-semibold text-warning-text">
              {metaParts.length > 0 ? ' · ' : ''}No price
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );

  const menu = (
    <ListLineMenu
      name={name}
      lineId={line.id}
      catalogItemId={item?.id}
      showEditAmount={variant === 'phone'}
      isBusy={isBusy}
      onEditLine={actions.onEditLine}
      onEditCatalogItem={actions.onEditCatalogItem}
      onRemoveLine={actions.onRemoveLine}
      onRequestDeleteFromCatalog={actions.onRequestDeleteFromCatalog}
    />
  );

  if (variant === 'phone') {
    return (
      <div
        data-testid={`list-line-${line.id}`}
        className="flex items-center gap-1 pr-2"
      >
        <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 py-2 pl-4">
          {checkbox}
          {body}
        </label>
        {menu}
      </div>
    );
  }

  return (
    <div
      data-testid={`list-line-${line.id}`}
      className="flex min-h-16 items-center gap-3 py-2.5 pr-2 pl-4"
    >
      {checkbox}
      {body}
      <IconButton
        variant="ghost"
        label={`Edit amount for ${name}`}
        icon={<Pencil />}
        onClick={handleEditAmount}
        disabled={isBusy}
      />
      {menu}
    </div>
  );
}
