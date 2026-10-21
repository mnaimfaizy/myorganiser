'use client';

import type { CatalogItem, GroceryList } from '@myorganiser/vault-core';
import type { GroceriesLayout } from '../../shared/utils';
import { GroceryListCard } from './GroceryListCard';
import { GroceryListPhoneCard } from './GroceryListPhoneCard';
import { NewListTile } from './NewListTile';

const NO_LISTS_TITLE = 'No grocery lists yet';
const NO_LISTS_HINT =
  'Create your first list to get started organizing your shopping.';

export interface GroceryListsPanelProps {
  variant: GroceriesLayout;
  lists: GroceryList[];
  catalog: CatalogItem[];
  onNewList: () => void;
  onRenameList: (listId: string) => void;
  onDeleteList: (listId: string) => void;
  onUncheckAll: (listId: string) => void;
}

/**
 * The Lists tab body. Desktop is a grid of cards closed by the New list tile;
 * with no lists it also carries the copy above the tile. Phone is a stack of
 * links with the same copy when empty; the page's FAB creates the first list.
 */
export function GroceryListsPanel({
  variant,
  lists,
  catalog,
  onNewList,
  onRenameList,
  onDeleteList,
  onUncheckAll,
}: GroceryListsPanelProps) {
  const isEmpty = lists.length === 0;

  if (variant === 'phone') {
    if (isEmpty) {
      return (
        <div className="flex flex-col gap-1">
          <p className="font-semibold text-body text-foreground">
            {NO_LISTS_TITLE}
          </p>
          <p className="text-body-sm text-muted-foreground">{NO_LISTS_HINT}</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-2.5">
        {lists.map((list) => (
          <GroceryListPhoneCard key={list.id} list={list} catalog={catalog} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {isEmpty && (
        <div role="status" className="flex flex-col gap-1">
          <p className="font-semibold text-body text-foreground">
            {NO_LISTS_TITLE}
          </p>
          <p className="text-body-sm text-muted-foreground">{NO_LISTS_HINT}</p>
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {lists.map((list) => (
          <GroceryListCard
            key={list.id}
            list={list}
            catalog={catalog}
            onRenameList={onRenameList}
            onDeleteList={onDeleteList}
            onUncheckAll={onUncheckAll}
          />
        ))}
        <NewListTile onNewList={onNewList} />
      </div>
    </div>
  );
}
