import type { CurrencyCode, SubscriptionRecord } from '@myorganiser/vault-core';
// Imported explicitly: this file is type-checked by the lib tsconfig too,
// which carries no jest globals.
import { jest } from '@jest/globals';
import type {
  MonthlyConversion,
  SubscriptionsPageController,
} from '../hooks/use-subscriptions-page';

export interface MakeSubscriptionsPageControllerOptions {
  loading?: boolean;
  preferredCurrency?: CurrencyCode;
}

/**
 * A complete `SubscriptionsPageController` for component tests. Every action is
 * a `jest.fn` that resolves its success value, so a test overrides only the
 * action it asserts on, with `mockResolvedValue(false)` for example.
 */
export function makeSubscriptionsPageController(
  items: SubscriptionRecord[] = [],
  {
    loading = false,
    preferredCurrency = 'AUD',
  }: MakeSubscriptionsPageControllerOptions = {},
): SubscriptionsPageController {
  const conversion: MonthlyConversion = { status: 'off' };

  return {
    items,
    loading,
    preferredCurrency,
    conversion,
    convertToPreferred: jest.fn(async () => undefined),
    showOriginal: jest.fn(),
    addSubscription: jest.fn(async () => undefined),
    updateSubscription: jest.fn(async () => undefined),
    markCancelled: jest.fn(async () => true),
    deleteSubscription: jest.fn(async () => true),
  };
}

/** A complete active monthly AUD record; override only what a test asserts on. */
export function makeSubscriptionRecord(
  overrides: Partial<SubscriptionRecord> &
    Pick<SubscriptionRecord, 'id' | 'name'>,
): SubscriptionRecord {
  return {
    status: 'active',
    billingCycle: 'monthly',
    amount: 10,
    currency: 'AUD',
    paymentMethod: 'creditCard',
    renewalType: 'autoRenew',
    tier: 'basic',
    startDate: '2025-01-15',
    ...overrides,
  };
}
