'use client';

import { Button, cn } from '@myorganiser/web-ui';
import { ChevronRight } from 'lucide-react';
import { useCallback, useState } from 'react';
import { formatMoney } from '../../shared/utils';
import type { ResolvedLine } from '../../shared/utils';
import type { GroceryListLineActions } from '../hooks/use-grocery-list-page';
import { ListLineRow } from './ListLineRow';
import type { GroceriesLayout } from '../../shared/utils';

interface CheckedSectionProps {
  lines: ResolvedLine[];
  checkedKnown: number;
  variant: GroceriesLayout;
  isBusy: boolean;
  actions: GroceryListLineActions;
  onUncheckAll: () => void;
  onRemoveChecked: () => void;
}

/**
 * The bought lines, collapsed by default. Desktop carries Uncheck All and
 * Remove Checked beside the toggle; on phone those live in the list menu.
 */
export function CheckedSection({
  lines,
  checkedKnown,
  variant,
  isBusy,
  actions,
  onUncheckAll,
  onRemoveChecked,
}: CheckedSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggleExpanded = useCallback(() => {
    setIsExpanded((value) => !value);
  }, []);

  const chevron = (
    <ChevronRight
      aria-hidden="true"
      className={cn(
        'size-3 shrink-0 transition-transform',
        isExpanded && 'rotate-90',
      )}
    />
  );
  const countLabel = `Checked · ${lines.length}`;
  const spendLabel = formatMoney(checkedKnown);

  if (variant === 'phone') {
    return (
      <div className="mx-4 flex flex-col">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={handleToggleExpanded}
          className="flex min-h-13 w-full items-center gap-2 rounded-xl border border-border bg-card px-4 text-left text-body font-semibold text-foreground"
        >
          {chevron}
          <span className="min-w-0 flex-1">{countLabel}</span>
          <span className="font-normal text-muted-foreground tabular-nums">
            {spendLabel}
          </span>
        </button>
        {isExpanded ? (
          <div className="mt-2 flex flex-col divide-y divide-border-subtle overflow-hidden rounded-xl border border-border bg-card">
            {lines.map(({ line, item }) => (
              <ListLineRow
                key={line.id}
                line={line}
                item={item}
                variant="phone"
                isBusy={isBusy}
                actions={actions}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section
      aria-label="Checked"
      className="flex flex-col rounded-xl border border-border bg-card"
    >
      <div className="flex flex-wrap items-center gap-2.5 py-2.5 pr-3 pl-4">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={handleToggleExpanded}
          className="flex h-11 min-w-0 flex-1 items-center gap-2 text-left text-body font-semibold text-foreground"
        >
          {chevron}
          <span>{countLabel}</span>
          <span className="font-normal text-muted-foreground tabular-nums">
            {`· ${spendLabel}`}
          </span>
        </button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onUncheckAll}
          disabled={isBusy}
        >
          Uncheck All
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onRemoveChecked}
          disabled={isBusy}
        >
          Remove Checked
        </Button>
      </div>
      {isExpanded ? (
        <div className="flex flex-col divide-y divide-border-subtle border-t border-border-subtle">
          {lines.map(({ line, item }) => (
            <ListLineRow
              key={line.id}
              line={line}
              item={item}
              variant="desktop"
              isBusy={isBusy}
              actions={actions}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
