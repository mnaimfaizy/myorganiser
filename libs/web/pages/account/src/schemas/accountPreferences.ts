import { isSupportedCurrencyCode } from '@myorganiser/vault-core';
import type { CurrencyCode } from '@myorganiser/vault-core';
import { z } from 'zod';

// Mirrors the normalisation getAccountSettings applies to stored values:
// a non-empty country code and a supported currency code.
export const accountPreferencesSchema = z.object({
  countryCode: z.string().min(1, 'Select a country.'),
  preferredCurrency: z.custom<CurrencyCode>(
    (value) => isSupportedCurrencyCode(value),
    { message: 'Select a supported currency.' },
  ),
});

export type AccountPreferencesValues = z.infer<typeof accountPreferencesSchema>;
