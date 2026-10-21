'use client';

import type { GroceryCategoryType } from '@myorganiser/vault-core';
import { cn } from '@myorganiser/web-ui';
import { useCallback } from 'react';
import type { ChangeEvent } from 'react';
import { GroceryCategoryIllustration } from '../../shared/components';
import {
  CATEGORY_ORDER,
  getCategoryLabel,
} from '../../shared/constants/categories';

interface CategoryPickerProps {
  value: GroceryCategoryType;
  onChange: (category: GroceryCategoryType) => void;
  disabled?: boolean;
}

/** The category of a new item, as a grid of radios in shop-walk order. */
export function CategoryPicker({
  value,
  onChange,
  disabled = false,
}: CategoryPickerProps) {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onChange(event.target.value as GroceryCategoryType);
    },
    [onChange],
  );

  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 text-body font-semibold text-foreground">
        Category
      </legend>
      <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
        {CATEGORY_ORDER.map((category) => {
          const selected = category === value;
          return (
            <label
              key={category}
              className={cn(
                'relative flex min-h-12 cursor-pointer items-center gap-1.5 rounded-control-sm px-2 py-1.5 text-control-sm text-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background',
                selected
                  ? 'border-2 border-primary bg-background font-semibold'
                  : 'border border-border bg-card hover:bg-ghost-hover',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name="category"
                value={category}
                checked={selected}
                onChange={handleChange}
                disabled={disabled}
                className="sr-only"
              />
              <GroceryCategoryIllustration category={category} size={24} />
              <span className="min-w-0 hyphens-auto leading-tight">
                {getCategoryLabel(category)}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
