'use client';

import type { CatalogItem } from '@myorganiser/vault-core';
import { cn } from '@myorganiser/web-ui';
import { Search } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { GroceryCategoryIllustration } from '../../shared/components';
import { formatMoney, searchCatalog } from '../../shared/utils';

const SUGGESTION_LIMIT = 12;

interface CatalogAddStripProps {
  catalog: CatalogItem[];
  listCatalogIds: ReadonlySet<string>;
  isBusy: boolean;
  onAdd: (catalogItemId: string) => void;
}

/** Search the Catalog and add a Catalog Item to this list with one click. */
export function CatalogAddStrip({
  catalog,
  listCatalogIds,
  isBusy,
  onAdd,
}: CatalogAddStripProps) {
  const [query, setQuery] = useState('');

  const suggestions = useMemo(() => {
    return searchCatalog(catalog, query).slice(0, SUGGESTION_LIMIT);
  }, [catalog, query]);

  const handleQueryChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setQuery(event.target.value);
    },
    [],
  );

  return (
    <section
      aria-label="Add from your Catalog"
      className="flex flex-col gap-2.5 rounded-panel border border-border bg-card p-4"
    >
      <label className="flex h-11 items-center gap-2.5 rounded-xl border border-border-strong px-3.5 focus-within:ring-2 focus-within:ring-focus">
        <Search
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="sr-only">Add from your Catalog</span>
        <input
          type="search"
          value={query}
          onChange={handleQueryChange}
          placeholder="Add from your Catalog — type a name"
          disabled={isBusy}
          className="min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((item) => {
          const onList = listCatalogIds.has(item.id);
          const priceText =
            typeof item.price === 'number' ? formatMoney(item.price) : null;

          return (
            <button
              key={item.id}
              type="button"
              disabled={onList || isBusy}
              onClick={() => onAdd(item.id)}
              aria-label={
                onList
                  ? `${item.name} already on list`
                  : `Add ${item.name} to list`
              }
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-control-sm border px-3 text-control-sm text-foreground',
                onList
                  ? 'border-dashed border-border bg-background opacity-60'
                  : 'border-border-strong bg-raised-surface hover:bg-ghost-hover',
              )}
            >
              <GroceryCategoryIllustration category={item.category} size={20} />
              {item.name}
              <span className="tabular-nums text-muted-foreground">
                {onList ? 'on this list' : priceText}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
