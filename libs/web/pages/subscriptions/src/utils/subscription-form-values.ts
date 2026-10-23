import {
  SubscriptionBillingCycleEnum,
  SubscriptionPaymentMethodEnum,
  SubscriptionRenewalTypeEnum,
  SubscriptionStatusEnum,
  SubscriptionTierEnum,
  type CurrencyCode,
  type SubscriptionRecord,
} from '@myorganiser/vault-core';

import type { SubscriptionFormValues } from '../schemas/subscription';
import { dateInputToIso, isoToDateInput, todayAsDateInput } from './date';

/** The values a new subscription form starts from. */
export function emptySubscriptionFormValues(
  currency: CurrencyCode,
): SubscriptionFormValues {
  return {
    name: '',
    status: SubscriptionStatusEnum.Active,
    billingCycle: SubscriptionBillingCycleEnum.Monthly,
    amount: 0,
    currency,
    paymentMethod: SubscriptionPaymentMethodEnum.CreditCard,
    renewalType: SubscriptionRenewalTypeEnum.AutoRenew,
    tier: SubscriptionTierEnum.Basic,
    startDate: todayAsDateInput(),
    endDate: '',
    nextBillingDate: '',
    link: '',
  };
}

/** The form values for editing a saved subscription. */
export function subscriptionToFormValues(
  record: SubscriptionRecord,
): SubscriptionFormValues {
  return {
    name: record.name,
    status: record.status,
    billingCycle: record.billingCycle,
    amount: record.amount,
    currency: record.currency,
    paymentMethod: record.paymentMethod,
    renewalType: record.renewalType,
    tier: record.tier,
    startDate: isoToDateInput(record.startDate),
    endDate: isoToDateInput(record.endDate),
    nextBillingDate: isoToDateInput(record.nextBillingDate),
    link: record.link ?? '',
  };
}

/**
 * The record fields a submitted form writes. Null when the start date does not
 * parse, which the caller reports as "Invalid start date".
 */
export function formValuesToFields(
  values: SubscriptionFormValues,
): Omit<
  SubscriptionRecord,
  'id' | 'cancellationDate' | 'cancellationReason' | 'updatedAt'
> | null {
  const startDate = dateInputToIso(values.startDate);
  if (!startDate) return null;

  return {
    name: values.name.trim(),
    startDate,
    endDate: dateInputToIso(values.endDate),
    status: values.status,
    billingCycle: values.billingCycle,
    amount: values.amount,
    currency: values.currency,
    paymentMethod: values.paymentMethod,
    nextBillingDate: dateInputToIso(values.nextBillingDate),
    renewalType: values.renewalType,
    tier: values.tier,
    link: values.link?.trim() || undefined,
  };
}
