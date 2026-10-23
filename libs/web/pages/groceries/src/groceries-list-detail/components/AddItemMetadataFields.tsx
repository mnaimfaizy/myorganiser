'use client';

import type { CatalogItem } from '@myorganiser/vault-core';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  cn,
} from '@myorganiser/web-ui';
import { useCallback } from 'react';
import type { ChangeEvent, KeyboardEvent, MouseEvent } from 'react';
import type { Control } from 'react-hook-form';
import { getCategoryLabel } from '../../shared/constants/categories';
import { formatMoney } from '../../shared/utils';
import type { AddItemFormValues } from '../schemas';
import { CategoryPicker } from './CategoryPicker';

export const ADD_ITEM_LISTBOX_ID = 'add-item-name-suggestions';
export const ADD_ITEM_NEW_OPTION_ID = 'add-item-new-option';

interface AddItemMetadataFieldsProps {
  control: Control<AddItemFormValues>;
  matchingCatalogItems: CatalogItem[];
  activeSuggestion: number;
  showListbox: boolean;
  typedName: string;
  onNameChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onNameKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSelectCatalogItem: (item: CatalogItem) => void;
  onKeepTypedName: () => void;
  isLoading: boolean;
}

/** The name in bold where it matches the typed text; the rest plain. */
function renderMatch(name: string, query: string) {
  const index = query ? name.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (index === -1) return name;
  return (
    <>
      {name.slice(0, index)}
      <b className="font-semibold">{name.slice(index, index + query.length)}</b>
      {name.slice(index + query.length)}
    </>
  );
}

/** The item name (a Catalog combobox) and the category, the two fields that identify an item. */
export function AddItemMetadataFields({
  control,
  matchingCatalogItems,
  activeSuggestion,
  showListbox,
  typedName,
  onNameChange,
  onNameKeyDown,
  onSelectCatalogItem,
  onKeepTypedName,
  isLoading,
}: AddItemMetadataFieldsProps) {
  const trimmedName = typedName.trim();
  const activeId =
    showListbox && activeSuggestion < matchingCatalogItems.length
      ? `catalog-suggestion-${matchingCatalogItems[activeSuggestion]?.id}`
      : showListbox
        ? ADD_ITEM_NEW_OPTION_ID
        : undefined;

  const handleSuggestionMouseDown = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
    },
    [],
  );

  const handleSuggestionClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const itemId = event.currentTarget.dataset.catalogItemId;
      const item = matchingCatalogItems.find(
        (catalogItem) => catalogItem.id === itemId,
      );
      if (item) {
        onSelectCatalogItem(item);
      }
    },
    [matchingCatalogItems, onSelectCatalogItem],
  );

  return (
    <>
      <FormField
        control={control}
        name="name"
        render={({ field }) => (
          <FormItem className="gap-1.5">
            <FormLabel className="text-body font-semibold text-foreground">
              Item
            </FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder="e.g. Organic Almond Milk"
                role="combobox"
                aria-autocomplete="list"
                aria-controls={showListbox ? ADD_ITEM_LISTBOX_ID : undefined}
                aria-expanded={showListbox}
                aria-activedescendant={activeId}
                autoComplete="off"
                onChange={onNameChange}
                onKeyDown={onNameKeyDown}
                disabled={isLoading}
                maxLength={200}
                autoFocus
                className="h-11 text-body"
              />
            </FormControl>
            {showListbox ? (
              <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-card p-1.5 shadow-card">
                <span
                  aria-hidden="true"
                  className="px-2.5 py-1.5 text-label-caps text-muted-foreground"
                >
                  FROM YOUR CATALOG
                </span>
                <div
                  id={ADD_ITEM_LISTBOX_ID}
                  role="listbox"
                  aria-label="From your Catalog"
                  className="flex flex-col gap-0.5"
                >
                  {matchingCatalogItems.map((item, index) => (
                    <button
                      key={item.id}
                      id={`catalog-suggestion-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={index === activeSuggestion}
                      data-catalog-item-id={item.id}
                      onMouseDown={handleSuggestionMouseDown}
                      onClick={handleSuggestionClick}
                      disabled={isLoading}
                      className={cn(
                        'flex min-h-11 items-center justify-between gap-3 rounded-item px-2.5 text-left text-foreground',
                        index === activeSuggestion && 'bg-brand-soft',
                      )}
                    >
                      <span className="min-w-0 text-body">
                        {renderMatch(item.name, trimmedName)}
                        {` · ${getCategoryLabel(item.category)}`}
                      </span>
                      {typeof item.price === 'number' ? (
                        <span className="shrink-0 text-body-sm text-foreground-secondary tabular-nums">
                          {formatMoney(item.price)}
                        </span>
                      ) : null}
                    </button>
                  ))}
                  <button
                    id={ADD_ITEM_NEW_OPTION_ID}
                    type="button"
                    role="option"
                    aria-selected={
                      activeSuggestion === matchingCatalogItems.length
                    }
                    onMouseDown={handleSuggestionMouseDown}
                    onClick={onKeepTypedName}
                    disabled={isLoading}
                    className={cn(
                      'flex min-h-11 items-center rounded-item px-2.5 text-left text-body font-semibold text-brand-text',
                      activeSuggestion === matchingCatalogItems.length &&
                        'bg-brand-soft',
                    )}
                  >
                    {`Add “${trimmedName}” as a new Catalog Item`}
                  </button>
                </div>
              </div>
            ) : null}
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="category"
        render={({ field }) => (
          <FormItem>
            <CategoryPicker
              value={field.value}
              onChange={field.onChange}
              disabled={isLoading}
            />
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
