'use client';

import {
  convertAmount,
  getAccountSettings,
  getFxRates,
  randomId,
  subscribeAccountSettings,
} from '@myorganiser/core';
import {
  SubscriptionStatusEnum,
  type CurrencyCode,
  type SubscriptionRecord,
} from '@myorganiser/vault-core';
import { useToast } from '@myorganiser/web-ui';
import {
  normalizeSubscriptions,
  saveVaultRecords,
  type VaultHandle,
} from '@myorganiser/web-vault';
import { useLocalVaultRevision } from '@myorganiser/web-vault-ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { SubscriptionFormValues } from '../schemas/subscription';
import { formValuesToFields } from '../utils/subscription-form-values';
import {
  activeMonthlyEquivalentIn,
  isActiveSubscription,
} from '../utils/subscription-summary';

/**
 * The "Show all in <currency>" conversion of the Monthly Equivalent. `off`
 * shows one figure per currency; `ready` holds every active subscription's
 * Monthly Equivalent converted to the preferred currency.
 */
export type MonthlyConversion =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'ready'; monthly: number }
  | { status: 'error'; message: string };

export interface SubscriptionsPageController {
  items: SubscriptionRecord[];
  /** True until the first vault read settles, so the empty state never flashes. */
  loading: boolean;
  preferredCurrency: CurrencyCode;
  conversion: MonthlyConversion;
  convertToPreferred: () => Promise<void>;
  showOriginal: () => void;
  /** Rejects when the save fails, so the form stays open with its values. */
  addSubscription: (values: SubscriptionFormValues) => Promise<void>;
  /** Rejects when the save fails, so the form stays open with its values. */
  updateSubscription: (
    id: string,
    values: SubscriptionFormValues,
  ) => Promise<void>;
  /** Resolves false when the save fails (already toasted). */
  markCancelled: (id: string) => Promise<boolean>;
  /** Resolves false when the save fails (already toasted). */
  deleteSubscription: (id: string) => Promise<boolean>;
}

/** Merges `patch` into the record with `id` and stamps its `updatedAt`. */
function patchRecord(
  items: readonly SubscriptionRecord[],
  id: string,
  patch: Partial<SubscriptionRecord>,
): SubscriptionRecord[] {
  return items.map((s) =>
    s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s,
  );
}

interface ConversionRunOptions {
  /** Leave the figure on screen until the new one lands, rather than `loading`. */
  keepFigure: boolean;
}

/**
 * Reads, writes and converts the Subscriptions blob for the page. Every write
 * saves the whole list, as before the redesign; the toasts are today's.
 */
export function useSubscriptionsPage(
  handle: VaultHandle,
): SubscriptionsPageController {
  const { toast } = useToast();

  const [items, setItems] = useState<SubscriptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [preferredCurrency, setPreferredCurrency] =
    useState<CurrencyCode>('AUD');
  const [conversion, setConversion] = useState<MonthlyConversion>({
    status: 'off',
  });

  // Convergence replaces the Local Vault without passing through this
  // component, so the revision is the only thing that says the Ciphertext
  // behind `items` moved. Every mutation below saves the whole list, so a
  // stale `items` is not merely out of date on screen — it is what gets
  // written back over the record that arrived (#587).
  const revision = useLocalVaultRevision();

  useEffect(() => {
    const apply = () => {
      const settings = getAccountSettings();
      setPreferredCurrency(settings.preferredCurrency);
    };

    apply();
    return subscribeAccountSettings(apply);
  }, []);

  useEffect(() => {
    // Cancellation matters now that this effect re-fires on every convergence:
    // without it, an earlier read resolving late can put stale records back
    // over the ones a later read just applied.
    let isActive = true;

    handle
      .loadDecryptedData<unknown>({
        type: 'subscriptions',
        defaultValue: [],
      })
      .then(async (raw) => {
        const normalized = normalizeSubscriptions(raw);
        if (isActive) {
          setItems(normalized.value);
          setLoading(false);
        }
        if (normalized.changed) {
          await saveVaultRecords(handle, 'subscriptions', normalized.value);
        }
      })
      .catch(() => {
        if (!isActive) return;
        setLoading(false);
        toast({
          title: 'Failed to load subscriptions',
          description: 'Could not decrypt saved data.',
          variant: 'destructive',
        });
      });

    return () => {
      isActive = false;
    };
  }, [handle, toast, revision]);

  const persist = useCallback(
    async (next: SubscriptionRecord[], deletedId?: string) => {
      try {
        await saveVaultRecords(
          handle,
          'subscriptions',
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

  const fieldsOrToast = useCallback(
    (values: SubscriptionFormValues) => {
      const fields = formValuesToFields(values);
      if (!fields) {
        toast({
          title: 'Invalid start date',
          description: 'Please enter a valid start date.',
          variant: 'destructive',
        });
        throw new Error('Invalid start date');
      }
      return fields;
    },
    [toast],
  );

  const addSubscription = useCallback(
    async (values: SubscriptionFormValues) => {
      const fields = fieldsOrToast(values);
      const nextItem: SubscriptionRecord = {
        id: randomId(),
        ...fields,
        cancellationDate: undefined,
        cancellationReason: undefined,
        updatedAt: new Date().toISOString(),
      };

      await persist([nextItem, ...items]);
      toast({
        title: 'Saved',
        description: 'Subscription saved (encrypted).',
      });
    },
    [fieldsOrToast, items, persist, toast],
  );

  const updateSubscription = useCallback(
    async (id: string, values: SubscriptionFormValues) => {
      const fields = fieldsOrToast(values);
      await persist(patchRecord(items, id, fields));
      toast({
        title: 'Saved',
        description: 'Subscription updated (encrypted).',
      });
    },
    [fieldsOrToast, items, persist, toast],
  );

  const markCancelled = useCallback(
    async (id: string) => {
      try {
        await persist(
          patchRecord(items, id, { status: SubscriptionStatusEnum.Cancelled }),
        );
      } catch {
        return false;
      }
      toast({
        title: 'Saved',
        description: 'Subscription updated (encrypted).',
      });
      return true;
    },
    [items, persist, toast],
  );

  const deleteSubscription = useCallback(
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
      toast({ title: 'Deleted', description: 'Subscription removed.' });
      return true;
    },
    [items, persist, toast],
  );

  // Whether the User has the converted view on, so a later items change knows
  // to recompute. A ref, not state: flipping it never needs a render of its
  // own, only the recompute it triggers below.
  const isConvertedViewOnRef = useRef(false);

  // The currency of the figure on screen. A recompute keeps that figure until
  // its replacement lands, which is only honest while the label still fits it.
  const convertedCurrencyRef = useRef<CurrencyCode | null>(null);

  // Recomputing on every items change means two conversions can be in flight
  // at once (an edit landing while the previous one is still awaiting rates).
  // Each run claims the next id and only writes its result while still the
  // latest, so a slower, superseded run can never overwrite a fresher one.
  const conversionRequestIdRef = useRef(0);

  const runConversion = useCallback(
    async ({ keepFigure }: ConversionRunOptions) => {
      const requestId = ++conversionRequestIdRef.current;
      if (!keepFigure) setConversion({ status: 'loading' });
      try {
        const active = items.filter(isActiveSubscription);
        const fromCurrencies = Array.from(
          new Set(active.map((s) => s.currency)),
        );
        const ratesByFrom = new Map<
          CurrencyCode,
          Awaited<ReturnType<typeof getFxRates>>
        >();

        await Promise.all(
          fromCurrencies.map(async (from) => {
            if (from === preferredCurrency) return;
            const rates = await getFxRates({ base: from });
            ratesByFrom.set(from, rates);
          }),
        );

        const monthly = activeMonthlyEquivalentIn(items, (amount, from) => {
          if (from === preferredCurrency) return amount;
          const rates = ratesByFrom.get(from);
          if (!rates) {
            throw new Error(`Missing FX rates for ${from}`);
          }
          return convertAmount({ amount, from, to: preferredCurrency, rates });
        });

        if (conversionRequestIdRef.current !== requestId) return;
        convertedCurrencyRef.current = preferredCurrency;
        setConversion({ status: 'ready', monthly });
      } catch (e: unknown) {
        if (conversionRequestIdRef.current !== requestId) return;
        // The error state shows the original figure and the "Show all" link,
        // so the view is off and that link is the retry. Left on, every later
        // change would fetch and toast again with no converted figure showing.
        isConvertedViewOnRef.current = false;
        const message = e instanceof Error ? e.message : String(e);
        setConversion({ status: 'error', message });
        toast({
          title: 'Conversion failed',
          description: message,
          variant: 'destructive',
        });
      }
    },
    [items, preferredCurrency, toast],
  );

  // Recomputes while the converted view is on and what it was computed from
  // moves: add, edit, cancel, a convergence pull, or the preferred currency.
  // Nothing fetches while the view is off (#1282).
  useEffect(() => {
    if (!isConvertedViewOnRef.current) return;
    // A currency change goes through `loading`, so the old figure never sits
    // beside the new label.
    void runConversion({
      keepFigure: convertedCurrencyRef.current === preferredCurrency,
    });
  }, [preferredCurrency, runConversion]);

  // A run still in flight when the page goes away must not toast over the next.
  useEffect(
    () => () => {
      conversionRequestIdRef.current += 1;
    },
    [],
  );

  const convertToPreferred = useCallback(async () => {
    isConvertedViewOnRef.current = true;
    await runConversion({ keepFigure: false });
  }, [runConversion]);

  const showOriginal = useCallback(() => {
    isConvertedViewOnRef.current = false;
    // Invalidates any in-flight run so its late result can't land over 'off'.
    conversionRequestIdRef.current += 1;
    setConversion({ status: 'off' });
  }, []);

  return {
    items,
    loading,
    preferredCurrency,
    conversion,
    convertToPreferred,
    showOriginal,
    addSubscription,
    updateSubscription,
    markCancelled,
    deleteSubscription,
  };
}
