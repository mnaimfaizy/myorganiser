'use client';

import type { GroceryList } from '@myorganiser/vault-core';
import type { GroceryListPageController } from '../hooks/use-grocery-list-page';
import { AddExistingItemDialog } from './AddExistingItemDialog';
import { AddItemDialog } from './AddItemDialog';
import { CatalogItemEditDialog } from './CatalogItemEditDialog';
import { DeleteCatalogItemDialog } from './DeleteCatalogItemDialog';
import { ListLineEditDialog } from './ListLineEditDialog';
import { DeleteListConfirmDialog } from '../../groceries-page/components/DeleteListConfirmDialog';
import { RenameListDialog } from '../../groceries-page/components/RenameListDialog';

interface GroceryListDialogsProps {
  list: GroceryList;
  page: GroceryListPageController;
}

/** Every dialog the Grocery List detail page can open, shared by both breakpoints. */
export function GroceryListDialogs({ list, page }: GroceryListDialogsProps) {
  const linePendingItem = page.linePendingEdit
    ? page.catalog.find(
        (item) => item.id === page.linePendingEdit?.catalogItemId,
      )
    : undefined;

  return (
    <>
      <AddItemDialog
        isOpen={page.isAddItemOpen}
        onClose={page.closeAddItem}
        onAdd={page.submitAddItem}
        isLoading={page.isBusy}
        catalog={page.catalog}
        listName={list.name}
        initialName={page.addItemInitialName}
      />
      <AddExistingItemDialog
        isOpen={page.isAddExistingOpen}
        onClose={page.closeAddExisting}
        catalog={page.catalog}
        lists={page.allLists}
        defaultListId={list.id}
        onAdd={page.submitAddExisting}
        isLoading={page.isBusy}
      />
      <DeleteCatalogItemDialog
        isOpen={page.catalogItemPendingDelete !== null}
        catalogItem={page.catalogItemPendingDelete}
        affectedListCount={page.affectedListCount}
        onClose={page.closeDeleteCatalog}
        onConfirm={page.confirmDeleteCatalog}
        isLoading={page.isBusy}
      />
      <CatalogItemEditDialog
        item={page.catalogItemPendingEdit}
        isOpen={page.catalogItemPendingEdit !== null}
        onClose={page.closeCatalogEdit}
        onSave={page.submitCatalogEdit}
        isLoading={page.isBusy}
      />
      <ListLineEditDialog
        line={page.linePendingEdit}
        catalogItem={linePendingItem}
        isOpen={page.linePendingEdit !== null}
        onClose={page.closeLineEdit}
        onSave={page.submitLineEdit}
        isLoading={page.isBusy}
      />
      <RenameListDialog
        isOpen={page.isRenameOpen}
        currentName={list.name}
        onClose={page.closeRename}
        onSubmit={page.submitRename}
        isLoading={page.isBusy}
      />
      <DeleteListConfirmDialog
        isOpen={page.isDeleteListOpen}
        listName={list.name}
        itemCount={list.lines.length}
        onClose={page.closeDeleteList}
        onConfirm={page.confirmDeleteList}
        isLoading={page.isBusy}
      />
    </>
  );
}
