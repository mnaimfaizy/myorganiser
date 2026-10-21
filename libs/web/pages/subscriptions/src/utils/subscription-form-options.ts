import { SUPPORTED_CURRENCIES } from '@myorganiser/core';
import {
  SubscriptionBillingCycleEnum,
  SubscriptionPaymentMethodEnum,
  SubscriptionRenewalTypeEnum,
  SubscriptionTierEnum,
} from '@myorganiser/vault-core';

import {
  getSubscriptionBillingCycleLabel,
  getSubscriptionPaymentMethodLabel,
  getSubscriptionRenewalTypeLabel,
  getSubscriptionStatusLabel,
  getSubscriptionTierLabel,
} from './presentation';
import { SUBSCRIPTION_STATUS_FILTERS } from './subscription-summary';

/** The form fields whose value is one choice from a list. */
export type SubscriptionChoiceFieldName =
  | 'status'
  | 'billingCycle'
  | 'paymentMethod'
  | 'renewalType'
  | 'tier'
  | 'currency';

export interface SubscriptionChoiceOption {
  value: string;
  label: string;
}

/**
 * Every choice list the form shows, keyed by field. Enum members come from the
 * vault-core enum objects and their labels from the presentation functions, so
 * no member is re-listed here (ADR 0053).
 */
export const SUBSCRIPTION_CHOICE_OPTIONS: Record<
  SubscriptionChoiceFieldName,
  readonly SubscriptionChoiceOption[]
> = {
  status: SUBSCRIPTION_STATUS_FILTERS.map((value) => ({
    value,
    label: getSubscriptionStatusLabel(value),
  })),
  billingCycle: Object.values(SubscriptionBillingCycleEnum).map((value) => ({
    value,
    label: getSubscriptionBillingCycleLabel(value),
  })),
  paymentMethod: Object.values(SubscriptionPaymentMethodEnum).map((value) => ({
    value,
    label: getSubscriptionPaymentMethodLabel(value),
  })),
  renewalType: Object.values(SubscriptionRenewalTypeEnum).map((value) => ({
    value,
    label: getSubscriptionRenewalTypeLabel(value),
  })),
  tier: Object.values(SubscriptionTierEnum).map((value) => ({
    value,
    label: getSubscriptionTierLabel(value),
  })),
  currency: SUPPORTED_CURRENCIES.map((currency) => ({
    value: currency.code,
    label: `${currency.code} — ${currency.name}`,
  })),
};

/** A trigger shows the currency code only; the item list shows the full name. */
export function currencyCodeText(value: string): string {
  return value;
}

/**
 * The symbol that prefixes an amount, "A$" for AUD. en-US gives the
 * disambiguated symbol for each code; an unknown code falls back to the code.
 */
export function currencyPrefix(currency: string): string {
  try {
    const part = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}
