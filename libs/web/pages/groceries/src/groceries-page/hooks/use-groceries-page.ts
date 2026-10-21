'use client';

import type { CatalogItem } from '@myorganiser/vault-core';
import { useToast } from '@myorganiser/web-ui';
import type { VaultHandle } from '@myorganiser/web-vault';
import { useCallback, useMemo, useState } from 'react';
import type {
  AddItemFormResult,
  CatalogItemEditChanges,
} from '../../groceries-list-detail/components';
import { useGroceriesErrorToast, useGroceriesVault } from '../../shared/hooks';
import type { AddCatalogItemAndLineInput } from '../../shared/hooks';
import {
  countListsPerCatalogItem,
  summarizeListSpend,
} from '../../shared/utils';

/** The list dialog currently open on the Groceries page, if any. */
export type ListDialogState =
  | { type: 'create' }
  | { type: 'rename'; listId: string; listName: string }
  | { type: 'delete'; listId: string; listName: string; itemCount: number }
  | null;

/** Maps the Add Item form onto the catalog-only input the vault accepts. */
function toCatalogInput(values: AddItemFormResult): AddCatalogItemAndLineInput {
  return {
    name: values.name,
    category: values.category,
    ...(values.catalogItemId ? { catalogItemId: values.catalogItemId } : {}),
    ...(values.price !== undefined ? { price: values.price } : {}),
    ...(values.notes ? { notes: values.notes } : {}),
    ...(values.imageUrl ? { imageUrl: values.imageUrl } : {}),
    ...(values.links ? { links: values.links } : {}),
  };
}

/**
 * The Groceries index behaviour: loads and writes through
 * `useGroceriesVault`, owns the dialog state for both tabs, and reports each
 * outcome with a toast. Plaintext stays in browser memory; this hook decides
 * what to save and what to say about it. The tab and the catalog filter are
 * UI state and live in the components that render them.
 */
export function useGroceriesPage(handle: VaultHandle) {
  const { toast } = useToast();
  const showErrorToast = useGroceriesErrorToast();
  const vault = useGroceriesVault({ handle });
  const { lists, catalog } = vault;

  const [listDialog, setListDialog] = useState<ListDialogState>(null);
  const [addExistingCatalogItemId, setAddExistingCatalogItemId] = useState<
    string | null
  >(null);
  const [isAddCatalogOpen, setIsAddCatalogOpen] = useState(false);
  const [catalogItemToEdit, setCatalogItemToEdit] =
    useState<CatalogItem | null>(null);
  const [catalogItemToDelete, setCatalogItemToDelete] =
    useState<CatalogItem | null>(null);
  const [pendingWrites, setPendingWrites] = useState(0);

  /** Counts a vault write as in flight until it settles, so the UI can hold its actions. */
  const trackWrite = useCallback(<T>(write: () => Promise<T>): Promise<T> => {
    setPendingWrites((count) => count + 1);
    return write().finally(() => setPendingWrites((count) => count - 1));
  }, []);

  const dismissError = useCallback(() => {
    vault.setError(null);
  }, [vault.setError]);

  // ---- Grocery Lists -------------------------------------------------------

  const openCreateList = useCallback(() => {
    setListDialog({ type: 'create' });
  }, []);

  const closeListDialog = useCallback(() => {
    setListDialog(null);
  }, []);

  const requestRenameList = useCallback(
    (listId: string) => {
      const list = lists.find((candidate) => candidate.id === listId);
      if (list) {
        setListDialog({ type: 'rename', listId, listName: list.name });
      }
    },
    [lists],
  );

  const requestDeleteList = useCallback(
    (listId: string) => {
      const list = lists.find((candidate) => candidate.id === listId);
      if (list) {
        setListDialog({
          type: 'delete',
          listId,
          listName: list.name,
          itemCount: list.lines.length,
        });
      }
    },
    [lists],
  );

  const submitCreateList = useCallback(
    async (name: string) => {
      await trackWrite(() => vault.createList(name));
      setListDialog(null);
    },
    [trackWrite, vault.createList],
  );

  const submitRenameList = useCallback(
    async (newName: string) => {
      if (listDialog?.type !== 'rename') return;
      await trackWrite(() => vault.renameList(listDialog.listId, newName));
      setListDialog(null);
    },
    [listDialog, trackWrite, vault.renameList],
  );

  const confirmDeleteList = useCallback(async () => {
    if (listDialog?.type !== 'delete') return;
    await trackWrite(() => vault.deleteList(listDialog.listId));
    setListDialog(null);
  }, [listDialog, trackWrite, vault.deleteList]);

  const uncheckAllLines = useCallback(
    async (listId: string) => {
      try {
        await trackWrite(() => vault.uncheckAllLines(listId));
      } catch (err) {
        console.error('Failed to uncheck all lines:', err);
        showErrorToast();
      }
    },
    [showErrorToast, trackWrite, vault.uncheckAllLines],
  );

  // ---- Catalog -------------------------------------------------------------

  const openAddCatalogItem = useCallback(() => {
    setIsAddCatalogOpen(true);
  }, []);

  const closeAddCatalogItem = useCallback(() => {
    setIsAddCatalogOpen(false);
  }, []);

  const submitAddCatalogItem = useCallback(
    async (values: AddItemFormResult) => {
      try {
        await trackWrite(() =>
          vault.addItemToLists([], toCatalogInput(values)),
        );
        toast({ title: 'Added to catalog' });
      } catch (err) {
        console.error('Failed to add catalog item:', err);
        showErrorToast();
        throw err;
      }
    },
    [showErrorToast, toast, trackWrite, vault.addItemToLists],
  );

  const openAddExistingItem = useCallback((catalogItemId: string) => {
    setAddExistingCatalogItemId(catalogItemId);
  }, []);

  const closeAddExistingItem = useCallback(() => {
    setAddExistingCatalogItemId(null);
  }, []);

  const submitAddExistingItem = useCallback(
    async (catalogItemId: string, listIds: string[], amount?: string) => {
      try {
        const addedListIds = await trackWrite(() =>
          vault.addExistingCatalogItemToLists(catalogItemId, listIds, amount),
        );

        if (addedListIds.length === 0) {
          toast({ title: 'Already on every selected list.' });
        } else if (addedListIds.length === listIds.length) {
          toast({
            title: 'Added to lists',
            description: `Added to ${addedListIds.length} list${addedListIds.length !== 1 ? 's' : ''}.`,
          });
        } else {
          toast({
            title: 'Added to lists',
            description: `Added to ${addedListIds.length} of ${listIds.length} lists (already on the rest).`,
          });
        }

        return addedListIds;
      } catch (err) {
        console.error('Failed to add existing catalog item to lists:', err);
        showErrorToast();
        throw err;
      }
    },
    [showErrorToast, toast, trackWrite, vault.addExistingCatalogItemToLists],
  );

  const openEditCatalogItem = useCallback(
    (catalogItemId: string) => {
      setCatalogItemToEdit(
        catalog.find((item) => item.id === catalogItemId) ?? null,
      );
    },
    [catalog],
  );

  const closeEditCatalogItem = useCallback(() => {
    setCatalogItemToEdit(null);
  }, []);

  const submitEditCatalogItem = useCallback(
    async (changes: CatalogItemEditChanges) => {
      try {
        await trackWrite(() => vault.updateCatalogItem(changes));
        setCatalogItemToEdit(null);
      } catch (err) {
        console.error('Failed to update catalog item:', err);
        showErrorToast();
        throw err;
      }
    },
    [showErrorToast, trackWrite, vault.updateCatalogItem],
  );

  const openDeleteCatalogItem = useCallback(
    (catalogItemId: string) => {
      setCatalogItemToDelete(
        catalog.find((item) => item.id === catalogItemId) ?? null,
      );
    },
    [catalog],
  );

  const closeDeleteCatalogItem = useCallback(() => {
    setCatalogItemToDelete(null);
  }, []);

  const confirmDeleteCatalogItem = useCallback(async () => {
    if (!catalogItemToDelete) return;
    try {
      await trackWrite(() => vault.deleteCatalogItem(catalogItemToDelete.id));
      toast({
        title: `Deleted "${catalogItemToDelete.name}" from Catalog`,
      });
    } catch (err) {
      console.error('Failed to delete catalog item:', err);
      showErrorToast();
    } finally {
      setCatalogItemToDelete(null);
    }
  }, [
    catalogItemToDelete,
    showErrorToast,
    toast,
    trackWrite,
    vault.deleteCatalogItem,
  ]);

  // ---- Derived -------------------------------------------------------------

  const spend = useMemo(
    () =>
      lists.reduce(
        (acc, list) => {
          const summary = summarizeListSpend(list.lines, catalog);
          acc.known += summary.known;
          acc.unpriced += summary.unpricedCount;
          return acc;
        },
        { known: 0, unpriced: 0 },
      ),
    [catalog, lists],
  );

  const listCountsByItem = useMemo(
    () => countListsPerCatalogItem(lists),
    [lists],
  );

  const affectedListCount = catalogItemToDelete
    ? (listCountsByItem.get(catalogItemToDelete.id) ?? 0)
    : 0;

  return {
    lists,
    catalog,
    loading: vault.loading,
    /** True while any vault write from this page is in flight. */
    writing: pendingWrites > 0,
    error: vault.error,
    dismissError,
    spend,
    listCountsByItem,
    affectedListCount,
    uncheckAllLines,
    listDialog,
    openCreateList,
    closeListDialog,
    requestRenameList,
    requestDeleteList,
    submitCreateList,
    submitRenameList,
    confirmDeleteList,
    addExistingCatalogItemId,
    openAddExistingItem,
    closeAddExistingItem,
    submitAddExistingItem,
    isAddCatalogOpen,
    openAddCatalogItem,
    closeAddCatalogItem,
    submitAddCatalogItem,
    catalogItemToEdit,
    openEditCatalogItem,
    closeEditCatalogItem,
    submitEditCatalogItem,
    catalogItemToDelete,
    openDeleteCatalogItem,
    closeDeleteCatalogItem,
    confirmDeleteCatalogItem,
  };
}

export type GroceriesPageController = ReturnType<typeof useGroceriesPage>;
