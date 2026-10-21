'use client';

import { useIsMobileState } from '@myorganiser/web-ui';
import type { VaultHandle } from '@myorganiser/web-vault';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { GroceryListDialogs } from './components/GroceryListDialogs';
import { GroceryListPhoneScreen } from './components/GroceryListPhoneScreen';
import { GroceryListView } from './components/GroceryListView';
import { useGroceryListPage } from './hooks/use-grocery-list-page';

interface GroceriesListDetailClientProps {
  listId: string;
  handle: VaultHandle;
}

/**
 * The Grocery List detail route. Loads the page controller, then renders the
 * phone or desktop layout for the breakpoint, with the shared dialogs.
 */
export function GroceriesListDetailClient({
  listId,
  handle,
}: GroceriesListDetailClientProps) {
  const page = useGroceryListPage(listId, handle);
  // Render nothing until the breakpoint is decided, so a phone never paints
  // the desktop layout on the first frame.
  const isPhone = useIsMobileState();
  const list = page.list;

  if (page.loading) {
    return (
      <div
        className="min-h-screen bg-background"
        aria-busy="true"
        aria-label="Loading grocery list"
      >
        <div className="mx-auto max-w-310 p-4 md:p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-11 w-11 animate-pulse rounded-control bg-muted" />
            <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  if (page.isLeaving || isPhone === undefined) {
    return null;
  }

  if (!list) {
    return (
      <div className="mx-auto flex w-full max-w-310 flex-col gap-4 p-4 md:p-8">
        {isPhone ? null : (
          <Link
            href="/dashboard/groceries"
            className="inline-flex items-center gap-2 self-start text-body-sm font-semibold text-brand-text hover:underline focus-visible:underline"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to Groceries
          </Link>
        )}
        <div className="rounded-panel border border-border bg-card p-8 text-center">
          <h2 className="font-display text-title text-foreground">
            List not found
          </h2>
          <p className="mt-2 text-body-sm text-muted-foreground">
            The grocery list you&apos;re looking for doesn&apos;t exist.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {isPhone ? (
        <GroceryListPhoneScreen list={list} page={page} />
      ) : (
        <GroceryListView list={list} page={page} />
      )}
      <GroceryListDialogs list={list} page={page} />
    </>
  );
}
