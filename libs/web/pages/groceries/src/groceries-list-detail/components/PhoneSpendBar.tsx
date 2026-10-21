'use client';

import { Button } from '@myorganiser/web-ui';
import { Plus } from 'lucide-react';
import { formatMoney } from '../../shared/utils';

interface PhoneSpendBarProps {
  knownSpend: number;
  unpricedCount: number;
  onAddItem: () => void;
}

/** The sticky bottom bar of a phone Grocery List: known spend and the add action. */
export function PhoneSpendBar({
  knownSpend,
  unpricedCount,
  onAddItem,
}: PhoneSpendBarProps) {
  return (
    <div className="sticky bottom-0 z-10 flex items-center gap-3 border-t border-border bg-raised-surface px-4 pt-3 pb-[calc(1rem_+_env(safe-area-inset-bottom))]">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-label-caps text-muted-foreground">
          KNOWN SPEND
        </span>
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-display text-title tabular-nums text-foreground">
            {formatMoney(knownSpend)}
          </span>
          {unpricedCount > 0 ? (
            <span className="text-caption text-warning-text">
              {`· ${unpricedCount} unpriced`}
            </span>
          ) : null}
        </span>
      </div>
      <Button variant="brand" onClick={onAddItem}>
        <Plus aria-hidden="true" />
        Add item
      </Button>
    </div>
  );
}
