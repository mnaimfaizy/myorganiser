'use client';

import { cn } from '@myorganiser/web-ui';
import { useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import type { GroceriesLayout } from '../../shared/utils';

export type GroceriesTab = 'lists' | 'catalog';

const TAB_KEYS: readonly GroceriesTab[] = ['lists', 'catalog'];

/** The DOM id of a tab button, for `aria-labelledby` on its panel. */
export function groceriesTabId(tab: GroceriesTab): string {
  return `groceries-tab-${tab}`;
}

/** The DOM id of a tab panel, for `aria-controls` on its tab button. */
export function groceriesPanelId(tab: GroceriesTab): string {
  return `groceries-panel-${tab}`;
}

export interface GroceriesTabsProps {
  /** Desktop is an underline tab strip; phone is the segmented control. */
  variant: GroceriesLayout;
  tab: GroceriesTab;
  listCount: number;
  catalogCount: number;
  onTabChange: (tab: GroceriesTab) => void;
}

/**
 * The Lists | Catalog switch. Both variants carry the same tab semantics
 * (`role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`); only the
 * drawing differs.
 */
export function GroceriesTabs({
  variant,
  tab,
  listCount,
  catalogCount,
  onTabChange,
}: GroceriesTabsProps) {
  const isPhone = variant === 'phone';

  const labelFor = (key: GroceriesTab): string => {
    if (key === 'lists') return isPhone ? 'Lists' : `Lists · ${listCount}`;
    return `Catalog · ${catalogCount}`;
  };

  // WAI-ARIA tabs: arrows, Home and End move focus and select the tab; only
  // the selected tab sits in the Tab order.
  const handleTablistKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const index = TAB_KEYS.indexOf(tab);
      const last = TAB_KEYS.length - 1;
      let nextIndex: number;
      if (event.key === 'ArrowRight') {
        nextIndex = index === last ? 0 : index + 1;
      } else if (event.key === 'ArrowLeft') {
        nextIndex = index === 0 ? last : index - 1;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = last;
      } else {
        return;
      }
      event.preventDefault();
      const next = TAB_KEYS[nextIndex];
      onTabChange(next);
      document.getElementById(groceriesTabId(next))?.focus();
    },
    [onTabChange, tab],
  );

  return (
    <div
      role="tablist"
      aria-label="Groceries"
      onKeyDown={handleTablistKeyDown}
      className={cn(
        isPhone
          ? 'grid grid-cols-2 gap-0.5 rounded-control bg-secondary p-1'
          : 'flex gap-6 border-b border-border',
      )}
    >
      {TAB_KEYS.map((key) => {
        const selected = key === tab;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            id={groceriesTabId(key)}
            aria-selected={selected}
            aria-controls={groceriesPanelId(key)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onTabChange(key)}
            className={cn(
              'inline-flex items-center transition-colors',
              isPhone
                ? cn(
                    'h-9 justify-center rounded-item text-control-sm',
                    selected
                      ? 'bg-raised-surface font-semibold text-foreground shadow-segment'
                      : 'font-medium text-foreground-secondary',
                  )
                : cn(
                    'h-11 border-b-2 px-0.5 text-body-sm',
                    selected
                      ? 'border-brand font-semibold text-foreground'
                      : 'border-transparent font-medium text-foreground-secondary hover:text-foreground',
                  ),
            )}
          >
            {labelFor(key)}
          </button>
        );
      })}
    </div>
  );
}
