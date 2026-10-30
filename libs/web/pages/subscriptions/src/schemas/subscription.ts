import {
  isSafeLink,
  SubscriptionBillingCycleEnum,
  SubscriptionPaymentMethodEnum,
  SubscriptionRenewalTypeEnum,
  SubscriptionStatusEnum,
  SubscriptionTierEnum,
  type CurrencyCode,
} from '@myorganiser/vault-core';
import { z } from 'zod';

export const subscriptionFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  status: z.enum([
    SubscriptionStatusEnum.Active,
    SubscriptionStatusEnum.Inactive,
    SubscriptionStatusEnum.Cancelled,
    SubscriptionStatusEnum.Expired,
    SubscriptionStatusEnum.Pending,
  ]),
  billingCycle: z.enum([
    SubscriptionBillingCycleEnum.Weekly,
    SubscriptionBillingCycleEnum.Fortnightly,
    SubscriptionBillingCycleEnum.Monthly,
    SubscriptionBillingCycleEnum.Quarterly,
    SubscriptionBillingCycleEnum.Yearly,
    SubscriptionBillingCycleEnum.TwoYears,
    SubscriptionBillingCycleEnum.ThreeYears,
  ]),
  amount: z
    .number({ error: 'Enter an amount.' })
    .finite()
    .min(0, 'Use 0 or more.'),
  currency: z.custom<CurrencyCode>(
    (v) => typeof v === 'string' && v.length > 0,
  ),
  paymentMethod: z.enum([
    SubscriptionPaymentMethodEnum.CreditCard,
    SubscriptionPaymentMethodEnum.PayPal,
    SubscriptionPaymentMethodEnum.BankTransfer,
  ]),
  renewalType: z.enum([
    SubscriptionRenewalTypeEnum.AutoRenew,
    SubscriptionRenewalTypeEnum.Manual,
  ]),
  tier: z.enum([
    SubscriptionTierEnum.Free,
    SubscriptionTierEnum.Basic,
    SubscriptionTierEnum.Pro,
    SubscriptionTierEnum.Enterprise,
    SubscriptionTierEnum.Individual,
    SubscriptionTierEnum.Family,
  ]),
  startDate: z.string().trim().min(1, 'Start date is required'),
  endDate: z.string().trim().optional(),
  nextBillingDate: z.string().trim().optional(),
  link: z
    .string()
    .trim()
    .refine((value) => !value || isSafeLink(value), {
      message: 'Enter a full web address, starting with https://',
    })
    .optional()
    .or(z.literal('')),
});

export type SubscriptionFormValues = z.infer<typeof subscriptionFormSchema>;
