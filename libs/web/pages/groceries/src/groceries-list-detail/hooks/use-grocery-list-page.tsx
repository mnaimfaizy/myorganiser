'use client';

import type {
  CatalogItem,
  GroceryList,
  ListLine,
} from '@myorganiser/vault-core';
import type { VaultHandle } from '@myorganiser/web-vault';
import { ToastAction, useToast } from '@myorganiser/web-ui';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { useGroceriesErrorToast, useGroceriesVault } from '../../shared/hooks';
import {
  countListsPerCatalogItem,
  groupLinesByCategory,
  summarizeListProgress,
  summarizeListSpend,
} from '../../shared/utils';
import type {
  CategoryGroup,
  ListProgress,
  ListSpendSummary,
  ResolvedLine,
} from '../../shared/utils';
import type { AddItemFormResult } from '../components/AddItemDialog';
import type { CatalogItemEditChanges } from '../components/CatalogItemEditDialog';

const GROCERIES_HREF = '/dashboard/groceries';
const EMPTY_LINES: ListLine[] = [];

/** Per-line actions a List Line row can raise. Every member is a memoized handler. */
export interface GroceryListLineActions {
  onToggleChecked: (lineId: string) => void;
  onEditLine: (lineId: string) => void;
  onEditCatalogItem: (catalogItemId: string) => void;
  onRemoveLine: (lineId: string) => void;
  onRequestDeleteFromCatalog: (catalogItemId: string) => void;
}

/** Everything the Grocery List detail views and dialogs read or call. */
export interface GroceryListPageController {
  loading: boolean;
  list: GroceryList | undefined;
  catalog: CatalogItem[];
  allLists: GroceryList[];
  /** A vault write is in flight. */
  isBusy: boolean;
  /** The list was deleted and the page is navigating away. */
  isLeaving: boolean;
  summary: ListSpendSummary;
  progress: ListProgress;
  openGroups: CategoryGroup[];
  checkedLines: ResolvedLine[];
  listCatalogIds: ReadonlySet<string>;
  /** Grocery Lists per Catalog Item, this list included. */
  listCounts: ReadonlyMap<string, number>;
  lineActions: GroceryListLineActions;
  onUncheckAll: () => void;
  onRemoveChecked: () => void;
  onAddFromCatalog: (catalogItemId: string) => void;

  isAddItemOpen: boolean;
  addItemInitialName: string | undefined;
  openAddItem: () => void;
  openAddItemNamed: (name: string) => void;
  closeAddItem: () => void;
  submitAddItem: (values: AddItemFormResult) => Promise<void>;

  isAddExistingOpen: boolean;
  openAddExisting: () => void;
  closeAddExisting: () => void;
  submitAddExisting: (
    catalogItemId: string,
    listIds: string[],
    amount?: string,
  ) => Promise<void>;

  isAddSheetOpen: boolean;
  openAddSheet: () => void;
  closeAddSheet: () => void;

  isRenameOpen: boolean;
  openRename: () => void;
  closeRename: () => void;
  submitRename: (newName: string) => Promise<void>;

  isDeleteListOpen: boolean;
  openDeleteList: () => void;
  closeDeleteList: () => void;
  confirmDeleteList: () => Promise<void>;

  catalogItemPendingDelete: CatalogItem | null;
  affectedListCount: number;
  closeDeleteCatalog: () => void;
  confirmDeleteCatalog: () => Promise<void>;

  linePendingEdit: ListLine | null;
  closeLineEdit: () => void;
  submitLineEdit: (changes: { id: string; amount?: string }) => Promise<void>;

  catalogItemPendingEdit: CatalogItem | null;
  closeCatalogEdit: () => void;
  submitCatalogEdit: (changes: CatalogItemEditChanges) => Promise<void>;
}

/**
 * Orchestration for one Grocery List detail page: vault reads and writes,
 * the toasts that report them, and which dialog is open. The views below it
 * only render and raise these handlers.
 */
export function useGroceryListPage(
  listId: string,
  handle: VaultHandle,
): GroceryListPageController {
  const router = useRouter();
  const { toast } = useToast();
  const vault = useGroceriesVault({ handle });
  const {
    toggleLineChecked,
    uncheckAllLines,
    removeCheckedLines,
    restoreLines,
    deleteListLine,
    addCatalogItemAndLine,
    addExistingCatalogItemToLists,
    deleteCatalogItem,
    updateCatalogItem,
    updateListLine,
    renameList,
    deleteList,
  } = vault;

  const [isBusy, setIsBusy] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [addItemInitialName, setAddItemInitialName] = useState<
    string | undefined
  >(undefined);
  const [isAddExistingOpen, setIsAddExistingOpen] = useState(false);
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteListOpen, setIsDeleteListOpen] = useState(false);
  const [catalogItemPendingDelete, setCatalogItemPendingDelete] =
    useState<CatalogItem | null>(null);
  const [linePendingEdit, setLinePendingEdit] = useState<ListLine | null>(null);
  const [catalogItemPendingEdit, setCatalogItemPendingEdit] =
    useState<CatalogItem | null>(null);

  const catalog = vault.catalog;
  const allLists = vault.lists;
  const list = allLists.find((entry) => entry.id === listId);
  const lines = list?.lines ?? EMPTY_LINES;

  const summary = useMemo(
    () => summarizeListSpend(lines, catalog),
    [lines, catalog],
  );
  const progress = useMemo(() => summarizeListProgress(lines), [lines]);
  const openGroups = useMemo(
    () =>
      groupLinesByCategory(
        lines.filter((line) => !line.checked),
        catalog,
      ),
    [lines, catalog],
  );
  const checkedLines = useMemo<ResolvedLine[]>(() => {
    const byId = new Map(catalog.map((item) => [item.id, item] as const));
    return lines
      .filter((line) => line.checked)
      .map((line) => ({ line, item: byId.get(line.catalogItemId) }));
  }, [lines, catalog]);
  const listCatalogIds = useMemo<ReadonlySet<string>>(
    () => new Set(lines.map((line) => line.catalogItemId)),
    [lines],
  );
  const listCounts = useMemo<ReadonlyMap<string, number>>(
    () => countListsPerCatalogItem(allLists),
    [allLists],
  );
  const affectedListCount = useMemo(() => {
    if (!catalogItemPendingDelete) return 0;
    const catalogItemId = catalogItemPendingDelete.id;
    // listCounts includes this list; take it out when the item is on it.
    const totalLists = listCounts.get(catalogItemId) ?? 0;
    return listCatalogIds.has(catalogItemId) ? totalLists - 1 : totalLists;
  }, [catalogItemPendingDelete, listCatalogIds, listCounts]);

  const showErrorToast = useGroceriesErrorToast();

  const handleToggleChecked = useCallback(
    async (lineId: string) => {
      setIsBusy(true);
      try {
        await toggleLineChecked(listId, lineId);
      } catch (err) {
        console.error('Failed to toggle list line:', err);
        showErrorToast();
      } finally {
        setIsBusy(false);
      }
    },
    [listId, toggleLineChecked, showErrorToast],
  );

  const handleUncheckAll = useCallback(async () => {
    setIsBusy(true);
    try {
      await uncheckAllLines(listId);
    } catch (err) {
      console.error('Failed to uncheck all list lines:', err);
      showErrorToast();
    } finally {
      setIsBusy(false);
    }
  }, [listId, uncheckAllLines, showErrorToast]);

  const createUndoHandler = useCallback(
    (targetListId: string, removed: ListLine[]) => () => {
      void restoreLines(targetListId, removed);
    },
    [restoreLines],
  );

  const handleRemoveChecked = useCallback(async () => {
    setIsBusy(true);
    try {
      const removed = await removeCheckedLines(listId);
      if (removed.length === 0) {
        toast({
          title: 'No checked items to remove.',
        });
        return;
      }
      toast({
        title: 'Checked items removed',
        description: `${removed.length} Checked Item${removed.length !== 1 ? 's' : ''} removed from this Grocery List.`,
        action: (
          <ToastAction
            altText="Undo"
            onClick={createUndoHandler(listId, removed)}
          >
            Undo
          </ToastAction>
        ),
      });
    } catch (err) {
      console.error('Failed to remove checked list lines:', err);
      showErrorToast();
    } finally {
      setIsBusy(false);
    }
  }, [createUndoHandler, listId, removeCheckedLines, showErrorToast, toast]);

  const handleDeleteLine = useCallback(
    async (lineId: string) => {
      setIsBusy(true);
      try {
        await deleteListLine(listId, lineId);
      } catch (err) {
        console.error('Failed to delete list line:', err);
        showErrorToast();
      } finally {
        setIsBusy(false);
      }
    },
    [listId, deleteListLine, showErrorToast],
  );

  const submitAddItem = useCallback(
    async (values: AddItemFormResult) => {
      setIsBusy(true);
      try {
        await addCatalogItemAndLine(listId, values);
        setIsAddItemOpen(false);
      } catch (err) {
        console.error('Failed to add item to list:', err);
        showErrorToast();
      } finally {
        setIsBusy(false);
      }
    },
    [listId, addCatalogItemAndLine, showErrorToast],
  );

  const openAddItem = useCallback(() => {
    setAddItemInitialName(undefined);
    setIsAddItemOpen(true);
  }, []);

  const openAddItemNamed = useCallback((name: string) => {
    setAddItemInitialName(name);
    setIsAddSheetOpen(false);
    setIsAddItemOpen(true);
  }, []);

  const closeAddItem = useCallback(() => {
    setIsAddItemOpen(false);
  }, []);

  const openAddExisting = useCallback(() => {
    setIsAddExistingOpen(true);
  }, []);

  const closeAddExisting = useCallback(() => {
    setIsAddExistingOpen(false);
  }, []);

  const submitAddExisting = useCallback(
    async (catalogItemId: string, listIds: string[], amount?: string) => {
      setIsBusy(true);
      try {
        const addedListIds = await addExistingCatalogItemToLists(
          catalogItemId,
          listIds,
          amount,
        );
        setIsAddExistingOpen(false);
        if (addedListIds.length === 0) {
          toast({
            title: 'Already on every selected list.',
          });
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
      } catch (err) {
        console.error('Failed to add existing catalog item to lists:', err);
        showErrorToast();
      } finally {
        setIsBusy(false);
      }
    },
    [addExistingCatalogItemToLists, showErrorToast, toast],
  );

  const onAddFromCatalog = useCallback(
    async (catalogItemId: string) => {
      setIsBusy(true);
      try {
        const addedListIds = await addExistingCatalogItemToLists(
          catalogItemId,
          [listId],
        );
        if (addedListIds.length === 0) {
          toast({
            title: 'Already on this list.',
          });
        }
      } catch (err) {
        console.error('Failed to add catalog item to list:', err);
        showErrorToast();
      } finally {
        setIsBusy(false);
      }
    },
    [listId, addExistingCatalogItemToLists, showErrorToast, toast],
  );

  const openAddSheet = useCallback(() => {
    setIsAddSheetOpen(true);
  }, []);

  const closeAddSheet = useCallback(() => {
    setIsAddSheetOpen(false);
  }, []);

  const openRename = useCallback(() => {
    setIsRenameOpen(true);
  }, []);

  const closeRename = useCallback(() => {
    setIsRenameOpen(false);
  }, []);

  const submitRename = useCallback(
    async (newName: string) => {
      setIsBusy(true);
      try {
        await renameList(listId, newName);
        setIsRenameOpen(false);
      } catch (err) {
        console.error('Failed to rename grocery list:', err);
        throw err;
      } finally {
        setIsBusy(false);
      }
    },
    [listId, renameList],
  );

  const openDeleteList = useCallback(() => {
    setIsDeleteListOpen(true);
  }, []);

  const closeDeleteList = useCallback(() => {
    setIsDeleteListOpen(false);
  }, []);

  const confirmDeleteList = useCallback(async () => {
    setIsBusy(true);
    // Set before the vault write so the list disappearing does not flash
    // the not-found state while the router navigates away.
    setIsLeaving(true);
    try {
      await deleteList(listId);
      router.push(GROCERIES_HREF);
    } catch (err) {
      console.error('Failed to delete grocery list:', err);
      setIsLeaving(false);
      showErrorToast();
    } finally {
      setIsBusy(false);
    }
  }, [deleteList, listId, router, showErrorToast]);

  const handleEditListLine = useCallback(
    (lineId: string) => {
      setLinePendingEdit(lines.find((line) => line.id === lineId) ?? null);
    },
    [lines],
  );

  const handleEditCatalogItem = useCallback(
    (catalogItemId: string) => {
      setCatalogItemPendingEdit(
        catalog.find((item) => item.id === catalogItemId) ?? null,
      );
    },
    [catalog],
  );

  const handleRequestDeleteFromCatalog = useCallback(
    (catalogItemId: string) => {
      const item = catalog.find((entry) => entry.id === catalogItemId);
      if (item) {
        setCatalogItemPendingDelete(item);
      }
    },
    [catalog],
  );

  const closeDeleteCatalog = useCallback(() => {
    setCatalogItemPendingDelete(null);
  }, []);

  const confirmDeleteCatalog = useCallback(async () => {
    if (!catalogItemPendingDelete) return;
    setIsBusy(true);
    try {
      await deleteCatalogItem(catalogItemPendingDelete.id);
      toast({
        title: `Deleted "${catalogItemPendingDelete.name}" from Catalog`,
      });
    } catch (err) {
      console.error('Failed to delete catalog item:', err);
      showErrorToast();
    } finally {
      setIsBusy(false);
      setCatalogItemPendingDelete(null);
    }
  }, [catalogItemPendingDelete, deleteCatalogItem, showErrorToast, toast]);

  const closeLineEdit = useCallback(() => {
    setLinePendingEdit(null);
  }, []);

  const submitLineEdit = useCallback(
    async (changes: { id: string; amount?: string }) => {
      setIsBusy(true);
      try {
        await updateListLine(listId, changes);
        setLinePendingEdit(null);
      } catch (err) {
        console.error('Failed to update list line:', err);
        showErrorToast();
        throw err;
      } finally {
        setIsBusy(false);
      }
    },
    [listId, updateListLine, showErrorToast],
  );

  const closeCatalogEdit = useCallback(() => {
    setCatalogItemPendingEdit(null);
  }, []);

  const submitCatalogEdit = useCallback(
    async (changes: CatalogItemEditChanges) => {
      setIsBusy(true);
      try {
        await updateCatalogItem(changes);
        setCatalogItemPendingEdit(null);
      } catch (err) {
        console.error('Failed to update catalog item:', err);
        showErrorToast();
        throw err;
      } finally {
        setIsBusy(false);
      }
    },
    [updateCatalogItem, showErrorToast],
  );

  const onUncheckAll = useCallback(() => {
    void handleUncheckAll();
  }, [handleUncheckAll]);

  const onRemoveChecked = useCallback(() => {
    void handleRemoveChecked();
  }, [handleRemoveChecked]);

  const lineActions = useMemo<GroceryListLineActions>(
    () => ({
      onToggleChecked: handleToggleChecked,
      onEditLine: handleEditListLine,
      onEditCatalogItem: handleEditCatalogItem,
      onRemoveLine: handleDeleteLine,
      onRequestDeleteFromCatalog: handleRequestDeleteFromCatalog,
    }),
    [
      handleToggleChecked,
      handleEditListLine,
      handleEditCatalogItem,
      handleDeleteLine,
      handleRequestDeleteFromCatalog,
    ],
  );

  return {
    loading: vault.loading,
    list,
    catalog,
    allLists,
    isBusy,
    isLeaving,
    summary,
    progress,
    openGroups,
    checkedLines,
    listCatalogIds,
    listCounts,
    lineActions,
    onUncheckAll,
    onRemoveChecked,
    onAddFromCatalog,
    isAddItemOpen,
    addItemInitialName,
    openAddItem,
    openAddItemNamed,
    closeAddItem,
    submitAddItem,
    isAddExistingOpen,
    openAddExisting,
    closeAddExisting,
    submitAddExisting,
    isAddSheetOpen,
    openAddSheet,
    closeAddSheet,
    isRenameOpen,
    openRename,
    closeRename,
    submitRename,
    isDeleteListOpen,
    openDeleteList,
    closeDeleteList,
    confirmDeleteList,
    catalogItemPendingDelete,
    affectedListCount,
    closeDeleteCatalog,
    confirmDeleteCatalog,
    linePendingEdit,
    closeLineEdit,
    submitLineEdit,
    catalogItemPendingEdit,
    closeCatalogEdit,
    submitCatalogEdit,
  };
}
