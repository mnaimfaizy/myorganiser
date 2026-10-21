import {
  SubscriptionBillingCycleEnum,
  SubscriptionPaymentMethodEnum,
  SubscriptionRenewalTypeEnum,
  SubscriptionStatusEnum,
  SubscriptionTierEnum,
  type SubscriptionBillingCycle,
  type SubscriptionPaymentMethod,
  type SubscriptionRenewalType,
  type SubscriptionStatus,
  type SubscriptionTier,
} from '@myorganiser/vault-core';
import type { StatusPillTone } from '@myorganiser/web-ui';

function titleCase(input: string) {
  return input.replace(/\b\w/g, (c) => c.toUpperCase());
}

function fallbackLabel(raw: string) {
  const spaced = raw
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
    .trim();

  return titleCase(spaced);
}

// Pinned to each enum's member set (ADR 0053): a status, cycle, method,
// renewal type, or tier added to its enum and not here fails to compile
// instead of silently falling back to a title-cased guess. The lookup
// functions below still fall back for a raw value that is not a member at
// all — decrypted data written by a build with a different enum — which
// `satisfies` cannot see coming from data rather than from code.

const statusLabels = {
  [SubscriptionStatusEnum.Active]: 'Active',
  [SubscriptionStatusEnum.Inactive]: 'Inactive',
  [SubscriptionStatusEnum.Cancelled]: 'Cancelled',
  [SubscriptionStatusEnum.Expired]: 'Expired',
  [SubscriptionStatusEnum.Pending]: 'Pending',
} as const satisfies Record<SubscriptionStatus, string>;

const billingCycleLabels = {
  [SubscriptionBillingCycleEnum.Weekly]: 'Weekly',
  [SubscriptionBillingCycleEnum.Fortnightly]: 'Fortnightly',
  [SubscriptionBillingCycleEnum.Monthly]: 'Monthly',
  [SubscriptionBillingCycleEnum.Quarterly]: 'Quarterly',
  [SubscriptionBillingCycleEnum.Yearly]: 'Yearly',
  [SubscriptionBillingCycleEnum.TwoYears]: 'Every 2 years',
  [SubscriptionBillingCycleEnum.ThreeYears]: 'Every 3 years',
} as const satisfies Record<SubscriptionBillingCycle, string>;

const paymentMethodLabels = {
  [SubscriptionPaymentMethodEnum.CreditCard]: 'Credit card',
  [SubscriptionPaymentMethodEnum.PayPal]: 'PayPal',
  [SubscriptionPaymentMethodEnum.BankTransfer]: 'Bank transfer',
} as const satisfies Record<SubscriptionPaymentMethod, string>;

const renewalTypeLabels = {
  [SubscriptionRenewalTypeEnum.AutoRenew]: 'Auto renew',
  [SubscriptionRenewalTypeEnum.Manual]: 'Manual',
} as const satisfies Record<SubscriptionRenewalType, string>;

const tierLabels = {
  [SubscriptionTierEnum.Free]: 'Free',
  [SubscriptionTierEnum.Basic]: 'Basic',
  [SubscriptionTierEnum.Pro]: 'Pro',
  [SubscriptionTierEnum.Enterprise]: 'Enterprise',
  [SubscriptionTierEnum.Individual]: 'Individual',
  [SubscriptionTierEnum.Family]: 'Family',
} as const satisfies Record<SubscriptionTier, string>;

export function getSubscriptionStatusLabel(value: string) {
  return (
    (statusLabels as Record<string, string>)[value] ?? fallbackLabel(value)
  );
}

export function getSubscriptionBillingCycleLabel(value: string) {
  return (
    (billingCycleLabels as Record<string, string>)[value] ??
    fallbackLabel(value)
  );
}

export function getSubscriptionPaymentMethodLabel(value: string) {
  return (
    (paymentMethodLabels as Record<string, string>)[value] ??
    fallbackLabel(value)
  );
}

export function getSubscriptionRenewalTypeLabel(value: string) {
  return (
    (renewalTypeLabels as Record<string, string>)[value] ?? fallbackLabel(value)
  );
}

export function getSubscriptionTierLabel(value: string) {
  return (tierLabels as Record<string, string>)[value] ?? fallbackLabel(value);
}

// The status pill colour. Active reads as trust (teal), Pending as a warning,
// Expired as danger; Inactive and Cancelled are neutral.
const statusTones = {
  [SubscriptionStatusEnum.Active]: 'trust',
  [SubscriptionStatusEnum.Pending]: 'warning',
  [SubscriptionStatusEnum.Inactive]: 'neutral',
  [SubscriptionStatusEnum.Cancelled]: 'neutral',
  [SubscriptionStatusEnum.Expired]: 'danger',
} as const satisfies Record<SubscriptionStatus, StatusPillTone>;

export function getSubscriptionStatusTone(value: string): StatusPillTone {
  return (statusTones as Record<string, StatusPillTone>)[value] ?? 'neutral';
}

// What one billing covers, after the amount: "A$15.49 a month".
const billingCyclePhrases = {
  [SubscriptionBillingCycleEnum.Weekly]: 'a week',
  [SubscriptionBillingCycleEnum.Fortnightly]: 'a fortnight',
  [SubscriptionBillingCycleEnum.Monthly]: 'a month',
  [SubscriptionBillingCycleEnum.Quarterly]: 'a quarter',
  [SubscriptionBillingCycleEnum.Yearly]: 'a year',
  [SubscriptionBillingCycleEnum.TwoYears]: 'every 2 years',
  [SubscriptionBillingCycleEnum.ThreeYears]: 'every 3 years',
} as const satisfies Record<SubscriptionBillingCycle, string>;

export function getSubscriptionBillingCyclePhrase(value: string) {
  return (
    (billingCyclePhrases as Record<string, string>)[value] ??
    getSubscriptionBillingCycleLabel(value).toLowerCase()
  );
}
