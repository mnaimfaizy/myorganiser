'use client';

import {
  AddressStatusEnum,
  type AddressStatus,
  type UsageLocationRecord,
} from '@myorganiser/vault-core';
import { ConfirmDialog, useIsMobileState } from '@myorganiser/web-ui';
import {
  PlaceDialog,
  PlaceSheet,
  type PlaceFormValues,
  useExpiringCopy,
} from '@myorganiser/web-usage-locations';
import type { VaultHandle } from '@myorganiser/web-vault';
import { VaultGate } from '@myorganiser/web-vault-ui';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

import { useAddressesPage } from '../hooks/use-addresses-page';
import type { AddAddressFormValues } from '../schemas/address';
import {
  describeAddressDeletion,
  formatAddressForCopy,
} from '../utils/address-summary';
import { AddressDetail } from './address-detail';
import { AddressDetailScreen } from './address-detail-screen';
import { AddressDetailLoading } from './AddressDetailLoading';
import { AddressDetailNotFound } from './AddressDetailNotFound';
import { AddressFormSheet } from './address-form-sheet';

const ADDRESSES_HREF = '/dashboard/addresses';

/** The label of the status button: it offers the status the Address is not in. */
const STATUS_ACTION_LABEL = {
  [AddressStatusEnum.Current]: 'Mark as old',
  [AddressStatusEnum.Old]: 'Mark as current',
} as const satisfies Record<AddressStatus, string>;

const NEXT_STATUS = {
  [AddressStatusEnum.Current]: AddressStatusEnum.Old,
  [AddressStatusEnum.Old]: AddressStatusEnum.Current,
} as const satisfies Record<AddressStatus, AddressStatus>;

export interface AddressDetailPageClientProps {
  params: { id: string };
}

interface AddressDetailInnerProps {
  handle: VaultHandle;
  addressId: string;
}

interface PlaceDialogState {
  open: boolean;
  /** null means add; a record means edit with that record loaded. */
  location: UsageLocationRecord | null;
}

/**
 * The Address detail route. The page owns every dialog, sheet and confirm,
 * and the vault writes come from `useAddressesPage`, so the desktop and the
 * phone detail share one set of behaviours.
 */
function AddressDetailInner({ handle, addressId }: AddressDetailInnerProps) {
  const router = useRouter();
  const page = useAddressesPage(handle);
  const { copy, message: copyMessage } = useExpiringCopy();
  // Render nothing until the breakpoint is decided, so a phone never paints
  // the desktop detail on the first frame.
  const isPhone = useIsMobileState();

  const {
    items,
    loading,
    updateAddress,
    setAddressStatus,
    deleteAddress,
    saveLocation,
    setLocationChanged,
    deleteLocation,
  } = page;
  const address = items.find((x) => x.id === addressId);
  const today = new Date();

  const [editing, setEditing] = useState(false);
  const [placeDialog, setPlaceDialog] = useState<PlaceDialogState>({
    open: false,
    location: null,
  });
  const [deletingPlace, setDeletingPlace] =
    useState<UsageLocationRecord | null>(null);
  const [deletingAddress, setDeletingAddress] = useState(false);
  const [pendingPlaceIds, setPendingPlaceIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Set while the Address is being deleted, so the not-found state does not
  // flash in the moment before the explicit navigation back to the list.
  const leavingRef = useRef(false);

  const handleRequestEdit = useCallback(() => {
    setEditing(true);
  }, []);

  const handleEditOpenChange = useCallback((open: boolean) => {
    setEditing(open);
  }, []);

  const handleSubmitEdit = useCallback(
    (values: AddAddressFormValues) => updateAddress(addressId, values),
    [addressId, updateAddress],
  );

  const handleToggleStatus = useCallback(() => {
    if (!address) return;
    void setAddressStatus(addressId, NEXT_STATUS[address.status]);
  }, [address, addressId, setAddressStatus]);

  const handleCopyField = useCallback(
    (label: string, value: string) => {
      void copy(label, value);
    },
    [copy],
  );

  const handleCopyAll = useCallback(() => {
    if (!address) return;
    void copy('Address', formatAddressForCopy(address));
  }, [address, copy]);

  const handleAddPlace = useCallback(() => {
    setPlaceDialog({ open: true, location: null });
  }, []);

  const handleEditPlace = useCallback((location: UsageLocationRecord) => {
    setPlaceDialog({ open: true, location });
  }, []);

  const handlePlaceOpenChange = useCallback((open: boolean) => {
    // The location is kept so the dialog does not change its title while it closes.
    setPlaceDialog((state) => ({ ...state, open }));
  }, []);

  const handleSubmitPlace = useCallback(
    async (values: PlaceFormValues, editingId: string | null) => {
      // A rejection keeps the dialog open for a retry.
      await saveLocation(addressId, values, editingId);
      setPlaceDialog((state) => ({ ...state, open: false }));
    },
    [addressId, saveLocation],
  );

  const handleSetPlaceChanged = useCallback(
    async (locationId: string, changed: boolean) => {
      setPendingPlaceIds((prev) => new Set(prev).add(locationId));
      try {
        await setLocationChanged(addressId, locationId, changed);
      } finally {
        setPendingPlaceIds((prev) => {
          const next = new Set(prev);
          next.delete(locationId);
          return next;
        });
      }
    },
    [addressId, setLocationChanged],
  );

  const handleRequestDeletePlace = useCallback(
    (location: UsageLocationRecord) => {
      setDeletingPlace(location);
    },
    [],
  );

  const handleDeletePlaceOpenChange = useCallback((open: boolean) => {
    if (!open) setDeletingPlace(null);
  }, []);

  const handleConfirmDeletePlace = useCallback(async () => {
    if (!deletingPlace) return;
    // On failure the dialog stays open so the User can retry.
    const deleted = await deleteLocation(addressId, deletingPlace.id);
    if (deleted) setDeletingPlace(null);
  }, [addressId, deleteLocation, deletingPlace]);

  const handleRequestDeleteAddress = useCallback(() => {
    setDeletingAddress(true);
  }, []);

  const handleDeleteAddressOpenChange = useCallback((open: boolean) => {
    setDeletingAddress(open);
  }, []);

  const handleConfirmDeleteAddress = useCallback(async () => {
    leavingRef.current = true;
    const deleted = await deleteAddress(addressId);
    if (deleted) {
      setDeletingAddress(false);
      router.push(ADDRESSES_HREF);
    } else {
      // Stay on the detail with the dialog open, so the User can retry.
      leavingRef.current = false;
    }
  }, [addressId, deleteAddress, router]);

  if (isPhone === undefined) {
    return null;
  }

  if (loading) {
    return <AddressDetailLoading />;
  }

  if (!address) {
    return leavingRef.current ? null : <AddressDetailNotFound />;
  }

  const placeFormProps = {
    open: placeDialog.open,
    location: placeDialog.location,
    existingLocations: address.usageLocations,
    subject: address.label,
    noun: 'address' as const,
    onOpenChange: handlePlaceOpenChange,
    onSubmit: handleSubmitPlace,
  };

  return (
    <>
      {isPhone ? (
        <AddressDetailScreen
          address={address}
          copyMessage={copyMessage}
          statusActionLabel={STATUS_ACTION_LABEL[address.status]}
          pendingPlaceIds={pendingPlaceIds}
          onEdit={handleRequestEdit}
          onToggleStatus={handleToggleStatus}
          onCopyField={handleCopyField}
          onCopyAll={handleCopyAll}
          onAddPlace={handleAddPlace}
          onEditPlace={handleEditPlace}
          onSetPlaceChanged={handleSetPlaceChanged}
          onRequestDeletePlace={handleRequestDeletePlace}
          onRequestDeleteAddress={handleRequestDeleteAddress}
        />
      ) : (
        <AddressDetail
          address={address}
          today={today}
          copyMessage={copyMessage}
          statusActionLabel={STATUS_ACTION_LABEL[address.status]}
          pendingPlaceIds={pendingPlaceIds}
          onEdit={handleRequestEdit}
          onToggleStatus={handleToggleStatus}
          onCopyField={handleCopyField}
          onCopyAll={handleCopyAll}
          onAddPlace={handleAddPlace}
          onEditPlace={handleEditPlace}
          onSetPlaceChanged={handleSetPlaceChanged}
          onRequestDeletePlace={handleRequestDeletePlace}
          onRequestDeleteAddress={handleRequestDeleteAddress}
        />
      )}

      <AddressFormSheet
        open={editing}
        onOpenChange={handleEditOpenChange}
        mode="edit"
        address={address}
        items={items}
        onSubmit={handleSubmitEdit}
        variant={isPhone ? 'phone' : 'desktop'}
      />

      {isPhone ? (
        <PlaceSheet {...placeFormProps} />
      ) : (
        <PlaceDialog {...placeFormProps} />
      )}

      {deletingPlace ? (
        <ConfirmDialog
          open
          onOpenChange={handleDeletePlaceOpenChange}
          title={`Delete "${deletingPlace.organisationName}"?`}
          description="This action cannot be undone. This usage location will be permanently removed from this address."
          confirmLabel="Delete place"
          tone="destructive"
          onConfirm={handleConfirmDeletePlace}
        />
      ) : null}

      {deletingAddress ? (
        <ConfirmDialog
          open
          onOpenChange={handleDeleteAddressOpenChange}
          title={`Delete "${address.label}"?`}
          description={describeAddressDeletion(address)}
          confirmLabel="Delete address"
          tone="destructive"
          onConfirm={handleConfirmDeleteAddress}
        />
      ) : null}
    </>
  );
}

export function AddressDetailPageClient({
  params,
}: AddressDetailPageClientProps) {
  return (
    <VaultGate title="Address">
      {({ handle }) =>
        handle ? (
          <AddressDetailInner handle={handle} addressId={params.id} />
        ) : null
      }
    </VaultGate>
  );
}
