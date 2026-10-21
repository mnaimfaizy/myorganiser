'use client';

import { Button, Skeleton, useIsMobileState } from '@myorganiser/web-ui';
import type { VaultHandle } from '@myorganiser/web-vault';
import { VaultGate } from '@myorganiser/web-vault-ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import {
  AddExistingItemDialog,
  AddItemDialog,
  CatalogItemEditDialog,
  DeleteCatalogItemDialog,
} from '../groceries-list-detail/components';
import {
  CatalogPanel,
  CreateListDialog,
  DeleteListConfirmDialog,
  GroceriesHeader,
  GroceriesTabs,
  groceriesPanelId,
  groceriesTabId,
  GroceryListsPanel,
  RenameListDialog,
  VaultErrorBanner,
} from './components';
import type { GroceriesTab } from './components';
import type { GroceriesLayout } from '../shared/utils';
import { useGroceriesPage } from './hooks/use-groceries-page';

interface GroceriesInnerProps {
  handle: VaultHandle;
}

function GroceriesInner({ handle }: GroceriesInnerProps) {
  const page = useGroceriesPage(handle);
  const [tab, setTab] = useState<GroceriesTab>('lists');
  // Render nothing until the breakpoint is decided, so a phone never paints
  // the desktop layout on the first frame.
  const isPhone = useIsMobileState();

  if (isPhone === undefined) {
    return null;
  }

  if (page.loading) {
    return (
      <div
        className="min-h-screen bg-background"
        aria-busy="true"
        aria-label="Loading groceries list"
      >
        <div className="mx-auto flex max-w-300 flex-col gap-6 p-4 md:p-8">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-panel" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const { listDialog } = page;
  const listCount = page.lists.length;
  const variant: GroceriesLayout = isPhone ? 'phone' : 'desktop';
  const handleNewRequest =
    tab === 'lists' ? page.openCreateList : page.openAddCatalogItem;

  const errorBanner = page.error ? (
    <VaultErrorBanner message={page.error} onDismiss={page.dismissError} />
  ) : null;

  // Both panels stay mounted so every tab's aria-controls resolves; the
  // inactive one is hidden.
  const tabPanel = (
    <>
      <div
        role="tabpanel"
        id={groceriesPanelId('lists')}
        aria-labelledby={groceriesTabId('lists')}
        tabIndex={0}
        hidden={tab !== 'lists'}
      >
        <GroceryListsPanel
          variant={variant}
          lists={page.lists}
          catalog={page.catalog}
          onNewList={page.openCreateList}
          onRenameList={page.requestRenameList}
          onDeleteList={page.requestDeleteList}
          onUncheckAll={page.uncheckAllLines}
        />
      </div>
      <div
        role="tabpanel"
        id={groceriesPanelId('catalog')}
        aria-labelledby={groceriesTabId('catalog')}
        tabIndex={0}
        hidden={tab !== 'catalog'}
      >
        <CatalogPanel
          catalog={page.catalog}
          listCount={listCount}
          listCountsByItem={page.listCountsByItem}
          busy={page.writing}
          onAddToLists={page.openAddExistingItem}
          onEditItem={page.openEditCatalogItem}
          onDeleteItem={page.openDeleteCatalogItem}
        />
      </div>
    </>
  );

  const content = isPhone ? (
    <div className="flex flex-col gap-3.5 px-4 pt-1 pb-24">
      {errorBanner}
      <GroceriesHeader
        variant="phone"
        tab={tab}
        listCount={listCount}
        knownSpend={page.spend.known}
        unpricedCount={page.spend.unpriced}
        onNewList={page.openCreateList}
        onNewCatalogItem={page.openAddCatalogItem}
      />
      <GroceriesTabs
        variant="phone"
        tab={tab}
        listCount={listCount}
        catalogCount={page.catalog.length}
        onTabChange={setTab}
      />
      {tabPanel}
      <Button
        variant="brand"
        onClick={handleNewRequest}
        className="fixed right-4 bottom-[calc(var(--toast-offset,0px)+1rem)] z-10 h-14 rounded-fab px-5 shadow-brand"
      >
        <Plus aria-hidden="true" />
        {tab === 'lists' ? 'New list' : 'New Catalog Item'}
      </Button>
    </div>
  ) : (
    <div className="mx-auto flex w-full max-w-300 flex-col gap-6 p-8">
      {errorBanner}
      <GroceriesHeader
        variant="desktop"
        tab={tab}
        listCount={listCount}
        knownSpend={page.spend.known}
        unpricedCount={page.spend.unpriced}
        onNewList={page.openCreateList}
        onNewCatalogItem={page.openAddCatalogItem}
      />
      <GroceriesTabs
        variant="desktop"
        tab={tab}
        listCount={listCount}
        catalogCount={page.catalog.length}
        onTabChange={setTab}
      />
      {tabPanel}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {content}

      <CreateListDialog
        isOpen={listDialog?.type === 'create'}
        onClose={page.closeListDialog}
        onSubmit={page.submitCreateList}
        isLoading={page.loading}
      />

      {listDialog?.type === 'rename' && (
        <RenameListDialog
          isOpen={true}
          currentName={listDialog.listName}
          onClose={page.closeListDialog}
          onSubmit={page.submitRenameList}
          isLoading={page.loading}
        />
      )}

      {listDialog?.type === 'delete' && (
        <DeleteListConfirmDialog
          isOpen={true}
          listName={listDialog.listName}
          itemCount={listDialog.itemCount}
          onClose={page.closeListDialog}
          onConfirm={page.confirmDeleteList}
          isLoading={page.loading}
        />
      )}

      <AddExistingItemDialog
        isOpen={page.addExistingCatalogItemId !== null}
        onClose={page.closeAddExistingItem}
        catalog={page.catalog}
        lists={page.lists}
        defaultCatalogItemId={page.addExistingCatalogItemId ?? undefined}
        onAdd={page.submitAddExistingItem}
        isLoading={page.loading}
      />

      <AddItemDialog
        isOpen={page.isAddCatalogOpen}
        onClose={page.closeAddCatalogItem}
        onAdd={page.submitAddCatalogItem}
        isLoading={page.loading}
        catalog={page.catalog}
        mode="catalog"
      />

      <CatalogItemEditDialog
        item={page.catalogItemToEdit}
        isOpen={page.catalogItemToEdit !== null}
        onClose={page.closeEditCatalogItem}
        onSave={page.submitEditCatalogItem}
        isLoading={page.loading}
      />

      <DeleteCatalogItemDialog
        isOpen={page.catalogItemToDelete !== null}
        catalogItem={page.catalogItemToDelete}
        affectedListCount={page.affectedListCount}
        onClose={page.closeDeleteCatalogItem}
        onConfirm={page.confirmDeleteCatalogItem}
        isLoading={page.loading}
      />
    </div>
  );
}

export function GroceriesPageClient() {
  return (
    <VaultGate title="Groceries">
      {({ handle }) => (handle ? <GroceriesInner handle={handle} /> : null)}
    </VaultGate>
  );
}
