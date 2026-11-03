'use client';

import { formatUsd } from '@myorganiser/core';
import type { CatalogItem } from '@myorganiser/vault-core';
import { Input, Label, cn } from '@myorganiser/web-ui';
import { Search } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { getCategoryEmoji } from '../../shared/constants/categories';

interface AddExistingItemCatalogSelectorProps {
  catalog: CatalogItem[];
  query: string;
  onQueryChange: (query: string) => void;
  selectedCatalogItemId: string | null;
  onSelectCatalogItem: (catalogItemId: string) => void;
  isLoading?: boolean;
}

export function AddExistingItemCatalogSelector({
  catalog,
  query,
  onQueryChange,
  selectedCatalogItemId,
  onSelectCatalogItem,
  isLoading = false,
}: AddExistingItemCatalogSelectorProps) {
  const filteredCatalog = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return catalog;
    return catalog.filter((item) => item.name.toLowerCase().includes(trimmed));
  }, [catalog, query]);

  const handleQueryChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onQueryChange(event.target.value);
    },
    [onQueryChange],
  );

  return (
    <div className="space-y-1.5">
      <Label
        htmlFor="add-existing-item-search"
        className="text-xs font-semibold text-muted-foreground uppercase tracking-wide"
      >
        Catalog Item
      </Label>
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          id="add-existing-item-search"
          placeholder="Search catalog by name..."
          value={query}
          onChange={handleQueryChange}
          disabled={isLoading}
          className="pl-9 text-base md:text-sm"
        />
      </div>

      <div
        role="radiogroup"
        aria-label="Select a Catalog Item"
        className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-border divide-y divide-border"
      >
        {filteredCatalog.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            No Catalog Items match "{query}".
          </p>
        ) : (
          filteredCatalog.map((item) => {
            const isSelected = item.id === selectedCatalogItemId;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => onSelectCatalogItem(item.id)}
                disabled={isLoading}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-50',
                  isSelected ? 'bg-brand/10' : 'hover:bg-muted',
                )}
              >
                <span
                  className="text-lg shrink-0 leading-none"
                  aria-hidden="true"
                >
                  {getCategoryEmoji(item.category)}
                </span>
                <span className="grow min-w-0 truncate text-sm font-medium text-foreground">
                  {item.name}
                </span>
                {typeof item.price === 'number' && (
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                    {formatUsd(item.price)}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
