'use client';

import type { CatalogItem } from '@myorganiser/vault-core';
import {
  BottomSheet,
  BottomSheetClose,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetTitle,
  IconButton,
} from '@myorganiser/web-ui';
import { Check, Plus, Search } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { GroceryCategoryIllustration } from '../../shared/components';
import { getCategoryLabel } from '../../shared/constants/categories';
import { formatMoney, pluralize, searchCatalog } from '../../shared/utils';

const RESULT_LIMIT = 12;
const OFTEN_BOUGHT_LIMIT = 4;

interface AddToListSheetProps {
  isOpen: boolean;
  listName: string;
  catalog: CatalogItem[];
  listCatalogIds: ReadonlySet<string>;
  /** Grocery Lists per Catalog Item, this list included. */
  listCounts: ReadonlyMap<string, number>;
  isBusy: boolean;
  onClose: () => void;
  onAddFromCatalog: (catalogItemId: string) => void;
  onRequestNewItem: (name: string) => void;
}

/**
 * Phone add flow: a bottom sheet that searches the Catalog and adds Catalog
 * Items to this list, or hands an unknown name to the full add dialog.
 */
export function AddToListSheet({
  isOpen,
  listName,
  catalog,
  listCatalogIds,
  listCounts,
  isBusy,
  onClose,
  onAddFromCatalog,
  onRequestNewItem,
}: AddToListSheetProps) {
  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();

  const matches = useMemo(
    () => (needle ? searchCatalog(catalog, trimmed) : []),
    [catalog, needle, trimmed],
  );
  const hasExactMatch = useMemo(
    () => catalog.some((item) => item.name.trim().toLowerCase() === needle),
    [catalog, needle],
  );
  const oftenBought = useMemo(
    () =>
      catalog
        .filter((item) => !listCatalogIds.has(item.id))
        .sort(
          (a, b) =>
            (listCounts.get(b.id) ?? 0) - (listCounts.get(a.id) ?? 0) ||
            a.name.localeCompare(b.name),
        )
        .slice(0, OFTEN_BOUGHT_LIMIT),
    [catalog, listCatalogIds, listCounts],
  );

  const handleQueryChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setQuery(event.target.value);
    },
    [],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setQuery('');
        onClose();
      }
    },
    [onClose],
  );

  const handleRequestNew = useCallback(() => {
    onRequestNewItem(trimmed);
  }, [onRequestNewItem, trimmed]);

  return (
    <BottomSheet open={isOpen} onOpenChange={handleOpenChange}>
      <BottomSheetContent className="max-h-[85vh] gap-0 overflow-y-auto px-0">
        <div className="grid grid-cols-[4rem_1fr_4rem] items-center">
          <BottomSheetClose className="min-h-11 px-3 text-left text-body font-medium text-foreground">
            Close
          </BottomSheetClose>
          <BottomSheetTitle className="truncate text-center text-body font-semibold">
            {`Add to ${listName}`}
          </BottomSheetTitle>
          <BottomSheetDescription className="sr-only">
            Pick from your Catalog or add a new item.
          </BottomSheetDescription>
          <BottomSheetClose className="min-h-11 px-3 text-right text-body font-bold text-brand-text">
            Done
          </BottomSheetClose>
        </div>

        <div className="px-4">
          <label className="flex h-12 items-center gap-2.5 rounded-xl border-2 border-primary px-3.5">
            <Search
              aria-hidden="true"
              className="size-5 shrink-0 text-muted-foreground"
            />
            <span className="sr-only">Search your Catalog</span>
            <input
              type="search"
              value={query}
              onChange={handleQueryChange}
              placeholder="Search your Catalog"
              className="min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>

        {needle ? (
          <>
            <h3 className="px-4 pt-3 pb-2 text-label-caps text-muted-foreground">
              {`FROM YOUR CATALOG · ${matches.length}`}
            </h3>
            <div className="flex flex-col divide-y divide-border-subtle border-y border-border-subtle">
              {matches.slice(0, RESULT_LIMIT).map((item) => {
                const onList = listCatalogIds.has(item.id);
                const otherLists =
                  (listCounts.get(item.id) ?? 0) - (onList ? 1 : 0);
                const priceText =
                  typeof item.price === 'number'
                    ? formatMoney(item.price)
                    : 'No price';
                return (
                  <div
                    key={item.id}
                    className="flex min-h-16 items-center gap-3 py-2 pr-2 pl-4"
                  >
                    <GroceryCategoryIllustration
                      category={item.category}
                      size={32}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span
                        className={
                          onList
                            ? 'text-body text-muted-foreground'
                            : 'text-body text-foreground'
                        }
                      >
                        {item.name}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-1.5 text-caption text-muted-foreground">
                        {`${getCategoryLabel(item.category)} · ${priceText}`}
                        {onList ? (
                          <span className="inline-flex items-center gap-1">
                            <Check aria-hidden="true" className="size-3.5" />
                            already on this list
                          </span>
                        ) : otherLists > 0 ? (
                          <span>{`· on ${pluralize(otherLists, 'other list')}`}</span>
                        ) : null}
                      </span>
                    </span>
                    {onList ? null : (
                      <IconButton
                        variant="ghost"
                        label={`Add ${item.name}`}
                        icon={<Plus />}
                        disabled={isBusy}
                        onClick={() => onAddFromCatalog(item.id)}
                        className="rounded-full bg-brand-soft text-brand-text hover:bg-brand-soft"
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {hasExactMatch ? null : (
              <button
                type="button"
                onClick={handleRequestNew}
                className="mx-4 mt-3.5 flex min-h-14 items-center gap-3 rounded-xl border border-dashed border-brand bg-brand-soft px-4 text-left"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand">
                  <Plus
                    aria-hidden="true"
                    className="size-4 text-brand-foreground"
                  />
                </span>
                <span className="flex flex-col">
                  <span className="text-body font-semibold text-brand-text-strong">
                    {`New item “${trimmed}”`}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    Pick a category, amount and price next
                  </span>
                </span>
              </button>
            )}
          </>
        ) : (
          <>
            <h3 className="px-4 pt-3 pb-2 text-label-caps text-muted-foreground">
              OFTEN BOUGHT
            </h3>
            <div className="flex flex-wrap gap-2 px-4">
              {oftenBought.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={isBusy}
                  onClick={() => onAddFromCatalog(item.id)}
                  className="h-9 rounded-control-sm border border-border-strong bg-card px-3 text-control-sm text-foreground"
                >
                  {`+ ${item.name}`}
                </button>
              ))}
            </div>
          </>
        )}
      </BottomSheetContent>
    </BottomSheet>
  );
}
