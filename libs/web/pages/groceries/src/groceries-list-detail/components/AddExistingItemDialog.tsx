'use client';

import type { CatalogItem, GroceryList } from '@myorganiser/vault-core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Label,
} from '@myorganiser/web-ui';
import { Lock } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AddExistingItemCatalogSelector } from './AddExistingItemCatalogSelector';
import { AddExistingItemListSelector } from './AddExistingItemListSelector';

interface AddExistingItemDialogProps {
  isOpen: boolean;
  onClose: () => void;
  catalog: CatalogItem[];
  lists: GroceryList[];
  defaultListId?: string;
  defaultCatalogItemId?: string;
  onAdd: (
    catalogItemId: string,
    listIds: string[],
    amount?: string,
  ) => Promise<string[] | void>;
  isLoading?: boolean;
}

/**
 * Lets the user attach an EXISTING Catalog Item as a new List Line to one or
 * many Grocery Lists at once, without duplicating the Catalog Item's identity.
 */
export function AddExistingItemDialog({
  isOpen,
  onClose,
  catalog,
  lists,
  defaultListId,
  defaultCatalogItemId,
  onAdd,
  isLoading = false,
}: AddExistingItemDialogProps) {
  const [query, setQuery] = useState('');
  const [selectedCatalogItemId, setSelectedCatalogItemId] = useState<
    string | null
  >(null);
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(
    new Set(),
  );
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setSelectedCatalogItemId(defaultCatalogItemId ?? null);
    setAmount('');
    setSelectedListIds(new Set(defaultListId ? [defaultListId] : []));
  }, [isOpen, defaultCatalogItemId, defaultListId]);

  const handleQueryChange = useCallback((newQuery: string) => {
    setQuery(newQuery);
  }, []);

  const handleSelectCatalogItem = useCallback((catalogItemId: string) => {
    setSelectedCatalogItemId(catalogItemId);
  }, []);

  const handleToggleList = useCallback((listId: string) => {
    setSelectedListIds((prev) => {
      const next = new Set(prev);
      if (next.has(listId)) {
        next.delete(listId);
      } else {
        next.add(listId);
      }
      return next;
    });
  }, []);

  const handleAmountChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setAmount(event.target.value);
    },
    [],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onClose();
      }
    },
    [onClose],
  );

  const canSubmit =
    !isLoading && selectedCatalogItemId !== null && selectedListIds.size > 0;

  const handleSubmit = useCallback(async () => {
    if (!selectedCatalogItemId || selectedListIds.size === 0) return;
    try {
      await onAdd(
        selectedCatalogItemId,
        Array.from(selectedListIds),
        amount || undefined,
      );
      onClose();
    } catch (err) {
      console.error('Failed to add existing catalog item to lists:', err);
    }
  }, [selectedCatalogItemId, selectedListIds, amount, onAdd, onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-xl p-0 gap-0 overflow-hidden">
        <div className="px-6 py-5 border-b border-border">
          <div className="flex items-start gap-3 mb-1">
            <DialogTitle className="text-xl font-semibold text-primary">
              Add From Catalog
            </DialogTitle>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-cyan/10 text-foreground rounded-full border border-cyan/30 text-[10px] font-bold tracking-wider uppercase shrink-0 mt-0.5">
              <Lock className="w-3 h-3" />
              Encrypted Data
            </span>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            Attach an existing Catalog Item to one or more Grocery Lists.
          </DialogDescription>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
          {catalog.length === 0 ? (
            <div className="rounded-lg border border-border bg-muted p-6 text-center">
              <p className="text-sm text-muted-foreground">
                There are no Catalog Items yet. Use "Add Item" to create one
                first.
              </p>
            </div>
          ) : (
            <>
              <AddExistingItemCatalogSelector
                catalog={catalog}
                query={query}
                onQueryChange={handleQueryChange}
                selectedCatalogItemId={selectedCatalogItemId}
                onSelectCatalogItem={handleSelectCatalogItem}
                isLoading={isLoading}
              />

              <AddExistingItemListSelector
                lists={lists}
                selectedListIds={selectedListIds}
                onToggleList={handleToggleList}
                isLoading={isLoading}
              />

              <div className="space-y-1.5">
                <Label
                  htmlFor="add-existing-item-amount"
                  className="text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                >
                  Amount{' '}
                  <span className="text-xs normal-case font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="add-existing-item-amount"
                  placeholder="e.g. 2, 500g"
                  value={amount}
                  onChange={handleAmountChange}
                  disabled={isLoading}
                  className="text-base md:text-sm"
                />
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 bg-muted border-t border-border flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="gap-2"
          >
            Add to Lists
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
