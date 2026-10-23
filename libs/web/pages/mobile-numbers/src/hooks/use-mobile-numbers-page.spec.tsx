/**
 * Tests for useMobileNumbersPage.
 *
 * Focus: the page hook above the Vault. The load and revision re-read (with the
 * stale-read guard), every Mobile Number and Usage Location write's collaborator
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
  normalizeMobileNumbers: jest.fn(),
  saveVaultRecords: jest.fn(),
}));

jest.mock('@myorganiser/web-vault-ui', () => ({
  useLocalVaultRevision: jest.fn(),
}));

import { randomId } from '@myorganiser/core';
import {
  OrganisationTypeEnum,
  PriorityEnum,
  UpdateMethodEnum,
  type MobileNumberRecord,
  type UsageLocationRecord,
} from '@myorganiser/vault-core';
import type { PlaceFormValues } from '@myorganiser/web-usage-locations';
import {
  normalizeMobileNumbers,
  saveVaultRecords,
  type VaultHandle,
} from '@myorganiser/web-vault';
import { useLocalVaultRevision } from '@myorganiser/web-vault-ui';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AddMobileNumberFormValues } from '../schemas/mobileNumber';
import { useMobileNumbersPage } from './use-mobile-numbers-page';

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

const PERSONAL: MobileNumberRecord = {
  id: 'mn-home',
  label: 'Personal',
  countryCode: '+61',
  phoneNumber: '412345678',
  usageLocations: [LOC_OLD, LOC_CHANGED],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const WORK: MobileNumberRecord = {
  id: 'mn-work',
  label: 'Work',
  countryCode: '+1',
  phoneNumber: '4155550100',
  usageLocations: [],
  createdAt: '2025-06-01T00:00:00.000Z',
};

let loadDecryptedData: jest.Mock;
let handle: VaultHandle;

function mobileValues(
  overrides: Partial<AddMobileNumberFormValues> = {},
): AddMobileNumberFormValues {
  return {
    label: 'Personal',
    countryCode: '+61',
    phoneNumber: '412345678',
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
async function renderLoaded(records: unknown[] = [PERSONAL, WORK]) {
  loadDecryptedData.mockResolvedValue(records);
  const hook = renderHook(() => useMobileNumbersPage(handle));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('useMobileNumbersPage', () => {
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
    jest.mocked(normalizeMobileNumbers).mockReset();
    jest.mocked(normalizeMobileNumbers).mockImplementation((raw) => ({
      value: raw as MobileNumberRecord[],
      changed: false,
    }));
    jest.mocked(randomId).mockReset();
    jest.mocked(randomId).mockReturnValue('mn-new');
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

      const { result } = renderHook(() => useMobileNumbersPage(handle));

      expect(result.current.loading).toBe(true);
      expect(result.current.items).toEqual([]);

      await act(async () => {
        resolveRead([PERSONAL]);
      });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(normalizeMobileNumbers).toHaveBeenCalledWith([PERSONAL]);
      expect(result.current.items).toEqual([PERSONAL]);
      expect(saveVaultRecords).not.toHaveBeenCalled();
    });

    it('saves the normalized list back when normalization changed it', async () => {
      const normalized = [{ ...WORK }];
      jest
        .mocked(normalizeMobileNumbers)
        .mockReturnValue({ value: normalized, changed: true });

      const { result } = await renderLoaded([{ legacy: true }]);

      expect(result.current.items).toEqual(normalized);
      await waitFor(() => {
        expect(saveVaultRecords).toHaveBeenCalledWith(
          handle,
          'mobileNumbers',
          normalized,
        );
      });
    });

    it('reports a decrypt failure with the destructive toast and stops loading', async () => {
      loadDecryptedData.mockRejectedValue(new Error('bad key'));

      const { result } = renderHook(() => useMobileNumbersPage(handle));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Failed to load mobile numbers',
          description: 'Could not decrypt saved data.',
          variant: 'destructive',
        });
      });
      expect(result.current.loading).toBe(false);
      expect(result.current.items).toEqual([]);
      expect(normalizeMobileNumbers).not.toHaveBeenCalled();
    });

    it('reads the Vault again when the local revision moves', async () => {
      // Convergence replaces what is stored; the next read must see it.
      let stored: unknown[] = [PERSONAL];
      loadDecryptedData.mockImplementation(async () => stored);

      const { result, rerender } = renderHook(() =>
        useMobileNumbersPage(handle),
      );
      await waitFor(() => expect(result.current.items).toEqual([PERSONAL]));

      stored = [WORK];
      jest.mocked(useLocalVaultRevision).mockReturnValue(1);
      rerender();

      await waitFor(() => expect(result.current.items).toEqual([WORK]));
      expect(loadDecryptedData).toHaveBeenCalledTimes(2);
      expect(loadDecryptedData).toHaveBeenLastCalledWith({
        type: 'mobileNumbers',
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

      const { result, rerender } = renderHook(() =>
        useMobileNumbersPage(handle),
      );
      await waitFor(() => expect(reads).toHaveLength(1));

      jest.mocked(useLocalVaultRevision).mockReturnValue(1);
      rerender();
      await waitFor(() => expect(reads).toHaveLength(2));

      await act(async () => {
        reads[1].resolve([WORK]);
      });
      await waitFor(() => expect(result.current.items).toEqual([WORK]));

      await act(async () => {
        reads[0].resolve([PERSONAL]);
      });

      expect(result.current.items).toEqual([WORK]);
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

      const { result, rerender } = renderHook(() =>
        useMobileNumbersPage(handle),
      );
      await waitFor(() => expect(reads).toHaveLength(1));

      jest.mocked(useLocalVaultRevision).mockReturnValue(1);
      rerender();
      await waitFor(() => expect(reads).toHaveLength(2));

      await act(async () => {
        reads[1].resolve([WORK]);
      });
      await waitFor(() => expect(result.current.items).toEqual([WORK]));

      await act(async () => {
        reads[0].reject(new Error('bad key'));
      });

      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Failed to load mobile numbers' }),
      );
      expect(result.current.loading).toBe(false);
      expect(result.current.items).toEqual([WORK]);
    });
  });

  describe('mobile number writes', () => {
    it('prepends a new mobile number with a fresh id and trimmed fields, then toasts', async () => {
      const { result } = await renderLoaded([PERSONAL]);

      await act(async () => {
        await result.current.addMobileNumber(
          mobileValues({
            label: '  Travel  ',
            countryCode: '+1',
            phoneNumber: ' 4155550199 ',
          }),
        );
      });

      const expected: MobileNumberRecord = {
        id: 'mn-new',
        label: 'Travel',
        countryCode: '+1',
        phoneNumber: '4155550199',
        usageLocations: [],
        createdAt: NOW_ISO,
      };
      expect(saveVaultRecords).toHaveBeenCalledWith(
        handle,
        'mobileNumbers',
        [expected, PERSONAL],
        undefined,
      );
      expect(result.current.items).toEqual([expected, PERSONAL]);
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Saved',
        description: 'Mobile number saved (encrypted).',
      });
    });

    it('rejects to the caller, toasts the message, and keeps the items when an add or update save fails', async () => {
      jest.mocked(saveVaultRecords).mockRejectedValue(new Error('disk full'));

      const { result } = await renderLoaded([PERSONAL, WORK]);

      await act(async () => {
        await expect(
          result.current.addMobileNumber(mobileValues()),
        ).rejects.toThrow('disk full');
      });
      await act(async () => {
        await expect(
          result.current.updateMobileNumber(PERSONAL.id, mobileValues()),
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
      expect(result.current.items).toEqual([PERSONAL, WORK]);
    });

    it('patches the mobile number fields, keeps its usage locations, stamps updatedAt, and toasts', async () => {
      const { result } = await renderLoaded([PERSONAL, WORK]);

      await act(async () => {
        await result.current.updateMobileNumber(
          PERSONAL.id,
          mobileValues({
            label: 'Personal (mobile)',
            countryCode: '+61',
            phoneNumber: '400111222',
          }),
        );
      });

      const updated: MobileNumberRecord = {
        ...PERSONAL,
        label: 'Personal (mobile)',
        phoneNumber: '400111222',
        updatedAt: NOW_ISO,
      };
      expect(saveVaultRecords).toHaveBeenCalledWith(
        handle,
        'mobileNumbers',
        [updated, WORK],
        undefined,
      );
      expect(result.current.items).toEqual([updated, WORK]);
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Saved',
        description: 'Mobile number updated (encrypted).',
      });
    });

    it('saves the list without the mobile number, records its deletion, toasts, and resolves true', async () => {
      const { result } = await renderLoaded([PERSONAL, WORK]);

      let ok = false;
      await act(async () => {
        ok = await result.current.deleteMobileNumber(PERSONAL.id);
      });

      expect(ok).toBe(true);
      expect(saveVaultRecords).toHaveBeenCalledWith(
        handle,
        'mobileNumbers',
        [WORK],
        { deletedId: PERSONAL.id },
      );
      expect(result.current.items).toEqual([WORK]);
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Deleted',
        description: 'Mobile number removed.',
      });
    });

    it('resolves false, keeps the mobile number, and toasts the failure when the delete save fails', async () => {
      jest.mocked(saveVaultRecords).mockRejectedValue(new Error('disk full'));

      const { result } = await renderLoaded([PERSONAL, WORK]);

      let ok = true;
      await act(async () => {
        ok = await result.current.deleteMobileNumber(PERSONAL.id);
      });

      expect(ok).toBe(false);
      expect(result.current.items).toEqual([PERSONAL, WORK]);
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
      const { result } = await renderLoaded([WORK]);

      await act(async () => {
        await result.current.saveLocation(
          WORK.id,
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
      expect(saveVaultRecords).toHaveBeenLastCalledWith(
        handle,
        'mobileNumbers',
        [{ ...WORK, usageLocations: [ticked], updatedAt: NOW_ISO }],
        undefined,
      );
      expect(mockToast).toHaveBeenLastCalledWith({
        title: 'Saved',
        description: 'Usage location saved (encrypted).',
      });

      await act(async () => {
        await result.current.saveLocation(
          WORK.id,
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
      expect(result.current.items[0].usageLocations).toEqual([plain, ticked]);
    });

    it('replaces the edited location fields, stamps changedAt on a false-to-true tick, and keeps it once set', async () => {
      const { result } = await renderLoaded([PERSONAL]);

      await act(async () => {
        await result.current.saveLocation(
          PERSONAL.id,
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
        'mobileNumbers',
        [
          {
            ...PERSONAL,
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
          PERSONAL.id,
          locationValues({
            orgName: 'Telco Plus',
            orgType: OrganisationTypeEnum.Government,
            changed: true,
          }),
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
      const { result } = await renderLoaded([PERSONAL]);

      let ticked = false;
      await act(async () => {
        ticked = await result.current.setLocationChanged(
          PERSONAL.id,
          LOC_OLD.id,
          true,
        );
      });

      expect(ticked).toBe(true);
      expect(saveVaultRecords).toHaveBeenLastCalledWith(
        handle,
        'mobileNumbers',
        [
          {
            ...PERSONAL,
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
          PERSONAL.id,
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

    it('resolves false with the failed-save toast when setLocationChanged or deleteLocation cannot save', async () => {
      jest.mocked(saveVaultRecords).mockRejectedValue(new Error('disk full'));

      const { result } = await renderLoaded([PERSONAL]);

      let tickOk = true;
      await act(async () => {
        tickOk = await result.current.setLocationChanged(
          PERSONAL.id,
          LOC_OLD.id,
          true,
        );
      });
      let deleteOk = true;
      await act(async () => {
        deleteOk = await result.current.deleteLocation(PERSONAL.id, LOC_OLD.id);
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
      expect(result.current.items).toEqual([PERSONAL]);
    });

    it('rejects to the caller, toasts the failure, and keeps the items when the location save fails', async () => {
      jest.mocked(saveVaultRecords).mockRejectedValue(new Error('disk full'));

      const { result } = await renderLoaded([PERSONAL]);

      await act(async () => {
        await expect(
          result.current.saveLocation(PERSONAL.id, locationValues(), null),
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
      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Updated' }),
      );
      expect(result.current.items).toEqual([PERSONAL]);
    });

    it('removes the location, stamps updatedAt, toasts, and resolves true', async () => {
      const { result } = await renderLoaded([PERSONAL]);

      let ok = false;
      await act(async () => {
        ok = await result.current.deleteLocation(PERSONAL.id, LOC_OLD.id);
      });

      expect(ok).toBe(true);
      expect(saveVaultRecords).toHaveBeenCalledWith(
        handle,
        'mobileNumbers',
        [{ ...PERSONAL, usageLocations: [LOC_CHANGED], updatedAt: NOW_ISO }],
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
