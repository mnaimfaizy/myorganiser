'use client';

import type { MobileNumberRecord } from '@myorganiser/vault-core';
import {
  ConfirmDialog,
  IconButton,
  Input,
  ListGroup,
} from '@myorganiser/web-ui';
import { CopyStatus, useExpiringCopy } from '@myorganiser/web-usage-locations';
import { Plus, Search } from 'lucide-react';
import { type ChangeEvent, type ReactNode, useCallback, useState } from 'react';

import type { MobileNumbersPageController } from '../hooks/use-mobile-numbers-page';
import { formatMobileNumber } from '../utils/formatMobileNumber';
import {
  describeMobileNumberDeletion,
  filterMobileNumbers,
  formatMobileNumbersPhoneSummary,
  formatMobileNumbersSummary,
} from '../utils/mobile-summary';
import { AddMobileNumberDialog } from './AddMobileNumberDialog';
import { MobileNumberPhoneRow } from './mobile-number-phone-row';
import { MobileNumberRow } from './mobile-number-row';
import { MobileNumbersEmpty } from './mobile-numbers-empty';
import { MobileNumbersHeader } from './mobile-numbers-header';

export interface MobileNumbersBoardProps {
  page: MobileNumbersPageController;
  variant: 'desktop' | 'phone';
}

const DESKTOP_CONTAINER = 'mx-auto flex w-full max-w-310 flex-col gap-5.5 p-8';
const PHONE_CONTAINER = 'flex flex-col gap-3.5 pt-1 pb-24';
const NO_MATCHES = 'text-body-sm text-muted-foreground';

/**
 * The Mobile numbers list. It owns the search, the add dialog, the delete
 * target and the copy confirmation, and reads and writes through the
 * `useMobileNumbersPage` controller it is given.
 */
export function MobileNumbersBoard({ page, variant }: MobileNumbersBoardProps) {
  const { items, loading, addMobileNumber, deleteMobileNumber } = page;
  const isPhone = variant === 'phone';

  const [query, setQuery] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MobileNumberRecord | null>(
    null,
  );
  const { copy, message: copyMessage } = useExpiringCopy();

  const visibleItems = filterMobileNumbers(items, query);
  const summary = loading
    ? ''
    : isPhone
      ? formatMobileNumbersPhoneSummary(items)
      : formatMobileNumbersSummary(items);

  const handleAdd = useCallback(() => {
    setIsAddOpen(true);
  }, []);

  const handleAddOpenChange = useCallback((open: boolean) => {
    setIsAddOpen(open);
  }, []);

  const handleQueryChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setQuery(event.target.value);
    },
    [],
  );

  const handleCopyItem = useCallback(
    (item: MobileNumberRecord) => {
      void copy('', formatMobileNumber(item));
    },
    [copy],
  );

  const handleRequestDelete = useCallback((item: MobileNumberRecord) => {
    setDeleteTarget(item);
  }, []);

  const handleDeleteOpenChange = useCallback((open: boolean) => {
    if (!open) setDeleteTarget(null);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    // On failure the dialog stays open so the user can retry.
    const deleted = await deleteMobileNumber(deleteTarget.id);
    if (deleted) setDeleteTarget(null);
  }, [deleteMobileNumber, deleteTarget]);

  const addDialog = (
    <AddMobileNumberDialog
      open={isAddOpen}
      onOpenChange={handleAddOpenChange}
      onAdd={addMobileNumber}
    />
  );

  const deleteDialog = deleteTarget ? (
    <ConfirmDialog
      open
      onOpenChange={handleDeleteOpenChange}
      title={`Delete "${deleteTarget.label}"?`}
      description={describeMobileNumberDeletion(deleteTarget)}
      confirmLabel="Delete mobile number"
      tone="destructive"
      onConfirm={handleConfirmDelete}
    />
  ) : null;

  const statusRegion = (
    <CopyStatus
      message={copyMessage}
      variant={isPhone ? 'phone' : 'floating'}
    />
  );

  let body: ReactNode;

  if (loading) {
    body = (
      <div className={isPhone ? PHONE_CONTAINER : DESKTOP_CONTAINER}>
        <MobileNumbersHeader summary="" onAdd={handleAdd} variant={variant} />
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className={isPhone ? PHONE_CONTAINER : DESKTOP_CONTAINER}>
        <MobileNumbersEmpty onAdd={handleAdd} variant={variant} />
      </div>
    );
  } else if (isPhone) {
    body = (
      <div className={PHONE_CONTAINER}>
        <MobileNumbersHeader
          summary={summary}
          onAdd={handleAdd}
          variant="phone"
        />
        <ListGroup>
          {items.map((item) => (
            <MobileNumberPhoneRow
              key={item.id}
              item={item}
              onCopy={handleCopyItem}
            />
          ))}
        </ListGroup>
        <IconButton
          variant="brand"
          size="fab"
          label="Add mobile number"
          onClick={handleAdd}
          className="fixed right-4 bottom-[calc(var(--toast-offset,0px)+1rem)] z-10 md:hidden"
        >
          <Plus aria-hidden="true" />
        </IconButton>
      </div>
    );
  } else {
    body = (
      <div className={DESKTOP_CONTAINER}>
        <MobileNumbersHeader
          summary={summary}
          onAdd={handleAdd}
          variant="desktop"
        />
        <label className="relative flex w-75">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <span className="sr-only">Filter mobile numbers</span>
          <Input
            type="text"
            value={query}
            onChange={handleQueryChange}
            placeholder="Filter by label or number"
            className="h-10 pl-10 text-body-sm"
          />
        </label>
        {visibleItems.length === 0 ? (
          <p className={NO_MATCHES}>No mobile numbers match your search.</p>
        ) : (
          <section
            aria-label="Mobile numbers"
            className="flex flex-col overflow-hidden rounded-panel border border-border bg-card"
          >
            {visibleItems.map((item) => (
              <MobileNumberRow
                key={item.id}
                item={item}
                onCopy={handleCopyItem}
                onRequestDelete={handleRequestDelete}
              />
            ))}
          </section>
        )}
      </div>
    );
  }

  return (
    <>
      {body}
      {statusRegion}
      {addDialog}
      {deleteDialog}
    </>
  );
}
