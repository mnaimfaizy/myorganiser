'use client';

import type {
  CatalogItem,
  GroceryCategoryType,
  GroceryList,
  GroceriesVaultPayload,
  ListLine,
} from '@myorganiser/vault-core';
import { readDeletionLog, toEpoch } from '@myorganiser/vault-core';
import { randomId } from '@myorganiser/core';
import {
  normalizeGroceries,
  saveGroceriesPayload,
  type VaultHandle,
} from '@myorganiser/web-vault';
import { useLocalVaultRevision } from '@myorganiser/web-vault-ui';
import { useCallback, useEffect, useState } from 'react';
import { validateAddCatalogItemAndLineInput } from '../utils';

interface UseGroceriesVaultOptions {
  handle: VaultHandle;
}

/**
 * A restored List Line has to be strictly newer than the deletion that
 * removed it, or the next merge buries it again. The Deletion Log is not
 * shrunk.
 */
function newerThanDeletion(deletedAt: string | undefined, now: string): string {
  if (deletedAt === undefined || toEpoch(now) > toEpoch(deletedAt)) return now;
  return new Date(toEpoch(deletedAt) + 1).toISOString();
}

/** Fields a caller may supply when adding an item to a Grocery List. */
export interface AddCatalogItemAndLineInput {
  name: string;
  category: GroceryCategoryType;
  catalogItemId?: string;
  price?: number;
  notes?: string;
  imageUrl?: string;
  links?: string[];
  amount?: string;
}

export interface UpdateCatalogItemInput {
  id: string;
  name: string;
  category: GroceryCategoryType;
  price?: number;
  notes?: string;
  imageUrl?: string;
  links?: string[];
}

export interface UpdateListLineInput {
  id: string;
  amount?: string;
}

interface UseGroceriesVaultResult {
  lists: GroceryList[];
  catalog: CatalogItem[];
  loading: boolean;
  error: string | null;
  selectedListId: string | null;
  setSelectedListId: (id: string | null) => void;
  setError: (error: string | null) => void;
  persistPayload: (payload: GroceriesVaultPayload) => Promise<void>;
  createList: (name: string) => Promise<void>;
  renameList: (listId: string, newName: string) => Promise<void>;
  deleteList: (listId: string) => Promise<void>;
  /** Toggle a single List Line's checked (bought-on-this-trip) state. */
  toggleLineChecked: (listId: string, lineId: string) => Promise<void>;
  /** Turn every Checked Item back to unchecked. Never removes lines. */
  uncheckAllLines: (listId: string) => Promise<void>;
  /**
   * Removes Checked Items from the list only (Catalog Items are untouched).
   * Returns the removed lines so the caller can offer an undo affordance.
   */
  removeCheckedLines: (listId: string) => Promise<ListLine[]>;
  /** Re-inserts previously removed lines (undo for removeCheckedLines). */
  restoreLines: (listId: string, lines: ListLine[]) => Promise<void>;
  /** Deletes one List Line only; the referenced Catalog Item remains. */
  deleteListLine: (listId: string, lineId: string) => Promise<void>;
  updateCatalogItem: (input: UpdateCatalogItemInput) => Promise<void>;
  updateListLine: (listId: string, input: UpdateListLineInput) => Promise<void>;
  /**
   * Adds an item to a Grocery List: reuses an existing Catalog Item when the
   * name matches case-insensitively (updating its durable fields), otherwise
   * creates a new Catalog Item, then attaches a new List Line to the list.
   */
  addCatalogItemAndLine: (
    listId: string,
    input: AddCatalogItemAndLineInput,
  ) => Promise<void>;
  /**
   * Adds an item to one or many Grocery Lists in a single action: reuses an
   * existing Catalog Item when the name matches case-insensitively (updating
   * its durable fields), otherwise creates a new Catalog Item. Skips any
   * target list that already carries a List Line for that Catalog Item, so
   * the same identity is never duplicated on one list.
   */
  addItemToLists: (
    listIds: string[],
    input: AddCatalogItemAndLineInput,
  ) => Promise<void>;
  /**
   * Adds an already-existing Catalog Item as a new List Line to one or many
   * Grocery Lists, without changing any of the Catalog Item's durable
   * fields. Skips any target list that already carries a List Line for that
   * Catalog Item. Resolves with the ids of the lists that actually received
   * a new List Line (a subset of `listIds` — lists that already had a line
   * for this Catalog Item are skipped and excluded from the result), so
   * callers can give accurate feedback when some targets were skipped.
   */
  addExistingCatalogItemToLists: (
    catalogItemId: string,
    listIds: string[],
    amount?: string,
  ) => Promise<string[]>;
  /**
   * Permanently destroys a Catalog Item and every List Line referencing it
   * across every Grocery List. Requires strong confirmation in the UI before
   * being called — this cannot be undone.
   */
  deleteCatalogItem: (catalogItemId: string) => Promise<void>;
}

/**
 * Custom hook for managing grocery lists with vault persistence.
 *
 * Handles:
 * - Loading grocery lists from encrypted vault storage (catalog + lists payload)
 * - Saving changes back to vault
 * - Normalizing data on load
 * - Error handling and reporting
 *
 * @param options Configuration with the owner-bound vault handle
 * @returns State and handlers for grocery list management
 *
 * @example
 * ```tsx
 * const vault = useGroceriesVault({ handle });
 * // Use vault.lists, vault.createList, vault.renameList, vault.deleteList
 * ```
 */
export function useGroceriesVault({
  handle,
}: UseGroceriesVaultOptions): UseGroceriesVaultResult {
  const [payload, setPayload] = useState<GroceriesVaultPayload>({
    catalog: [],
    lists: [],
  });
  const [loading, setLoading] = useState(true);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Convergence replaces the Local Vault without passing through this hook,
  // so the revision is the only thing that says the Ciphertext behind
  // `payload` moved. Without it this hook goes on saving the payload it loaded
  // on mount, writing the converged lists back out (#587).
  const revision = useLocalVaultRevision();

  // Load payload from vault on mount, and again whenever it is replaced
  useEffect(() => {
    // Cancellation matters because this effect re-fires on every convergence:
    // without it, an earlier read resolving late can put stale lists back on
    // screen and save them over the ones a later read just applied (#1280).
    let isActive = true;

    setError(null);
    handle
      .loadDecryptedData<unknown>({
        type: 'groceries',
        defaultValue: null,
      })
      .then(async (raw) => {
        const normalized = normalizeGroceries(raw);
        if (!isActive) return;
        setPayload(normalized.value);
        // Only ever moves the selection onto a list that exists. A reload
        // triggered by convergence must not pull the User off the list they
        // are working in and back to the first one — but a selected list the
        // convergence removed cannot be left selected either.
        setSelectedListId((current) => {
          const stillPresent =
            current !== null &&
            normalized.value.lists.some((list) => list.id === current);
          if (stillPresent) return current;
          return normalized.value.lists[0]?.id ?? null;
        });
        // Re-save if data was normalized (data migration or repair)
        if (normalized.changed) {
          await saveGroceriesPayload(handle, normalized.value);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!isActive) return;
        console.error('Failed to load grocery lists from vault:', err);
        setError('Failed to load your grocery lists. Please try again.');
        setLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [handle, revision]);

  // Persist full payload to vault
  const persistPayload = useCallback(
    async (
      nextPayload: GroceriesVaultPayload,
      deletedIds?: readonly string[],
    ) => {
      setError(null);
      try {
        await saveGroceriesPayload(
          handle,
          nextPayload,
          deletedIds !== undefined && deletedIds.length > 0
            ? { deletedIds }
            : undefined,
        );
        setPayload(nextPayload);
      } catch (err) {
        console.error('Failed to save grocery lists to vault:', err);
        setError('Failed to save your changes. Please try again.');
        throw err;
      }
    },
    [handle],
  );

  // Create a new grocery list
  const createList = useCallback(
    async (name: string) => {
      try {
        const newList: GroceryList = {
          id: randomId(),
          name,
          lines: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const nextPayload: GroceriesVaultPayload = {
          ...payload,
          lists: [...payload.lists, newList],
        };
        await persistPayload(nextPayload);
        setSelectedListId(newList.id);
      } catch (err) {
        console.error('Failed to create list:', err);
      }
    },
    [payload, persistPayload],
  );

  // Rename an existing grocery list
  const renameList = useCallback(
    async (listId: string, newName: string) => {
      try {
        const nextPayload: GroceriesVaultPayload = {
          ...payload,
          lists: payload.lists.map((list) =>
            list.id === listId
              ? { ...list, name: newName, updatedAt: new Date().toISOString() }
              : list,
          ),
        };
        await persistPayload(nextPayload);
      } catch (err) {
        console.error('Failed to rename list:', err);
      }
    },
    [payload, persistPayload],
  );

  // Delete a grocery list
  const deleteList = useCallback(
    async (listId: string) => {
      try {
        const nextLists = payload.lists.filter((list) => list.id !== listId);
        const nextPayload: GroceriesVaultPayload = {
          ...payload,
          lists: nextLists,
        };
        await persistPayload(nextPayload, [listId]);
        if (selectedListId === listId) {
          setSelectedListId(nextLists.length > 0 ? nextLists[0].id : null);
        }
      } catch (err) {
        console.error('Failed to delete list:', err);
      }
    },
    [payload, selectedListId, persistPayload],
  );

  /** Toggle a single List Line's checked (bought-on-this-trip) state. */
  const toggleLineChecked = useCallback(
    async (listId: string, lineId: string) => {
      try {
        const nextPayload: GroceriesVaultPayload = {
          ...payload,
          lists: payload.lists.map((list) =>
            list.id === listId
              ? {
                  ...list,
                  lines: list.lines.map((line) =>
                    line.id === lineId
                      ? {
                          ...line,
                          checked: !line.checked,
                          updatedAt: new Date().toISOString(),
                        }
                      : line,
                  ),
                }
              : list,
          ),
        };
        await persistPayload(nextPayload);
      } catch (err) {
        console.error('Failed to toggle list line:', err);
        throw err;
      }
    },
    [payload, persistPayload],
  );

  /** Turn every Checked Item back to unchecked. Never removes lines. */
  const uncheckAllLines = useCallback(
    async (listId: string) => {
      try {
        const nextPayload: GroceriesVaultPayload = {
          ...payload,
          lists: payload.lists.map((list) =>
            list.id === listId
              ? {
                  ...list,
                  lines: list.lines.map((line) =>
                    line.checked
                      ? {
                          ...line,
                          checked: false,
                          updatedAt: new Date().toISOString(),
                        }
                      : line,
                  ),
                }
              : list,
          ),
        };
        await persistPayload(nextPayload);
      } catch (err) {
        console.error('Failed to uncheck all list lines:', err);
        throw err;
      }
    },
    [payload, persistPayload],
  );

  /**
   * Removes Checked Items from the list only (Catalog Items are untouched).
   * Returns the removed lines so the caller can offer an undo affordance.
   */
  const removeCheckedLines = useCallback(
    async (listId: string): Promise<ListLine[]> => {
      const list = payload.lists.find((l) => l.id === listId);
      if (!list) return [];

      const removed = list.lines.filter((line) => line.checked);
      if (removed.length === 0) return [];

      try {
        const nextPayload: GroceriesVaultPayload = {
          ...payload,
          lists: payload.lists.map((l) =>
            l.id === listId
              ? {
                  ...l,
                  lines: l.lines.filter((line) => !line.checked),
                }
              : l,
          ),
        };
        await persistPayload(
          nextPayload,
          removed.map((line) => line.id),
        );
        return removed;
      } catch (err) {
        console.error('Failed to remove checked list lines:', err);
        throw err;
      }
    },
    [payload, persistPayload],
  );

  /** Re-inserts previously removed lines (undo for removeCheckedLines). */
  const restoreLines = useCallback(
    async (listId: string, lines: ListLine[]) => {
      if (lines.length === 0) return;
      try {
        const stored = await handle.loadDecryptedData<unknown>({
          type: 'groceries',
          defaultValue: null,
        });
        const deletions = readDeletionLog(stored);
        const now = new Date().toISOString();
        const nextPayload: GroceriesVaultPayload = {
          ...payload,
          lists: payload.lists.map((list) => {
            if (list.id !== listId) return list;
            const existingIds = new Set(list.lines.map((line) => line.id));
            const toRestore = lines
              .filter((line) => !existingIds.has(line.id))
              .map((line) => ({
                ...line,
                // A restored line has to be newer than its deletion, or the
                // next merge buries it again. The log itself is not shrunk.
                updatedAt: newerThanDeletion(deletions[line.id], now),
              }));
            return {
              ...list,
              lines: [...list.lines, ...toRestore],
            };
          }),
        };
        await persistPayload(nextPayload);
      } catch (err) {
        console.error('Failed to restore list lines:', err);
      }
    },
    [handle, payload, persistPayload],
  );

  /** Deletes one List Line only; the referenced Catalog Item remains. */
  const deleteListLine = useCallback(
    async (listId: string, lineId: string) => {
      try {
        const nextPayload: GroceriesVaultPayload = {
          ...payload,
          lists: payload.lists.map((list) =>
            list.id === listId
              ? {
                  ...list,
                  lines: list.lines.filter((line) => line.id !== lineId),
                }
              : list,
          ),
        };
        await persistPayload(nextPayload, [lineId]);
      } catch (err) {
        console.error('Failed to delete list line:', err);
        throw err;
      }
    },
    [payload, persistPayload],
  );

  /** Updates only durable Catalog Item fields; List Lines are untouched. */
  const updateCatalogItem = useCallback(
    async (input: UpdateCatalogItemInput) => {
      try {
        const existing = payload.catalog.find((item) => item.id === input.id);
        if (!existing) throw new Error('Catalog Item not found');

        const now = new Date().toISOString();
        const nextPayload: GroceriesVaultPayload = {
          ...payload,
          catalog: payload.catalog.map((item) =>
            item.id === input.id ? { ...item, ...input, updatedAt: now } : item,
          ),
          lists: payload.lists,
        };
        await persistPayload(nextPayload);
      } catch (err) {
        console.error('Failed to update catalog item:', err);
        throw err;
      }
    },
    [payload, persistPayload],
  );

  /** Updates only one List Line's trip-local amount; checked is untouched. */
  const updateListLine = useCallback(
    async (listId: string, input: UpdateListLineInput) => {
      try {
        const list = payload.lists.find(
          (currentList) => currentList.id === listId,
        );
        if (!list || !list.lines.some((line) => line.id === input.id)) {
          throw new Error('List Line not found');
        }

        const now = new Date().toISOString();
        const nextPayload: GroceriesVaultPayload = {
          ...payload,
          catalog: payload.catalog,
          lists: payload.lists.map((currentList) =>
            currentList.id === listId
              ? {
                  ...currentList,
                  lines: currentList.lines.map((line) =>
                    line.id === input.id
                      ? { ...line, amount: input.amount, updatedAt: now }
                      : line,
                  ),
                }
              : currentList,
          ),
        };
        await persistPayload(nextPayload);
      } catch (err) {
        console.error('Failed to update list line:', err);
        throw err;
      }
    },
    [payload, persistPayload],
  );

  /**
   * Adds an item to a Grocery List: reuses an existing Catalog Item when the
   * name matches case-insensitively (updating its durable fields), otherwise
   * creates a new Catalog Item, then attaches a new List Line to the list.
   */
  const addCatalogItemAndLine = useCallback(
    async (listId: string, input: AddCatalogItemAndLineInput) => {
      try {
        const validatedInput = validateAddCatalogItemAndLineInput(input);
        const now = new Date().toISOString();
        const trimmedName = validatedInput.name;
        const existing = validatedInput.catalogItemId
          ? payload.catalog.find(
              (item) => item.id === validatedInput.catalogItemId,
            )
          : payload.catalog.find(
              (item) =>
                item.name.trim().toLowerCase() === trimmedName.toLowerCase(),
            );

        if (validatedInput.catalogItemId && !existing) {
          throw new Error('Catalog Item not found');
        }

        let catalogItemId: string;
        let nextCatalog: CatalogItem[];

        if (existing) {
          catalogItemId = existing.id;
          nextCatalog = validatedInput.catalogItemId
            ? payload.catalog
            : payload.catalog.map((item) =>
                item.id === existing.id
                  ? {
                      ...item,
                      name: trimmedName,
                      category: validatedInput.category,
                      price: validatedInput.price,
                      notes: validatedInput.notes,
                      imageUrl: validatedInput.imageUrl,
                      links: validatedInput.links,
                      updatedAt: now,
                    }
                  : item,
              );
        } else {
          const newCatalogItem: CatalogItem = {
            id: randomId(),
            name: trimmedName,
            category: validatedInput.category,
            price: validatedInput.price,
            notes: validatedInput.notes,
            imageUrl: validatedInput.imageUrl,
            links: validatedInput.links,
            createdAt: now,
            updatedAt: now,
          };
          catalogItemId = newCatalogItem.id;
          nextCatalog = [...payload.catalog, newCatalogItem];
        }

        const newLine: ListLine = {
          id: randomId(),
          catalogItemId,
          checked: false,
          amount: validatedInput.amount,
          createdAt: now,
          updatedAt: now,
        };

        const nextPayload: GroceriesVaultPayload = {
          ...payload,
          catalog: nextCatalog,
          lists: payload.lists.map((list) =>
            list.id === listId
              ? {
                  ...list,
                  lines: [...list.lines, newLine],
                }
              : list,
          ),
        };
        await persistPayload(nextPayload);
      } catch (err) {
        console.error('Failed to add item to list:', err);
        throw err;
      }
    },
    [payload, persistPayload],
  );

  /**
   * Adds an item to one or many Grocery Lists in a single action: reuses an
   * existing Catalog Item when the name matches case-insensitively (updating
   * its durable fields), otherwise creates a new Catalog Item. Skips any
   * target list that already carries a List Line for that Catalog Item, so
   * the same identity is never duplicated on one list.
   */
  const addItemToLists = useCallback(
    async (listIds: string[], input: AddCatalogItemAndLineInput) => {
      try {
        const validatedInput = validateAddCatalogItemAndLineInput(input);
        const now = new Date().toISOString();
        const trimmedName = validatedInput.name;
        const existing = validatedInput.catalogItemId
          ? payload.catalog.find(
              (item) => item.id === validatedInput.catalogItemId,
            )
          : payload.catalog.find(
              (item) =>
                item.name.trim().toLowerCase() === trimmedName.toLowerCase(),
            );

        if (validatedInput.catalogItemId && !existing) {
          throw new Error('Catalog Item not found');
        }

        let catalogItemId: string;
        let nextCatalog: CatalogItem[];

        if (existing) {
          catalogItemId = existing.id;
          nextCatalog = validatedInput.catalogItemId
            ? payload.catalog
            : payload.catalog.map((item) =>
                item.id === existing.id
                  ? {
                      ...item,
                      name: trimmedName,
                      category: validatedInput.category,
                      price: validatedInput.price,
                      notes: validatedInput.notes,
                      imageUrl: validatedInput.imageUrl,
                      links: validatedInput.links,
                      updatedAt: now,
                    }
                  : item,
              );
        } else {
          const newCatalogItem: CatalogItem = {
            id: randomId(),
            name: trimmedName,
            category: validatedInput.category,
            price: validatedInput.price,
            notes: validatedInput.notes,
            imageUrl: validatedInput.imageUrl,
            links: validatedInput.links,
            createdAt: now,
            updatedAt: now,
          };
          catalogItemId = newCatalogItem.id;
          nextCatalog = [...payload.catalog, newCatalogItem];
        }

        const targetIds = new Set(listIds);
        const nextPayload: GroceriesVaultPayload = {
          ...payload,
          catalog: nextCatalog,
          lists: payload.lists.map((list) => {
            if (!targetIds.has(list.id)) return list;
            const alreadyHasLine = list.lines.some(
              (line) => line.catalogItemId === catalogItemId,
            );
            if (alreadyHasLine) return list;
            const newLine: ListLine = {
              id: randomId(),
              catalogItemId,
              checked: false,
              amount: validatedInput.amount,
              createdAt: now,
              updatedAt: now,
            };
            return {
              ...list,
              lines: [...list.lines, newLine],
            };
          }),
        };
        await persistPayload(nextPayload);
      } catch (err) {
        console.error('Failed to add item to lists:', err);
        throw err;
      }
    },
    [payload, persistPayload],
  );

  /**
   * Adds an already-existing Catalog Item as a new List Line to one or many
   * Grocery Lists, without changing any of the Catalog Item's durable
   * fields. Skips any target list that already carries a List Line for that
   * Catalog Item. Resolves with the ids of the lists that actually received
   * a new List Line, so callers can report accurate feedback when some
   * targets were skipped as duplicates.
   */
  const addExistingCatalogItemToLists = useCallback(
    async (
      catalogItemId: string,
      listIds: string[],
      amount?: string,
    ): Promise<string[]> => {
      try {
        const catalogItem = payload.catalog.find(
          (item) => item.id === catalogItemId,
        );
        if (!catalogItem) {
          throw new Error('Catalog Item not found');
        }

        const now = new Date().toISOString();
        const targetIds = new Set(listIds);
        const addedListIds: string[] = [];
        const nextPayload: GroceriesVaultPayload = {
          ...payload,
          lists: payload.lists.map((list) => {
            if (!targetIds.has(list.id)) return list;
            const alreadyHasLine = list.lines.some(
              (line) => line.catalogItemId === catalogItemId,
            );
            if (alreadyHasLine) return list;
            const newLine: ListLine = {
              id: randomId(),
              catalogItemId,
              checked: false,
              amount,
              createdAt: now,
              updatedAt: now,
            };
            addedListIds.push(list.id);
            return {
              ...list,
              lines: [...list.lines, newLine],
            };
          }),
        };
        await persistPayload(nextPayload);
        return addedListIds;
      } catch (err) {
        console.error('Failed to add existing catalog item to lists:', err);
        throw err;
      }
    },
    [payload, persistPayload],
  );

  /**
   * Permanently destroys a Catalog Item and every List Line referencing it
   * across every Grocery List. This is the Delete From Catalog action — it
   * cascades off every list and cannot be undone.
   */
  const deleteCatalogItem = useCallback(
    async (catalogItemId: string) => {
      try {
        const nextPayload: GroceriesVaultPayload = {
          ...payload,
          catalog: payload.catalog.filter((item) => item.id !== catalogItemId),
          lists: payload.lists.map((list) => {
            const hasLine = list.lines.some(
              (line) => line.catalogItemId === catalogItemId,
            );
            if (!hasLine) return list;
            return {
              ...list,
              lines: list.lines.filter(
                (line) => line.catalogItemId !== catalogItemId,
              ),
            };
          }),
        };
        await persistPayload(nextPayload, [catalogItemId]);
      } catch (err) {
        console.error('Failed to delete catalog item:', err);
        throw err;
      }
    },
    [payload, persistPayload],
  );

  return {
    lists: payload.lists,
    catalog: payload.catalog,
    loading,
    error,
    selectedListId,
    setSelectedListId,
    setError,
    persistPayload,
    createList,
    renameList,
    deleteList,
    toggleLineChecked,
    uncheckAllLines,
    removeCheckedLines,
    restoreLines,
    deleteListLine,
    updateCatalogItem,
    updateListLine,
    addCatalogItemAndLine,
    addItemToLists,
    addExistingCatalogItemToLists,
    deleteCatalogItem,
  };
}
