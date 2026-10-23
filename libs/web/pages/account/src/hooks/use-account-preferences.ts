'use client';

import {
  getAccountSettings,
  setAccountSettings,
  subscribeAccountSettings,
} from '@myorganiser/core';
import type { CurrencyCode } from '@myorganiser/vault-core';
import { useToast } from '@myorganiser/web-ui';
import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export interface AccountPreferences {
  countryCode: string;
  setCountryCode: Dispatch<SetStateAction<string>>;
  preferredCurrency: CurrencyCode;
  setPreferredCurrency: Dispatch<SetStateAction<CurrencyCode>>;
  /** Persists both picks. Nothing is stored until this runs. */
  save: () => void;
}

/**
 * Country and currency preferences. Picks stay local until `save`, which is
 * the only call that writes them (and the only one that toasts).
 */
export function useAccountPreferences(): AccountPreferences {
  const { toast } = useToast();

  const [countryCode, setCountryCode] = useState<string>('AU');
  const [preferredCurrency, setPreferredCurrency] =
    useState<CurrencyCode>('AUD');

  useEffect(() => {
    const apply = () => {
      const settings = getAccountSettings();
      setCountryCode(settings.countryCode);
      setPreferredCurrency(settings.preferredCurrency);
    };

    apply();
    return subscribeAccountSettings(apply);
  }, []);

  const save = useCallback(() => {
    setAccountSettings({ countryCode, preferredCurrency });
    toast({
      title: 'Saved',
      description: 'Account settings updated.',
    });
  }, [countryCode, preferredCurrency, toast]);

  return {
    countryCode,
    setCountryCode,
    preferredCurrency,
    setPreferredCurrency,
    save,
  };
}
