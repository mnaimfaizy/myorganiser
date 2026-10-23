'use client';

import { Button, Illustration, cn } from '@myorganiser/web-ui';
import { pluralize } from '../../shared/utils';
import type { GroceriesLayout } from '../../shared/utils';

interface GroceryListEmptyStateProps {
  variant: GroceriesLayout;
  catalogCount: number;
  onAddItems: () => void;
}

/** A list with no lines. It says so, and points at the two ways to fill it. */
export function GroceryListEmptyState({
  variant,
  catalogCount,
  onAddItems,
}: GroceryListEmptyStateProps) {
  const isPhone = variant === 'phone';

  return (
    <section
      className={cn(
        'flex flex-col items-center text-center',
        isPhone
          ? 'flex-1 justify-center gap-3 px-8 py-6'
          : 'gap-3 rounded-panel border border-dashed border-border-strong bg-card px-6 py-10',
      )}
    >
      <Illustration kind="groceries" size={96} />
      <h2 className="font-display text-title text-foreground">
        Nothing on this list yet
      </h2>
      <p className="text-body-sm text-foreground-secondary">
        {`Add what you need for this shop, or pick from the ${pluralize(catalogCount, 'item')} in your Catalog.`}
      </p>
      <Button
        variant="brand"
        onClick={onAddItems}
        className={cn(isPhone && 'mt-1.5 w-full')}
      >
        Add items
      </Button>
    </section>
  );
}
