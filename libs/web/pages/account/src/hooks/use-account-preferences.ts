'use client';

import {
  getAccountSettings,
  setAccountSettings,
  subscribeAccountSettings,
} from '@myorganiser/core';
import type { CurrencyCode } from '@myorganiser/vault-core';
import { useToast } from '@myorganiser/web-ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import {
  accountPreferencesSchema,
  type AccountPreferencesValues,
} from '../schemas/accountPreferences';

export interface AccountPreferences {
  countryCode: string;
  setCountryCode: (countryCode: string) => void;
  preferredCurrency: CurrencyCode;
  setPreferredCurrency: (currency: CurrencyCode) => void;
  /** Persists both picks. Nothing is stored until this runs. */
  save: () => Promise<void>;
}

/**
 * Country and currency preferences. Picks stay in the form until `save`,
 * which is the only call that writes them (and the only one that toasts).
 */
export function useAccountPreferences(): AccountPreferences {
  const { toast } = useToast();

  const { control, setValue, reset, handleSubmit } =
    useForm<AccountPreferencesValues>({
      resolver: zodResolver(accountPreferencesSchema),
      // Static defaults keep the first render identical on server and client;
      // the effect below applies the stored settings.
      defaultValues: { countryCode: 'AU', preferredCurrency: 'AUD' },
    });

  useEffect(() => {
    const apply = () => reset(getAccountSettings());

    apply();
    return subscribeAccountSettings(apply);
  }, [reset]);

  const countryCode = useWatch({ control, name: 'countryCode' });
  const preferredCurrency = useWatch({ control, name: 'preferredCurrency' });

  const setCountryCode = useCallback(
    (next: string) => setValue('countryCode', next),
    [setValue],
  );
  const setPreferredCurrency = useCallback(
    (next: CurrencyCode) => setValue('preferredCurrency', next),
    [setValue],
  );

  const save = useCallback(
    () =>
      handleSubmit((values) => {
        setAccountSettings(values);
        toast({
          title: 'Saved',
          description: 'Account settings updated.',
        });
      })(),
    [handleSubmit, toast],
  );

  return {
    countryCode,
    setCountryCode,
    preferredCurrency,
    setPreferredCurrency,
    save,
  };
}
