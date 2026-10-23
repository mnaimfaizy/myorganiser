'use client';

import type { GroceryCategoryType } from '@myorganiser/vault-core';
import { cn } from '@myorganiser/web-ui';
import { GroceryCategoryIllustration } from '../../shared/components';
import { getCategoryLabel } from '../../shared/constants/categories';
import type { ResolvedLine } from '../../shared/utils';
import type { GroceryListLineActions } from '../hooks/use-grocery-list-page';
import { ListLineRow } from './ListLineRow';
import type { GroceriesLayout } from '../../shared/utils';

interface CategoryLineGroupProps {
  category: GroceryCategoryType;
  lines: ResolvedLine[];
  variant: GroceriesLayout;
  isBusy: boolean;
  actions: GroceryListLineActions;
}

/** Open List Lines of one category, in shop-walk order, under a labelled heading. */
export function CategoryLineGroup({
  category,
  lines,
  variant,
  isBusy,
  actions,
}: CategoryLineGroupProps) {
  const label = getCategoryLabel(category);
  const isPhone = variant === 'phone';

  return (
    <section
      aria-label={label}
      className={cn('flex flex-col', isPhone ? 'gap-1' : 'gap-2')}
    >
      <h2
        className={cn(
          'flex items-center gap-2 text-label-caps text-foreground-secondary uppercase',
          isPhone && 'h-9 items-end px-4 pb-2',
        )}
      >
        <GroceryCategoryIllustration category={category} size={24} />
        {`${label} · ${lines.length}`}
      </h2>
      <div
        className={cn(
          'flex flex-col divide-y divide-border-subtle overflow-hidden rounded-xl border border-border bg-card',
          isPhone && 'mx-4',
        )}
      >
        {lines.map(({ line, item }) => (
          <ListLineRow
            key={line.id}
            line={line}
            item={item}
            variant={variant}
            isBusy={isBusy}
            actions={actions}
          />
        ))}
      </div>
    </section>
  );
}
