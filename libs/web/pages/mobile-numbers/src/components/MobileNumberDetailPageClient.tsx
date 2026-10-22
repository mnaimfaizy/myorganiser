'use client';

import type { UsageLocationRecord } from '@myorganiser/vault-core';
import { ConfirmDialog, useIsMobileState } from '@myorganiser/web-ui';
import {
  PlaceDialog,
  type PlaceFormValues,
  PlaceSheet,
  useExpiringCopy,
} from '@myorganiser/web-usage-locations';
import type { VaultHandle } from '@myorganiser/web-vault';
import { VaultGate } from '@myorganiser/web-vault-ui';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

import { useMobileNumbersPage } from '../hooks/use-mobile-numbers-page';
import type { AddMobileNumberFormValues } from '../schemas/mobileNumber';
import { formatMobileNumber } from '../utils/formatMobileNumber';
import { describeMobileNumberDeletion } from '../utils/mobile-summary';
import { MobileNumberDetail } from './mobile-number-detail';
import { MobileNumberDetailScreen } from './mobile-number-detail-screen';
import { MobileNumberDetailLoading } from './MobileNumberDetailLoading';
import { MobileNumberDetailNotFound } from './MobileNumberDetailNotFound';
import { MobileNumberEditDialog } from './MobileNumberEditDialog';

const MOBILE_NUMBERS_HREF = '/dashboard/mobile-numbers';

export interface MobileNumberDetailPageClientProps {
  params: { id: string };
}

interface MobileNumberDetailInnerProps {
  handle: VaultHandle;
  mobileNumberId: string;
}

interface PlaceDialogState {
  open: boolean;
  /** null means add; a record means edit with that record loaded. */
  location: UsageLocationRecord | null;
}

/**
 * The Mobile Number detail route. The page owns every dialog, sheet and
 * confirm, and the vault writes come from `useMobileNumbersPage`, so the
 * desktop and the phone detail share one set of behaviours.
 */
function MobileNumberDetailInner({
  handle,
  mobileNumberId,
}: MobileNumberDetailInnerProps) {
  const router = useRouter();
  const page = useMobileNumbersPage(handle);
  const { copy, message: copyMessage } = useExpiringCopy();
  // Render nothing until the breakpoint is decided, so a phone never paints
  // the desktop detail on the first frame.
  const isPhone = useIsMobileState();

  const {
    items,
    loading,
    updateMobileNumber,
    deleteMobileNumber,
    saveLocation,
    setLocationChanged,
    deleteLocation,
  } = page;
  const item = items.find((x) => x.id === mobileNumberId);
  const today = new Date();

  const [editing, setEditing] = useState(false);
  const [placeDialog, setPlaceDialog] = useState<PlaceDialogState>({
    open: false,
    location: null,
  });
  const [deletingPlace, setDeletingPlace] =
    useState<UsageLocationRecord | null>(null);
  const [deletingNumber, setDeletingNumber] = useState(false);
  const [pendingPlaceIds, setPendingPlaceIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Set while the Mobile Number is being deleted, so the not-found state does
  // not flash in the moment before the explicit navigation back to the list.
  const leavingRef = useRef(false);

  const handleRequestEdit = useCallback(() => {
    setEditing(true);
  }, []);

  const handleEditOpenChange = useCallback((open: boolean) => {
    setEditing(open);
  }, []);

  const handleSubmitEdit = useCallback(
    (id: string, values: AddMobileNumberFormValues) =>
      updateMobileNumber(id, values),
    [updateMobileNumber],
  );

  const handleCopyNumber = useCallback(() => {
    if (!item) return;
    void copy('', formatMobileNumber(item));
  }, [copy, item]);

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
      await saveLocation(mobileNumberId, values, editingId);
      setPlaceDialog((state) => ({ ...state, open: false }));
    },
    [mobileNumberId, saveLocation],
  );

  const handleSetPlaceChanged = useCallback(
    async (locationId: string, changed: boolean) => {
      setPendingPlaceIds((prev) => new Set(prev).add(locationId));
      try {
        await setLocationChanged(mobileNumberId, locationId, changed);
      } finally {
        setPendingPlaceIds((prev) => {
          const next = new Set(prev);
          next.delete(locationId);
          return next;
        });
      }
    },
    [mobileNumberId, setLocationChanged],
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
    const deleted = await deleteLocation(mobileNumberId, deletingPlace.id);
    if (deleted) setDeletingPlace(null);
  }, [deleteLocation, deletingPlace, mobileNumberId]);

  const handleRequestDeleteNumber = useCallback(() => {
    setDeletingNumber(true);
  }, []);

  const handleDeleteNumberOpenChange = useCallback((open: boolean) => {
    setDeletingNumber(open);
  }, []);

  const handleConfirmDeleteNumber = useCallback(async () => {
    leavingRef.current = true;
    const deleted = await deleteMobileNumber(mobileNumberId);
    if (deleted) {
      setDeletingNumber(false);
      router.push(MOBILE_NUMBERS_HREF);
    } else {
      // Stay on the detail with the dialog open, so the User can retry.
      leavingRef.current = false;
    }
  }, [deleteMobileNumber, mobileNumberId, router]);

  if (isPhone === undefined) {
    return null;
  }

  if (loading) {
    return <MobileNumberDetailLoading />;
  }

  if (!item) {
    return leavingRef.current ? null : <MobileNumberDetailNotFound />;
  }

  const placeFormProps = {
    open: placeDialog.open,
    location: placeDialog.location,
    existingLocations: item.usageLocations,
    subject: `${item.label} (${formatMobileNumber(item)})`,
    noun: 'number' as const,
    onOpenChange: handlePlaceOpenChange,
    onSubmit: handleSubmitPlace,
  };

  return (
    <>
      {isPhone ? (
        <MobileNumberDetailScreen
          item={item}
          copyMessage={copyMessage}
          pendingPlaceIds={pendingPlaceIds}
          onEdit={handleRequestEdit}
          onCopyNumber={handleCopyNumber}
          onAddPlace={handleAddPlace}
          onEditPlace={handleEditPlace}
          onSetPlaceChanged={handleSetPlaceChanged}
          onRequestDeletePlace={handleRequestDeletePlace}
          onRequestDelete={handleRequestDeleteNumber}
        />
      ) : (
        <MobileNumberDetail
          item={item}
          today={today}
          copyMessage={copyMessage}
          pendingPlaceIds={pendingPlaceIds}
          onEdit={handleRequestEdit}
          onCopyNumber={handleCopyNumber}
          onAddPlace={handleAddPlace}
          onEditPlace={handleEditPlace}
          onSetPlaceChanged={handleSetPlaceChanged}
          onRequestDeletePlace={handleRequestDeletePlace}
          onRequestDelete={handleRequestDeleteNumber}
        />
      )}

      <MobileNumberEditDialog
        open={editing}
        mobileNumber={item}
        onOpenChange={handleEditOpenChange}
        onSave={handleSubmitEdit}
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
          description="This action cannot be undone. This usage location will be permanently removed from this mobile number."
          confirmLabel="Delete place"
          tone="destructive"
          onConfirm={handleConfirmDeletePlace}
        />
      ) : null}

      {deletingNumber ? (
        <ConfirmDialog
          open
          onOpenChange={handleDeleteNumberOpenChange}
          title={`Delete "${item.label}"?`}
          description={describeMobileNumberDeletion(item)}
          confirmLabel="Delete mobile number"
          tone="destructive"
          onConfirm={handleConfirmDeleteNumber}
        />
      ) : null}
    </>
  );
}

export function MobileNumberDetailPageClient({
  params,
}: MobileNumberDetailPageClientProps) {
  return (
    <VaultGate title="Mobile Number">
      {({ handle }) =>
        handle ? (
          <MobileNumberDetailInner handle={handle} mobileNumberId={params.id} />
        ) : null
      }
    </VaultGate>
  );
}
