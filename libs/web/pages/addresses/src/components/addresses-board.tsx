'use client';

import type { AddressRecord } from '@myorganiser/vault-core';
import { ConfirmDialog, IconButton, ListGroup } from '@myorganiser/web-ui';
import { CopyStatus, useExpiringCopy } from '@myorganiser/web-usage-locations';
import { Plus } from 'lucide-react';
import { type ReactNode, useCallback, useState } from 'react';

import type { AddressesPageController } from '../hooks/use-addresses-page';
import {
  type AddressListFilter,
  countAddressesByStatus,
  describeAddressDeletion,
  filterAddresses,
  formatAddressesPhoneSummary,
  formatAddressesSummary,
  formatAddressForCopy,
} from '../utils/address-summary';
import { AddressCard } from './address-card';
import { AddressFilters } from './address-filters';
import { AddressFormSheet } from './address-form-sheet';
import { AddressRow } from './address-row';
import { AddressesEmpty } from './addresses-empty';
import { AddressesHeader } from './addresses-header';

export interface AddressesBoardProps {
  page: AddressesPageController;
  variant: 'desktop' | 'phone';
}

const DESKTOP_CONTAINER = 'mx-auto flex w-full max-w-310 flex-col gap-5.5 p-8';
const PHONE_CONTAINER = 'flex flex-col gap-3.5 pt-1 pb-24';
const NO_MATCHES = 'text-body-sm text-muted-foreground';

/**
 * The Addresses list. It owns the search, the status filter, the add sheet,
 * the row-menu delete target and the copy confirmation, and reads and writes
 * through the `useAddressesPage` controller it is given.
 */
export function AddressesBoard({ page, variant }: AddressesBoardProps) {
  const { items, loading, addAddress, deleteAddress } = page;
  const isPhone = variant === 'phone';

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AddressListFilter>('all');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AddressRecord | null>(null);
  const { copy, message: copyMessage } = useExpiringCopy();

  const counts = countAddressesByStatus(items);
  const visibleItems = filterAddresses(items, query, filter);
  const summary = loading
    ? ''
    : isPhone
      ? formatAddressesPhoneSummary(items)
      : formatAddressesSummary(items);

  const handleAdd = useCallback(() => {
    setIsAddOpen(true);
  }, []);

  const handleAddOpenChange = useCallback((open: boolean) => {
    setIsAddOpen(open);
  }, []);

  const handleQueryChange = useCallback((next: string) => {
    setQuery(next);
  }, []);

  const handleFilterChange = useCallback((next: AddressListFilter) => {
    setFilter(next);
  }, []);

  const handleCopyAddress = useCallback(
    (address: AddressRecord) => {
      void copy('Address', formatAddressForCopy(address));
    },
    [copy],
  );

  const handleRequestDelete = useCallback((address: AddressRecord) => {
    setDeleteTarget(address);
  }, []);

  const handleDeleteOpenChange = useCallback((open: boolean) => {
    if (!open) setDeleteTarget(null);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    // On failure the dialog stays open so the user can retry.
    const deleted = await deleteAddress(deleteTarget.id);
    if (deleted) setDeleteTarget(null);
  }, [deleteAddress, deleteTarget]);

  const addSheet = (
    <AddressFormSheet
      open={isAddOpen}
      onOpenChange={handleAddOpenChange}
      mode="add"
      items={items}
      onSubmit={addAddress}
      variant={variant}
    />
  );

  const deleteDialog = deleteTarget ? (
    <ConfirmDialog
      open
      onOpenChange={handleDeleteOpenChange}
      title={`Delete "${deleteTarget.label}"?`}
      description={describeAddressDeletion(deleteTarget)}
      confirmLabel="Delete address"
      tone="destructive"
      onConfirm={handleConfirmDelete}
    />
  ) : null;

  const noMatches = (
    <p className={NO_MATCHES}>No addresses match your search.</p>
  );

  let body: ReactNode;
  // Only the desktop copy confirmation renders here. The slot exists on every
  // branch, so the add sheet and delete dialog keep the same fragment position.
  let statusRegion: ReactNode = null;

  if (loading) {
    body = (
      <div className={isPhone ? PHONE_CONTAINER : DESKTOP_CONTAINER}>
        <AddressesHeader summary="" onAdd={handleAdd} variant={variant} />
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className={isPhone ? PHONE_CONTAINER : DESKTOP_CONTAINER}>
        <AddressesEmpty onAdd={handleAdd} variant={variant} />
      </div>
    );
  } else if (isPhone) {
    body = (
      <div className={PHONE_CONTAINER}>
        <AddressesHeader summary={summary} onAdd={handleAdd} variant="phone" />
        <AddressFilters
          query={query}
          onQueryChange={handleQueryChange}
          filter={filter}
          onFilterChange={handleFilterChange}
          counts={counts}
          variant="phone"
        />
        {visibleItems.length === 0 ? (
          noMatches
        ) : (
          <ListGroup>
            {visibleItems.map((address) => (
              <AddressRow key={address.id} address={address} />
            ))}
          </ListGroup>
        )}
        <IconButton
          variant="brand"
          size="fab"
          label="Add address"
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
        <AddressesHeader
          summary={summary}
          onAdd={handleAdd}
          variant="desktop"
        />
        <AddressFilters
          query={query}
          onQueryChange={handleQueryChange}
          filter={filter}
          onFilterChange={handleFilterChange}
          counts={counts}
          variant="desktop"
        />
        {visibleItems.length === 0 ? (
          noMatches
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,26.25rem),1fr))] gap-4">
            {visibleItems.map((address) => (
              <AddressCard
                key={address.id}
                address={address}
                onCopy={handleCopyAddress}
                onRequestDelete={handleRequestDelete}
              />
            ))}
          </div>
        )}
      </div>
    );
    statusRegion = <CopyStatus message={copyMessage} variant="floating" />;
  }

  return (
    <>
      {body}
      {statusRegion}
      {addSheet}
      {deleteDialog}
    </>
  );
}
