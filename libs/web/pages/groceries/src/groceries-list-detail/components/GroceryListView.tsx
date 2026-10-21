'use client';

import type { GroceryList } from '@myorganiser/vault-core';
import { Button } from '@myorganiser/web-ui';
import { Plus } from 'lucide-react';
import {
  formatRelativeTime,
  lastListActivity,
  pluralize,
} from '../../shared/utils';
import type { GroceryListPageController } from '../hooks/use-grocery-list-page';
import { AllBoughtCallout } from './AllBoughtCallout';
import { CatalogAddStrip } from './CatalogAddStrip';
import { CategoryLineGroup } from './CategoryLineGroup';
import { CheckedSection } from './CheckedSection';
import { GroceryListEmptyState } from './GroceryListEmptyState';
import { ListActionsCard } from './ListActionsCard';
import { ListSummaryAside } from './ListSummaryAside';

interface GroceryListViewProps {
  list: GroceryList;
  page: GroceryListPageController;
}

/**
 * The desktop Grocery List: the lines in shop-walk order with the Catalog
 * strip above them, and a side column of spend and list actions.
 */
export function GroceryListView({ list, page }: GroceryListViewProps) {
  const hasLines = list.lines.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-310 flex-wrap items-start gap-6 p-8">
      <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="font-display text-title-lg text-foreground">
              {list.name}
            </h1>
            <p className="text-body-sm text-muted-foreground">
              {`${pluralize(list.lines.length, 'item')} · updated ${formatRelativeTime(lastListActivity(list))}`}
            </p>
          </div>
          <Button variant="brand" onClick={page.openAddItem}>
            <Plus aria-hidden="true" />
            Add item
          </Button>
        </div>

        <CatalogAddStrip
          catalog={page.catalog}
          listCatalogIds={page.listCatalogIds}
          isBusy={page.isBusy}
          onAdd={page.onAddFromCatalog}
        />

        {page.openGroups.map((group) => (
          <CategoryLineGroup
            key={group.category}
            category={group.category}
            lines={group.lines}
            variant="desktop"
            isBusy={page.isBusy}
            actions={page.lineActions}
          />
        ))}

        {hasLines ? null : (
          <GroceryListEmptyState
            variant="desktop"
            catalogCount={page.catalog.length}
            onAddItems={page.openAddItem}
          />
        )}

        {hasLines && page.progress.allBought ? (
          <AllBoughtCallout
            isBusy={page.isBusy}
            onUncheckAll={page.onUncheckAll}
          />
        ) : null}

        {page.checkedLines.length > 0 ? (
          <CheckedSection
            lines={page.checkedLines}
            checkedKnown={page.summary.checkedKnown}
            variant="desktop"
            isBusy={page.isBusy}
            actions={page.lineActions}
            onUncheckAll={page.onUncheckAll}
            onRemoveChecked={page.onRemoveChecked}
          />
        ) : null}
      </div>

      <aside
        aria-label="List summary"
        className="flex min-w-0 flex-[1_1_280px] flex-col gap-4"
      >
        <ListSummaryAside
          knownSpend={page.summary.known}
          checkedKnown={page.summary.checkedKnown}
          checkedCount={page.progress.checked}
          totalCount={page.progress.total}
          unpricedCount={page.summary.unpricedCount}
        />
        <ListActionsCard
          onRename={page.openRename}
          onAddToMultipleLists={page.openAddExisting}
          onDeleteList={page.openDeleteList}
        />
      </aside>
    </div>
  );
}
