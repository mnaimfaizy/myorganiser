'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { CatalogItem, GroceryCategoryType } from '@myorganiser/vault-core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Form,
} from '@myorganiser/web-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { useForm } from 'react-hook-form';
import { searchCatalog } from '../../shared/utils';
import { addItemSchema, type AddItemFormValues } from '../schemas';
import { AddItemDetailsFields } from './AddItemDetailsFields';
import { AddItemMetadataFields } from './AddItemMetadataFields';

export interface AddItemFormResult {
  name: string;
  category: GroceryCategoryType;
  catalogItemId?: string;
  amount?: string;
  price?: number;
  notes?: string;
  imageUrl?: string;
  links?: string[];
}

interface AddItemDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (values: AddItemFormResult) => Promise<void>;
  isLoading?: boolean;
  catalog?: CatalogItem[];
  mode?: 'list' | 'catalog';
  /** The Grocery List the item is added to; named in the title and footer. */
  listName?: string;
  /** Prefills the Item name when the dialog opens (from the phone add sheet). */
  initialName?: string;
}

const SUGGESTION_LIMIT = 8;

export function AddItemDialog({
  isOpen,
  onClose,
  onAdd,
  isLoading = false,
  catalog = [],
  mode = 'list',
  listName,
  initialName,
}: AddItemDialogProps) {
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [selectedCatalogItemId, setSelectedCatalogItemId] = useState<
    string | undefined
  >();
  const form = useForm<AddItemFormValues>({
    resolver: zodResolver(addItemSchema, undefined, { mode: 'sync' }),
    mode: 'onChange',
    defaultValues: {
      name: '',
      category: 'other',
      amount: '',
      price: '',
      notes: '',
      imageUrl: '',
      links: [],
    },
  });

  const nameValue = form.watch('name');
  const imageUrl = form.watch('imageUrl');
  const matchingCatalogItems = useMemo(() => {
    if (!nameValue.trim()) return [];
    return searchCatalog(catalog, nameValue).slice(0, SUGGESTION_LIMIT);
  }, [catalog, nameValue]);

  const showListbox =
    isSuggestionsOpen &&
    nameValue.trim() !== '' &&
    matchingCatalogItems.length > 0;
  const hasMoreErrors = Boolean(
    form.formState.errors.imageUrl || form.formState.errors.links,
  );

  useEffect(() => {
    if (isOpen && initialName) {
      form.setValue('name', initialName, { shouldValidate: true });
      setIsSuggestionsOpen(false);
    }
  }, [form, initialName, isOpen]);

  const handleSelectCatalogItem = useCallback(
    (item: CatalogItem) => {
      setSelectedCatalogItemId(item.id);
      form.setValue('name', item.name, { shouldValidate: true });
      form.setValue('category', item.category, { shouldValidate: true });
      form.setValue(
        'price',
        item.price === undefined ? '' : String(item.price),
        {
          shouldValidate: true,
        },
      );
      setIsSuggestionsOpen(false);
      setActiveSuggestion(0);
    },
    [form],
  );

  const handleKeepTypedName = useCallback(() => {
    setSelectedCatalogItemId(undefined);
    setIsSuggestionsOpen(false);
    setActiveSuggestion(0);
  }, []);

  const handleNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setSelectedCatalogItemId(undefined);
      setIsSuggestionsOpen(true);
      setActiveSuggestion(0);
      form.setValue('name', event.target.value, { shouldValidate: true });
    },
    [form],
  );

  const handleNameKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (!showListbox) return;
      // The last option is "Add as a new Catalog Item", one past the matches.
      const optionCount = matchingCatalogItems.length + 1;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveSuggestion((index) => Math.min(index + 1, optionCount - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveSuggestion((index) => Math.max(index - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const item = matchingCatalogItems[activeSuggestion];
        if (item) {
          handleSelectCatalogItem(item);
        } else {
          handleKeepTypedName();
        }
      } else if (event.key === 'Escape') {
        setActiveSuggestion(0);
      }
    },
    [
      activeSuggestion,
      handleKeepTypedName,
      handleSelectCatalogItem,
      matchingCatalogItems,
      showListbox,
    ],
  );

  const resetForm = useCallback(() => {
    form.reset();
    setSelectedCatalogItemId(undefined);
    setIsSuggestionsOpen(false);
    setActiveSuggestion(0);
  }, [form]);

  const handleSubmit = form.handleSubmit(async (values) => {
    try {
      await onAdd({
        name: values.name,
        category: values.category,
        ...(selectedCatalogItemId
          ? { catalogItemId: selectedCatalogItemId }
          : {}),
        amount: values.amount || undefined,
        price: values.price ? Number(values.price) : undefined,
        notes: values.notes || undefined,
        imageUrl: values.imageUrl || undefined,
        links: values.links?.length ? values.links : undefined,
      });
      resetForm();
      onClose();
    } catch (err) {
      console.error('Failed to add item:', err);
    }
  });

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        resetForm();
        onClose();
      }
    },
    [onClose, resetForm],
  );

  const handleCancel = useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  const isCatalogMode = mode === 'catalog';
  const title = isCatalogMode
    ? 'New Catalog Item'
    : listName
      ? `Add item to ${listName}`
      : 'Add item';
  const showCatalogHint = !isCatalogMode && selectedCatalogItemId !== undefined;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-150 gap-0 overflow-hidden rounded-panel p-0">
        <Form {...form}>
          <form onSubmit={handleSubmit} className="flex flex-col">
            <div className="flex flex-col gap-1 border-b border-border px-6 pt-6 pb-4">
              <DialogTitle className="font-display text-title text-foreground">
                {title}
              </DialogTitle>
              <DialogDescription className="flex items-center gap-1.5 text-caption text-trust-text">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full bg-trust"
                />
                Encrypted on this device before it syncs
              </DialogDescription>
            </div>

            <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-6 py-5">
              <AddItemMetadataFields
                control={form.control}
                matchingCatalogItems={matchingCatalogItems}
                activeSuggestion={activeSuggestion}
                showListbox={showListbox}
                typedName={nameValue}
                onNameChange={handleNameChange}
                onNameKeyDown={handleNameKeyDown}
                onSelectCatalogItem={handleSelectCatalogItem}
                onKeepTypedName={handleKeepTypedName}
                isLoading={isLoading}
              />
              <AddItemDetailsFields
                control={form.control}
                imageUrl={imageUrl}
                isLoading={isLoading}
                showAmount={!isCatalogMode}
                hasMoreErrors={hasMoreErrors}
              />
            </div>

            <div className="flex items-center gap-2.5 border-t border-border px-6 pt-4 pb-6">
              <p className="min-w-0 flex-1 text-caption text-muted-foreground">
                {showCatalogHint
                  ? `Already in your Catalog — this adds it to ${listName ?? 'this list'}.`
                  : null}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isLoading || !form.formState.isValid}
              >
                {isCatalogMode ? 'Add to catalog' : 'Add to list'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
