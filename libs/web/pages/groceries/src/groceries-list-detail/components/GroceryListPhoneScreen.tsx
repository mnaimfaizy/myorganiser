'use client';

import type { GroceryList } from '@myorganiser/vault-core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Progress,
} from '@myorganiser/web-ui';
import { MoreHorizontal } from 'lucide-react';
import type { GroceryListPageController } from '../hooks/use-grocery-list-page';
import { AddToListSheet } from './AddToListSheet';
import { AllBoughtCallout } from './AllBoughtCallout';
import { CategoryLineGroup } from './CategoryLineGroup';
import { CheckedSection } from './CheckedSection';
import { GroceryListEmptyState } from './GroceryListEmptyState';
import { PhoneSpendBar } from './PhoneSpendBar';

interface GroceryListPhoneScreenProps {
  list: GroceryList;
  page: GroceryListPageController;
}

/**
 * The phone Grocery List, in the shop: a title block with progress, the lines
 * by category, the checked disclosure, and a spend bar that opens the add sheet.
 * The shell draws the back link, so this screen does not.
 */
export function GroceryListPhoneScreen({
  list,
  page,
}: GroceryListPhoneScreenProps) {
  const { progress } = page;
  const hasLines = list.lines.length > 0;
  const noneChecked = progress.checked === 0;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-border bg-raised-surface px-4 pb-3">
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 flex-1 font-display text-title-lg text-foreground">
            {list.name}
          </h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                variant="ghost"
                label="List actions"
                icon={<MoreHorizontal />}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={page.openRename}>
                Rename list
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={page.openAddExisting}>
                Add to multiple lists…
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={page.onUncheckAll}
                disabled={noneChecked}
              >
                Uncheck All
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={page.onRemoveChecked}
                disabled={noneChecked}
              >
                Remove Checked
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={page.openDeleteList}
              >
                Delete Grocery List…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {hasLines ? (
          <>
            <div className="flex items-center justify-between text-body-sm">
              <span>
                <b className="font-semibold tabular-nums text-foreground">
                  {`${progress.checked} of ${progress.total}`}
                </b>{' '}
                <span className="text-muted-foreground">checked</span>
              </span>
              <span className="text-muted-foreground">{`${progress.left} left`}</span>
            </div>
            <Progress
              aria-label={`${list.name} progress`}
              value={progress.checked}
              max={progress.total}
            />
          </>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-4 pt-1.5 pb-4">
        {hasLines ? (
          <>
            {page.openGroups.map((group) => (
              <CategoryLineGroup
                key={group.category}
                category={group.category}
                lines={group.lines}
                variant="phone"
                isBusy={page.isBusy}
                actions={page.lineActions}
              />
            ))}
            {progress.allBought ? (
              <div className="mx-4">
                <AllBoughtCallout
                  isBusy={page.isBusy}
                  onUncheckAll={page.onUncheckAll}
                />
              </div>
            ) : null}
            {page.checkedLines.length > 0 ? (
              <CheckedSection
                lines={page.checkedLines}
                checkedKnown={page.summary.checkedKnown}
                variant="phone"
                isBusy={page.isBusy}
                actions={page.lineActions}
                onUncheckAll={page.onUncheckAll}
                onRemoveChecked={page.onRemoveChecked}
              />
            ) : null}
          </>
        ) : (
          <GroceryListEmptyState
            variant="phone"
            catalogCount={page.catalog.length}
            onAddItems={page.openAddSheet}
          />
        )}
      </div>

      {hasLines ? (
        <PhoneSpendBar
          knownSpend={page.summary.known}
          unpricedCount={page.summary.unpricedCount}
          onAddItem={page.openAddSheet}
        />
      ) : null}

      <AddToListSheet
        isOpen={page.isAddSheetOpen}
        listName={list.name}
        catalog={page.catalog}
        listCatalogIds={page.listCatalogIds}
        listCounts={page.listCounts}
        isBusy={page.isBusy}
        onClose={page.closeAddSheet}
        onAddFromCatalog={page.onAddFromCatalog}
        onRequestNewItem={page.openAddItemNamed}
      />
    </div>
  );
}
