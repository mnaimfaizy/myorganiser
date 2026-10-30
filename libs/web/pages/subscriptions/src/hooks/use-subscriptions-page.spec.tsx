/**
 * Tests for useSubscriptionsPage.
 *
 * Focus: the page hook above the Vault. The load and revision re-read, the
 * preferred-currency subscription, every write's collaborator call and toast
 * wording, the failure paths that keep the list unchanged, and the monthly
 * conversion state machine. The Vault handle, the vault record helpers, the
 * account settings, the FX service, the id generator and the toast are mocked
 * at their module boundaries. The pure conversion and date helpers run real.
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
    getAccountSettings: jest.fn(),
    subscribeAccountSettings: jest.fn(),
    getFxRates: jest.fn(),
    randomId: jest.fn(),
  };
});

jest.mock('@myorganiser/web-vault', () => ({
  normalizeSubscriptions: jest.fn(),
  saveVaultRecords: jest.fn(),
}));

jest.mock('@myorganiser/web-vault-ui', () => ({
  useLocalVaultRevision: jest.fn(),
}));

import {
  getAccountSettings,
  getFxRates,
  randomId,
  subscribeAccountSettings,
} from '@myorganiser/core';
import {
  SubscriptionBillingCycleEnum,
  SubscriptionPaymentMethodEnum,
  SubscriptionRenewalTypeEnum,
  SubscriptionStatusEnum,
  SubscriptionTierEnum,
  type SubscriptionRecord,
} from '@myorganiser/vault-core';
import {
  normalizeSubscriptions,
  saveVaultRecords,
  type VaultHandle,
} from '@myorganiser/web-vault';
import { useLocalVaultRevision } from '@myorganiser/web-vault-ui';
import { act, renderHook, waitFor } from '@testing-library/react';
import { emptySubscriptionFormValues } from '../utils/subscription-form-values';
import { useSubscriptionsPage } from './use-subscriptions-page';

type FxEntry = Awaited<ReturnType<typeof getFxRates>>;

const NOW_ISO = '2026-10-21T09:00:00.000Z';

type StoredSubscription = SubscriptionRecord & { futureField?: string };

const NETFLIX: StoredSubscription = {
  id: 'sub-netflix',
  name: 'Netflix',
  startDate: '2026-01-01T00:00:00.000Z',
  status: SubscriptionStatusEnum.Active,
  billingCycle: SubscriptionBillingCycleEnum.Monthly,
  amount: 15,
  currency: 'USD',
  paymentMethod: SubscriptionPaymentMethodEnum.CreditCard,
  renewalType: SubscriptionRenewalTypeEnum.AutoRenew,
  tier: SubscriptionTierEnum.Basic,
  updatedAt: '2026-02-01T00:00:00.000Z',
  futureField: 'kept',
};

const GYM: SubscriptionRecord = {
  id: 'sub-gym',
  name: 'Gym',
  startDate: '2026-03-01T00:00:00.000Z',
  status: SubscriptionStatusEnum.Active,
  billingCycle: SubscriptionBillingCycleEnum.Monthly,
  amount: 50,
  currency: 'AUD',
  paymentMethod: SubscriptionPaymentMethodEnum.BankTransfer,
  renewalType: SubscriptionRenewalTypeEnum.Manual,
  tier: SubscriptionTierEnum.Pro,
};

const SAVE_TOAST_TITLE = 'Saved';

let loadDecryptedData: jest.Mock;
let handle: VaultHandle;

/** Renders the hook with `records` as the stored blob, and waits for the first read to settle. */
async function renderLoaded(records: unknown[] = [NETFLIX]) {
  loadDecryptedData.mockResolvedValue(records);
  const hook = renderHook(() => useSubscriptionsPage(handle));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('useSubscriptionsPage', () => {
  beforeEach(() => {
    // Pin only the clock so the stamped updatedAt is deterministic.
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
    jest.mocked(normalizeSubscriptions).mockReset();
    jest.mocked(normalizeSubscriptions).mockImplementation((raw) => ({
      value: raw as SubscriptionRecord[],
      changed: false,
    }));
    jest.mocked(getAccountSettings).mockReset();
    jest.mocked(getAccountSettings).mockReturnValue({
      countryCode: 'AU',
      preferredCurrency: 'AUD',
    });
    jest.mocked(subscribeAccountSettings).mockReset();
    jest.mocked(subscribeAccountSettings).mockReturnValue(() => undefined);
    jest.mocked(getFxRates).mockReset();
    jest.mocked(randomId).mockReset();
    jest.mocked(randomId).mockReturnValue('sub-new');
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

      const { result } = renderHook(() => useSubscriptionsPage(handle));

      expect(result.current.loading).toBe(true);
      expect(result.current.items).toEqual([]);

      await act(async () => {
        resolveRead([NETFLIX]);
      });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(normalizeSubscriptions).toHaveBeenCalledWith([NETFLIX]);
      expect(result.current.items).toEqual([NETFLIX]);
      expect(saveVaultRecords).not.toHaveBeenCalled();
    });

    it('saves the normalized list back when normalization changed it', async () => {
      const normalized = [{ ...GYM }];
      jest
        .mocked(normalizeSubscriptions)
        .mockReturnValue({ value: normalized, changed: true });

      const { result } = await renderLoaded([{ legacy: true }]);

      expect(result.current.items).toEqual(normalized);
      await waitFor(() => {
        expect(saveVaultRecords).toHaveBeenCalledWith(
          handle,
          'subscriptions',
          normalized,
        );
      });
      expect(saveVaultRecords).toHaveBeenCalledTimes(1);
    });

    it('reports a decrypt failure with the destructive toast and stops loading', async () => {
      loadDecryptedData.mockRejectedValue(new Error('bad key'));

      const { result } = renderHook(() => useSubscriptionsPage(handle));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Failed to load subscriptions',
          description: 'Could not decrypt saved data.',
          variant: 'destructive',
        });
      });
      expect(result.current.loading).toBe(false);
      expect(result.current.items).toEqual([]);
      expect(normalizeSubscriptions).not.toHaveBeenCalled();
    });

    it('reads the Vault again when the local revision moves', async () => {
      const replaced = { ...GYM };
      // Convergence replaces what is stored; the next read must see it.
      let stored: unknown[] = [NETFLIX];
      loadDecryptedData.mockImplementation(async () => stored);

      const { result, rerender } = renderHook(() =>
        useSubscriptionsPage(handle),
      );
      await waitFor(() => expect(result.current.items).toEqual([NETFLIX]));

      stored = [replaced];
      jest.mocked(useLocalVaultRevision).mockReturnValue(1);
      rerender();

      await waitFor(() => expect(result.current.items).toEqual([replaced]));
      expect(loadDecryptedData).toHaveBeenCalledTimes(2);
      expect(loadDecryptedData).toHaveBeenLastCalledWith({
        type: 'subscriptions',
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
        useSubscriptionsPage(handle),
      );
      await waitFor(() => expect(reads).toHaveLength(1));

      jest.mocked(useLocalVaultRevision).mockReturnValue(1);
      rerender();
      await waitFor(() => expect(reads).toHaveLength(2));

      await act(async () => {
        reads[1].resolve([GYM]);
      });
      await waitFor(() => expect(result.current.items).toEqual([GYM]));

      await act(async () => {
        reads[0].resolve([NETFLIX]);
      });

      expect(result.current.items).toEqual([GYM]);
      expect(result.current.loading).toBe(false);
      expect(mockToast).not.toHaveBeenCalled();
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
        .mocked(normalizeSubscriptions)
        .mockImplementation((raw) =>
          raw === staleRaw
            ? { value: [NETFLIX], changed: true }
            : { value: raw as SubscriptionRecord[], changed: false },
        );

      const { result, rerender } = renderHook(() =>
        useSubscriptionsPage(handle),
      );
      await waitFor(() => expect(reads).toHaveLength(1));

      jest.mocked(useLocalVaultRevision).mockReturnValue(1);
      rerender();
      await waitFor(() => expect(reads).toHaveLength(2));

      await act(async () => {
        reads[1].resolve([GYM]);
      });
      await waitFor(() => expect(result.current.items).toEqual([GYM]));

      await act(async () => {
        reads[0].resolve(staleRaw);
      });

      expect(saveVaultRecords).not.toHaveBeenCalled();
      expect(result.current.items).toEqual([GYM]);
    });
  });

  describe('preferred currency', () => {
    it('follows account settings and updates when they change', async () => {
      jest.mocked(getAccountSettings).mockReturnValue({
        countryCode: 'AU',
        preferredCurrency: 'USD',
      });
      let onSettingsChanged: () => void = () => undefined;
      jest.mocked(subscribeAccountSettings).mockImplementation((callback) => {
        onSettingsChanged = callback;
        return () => undefined;
      });

      const { result } = await renderLoaded();
      expect(result.current.preferredCurrency).toBe('USD');

      jest.mocked(getAccountSettings).mockReturnValue({
        countryCode: 'DE',
        preferredCurrency: 'EUR',
      });
      act(() => {
        onSettingsChanged();
      });

      expect(result.current.preferredCurrency).toBe('EUR');
    });
  });

  describe('addSubscription', () => {
    it('prepends a record with a fresh id, trimmed fields and ISO dates, then toasts', async () => {
      const { result } = await renderLoaded([NETFLIX]);

      await act(async () => {
        await result.current.addSubscription({
          ...emptySubscriptionFormValues('AUD'),
          name: '  Spotify  ',
          amount: 10,
          startDate: '2026-10-01',
          nextBillingDate: '2026-11-01',
          link: '  https://spotify.test  ',
        });
      });

      const added: SubscriptionRecord = {
        id: 'sub-new',
        name: 'Spotify',
        startDate: '2026-10-01T00:00:00.000Z',
        endDate: undefined,
        status: SubscriptionStatusEnum.Active,
        billingCycle: SubscriptionBillingCycleEnum.Monthly,
        amount: 10,
        currency: 'AUD',
        paymentMethod: SubscriptionPaymentMethodEnum.CreditCard,
        nextBillingDate: '2026-11-01T00:00:00.000Z',
        renewalType: SubscriptionRenewalTypeEnum.AutoRenew,
        tier: SubscriptionTierEnum.Basic,
        link: 'https://spotify.test',
        cancellationDate: undefined,
        cancellationReason: undefined,
        updatedAt: NOW_ISO,
      };
      expect(saveVaultRecords).toHaveBeenCalledWith(
        handle,
        'subscriptions',
        [added, NETFLIX],
        undefined,
      );
      expect(result.current.items).toEqual([added, NETFLIX]);
      expect(mockToast).toHaveBeenCalledWith({
        title: SAVE_TOAST_TITLE,
        description: 'Subscription saved (encrypted).',
      });
    });

    it('rejects an unparseable start date with the invalid-date toast and saves nothing', async () => {
      const { result } = await renderLoaded([NETFLIX]);

      await act(async () => {
        await expect(
          result.current.addSubscription({
            ...emptySubscriptionFormValues('AUD'),
            name: 'Spotify',
            startDate: 'not-a-date',
          }),
        ).rejects.toThrow('Invalid start date');
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Invalid start date',
        description: 'Please enter a valid start date.',
        variant: 'destructive',
      });
      expect(saveVaultRecords).not.toHaveBeenCalled();
      expect(result.current.items).toEqual([NETFLIX]);
    });

    it('reports a failed save with its message, rejects, and keeps the items', async () => {
      jest.mocked(saveVaultRecords).mockRejectedValue(new Error('disk full'));

      const { result } = await renderLoaded([NETFLIX]);

      await act(async () => {
        await expect(
          result.current.addSubscription({
            ...emptySubscriptionFormValues('AUD'),
            name: 'Spotify',
            startDate: '2026-10-01',
          }),
        ).rejects.toThrow('disk full');
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Failed to save',
        description: 'disk full',
        variant: 'destructive',
      });
      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: SAVE_TOAST_TITLE }),
      );
      expect(result.current.items).toEqual([NETFLIX]);
    });
  });

  describe('updateSubscription', () => {
    it('replaces only the target record, keeps its unknown keys, and stamps updatedAt', async () => {
      const { result } = await renderLoaded([NETFLIX, GYM]);

      await act(async () => {
        await result.current.updateSubscription('sub-netflix', {
          ...emptySubscriptionFormValues('USD'),
          name: 'Netflix Premium',
          amount: 20,
          tier: SubscriptionTierEnum.Pro,
          startDate: '2026-01-01',
        });
      });

      const updated = {
        ...NETFLIX,
        name: 'Netflix Premium',
        amount: 20,
        tier: SubscriptionTierEnum.Pro,
        startDate: '2026-01-01T00:00:00.000Z',
        updatedAt: NOW_ISO,
      };
      expect(saveVaultRecords).toHaveBeenCalledWith(
        handle,
        'subscriptions',
        [updated, GYM],
        undefined,
      );
      expect(result.current.items).toEqual([updated, GYM]);
      expect(result.current.items[0]).toHaveProperty('futureField', 'kept');
      expect(mockToast).toHaveBeenCalledWith({
        title: SAVE_TOAST_TITLE,
        description: 'Subscription updated (encrypted).',
      });
    });
  });

  describe('markCancelled', () => {
    it('sets the status to cancelled, stamps updatedAt, and resolves true', async () => {
      const { result } = await renderLoaded([NETFLIX]);

      let outcome: boolean | undefined;
      await act(async () => {
        outcome = await result.current.markCancelled('sub-netflix');
      });

      const cancelled = {
        ...NETFLIX,
        status: SubscriptionStatusEnum.Cancelled,
        updatedAt: NOW_ISO,
      };
      expect(outcome).toBe(true);
      expect(saveVaultRecords).toHaveBeenCalledWith(
        handle,
        'subscriptions',
        [cancelled],
        undefined,
      );
      expect(result.current.items).toEqual([cancelled]);
      expect(mockToast).toHaveBeenCalledWith({
        title: SAVE_TOAST_TITLE,
        description: 'Subscription updated (encrypted).',
      });
    });

    it('resolves false on a failed save, toasts the failure once, and keeps the record active', async () => {
      jest.mocked(saveVaultRecords).mockRejectedValue(new Error('disk full'));

      const { result } = await renderLoaded([NETFLIX]);

      let outcome: boolean | undefined;
      await act(async () => {
        outcome = await result.current.markCancelled('sub-netflix');
      });

      expect(outcome).toBe(false);
      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Failed to save',
        description: 'disk full',
        variant: 'destructive',
      });
      expect(result.current.items).toEqual([NETFLIX]);
    });
  });

  describe('deleteSubscription', () => {
    it('saves the list without the record with its deletedId, then resolves true', async () => {
      const { result } = await renderLoaded([NETFLIX, GYM]);

      let outcome: boolean | undefined;
      await act(async () => {
        outcome = await result.current.deleteSubscription('sub-netflix');
      });

      expect(outcome).toBe(true);
      expect(saveVaultRecords).toHaveBeenCalledWith(
        handle,
        'subscriptions',
        [GYM],
        { deletedId: 'sub-netflix' },
      );
      expect(result.current.items).toEqual([GYM]);
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Deleted',
        description: 'Subscription removed.',
      });
    });

    it('resolves false on a failed save and keeps the record in the list', async () => {
      jest.mocked(saveVaultRecords).mockRejectedValue(new Error('disk full'));

      const { result } = await renderLoaded([NETFLIX, GYM]);

      let outcome: boolean | undefined;
      await act(async () => {
        outcome = await result.current.deleteSubscription('sub-netflix');
      });

      expect(outcome).toBe(false);
      expect(result.current.items).toEqual([NETFLIX, GYM]);
      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Failed to save',
        description: 'disk full',
        variant: 'destructive',
      });
    });
  });

  describe('convertToPreferred and showOriginal', () => {
    it('sums the active monthly equivalents in the preferred currency, then returns to off', async () => {
      const inactive: SubscriptionRecord = {
        ...GYM,
        id: 'sub-old',
        name: 'Old service',
        status: SubscriptionStatusEnum.Inactive,
        currency: 'USD',
        amount: 99,
      };
      const yearly: SubscriptionRecord = {
        ...GYM,
        id: 'sub-yearly',
        name: 'Domain',
        billingCycle: SubscriptionBillingCycleEnum.Yearly,
        amount: 120,
      };
      const { result } = await renderLoaded([NETFLIX, GYM, yearly, inactive]);

      let resolveRates: (entry: FxEntry) => void = () => undefined;
      jest.mocked(getFxRates).mockImplementation(
        () =>
          new Promise<FxEntry>((resolve) => {
            resolveRates = resolve;
          }),
      );

      let pending: Promise<void> = Promise.resolve();
      await act(async () => {
        pending = result.current.convertToPreferred();
      });
      expect(result.current.conversion).toEqual({ status: 'loading' });

      await act(async () => {
        resolveRates({
          base: 'USD',
          fetchedAt: 0,
          ttlMs: 0,
          rates: { AUD: 1.5 },
        });
        await pending;
      });

      // Netflix 15 USD * 1.5 = 22.5; Gym 50 AUD; yearly 120 AUD / 12 = 10.
      // The inactive USD record is left out, and AUD needs no FX lookup.
      expect(getFxRates).toHaveBeenCalledTimes(1);
      expect(getFxRates).toHaveBeenCalledWith({ base: 'USD' });
      await waitFor(() =>
        expect(result.current.conversion).toEqual({
          status: 'ready',
          monthly: 82.5,
        }),
      );

      act(() => {
        result.current.showOriginal();
      });
      expect(result.current.conversion).toEqual({ status: 'off' });
    });

    it('moves to an error state and toasts when the FX lookup fails', async () => {
      jest
        .mocked(getFxRates)
        .mockRejectedValue(new Error('FX service unavailable'));

      const { result } = await renderLoaded([NETFLIX]);

      await act(async () => {
        await result.current.convertToPreferred();
      });

      expect(result.current.conversion).toEqual({
        status: 'error',
        message: 'FX service unavailable',
      });
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Conversion failed',
        description: 'FX service unavailable',
        variant: 'destructive',
      });
    });
  });
});
