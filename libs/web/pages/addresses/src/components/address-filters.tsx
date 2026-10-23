'use client';

import { ChoiceChip, Input } from '@myorganiser/web-ui';
import { Search } from 'lucide-react';
import { type ChangeEvent, useCallback } from 'react';

import type { AddressListFilter } from '../utils/address-summary';
import {
  ADDRESS_FILTER_KEYS,
  ADDRESS_FILTER_LABELS,
} from '../utils/presentation';

interface AddressFiltersProps {
  query: string;
  onQueryChange: (next: string) => void;
  filter: AddressListFilter;
  onFilterChange: (next: AddressListFilter) => void;
  counts: Record<AddressListFilter, number>;
  /** Desktop shows the status chips beside the search; phone shows the search alone. */
  variant: 'desktop' | 'phone';
}

/**
 * The search field and, on desktop, the status chips. Search matches label,
 * street, country or the full address.
 */
const AddressFilters = ({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  counts,
  variant,
}: AddressFiltersProps) => {
  const handleQueryChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onQueryChange(event.target.value);
    },
    [onQueryChange],
  );

  const chooseFilter = useCallback(
    (next: AddressListFilter) => {
      onFilterChange(next);
    },
    [onFilterChange],
  );

  const isPhone = variant === 'phone';

  return (
    <div
      className={
        isPhone ? 'flex flex-col gap-3' : 'flex flex-wrap items-center gap-2.5'
      }
    >
      <label className={isPhone ? 'relative flex' : 'relative flex w-75'}>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <span className="sr-only">Filter addresses</span>
        <Input
          type="text"
          value={query}
          onChange={handleQueryChange}
          placeholder={
            isPhone ? 'Filter addresses' : 'Filter by label, street or country'
          }
          className={
            isPhone
              ? 'h-11 border-transparent bg-secondary pl-10 text-body'
              : 'h-10 pl-10 md:h-10 text-body-sm'
          }
        />
      </label>

      {isPhone ? null : (
        <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
          {ADDRESS_FILTER_KEYS.map((key) => (
            <ChoiceChip
              key={key}
              pressed={filter === key}
              onPressedChange={() => chooseFilter(key)}
            >
              {`${ADDRESS_FILTER_LABELS[key]} · ${counts[key]}`}
            </ChoiceChip>
          ))}
        </div>
      )}
    </div>
  );
};

export { AddressFilters };
export type { AddressFiltersProps };
