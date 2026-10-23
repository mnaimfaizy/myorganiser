'use client';

import type { CatalogItem, GroceryCategoryType } from '@myorganiser/vault-core';
import { ChoiceChip, Input, Label } from '@myorganiser/web-ui';
import { Search } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { GroceryCategoryIllustration } from '../../shared/components';
import {
  CATEGORY_ORDER,
  getCategoryLabel,
} from '../../shared/constants/categories';
import { searchCatalog, toKnownCategory } from '../../shared/utils';
import { CatalogItemRow } from './CatalogItemRow';

const FILTER_INPUT_ID = 'groceries-catalog-filter';

const CATALOG_FOOTNOTE = `"Delete from Catalog" lives in each item's menu and asks for the item's name, because it removes the item from every list.`;

type CategoryFilter = GroceryCategoryType | 'all';

export interface CatalogPanelProps {
  catalog: CatalogItem[];
  /** How many Grocery Lists exist; "Add to lists" needs at least one. */
  listCount: number;
  /** How many Grocery Lists carry each Catalog Item, keyed by its id. */
  listCountsByItem: ReadonlyMap<string, number>;
  /** True while a vault write is in flight; holds the row actions. */
  busy: boolean;
  onAddToLists: (catalogItemId: string) => void;
  onEditItem: (catalogItemId: string) => void;
  onDeleteItem: (catalogItemId: string) => void;
}

/**
 * The Catalog tab body: a name filter and category chips over the Catalog
 * Items, grouped by category in shop-walk order. The filter and the chosen
 * category are local to this panel.
 */
export function CatalogPanel({
  catalog,
  listCount,
  listCountsByItem,
  busy,
  onAddToLists,
  onEditItem,
  onDeleteItem,
}: CatalogPanelProps) {
  const [filterText, setFilterText] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');

  const handleFilterChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setFilterText(event.currentTarget.value);
    },
    [],
  );

  const handleSelectCategory = useCallback((next: CategoryFilter) => {
    setCategory(next);
  }, []);

  const countsByCategory = useMemo(() => {
    const counts = new Map<GroceryCategoryType, number>();
    for (const item of catalog) {
      const itemCategory = toKnownCategory(item.category);
      counts.set(itemCategory, (counts.get(itemCategory) ?? 0) + 1);
    }
    return counts;
  }, [catalog]);

  const categoriesInUse = useMemo(
    () => CATEGORY_ORDER.filter((c) => countsByCategory.has(c)),
    [countsByCategory],
  );

  const visible = useMemo(
    () =>
      searchCatalog(catalog, filterText).filter(
        (item) =>
          category === 'all' || toKnownCategory(item.category) === category,
      ),
    [catalog, category, filterText],
  );

  const groups = useMemo(
    () =>
      CATEGORY_ORDER.map((c) => ({
        category: c,
        items: visible.filter((item) => toKnownCategory(item.category) === c),
      })).filter((group) => group.items.length > 0),
    [visible],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:items-center">
        <div className="relative w-full md:w-65">
          <Label htmlFor={FILTER_INPUT_ID} className="sr-only">
            Filter your Catalog
          </Label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={FILTER_INPUT_ID}
            type="search"
            value={filterText}
            onChange={handleFilterChange}
            placeholder="Filter your Catalog"
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto md:flex-wrap">
          <ChoiceChip
            className="shrink-0"
            pressed={category === 'all'}
            onPressedChange={() => handleSelectCategory('all')}
          >
            {`All · ${catalog.length}`}
          </ChoiceChip>
          {categoriesInUse.map((c) => (
            <ChoiceChip
              key={c}
              className="shrink-0"
              pressed={category === c}
              onPressedChange={() => handleSelectCategory(c)}
            >
              {`${getCategoryLabel(c)} · ${countsByCategory.get(c) ?? 0}`}
            </ChoiceChip>
          ))}
        </div>
      </div>

      {catalog.length === 0 && (
        <p className="rounded-panel border border-dashed border-border-strong p-6 text-center text-body-sm text-muted-foreground">
          No Catalog Items yet — add one to seed the catalog.
        </p>
      )}

      {catalog.length > 0 && groups.length === 0 && (
        <p
          role="status"
          className="rounded-panel border border-dashed border-border-strong p-6 text-center text-body-sm text-muted-foreground"
        >
          No catalog matches
        </p>
      )}

      {groups.map((group) => {
        const label = getCategoryLabel(group.category);
        return (
          <section
            key={group.category}
            aria-label={label}
            className="flex flex-col gap-2"
          >
            <h2 className="flex items-center gap-2 text-label-caps uppercase text-foreground-secondary">
              <GroceryCategoryIllustration
                category={group.category}
                size={24}
              />
              {`${label} · ${group.items.length}`}
            </h2>
            <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border bg-card">
              {group.items.map((item) => {
                const onLists = listCountsByItem.get(item.id) ?? 0;
                return (
                  <CatalogItemRow
                    key={item.id}
                    item={item}
                    listCount={onLists}
                    addDisabled={listCount === 0 || onLists >= listCount}
                    busy={busy}
                    onAddToLists={onAddToLists}
                    onEditItem={onEditItem}
                    onDeleteItem={onDeleteItem}
                  />
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="text-caption text-muted-foreground">{CATALOG_FOOTNOTE}</p>
    </div>
  );
}
