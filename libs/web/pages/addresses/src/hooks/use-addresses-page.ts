'use client';

import { randomId } from '@myorganiser/core';
import {
  AddressStatusEnum,
  type AddressRecord,
  type AddressStatus,
} from '@myorganiser/vault-core';
import { useToast } from '@myorganiser/web-ui';
import {
  type PlaceFormValues,
  removePlace,
  setPlaceChanged,
  upsertPlace,
} from '@myorganiser/web-usage-locations';
import {
  normalizeAddresses,
  saveVaultRecords,
  type VaultHandle,
} from '@myorganiser/web-vault';
import { useLocalVaultRevision } from '@myorganiser/web-vault-ui';
import { useCallback, useEffect, useState } from 'react';

import type { AddAddressFormValues } from '../schemas/address';
import { addressFormValuesToRecordFields } from '../utils/addressForm';

export interface AddressesPageController {
  items: AddressRecord[];
  /** True until the first vault read settles, so no empty or not-found state flashes. */
  loading: boolean;
  /** Rejects when the save fails, so the sheet stays open with its values. */
  addAddress: (values: AddAddressFormValues) => Promise<AddressRecord>;
  /** Rejects when the save fails, so the sheet stays open with its values. */
  updateAddress: (id: string, values: AddAddressFormValues) => Promise<void>;
  /** Resolves false when the save fails (already toasted). */
  setAddressStatus: (id: string, status: AddressStatus) => Promise<boolean>;
  /** Resolves false when the save fails (already toasted). */
  deleteAddress: (id: string) => Promise<boolean>;
  /**
   * Adds a Usage Location to the Address, or replaces the one `editingId`
   * names. Rejects when the save fails, so the dialog stays open.
   */
  saveLocation: (
    addressId: string,
    values: PlaceFormValues,
    editingId: string | null,
  ) => Promise<void>;
  /** Ticks or unticks one checklist line. Resolves false when the save fails (already toasted). */
  setLocationChanged: (
    addressId: string,
    locationId: string,
    changed: boolean,
  ) => Promise<boolean>;
  /** Resolves false when the save fails (already toasted). */
  deleteLocation: (addressId: string, locationId: string) => Promise<boolean>;
}

/** Merges `patch` into the Address with `id` and stamps its `updatedAt`. */
function patchAddress(
  items: readonly AddressRecord[],
  id: string,
  patch: (address: AddressRecord) => Partial<AddressRecord>,
): AddressRecord[] {
  return items.map((a) =>
    a.id === id
      ? { ...a, ...patch(a), updatedAt: new Date().toISOString() }
      : a,
  );
}

/**
 * Reads and writes the Addresses blob for the list and the detail route. Every
 * write saves the whole list, as before the redesign; the toasts are today's.
 */
export function useAddressesPage(handle: VaultHandle): AddressesPageController {
  const { toast } = useToast();

  const [items, setItems] = useState<AddressRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Convergence replaces the Local Vault without passing through this
  // component, so the revision is the only thing that says the Ciphertext
  // behind `items` moved. Every mutation below saves the whole list, so a
  // stale `items` is not merely out of date on screen — it is what gets
  // written back over the record that arrived (#587).
  const revision = useLocalVaultRevision();

  useEffect(() => {
    // Cancellation matters now that this effect re-fires on every convergence:
    // without it, an earlier read resolving late can put stale records back
    // over the ones a later read just applied.
    let isActive = true;

    handle
      .loadDecryptedData<unknown>({
        type: 'addresses',
        defaultValue: [],
      })
      .then(async (raw) => {
        const normalized = normalizeAddresses(raw);
        // A superseded read neither reaches the screen nor goes back to the
        // Vault. Normalization repairs what *this* read saw, so saving it
        // after a newer read has landed writes the stale records over the
        // newer ones, silently (#1280).
        if (!isActive) return;
        setItems(normalized.value);
        setLoading(false);
        if (normalized.changed) {
          await saveVaultRecords(handle, 'addresses', normalized.value);
        }
      })
      .catch(() => {
        if (!isActive) return;
        setLoading(false);
        toast({
          title: 'Failed to load addresses',
          description: 'Could not decrypt saved data.',
          variant: 'destructive',
        });
      });

    return () => {
      isActive = false;
    };
  }, [handle, toast, revision]);

  const persist = useCallback(
    async (next: AddressRecord[], deletedId?: string) => {
      try {
        await saveVaultRecords(
          handle,
          'addresses',
          next,
          deletedId === undefined ? undefined : { deletedId },
        );
        setItems(next);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        toast({
          title: 'Failed to save',
          description: message,
          variant: 'destructive',
        });
        throw e;
      }
    },
    [handle, toast],
  );

  const addAddress = useCallback(
    async (values: AddAddressFormValues) => {
      const nextItem: AddressRecord = {
        id: randomId(),
        ...addressFormValuesToRecordFields(values),
        status: AddressStatusEnum.Current,
        usageLocations: [],
        createdAt: new Date().toISOString(),
      };

      await persist([nextItem, ...items]);
      toast({ title: 'Saved', description: 'Address saved (encrypted).' });
      return nextItem;
    },
    [items, persist, toast],
  );

  const updateAddress = useCallback(
    async (id: string, values: AddAddressFormValues) => {
      await persist(
        patchAddress(items, id, () => addressFormValuesToRecordFields(values)),
      );
      toast({ title: 'Saved', description: 'Address updated (encrypted).' });
    },
    [items, persist, toast],
  );

  const setAddressStatus = useCallback(
    async (id: string, status: AddressStatus) => {
      try {
        await persist(patchAddress(items, id, () => ({ status })));
      } catch {
        return false;
      }
      toast({ title: 'Saved', description: 'Address updated (encrypted).' });
      return true;
    },
    [items, persist, toast],
  );

  const deleteAddress = useCallback(
    async (id: string) => {
      try {
        await persist(
          items.filter((x) => x.id !== id),
          id,
        );
      } catch {
        // persist() already toasted the failure; the caller keeps its dialog open
        return false;
      }
      toast({ title: 'Deleted', description: 'Address removed.' });
      return true;
    },
    [items, persist, toast],
  );

  const saveLocation = useCallback(
    async (
      addressId: string,
      values: PlaceFormValues,
      editingId: string | null,
    ) => {
      const now = new Date().toISOString();

      await persist(
        patchAddress(items, addressId, (address) => ({
          usageLocations: upsertPlace(
            address.usageLocations,
            values,
            editingId,
            now,
            randomId,
          ),
        })),
      );
      toast({
        title: editingId ? 'Updated' : 'Saved',
        description: editingId
          ? 'Usage location updated successfully (encrypted).'
          : 'Usage location saved (encrypted).',
      });
    },
    [items, persist, toast],
  );

  const setLocationChanged = useCallback(
    async (addressId: string, locationId: string, changed: boolean) => {
      const now = new Date().toISOString();
      try {
        await persist(
          patchAddress(items, addressId, (address) => ({
            usageLocations: setPlaceChanged(
              address.usageLocations,
              locationId,
              changed,
              now,
            ),
          })),
        );
      } catch {
        return false;
      }
      return true;
    },
    [items, persist],
  );

  const deleteLocation = useCallback(
    async (addressId: string, locationId: string) => {
      try {
        await persist(
          patchAddress(items, addressId, (address) => ({
            usageLocations: removePlace(address.usageLocations, locationId),
          })),
        );
      } catch {
        return false;
      }
      toast({
        title: 'Deleted',
        description: 'Usage location deleted successfully.',
      });
      return true;
    },
    [items, persist, toast],
  );

  return {
    items,
    loading,
    addAddress,
    updateAddress,
    setAddressStatus,
    deleteAddress,
    saveLocation,
    setLocationChanged,
    deleteLocation,
  };
}
