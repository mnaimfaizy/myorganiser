'use client';

import { randomId } from '@myorganiser/core';
import type { MobileNumberRecord } from '@myorganiser/vault-core';
import { useToast } from '@myorganiser/web-ui';
import {
  type PlaceFormValues,
  removePlace,
  setPlaceChanged,
  upsertPlace,
} from '@myorganiser/web-usage-locations';
import {
  normalizeMobileNumbers,
  saveVaultRecords,
  type VaultHandle,
} from '@myorganiser/web-vault';
import { useLocalVaultRevision } from '@myorganiser/web-vault-ui';
import { useCallback, useEffect, useState } from 'react';

import {
  type AddMobileNumberFormValues,
  mobileNumberFormValuesToRecordFields,
} from '../schemas/mobileNumber';

export interface MobileNumbersPageController {
  items: MobileNumberRecord[];
  /** True until the first vault read settles, so no empty or not-found state flashes. */
  loading: boolean;
  /** Rejects when the save fails, so the dialog stays open with its values. */
  addMobileNumber: (values: AddMobileNumberFormValues) => Promise<void>;
  /** Rejects when the save fails, so the dialog stays open with its values. */
  updateMobileNumber: (
    id: string,
    values: AddMobileNumberFormValues,
  ) => Promise<void>;
  /** Resolves false when the delete fails (already toasted). */
  deleteMobileNumber: (id: string) => Promise<boolean>;
  /**
   * Adds a Usage Location to the Mobile Number, or replaces the one `editingId`
   * names. Rejects when the save fails, so the dialog stays open.
   */
  saveLocation: (
    mobileNumberId: string,
    values: PlaceFormValues,
    editingId: string | null,
  ) => Promise<void>;
  /** Ticks or unticks one checklist line. Resolves false when the save fails (already toasted). */
  setLocationChanged: (
    mobileNumberId: string,
    locationId: string,
    changed: boolean,
  ) => Promise<boolean>;
  /** Resolves false when the delete fails (already toasted). */
  deleteLocation: (
    mobileNumberId: string,
    locationId: string,
  ) => Promise<boolean>;
}

/** Merges `patch` into the Mobile Number with `id` and stamps its `updatedAt`. */
function patchMobileNumber(
  items: readonly MobileNumberRecord[],
  id: string,
  patch: (item: MobileNumberRecord) => Partial<MobileNumberRecord>,
): MobileNumberRecord[] {
  return items.map((m) =>
    m.id === id
      ? { ...m, ...patch(m), updatedAt: new Date().toISOString() }
      : m,
  );
}

/**
 * Reads and writes the Mobile Numbers blob for the list and the detail route.
 * Every write saves the whole list, as Addresses does; the toasts are today's.
 */
export function useMobileNumbersPage(
  handle: VaultHandle,
): MobileNumbersPageController {
  const { toast } = useToast();

  const [items, setItems] = useState<MobileNumberRecord[]>([]);
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
        type: 'mobileNumbers',
        defaultValue: [],
      })
      .then(async (raw) => {
        const normalized = normalizeMobileNumbers(raw);
        // A read a newer one has superseded stops here, reaching neither the
        // screen nor the Vault. Normalization repairs what *this* read saw, so
        // saving it after a newer read has landed writes the stale records
        // over the newer ones, silently (#1280). What this decides is whether
        // the save starts: a save already in flight fixes its records half
        // when it is entered, and nothing here aborts it.
        if (!isActive) return;
        setItems(normalized.value);
        setLoading(false);
        if (normalized.changed) {
          await saveVaultRecords(handle, 'mobileNumbers', normalized.value);
        }
      })
      .catch(() => {
        if (!isActive) return;
        setLoading(false);
        toast({
          title: 'Failed to load mobile numbers',
          description: 'Could not decrypt saved data.',
          variant: 'destructive',
        });
      });

    return () => {
      isActive = false;
    };
  }, [handle, toast, revision]);

  const persist = useCallback(
    async (next: MobileNumberRecord[], deletedId?: string) => {
      try {
        await saveVaultRecords(
          handle,
          'mobileNumbers',
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

  const addMobileNumber = useCallback(
    async (values: AddMobileNumberFormValues) => {
      const nextItem: MobileNumberRecord = {
        id: randomId(),
        ...mobileNumberFormValuesToRecordFields(values),
        usageLocations: [],
        createdAt: new Date().toISOString(),
      };

      await persist([nextItem, ...items]);
      toast({
        title: 'Saved',
        description: 'Mobile number saved (encrypted).',
      });
    },
    [items, persist, toast],
  );

  const updateMobileNumber = useCallback(
    async (id: string, values: AddMobileNumberFormValues) => {
      await persist(
        patchMobileNumber(items, id, () =>
          mobileNumberFormValuesToRecordFields(values),
        ),
      );
      toast({
        title: 'Saved',
        description: 'Mobile number updated (encrypted).',
      });
    },
    [items, persist, toast],
  );

  const deleteMobileNumber = useCallback(
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
      toast({ title: 'Deleted', description: 'Mobile number removed.' });
      return true;
    },
    [items, persist, toast],
  );

  const saveLocation = useCallback(
    async (
      mobileNumberId: string,
      values: PlaceFormValues,
      editingId: string | null,
    ) => {
      const now = new Date().toISOString();

      await persist(
        patchMobileNumber(items, mobileNumberId, (mobileNumber) => ({
          usageLocations: upsertPlace(
            mobileNumber.usageLocations,
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
    async (mobileNumberId: string, locationId: string, changed: boolean) => {
      const now = new Date().toISOString();
      try {
        await persist(
          patchMobileNumber(items, mobileNumberId, (mobileNumber) => ({
            usageLocations: setPlaceChanged(
              mobileNumber.usageLocations,
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
    async (mobileNumberId: string, locationId: string) => {
      try {
        await persist(
          patchMobileNumber(items, mobileNumberId, (mobileNumber) => ({
            usageLocations: removePlace(
              mobileNumber.usageLocations,
              locationId,
            ),
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
    addMobileNumber,
    updateMobileNumber,
    deleteMobileNumber,
    saveLocation,
    setLocationChanged,
    deleteLocation,
  };
}
