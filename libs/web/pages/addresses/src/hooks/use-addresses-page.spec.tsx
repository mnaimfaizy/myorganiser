/**
 * Tests for useAddressesPage.
 *
 * Focus: the page hook above the Vault. The load and revision re-read (with the
 * stale-read guard), every address and Usage Location write's collaborator
 * call, toast wording, the failure paths that keep the list unchanged, and the
 * changedAt stamping rules. The Vault handle, the vault record helpers, the
 * revision hook, the id generator and the toast are mocked at their module
 * boundaries. The form mappers and the record types run real.
 */

/* eslint-disable import/first -- jest.mock must precede application imports */
const mockToast = jest.fn();

jest.mock('@myorganiser/web-ui', () => ({
  useToast: jest.fn(() => ({ toast: mockToast })),
}));

jest.mock('@myorganiser/core', () => {
  const actual = jest.requireActual('@myorganiser/core');
  return {
    ...actual,
    randomId: jest.fn(),
  };
});

jest.mock('@myorganiser/web-vault', () => ({
  normalizeAddresses: jest.fn(),
  saveVaultRecords: jest.fn(),
}));

jest.mock('@myorganiser/web-vault-ui', () => ({
  useLocalVaultRevision: jest.fn(),
}));

import { randomId } from '@myorganiser/core';
import {
  AddressStatusEnum,
  OrganisationTypeEnum,
  PriorityEnum,
  UpdateMethodEnum,
  type AddressRecord,
  type UsageLocationRecord,
} from '@myorganiser/vault-core';
import type { PlaceFormValues } from '@myorganiser/web-usage-locations';
import {
  normalizeAddresses,
  saveVaultRecords,
  type VaultHandle,
} from '@myorganiser/web-vault';
import { useLocalVaultRevision } from '@myorganiser/web-vault-ui';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AddAddressFormValues } from '../schemas/address';
import { useAddressesPage } from './use-addresses-page';

const NOW_ISO = '2026-10-21T09:00:00.000Z';
// An earlier stamp, so a kept changedAt is distinguishable from a fresh one.
const EARLIER_ISO = '2026-02-02T00:00:00.000Z';

const LOC_OLD: UsageLocationRecord = {
  id: 'loc-old',
  organisationName: 'Centrelink',
  organisationType: OrganisationTypeEnum.Government,
  updateMethod: UpdateMethodEnum.Online,
  priority: PriorityEnum.Normal,
  changed: false,
  createdAt: '2026-01-05T00:00:00.000Z',
};

const LOC_CHANGED: UsageLocationRecord = {
  id: 'loc-changed',
  organisationName: 'Telco',
  organisationType: OrganisationTypeEnum.Telecom,
  updateMethod: UpdateMethodEnum.Phone,
  priority: PriorityEnum.High,
  changed: true,
  changedAt: EARLIER_ISO,
  createdAt: '2026-01-06T00:00:00.000Z',
};

const HOME: AddressRecord = {
  id: 'addr-home',
  label: 'Home',
  street: '1 Main St',
  suburb: 'Sydney',
  state: 'NSW',
  zipCode: '2000',
  country: 'Australia',
  status: AddressStatusEnum.Current,
  usageLocations: [LOC_OLD, LOC_CHANGED],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const OTHER: AddressRecord = {
  id: 'addr-other',
  label: 'Old flat',
  street: '5 High St',
  suburb: 'Perth',
  state: 'WA',
  zipCode: '6000',
  country: 'Australia',
  status: AddressStatusEnum.Old,
  usageLocations: [],
  createdAt: '2025-06-01T00:00:00.000Z',
};

let loadDecryptedData: jest.Mock;
let handle: VaultHandle;

function addressValues(
  overrides: Partial<AddAddressFormValues> = {},
): AddAddressFormValues {
  return {
    label: 'Home',
    propertyNumber: '',
    street: '1 Main St',
    suburb: 'Sydney',
    state: 'NSW',
    zipCode: '2000',
    countryCode: 'AU',
    ...overrides,
  };
}

function locationValues(
  overrides: Partial<PlaceFormValues> = {},
): PlaceFormValues {
  return {
    orgName: 'Centrelink',
    orgType: OrganisationTypeEnum.Government,
    updateMethod: UpdateMethodEnum.Online,
    priority: PriorityEnum.Normal,
    link: '',
    changed: false,
    ...overrides,
  };
}

/** Renders the hook with `records` as the stored blob, and waits for the first read to settle. */
async function renderLoaded(records: unknown[] = [HOME, OTHER]) {
  loadDecryptedData.mockResolvedValue(records);
  const hook = renderHook(() => useAddressesPage(handle));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('useAddressesPage', () => {
  beforeEach(() => {
    // Pin only the clock so the stamped createdAt, updatedAt and changedAt are deterministic.
    jest.useFakeTimers({
      now: new Date(NOW_ISO),
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });

    mockToast.mockReset();
    jest.mocked(saveVaultRecords).mockReset();
    jest.mocked(saveVaultRecords).mockResolvedValue(undefined);
    jest.mocked(normalizeAddresses).mockReset();
    jest.mocked(normalizeAddresses).mockImplementation((raw) => ({
      value: raw as AddressRecord[],
      changed: false,
    }));
    jest.mocked(randomId).mockReset();
    jest.mocked(randomId).mockReturnValue('addr-new');
    jest.mocked(useLocalVaultRevision).mockReset();
    jest.mocked(useLocalVaultRevision).mockReturnValue(0);

    loadDecryptedData = jest.fn();
    handle = { loadDecryptedData } as unknown as VaultHandle;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('loading the stored list', () => {
    it('stays loading until the read settles, then exposes the normalized items', async () => {
      let resolveRead: (value: unknown) => void = () => undefined;
      loadDecryptedData.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRead = resolve;
          }),
      );

      const { result } = renderHook(() => useAddressesPage(handle));

      expect(result.current.loading).toBe(true);
      expect(result.current.items).toEqual([]);

      await act(async () => {
        resolveRead([HOME]);
      });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(normalizeAddresses).toHaveBeenCalledWith([HOME]);
      expect(result.current.items).toEqual([HOME]);
      expect(saveVaultRecords).not.toHaveBeenCalled();
    });

    it('saves the normalized list back when normalization changed it', async () => {
      const normalized = [{ ...OTHER }];
      jest
        .mocked(normalizeAddresses)
        .mockReturnValue({ value: normalized, changed: true });

      const { result } = await renderLoaded([{ legacy: true }]);

      expect(result.current.items).toEqual(normalized);
      await waitFor(() => {
        expect(saveVaultRecords).toHaveBeenCalledWith(
          handle,
          'addresses',
          normalized,
        );
      });
      expect(saveVaultRecords).toHaveBeenCalledTimes(1);
    });

    it('reports a decrypt failure with the destructive toast and stops loading', async () => {
      loadDecryptedData.mockRejectedValue(new Error('bad key'));

      const { result } = renderHook(() => useAddressesPage(handle));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Failed to load addresses',
          description: 'Could not decrypt saved data.',
          variant: 'destructive',
        });
      });
      expect(result.current.loading).toBe(false);
      expect(result.current.items).toEqual([]);
      expect(normalizeAddresses).not.toHaveBeenCalled();
    });

    it('reads the Vault again when the local revision moves', async () => {
      // Convergence replaces what is stored; the next read must see it.
      let stored: unknown[] = [HOME];
      loadDecryptedData.mockImplementation(async () => stored);

      const { result, rerender } = renderHook(() => useAddressesPage(handle));
      await waitFor(() => expect(result.current.items).toEqual([HOME]));

      stored = [OTHER];
      jest.mocked(useLocalVaultRevision).mockReturnValue(1);
      rerender();

      await waitFor(() => expect(result.current.items).toEqual([OTHER]));
      expect(loadDecryptedData).toHaveBeenCalledTimes(2);
      expect(loadDecryptedData).toHaveBeenLastCalledWith({
        type: 'addresses',
        defaultValue: [],
      });
    });

    it('ignores a read that resolves after a newer revision has applied its records', async () => {
      const reads: Array<{
        resolve: (value: unknown) => void;
        reject: (reason: unknown) => void;
      }> = [];
      loadDecryptedData.mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            reads.push({ resolve, reject });
          }),
      );

      const { result, rerender } = renderHook(() => useAddressesPage(handle));
      await waitFor(() => expect(reads).toHaveLength(1));

      jest.mocked(useLocalVaultRevision).mockReturnValue(1);
      rerender();
      await waitFor(() => expect(reads).toHaveLength(2));

      await act(async () => {
        reads[1].resolve([OTHER]);
      });
      await waitFor(() => expect(result.current.items).toEqual([OTHER]));

      await act(async () => {
        reads[0].resolve([HOME]);
      });

      expect(result.current.items).toEqual([OTHER]);
      expect(result.current.loading).toBe(false);
      expect(mockToast).not.toHaveBeenCalled();
    });

    it('stays quiet when an older read rejects after a newer read has applied', async () => {
      const reads: Array<{
        resolve: (value: unknown) => void;
        reject: (reason: unknown) => void;
      }> = [];
      loadDecryptedData.mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            reads.push({ resolve, reject });
          }),
      );

      const { result, rerender } = renderHook(() => useAddressesPage(handle));
      await waitFor(() => expect(reads).toHaveLength(1));

      jest.mocked(useLocalVaultRevision).mockReturnValue(1);
      rerender();
      await waitFor(() => expect(reads).toHaveLength(2));

      await act(async () => {
        reads[1].resolve([OTHER]);
      });
      await waitFor(() => expect(result.current.items).toEqual([OTHER]));

      await act(async () => {
        reads[0].reject(new Error('bad key'));
      });

      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Failed to load addresses' }),
      );
      expect(result.current.loading).toBe(false);
      expect(result.current.items).toEqual([OTHER]);
    });

    it('does not write the records of a superseded read back over the newer ones', async () => {
      const reads: Array<{
        resolve: (value: unknown) => void;
        reject: (reason: unknown) => void;
      }> = [];
      loadDecryptedData.mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            reads.push({ resolve, reject });
          }),
      );
      // Only the older read's raw records need repair, so the two reads get different verdicts.
      const staleRaw = [{ legacy: true }];
      jest
        .mocked(normalizeAddresses)
        .mockImplementation((raw) =>
          raw === staleRaw
            ? { value: [HOME], changed: true }
            : { value: raw as AddressRecord[], changed: false },
        );

      const { result, rerender } = renderHook(() => useAddressesPage(handle));
      await waitFor(() => expect(reads).toHaveLength(1));

      jest.mocked(useLocalVaultRevision).mockReturnValue(1);
      rerender();
      await waitFor(() => expect(reads).toHaveLength(2));

      await act(async () => {
        reads[1].resolve([OTHER]);
      });
      await waitFor(() => expect(result.current.items).toEqual([OTHER]));

      await act(async () => {
        reads[0].resolve(staleRaw);
      });

      expect(saveVaultRecords).not.toHaveBeenCalled();
      expect(result.current.items).toEqual([OTHER]);
    });
  });

  describe('address writes', () => {
    it('prepends a current address with a fresh id, mapped fields and an ISO createdAt, then toasts', async () => {
      const { result } = await renderLoaded([HOME]);

      let created: AddressRecord | undefined;
      await act(async () => {
        created = await result.current.addAddress(
          addressValues({
            label: '  Work  ',
            propertyNumber: ' 12 ',
            street: ' 9 Other Rd ',
            suburb: 'Melbourne',
            state: 'VIC',
            zipCode: ' 3000 ',
            countryCode: 'AU',
          }),
        );
      });

      const expected: AddressRecord = {
        id: 'addr-new',
        label: 'Work',
        propertyNumber: '12',
        street: '9 Other Rd',
        suburb: 'Melbourne',
        state: 'VIC',
        zipCode: '3000',
        country: 'Australia',
        status: AddressStatusEnum.Current,
        usageLocations: [],
        createdAt: NOW_ISO,
      };
      expect(created).toEqual(expected);
      expect(saveVaultRecords).toHaveBeenCalledWith(
        handle,
        'addresses',
        [expected, HOME],
        undefined,
      );
      expect(result.current.items).toEqual([expected, HOME]);
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Saved',
        description: 'Address saved (encrypted).',
      });
    });

    it('rejects to the caller, toasts the message, and keeps the items when a save fails', async () => {
      jest.mocked(saveVaultRecords).mockRejectedValue(new Error('disk full'));

      const { result } = await renderLoaded([HOME, OTHER]);

      await act(async () => {
        await expect(
          result.current.addAddress(addressValues()),
        ).rejects.toThrow('disk full');
      });
      await act(async () => {
        await expect(
          result.current.updateAddress(HOME.id, addressValues()),
        ).rejects.toThrow('disk full');
      });
      await act(async () => {
        await expect(
          result.current.saveLocation(
            HOME.id,
            locationValues({ orgName: 'Telstra' }),
            null,
          ),
        ).rejects.toThrow('disk full');
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Failed to save',
        description: 'disk full',
        variant: 'destructive',
      });
      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Saved' }),
      );
      expect(result.current.items).toEqual([HOME, OTHER]);
    });

    it('patches the address fields, stamps updatedAt, and toasts', async () => {
      const { result } = await renderLoaded([HOME, OTHER]);

      await act(async () => {
        await result.current.updateAddress(
          HOME.id,
          addressValues({
            label: 'Home (renovated)',
            street: '2 Quay St',
            countryCode: 'AU',
          }),
        );
      });

      const updated: AddressRecord = {
        ...HOME,
        label: 'Home (renovated)',
        street: '2 Quay St',
        updatedAt: NOW_ISO,
      };
      expect(saveVaultRecords).toHaveBeenCalledWith(
        handle,
        'addresses',
        [updated, OTHER],
        undefined,
      );
      expect(result.current.items).toEqual([updated, OTHER]);
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Saved',
        description: 'Address updated (encrypted).',
      });
    });

    it('sets the status, stamps updatedAt, toasts, and resolves true', async () => {
      const { result } = await renderLoaded([HOME, OTHER]);

      let ok = false;
      await act(async () => {
        ok = await result.current.setAddressStatus(HOME.id, 'old');
      });

      const moved: AddressRecord = {
        ...HOME,
        status: AddressStatusEnum.Old,
        updatedAt: NOW_ISO,
      };
      expect(ok).toBe(true);
      expect(saveVaultRecords).toHaveBeenCalledWith(
        handle,
        'addresses',
        [moved, OTHER],
        undefined,
      );
      expect(result.current.items).toEqual([moved, OTHER]);
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Saved',
        description: 'Address updated (encrypted).',
      });
    });

    it('resolves false with the failed-save toast and keeps the status when the save fails', async () => {
      jest.mocked(saveVaultRecords).mockRejectedValue(new Error('disk full'));

      const { result } = await renderLoaded([HOME, OTHER]);

      let ok = true;
      await act(async () => {
        ok = await result.current.setAddressStatus(HOME.id, 'old');
      });

      expect(ok).toBe(false);
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Failed to save',
        description: 'disk full',
        variant: 'destructive',
      });
      expect(result.current.items).toEqual([HOME, OTHER]);
    });

    it('saves the list without the address, records its deletion, toasts, and resolves true', async () => {
      const { result } = await renderLoaded([HOME, OTHER]);

      let ok = false;
      await act(async () => {
        ok = await result.current.deleteAddress(HOME.id);
      });

      expect(ok).toBe(true);
      expect(saveVaultRecords).toHaveBeenCalledWith(
        handle,
        'addresses',
        [OTHER],
        { deletedId: HOME.id },
      );
      expect(result.current.items).toEqual([OTHER]);
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Deleted',
        description: 'Address removed.',
      });
    });

    it('resolves false and keeps the address when the delete save fails', async () => {
      jest.mocked(saveVaultRecords).mockRejectedValue(new Error('disk full'));

      const { result } = await renderLoaded([HOME, OTHER]);

      let ok = true;
      await act(async () => {
        ok = await result.current.deleteAddress(HOME.id);
      });

      expect(ok).toBe(false);
      expect(result.current.items).toEqual([HOME, OTHER]);
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Failed to save',
        description: 'disk full',
        variant: 'destructive',
      });
      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Deleted' }),
      );
    });
  });

  describe('usage location writes', () => {
    it('prepends a new location, stamps changedAt only when it is ticked, and toasts', async () => {
      // Two sequential adds need distinct ids; a counter keeps them apart
      // without a one-shot queue.
      let generated = 0;
      jest.mocked(randomId).mockImplementation(() => {
        generated += 1;
        return `generated-${generated}`;
      });
      const { result } = await renderLoaded([HOME]);

      await act(async () => {
        await result.current.saveLocation(
          HOME.id,
          locationValues({
            orgName: '  Medicare  ',
            link: ' https://medicare.test ',
            changed: true,
          }),
          null,
        );
      });

      const ticked: UsageLocationRecord = {
        id: 'generated-1',
        organisationName: 'Medicare',
        organisationType: OrganisationTypeEnum.Government,
        updateMethod: UpdateMethodEnum.Online,
        priority: PriorityEnum.Normal,
        changed: true,
        link: 'https://medicare.test',
        createdAt: NOW_ISO,
        changedAt: NOW_ISO,
      };
      const addressAfterTick: AddressRecord = {
        ...HOME,
        usageLocations: [ticked, LOC_OLD, LOC_CHANGED],
        updatedAt: NOW_ISO,
      };
      expect(saveVaultRecords).toHaveBeenLastCalledWith(
        handle,
        'addresses',
        [addressAfterTick],
        undefined,
      );
      expect(mockToast).toHaveBeenLastCalledWith({
        title: 'Saved',
        description: 'Usage location saved (encrypted).',
      });

      await act(async () => {
        await result.current.saveLocation(
          HOME.id,
          locationValues({ orgName: 'Services Australia', changed: false }),
          null,
        );
      });

      const plain: UsageLocationRecord = {
        id: 'generated-2',
        organisationName: 'Services Australia',
        organisationType: OrganisationTypeEnum.Government,
        updateMethod: UpdateMethodEnum.Online,
        priority: PriorityEnum.Normal,
        changed: false,
        link: undefined,
        createdAt: NOW_ISO,
        changedAt: undefined,
      };
      expect(result.current.items[0].usageLocations[0]).toEqual(plain);
      expect(result.current.items[0].usageLocations).toHaveLength(4);
    });

    it('replaces the edited location fields, stamps changedAt on a false-to-true tick, and keeps it once set', async () => {
      const { result } = await renderLoaded([HOME]);

      await act(async () => {
        await result.current.saveLocation(
          HOME.id,
          locationValues({
            orgName: 'Centrelink Online',
            updateMethod: UpdateMethodEnum.Phone,
            priority: PriorityEnum.High,
            link: 'https://my.gov.au',
            changed: true,
          }),
          LOC_OLD.id,
        );
      });

      const editedOld: UsageLocationRecord = {
        ...LOC_OLD,
        organisationName: 'Centrelink Online',
        updateMethod: UpdateMethodEnum.Phone,
        priority: PriorityEnum.High,
        link: 'https://my.gov.au',
        changed: true,
        changedAt: NOW_ISO,
      };
      expect(saveVaultRecords).toHaveBeenLastCalledWith(
        handle,
        'addresses',
        [
          {
            ...HOME,
            usageLocations: [editedOld, LOC_CHANGED],
            updatedAt: NOW_ISO,
          },
        ],
        undefined,
      );
      expect(mockToast).toHaveBeenLastCalledWith({
        title: 'Updated',
        description: 'Usage location updated successfully (encrypted).',
      });

      // LOC_CHANGED was already ticked, so its original changedAt survives the edit.
      await act(async () => {
        await result.current.saveLocation(
          HOME.id,
          locationValues({ orgName: 'Telco Plus', changed: true }),
          LOC_CHANGED.id,
        );
      });

      const editedChanged: UsageLocationRecord = {
        ...LOC_CHANGED,
        organisationName: 'Telco Plus',
        organisationType: OrganisationTypeEnum.Government,
        updateMethod: UpdateMethodEnum.Online,
        priority: PriorityEnum.Normal,
        link: undefined,
        changedAt: EARLIER_ISO,
      };
      expect(result.current.items[0].usageLocations).toEqual([
        editedOld,
        editedChanged,
      ]);
    });

    it('ticks a line to stamp changedAt, unticks it while keeping the old changedAt, and does not toast', async () => {
      const { result } = await renderLoaded([HOME]);

      let ticked = false;
      await act(async () => {
        ticked = await result.current.setLocationChanged(
          HOME.id,
          LOC_OLD.id,
          true,
        );
      });

      expect(ticked).toBe(true);
      expect(saveVaultRecords).toHaveBeenLastCalledWith(
        handle,
        'addresses',
        [
          {
            ...HOME,
            usageLocations: [
              { ...LOC_OLD, changed: true, changedAt: NOW_ISO },
              LOC_CHANGED,
            ],
            updatedAt: NOW_ISO,
          },
        ],
        undefined,
      );

      let unticked = false;
      await act(async () => {
        unticked = await result.current.setLocationChanged(
          HOME.id,
          LOC_CHANGED.id,
          false,
        );
      });

      expect(unticked).toBe(true);
      expect(result.current.items[0].usageLocations[1]).toEqual({
        ...LOC_CHANGED,
        changed: false,
        changedAt: EARLIER_ISO,
      });
      expect(mockToast).not.toHaveBeenCalled();
    });

    it('keeps the original changedAt when an already-ticked line is ticked again', async () => {
      const { result } = await renderLoaded([HOME]);

      let ok = false;
      await act(async () => {
        ok = await result.current.setLocationChanged(
          HOME.id,
          LOC_CHANGED.id,
          true,
        );
      });

      expect(ok).toBe(true);
      expect(saveVaultRecords).toHaveBeenLastCalledWith(
        handle,
        'addresses',
        [
          {
            ...HOME,
            usageLocations: [
              LOC_OLD,
              { ...LOC_CHANGED, changed: true, changedAt: EARLIER_ISO },
            ],
            updatedAt: NOW_ISO,
          },
        ],
        undefined,
      );
      expect(mockToast).not.toHaveBeenCalled();
    });

    it('keeps changedAt when an edit unticks an already-ticked line', async () => {
      const { result } = await renderLoaded([HOME]);

      await act(async () => {
        await result.current.saveLocation(
          HOME.id,
          locationValues({ orgName: 'Telco', changed: false }),
          LOC_CHANGED.id,
        );
      });

      expect(result.current.items[0].usageLocations[1]).toEqual({
        ...LOC_CHANGED,
        organisationName: 'Telco',
        organisationType: OrganisationTypeEnum.Government,
        updateMethod: UpdateMethodEnum.Online,
        priority: PriorityEnum.Normal,
        link: undefined,
        changed: false,
        changedAt: EARLIER_ISO,
      });
    });

    it('resolves false with the failed-save toast when setLocationChanged or deleteLocation cannot save', async () => {
      jest.mocked(saveVaultRecords).mockRejectedValue(new Error('disk full'));

      const { result } = await renderLoaded([HOME]);

      let tickOk = true;
      await act(async () => {
        tickOk = await result.current.setLocationChanged(
          HOME.id,
          LOC_OLD.id,
          true,
        );
      });
      let deleteOk = true;
      await act(async () => {
        deleteOk = await result.current.deleteLocation(HOME.id, LOC_OLD.id);
      });

      expect(tickOk).toBe(false);
      expect(deleteOk).toBe(false);
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Failed to save',
        description: 'disk full',
        variant: 'destructive',
      });
      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Deleted' }),
      );
      expect(result.current.items).toEqual([HOME]);
    });

    it('removes the location, stamps updatedAt, toasts, and resolves true', async () => {
      const { result } = await renderLoaded([HOME]);

      let ok = false;
      await act(async () => {
        ok = await result.current.deleteLocation(HOME.id, LOC_OLD.id);
      });

      expect(ok).toBe(true);
      expect(saveVaultRecords).toHaveBeenCalledWith(
        handle,
        'addresses',
        [{ ...HOME, usageLocations: [LOC_CHANGED], updatedAt: NOW_ISO }],
        undefined,
      );
      expect(result.current.items[0].usageLocations).toEqual([LOC_CHANGED]);
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Deleted',
        description: 'Usage location deleted successfully.',
      });
    });
  });
});
