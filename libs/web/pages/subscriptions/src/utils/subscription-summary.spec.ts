import {
  SubscriptionBillingCycleEnum,
  SubscriptionPaymentMethodEnum,
  SubscriptionRenewalTypeEnum,
  SubscriptionStatusEnum,
  SubscriptionTierEnum,
  type SubscriptionBillingCycle,
  type SubscriptionRecord,
  type SubscriptionStatus,
} from '@myorganiser/vault-core';
import {
  activeMonthlyTotals,
  countByStatus,
  filterSubscriptions,
  formatNextBillingDetail,
  formatLongDate,
  formatRenewal,
  formatSubscriptionsSummary,
  formatWeekdayDate,
  monthlyEquivalent,
  nextActiveRenewal,
  sortSubscriptions,
} from './subscription-summary';

// Fixed "today": Sunday 18 Oct 2026, local time. No system clock involved.
const today = new Date(2026, 9, 18);

function makeRecord(
  overrides: Partial<SubscriptionRecord> & { id: string },
): SubscriptionRecord {
  return {
    name: 'Streaming',
    startDate: '2025-01-01T00:00:00.000Z',
    status: SubscriptionStatusEnum.Active,
    billingCycle: SubscriptionBillingCycleEnum.Monthly,
    amount: 10,
    currency: 'AUD',
    paymentMethod: SubscriptionPaymentMethodEnum.CreditCard,
    renewalType: SubscriptionRenewalTypeEnum.AutoRenew,
    tier: SubscriptionTierEnum.Basic,
    ...overrides,
  };
}

function withStatus(
  id: string,
  status: SubscriptionStatus,
): SubscriptionRecord {
  return makeRecord({ id, name: id, status, nextBillingDate: '2026-11-30' });
}

describe('monthlyEquivalent', () => {
  it('leaves a monthly amount unchanged and divides a yearly amount by 12', () => {
    expect(monthlyEquivalent(10, SubscriptionBillingCycleEnum.Monthly)).toBe(
      10,
    );
    expect(
      monthlyEquivalent(89, SubscriptionBillingCycleEnum.Yearly),
    ).toBeCloseTo(89 / 12);
  });

  it('uses 52/12 months per weekly billing and counts an unknown cycle as monthly', () => {
    expect(
      monthlyEquivalent(12, SubscriptionBillingCycleEnum.Weekly),
    ).toBeCloseTo(52);
    expect(monthlyEquivalent(15, 'biennial' as SubscriptionBillingCycle)).toBe(
      15,
    );
  });
});

describe('activeMonthlyTotals', () => {
  it('counts only active subscriptions, and returns [] when there are none', () => {
    const items = [
      makeRecord({ id: 'a', amount: 10 }),
      makeRecord({
        id: 'p',
        amount: 1000,
        status: SubscriptionStatusEnum.Pending,
      }),
      makeRecord({
        id: 'i',
        amount: 1000,
        status: SubscriptionStatusEnum.Inactive,
      }),
      makeRecord({
        id: 'c',
        amount: 1000,
        status: SubscriptionStatusEnum.Cancelled,
      }),
      makeRecord({
        id: 'e',
        amount: 1000,
        status: SubscriptionStatusEnum.Expired,
      }),
    ];

    expect(activeMonthlyTotals(items, 'AUD')).toEqual([
      { currency: 'AUD', monthly: 10, count: 1 },
    ]);
    expect(activeMonthlyTotals([], 'AUD')).toEqual([]);
  });

  it('groups per currency with summed monthly and count, preferred currency first then alphabetical', () => {
    const items = [
      makeRecord({ id: 'aud-m', currency: 'AUD', amount: 10 }),
      makeRecord({
        id: 'aud-y',
        currency: 'AUD',
        amount: 120,
        billingCycle: SubscriptionBillingCycleEnum.Yearly,
      }),
      makeRecord({ id: 'eur', currency: 'EUR', amount: 7 }),
      makeRecord({ id: 'usd', currency: 'USD', amount: 5 }),
    ];

    expect(activeMonthlyTotals(items, 'USD')).toEqual([
      { currency: 'USD', monthly: 5, count: 1 },
      { currency: 'AUD', monthly: 20, count: 2 },
      { currency: 'EUR', monthly: 7, count: 1 },
    ]);
  });
});

describe('formatRenewal', () => {
  it('counts down to the renewal within 7 days and reads a UTC-midnight string by its date', () => {
    expect(formatRenewal('2026-10-18', today)).toEqual({
      label: 'Today',
      soon: true,
    });
    expect(formatRenewal('2026-10-19', today)).toEqual({
      label: 'Tomorrow',
      soon: true,
    });
    expect(formatRenewal('2026-10-21', today)).toEqual({
      label: 'In 3 days',
      soon: true,
    });
    expect(formatRenewal('2026-10-25', today)).toEqual({
      label: 'In 7 days',
      soon: true,
    });
    expect(formatRenewal('2026-10-21T00:00:00.000Z', today)).toEqual({
      label: 'In 3 days',
      soon: true,
    });
  });

  it('shows a short date beyond a week, the full date when past, the year only beyond the coming year, and null when missing or invalid', () => {
    expect(formatRenewal('2026-10-26', today)).toEqual({
      label: '26 Oct',
      soon: false,
    });
    expect(formatRenewal('2026-10-01', today)).toEqual({
      label: '1 Oct 2026',
      soon: false,
    });
    expect(formatRenewal('2027-10-17', today)).toEqual({
      label: '17 Oct',
      soon: false,
    });
    expect(formatRenewal('2027-10-18', today)).toEqual({
      label: '18 Oct 2027',
      soon: false,
    });
    expect(formatRenewal(undefined, today)).toBeNull();
    expect(formatRenewal('not-a-date', today)).toBeNull();
  });
});

describe('formatNextBillingDetail', () => {
  it('appends the countdown when soon, shows the bare weekday date otherwise, and is null with no date', () => {
    expect(formatNextBillingDetail('2026-10-21', today)).toBe(
      'Wed 21 Oct · in 3 days',
    );
    expect(formatNextBillingDetail('2026-10-18', today)).toBe(
      'Sun 18 Oct · today',
    );
    expect(formatNextBillingDetail('2026-11-02', today)).toBe('Mon 2 Nov');
    expect(formatNextBillingDetail(undefined, today)).toBeNull();
  });
});

describe('formatWeekdayDate and formatLongDate', () => {
  it('formats the weekday date and the long date, and returns null for a missing or invalid date', () => {
    expect(formatWeekdayDate('2026-10-21')).toBe('Wed 21 Oct');
    expect(formatWeekdayDate(undefined)).toBeNull();
    expect(formatLongDate('2024-03-03')).toBe('3 Mar 2024');
    expect(formatLongDate('not-a-date')).toBeNull();
  });
});

describe('nextActiveRenewal', () => {
  it('ignores non-active, past and undated subscriptions and returns the soonest upcoming active one', () => {
    const items = [
      makeRecord({ id: 'gym', name: 'Gym', nextBillingDate: '2026-10-25' }),
      makeRecord({ id: 'music', name: 'Music', nextBillingDate: '2026-10-20' }),
      makeRecord({
        id: 'pending',
        name: 'Pending',
        status: SubscriptionStatusEnum.Pending,
        nextBillingDate: '2026-10-19',
      }),
      makeRecord({ id: 'past', name: 'Past', nextBillingDate: '2026-10-01' }),
      makeRecord({ id: 'undated', name: 'Undated' }),
    ];

    expect(nextActiveRenewal(items, today)?.id).toBe('music');
  });

  it('breaks a same-day tie by name, and returns null when nothing qualifies', () => {
    const items = [
      makeRecord({ id: 'zoo', name: 'Zoo', nextBillingDate: '2026-10-20' }),
      makeRecord({ id: 'atlas', name: 'Atlas', nextBillingDate: '2026-10-20' }),
    ];

    expect(nextActiveRenewal(items, today)?.id).toBe('atlas');
    expect(nextActiveRenewal([], today)).toBeNull();
    expect(
      nextActiveRenewal(
        [
          makeRecord({
            id: 'paused',
            status: SubscriptionStatusEnum.Pending,
            nextBillingDate: '2026-10-25',
          }),
          makeRecord({ id: 'lapsed', nextBillingDate: '2026-10-01' }),
          makeRecord({ id: 'undated', name: 'Undated' }),
        ],
        today,
      ),
    ).toBeNull();
  });
});

describe('formatSubscriptionsSummary', () => {
  it('returns the plain active count when nothing renews within a week, ignoring non-active renewals', () => {
    const items = [
      makeRecord({ id: 'far', nextBillingDate: '2026-11-30' }),
      makeRecord({
        id: 'pending-soon',
        status: SubscriptionStatusEnum.Pending,
        nextBillingDate: '2026-10-19',
      }),
    ];

    expect(formatSubscriptionsSummary(items, today)).toBe('1 active');
  });

  it('uses the singular "renews" for one renewal this week and "renew" for several', () => {
    const one = [
      makeRecord({ id: 'a', nextBillingDate: '2026-10-20' }),
      makeRecord({ id: 'b', nextBillingDate: '2026-11-30' }),
    ];
    const several = [
      makeRecord({ id: 'a', nextBillingDate: '2026-10-20' }),
      makeRecord({ id: 'b', nextBillingDate: '2026-10-25' }),
      makeRecord({ id: 'c', nextBillingDate: '2026-11-30' }),
    ];

    expect(formatSubscriptionsSummary(one, today)).toBe(
      '2 active · 1 renews this week',
    );
    expect(formatSubscriptionsSummary(several, today)).toBe(
      '3 active · 2 renew this week',
    );
  });
});

describe('countByStatus and filterSubscriptions', () => {
  const items = [
    withStatus('active-1', SubscriptionStatusEnum.Active),
    withStatus('active-2', SubscriptionStatusEnum.Active),
    withStatus('pending-1', SubscriptionStatusEnum.Pending),
    withStatus('cancelled-1', SubscriptionStatusEnum.Cancelled),
  ];

  it('counts every status, ignores an unknown status, and filters to one status or to every non-active subscription for "others"', () => {
    const expectedCounts = {
      active: 2,
      pending: 1,
      inactive: 0,
      cancelled: 1,
      expired: 0,
    };
    expect(countByStatus(items)).toEqual(expectedCounts);
    expect(
      countByStatus([
        ...items,
        makeRecord({ id: 'unknown', status: 'archived' as SubscriptionStatus }),
      ]),
    ).toEqual(expectedCounts);
    expect(
      filterSubscriptions(items, SubscriptionStatusEnum.Active).map(
        (s) => s.id,
      ),
    ).toEqual(['active-1', 'active-2']);
    expect(filterSubscriptions(items, 'others').map((s) => s.id)).toEqual([
      'pending-1',
      'cancelled-1',
    ]);
  });
});

describe('sortSubscriptions', () => {
  const items = [
    makeRecord({ id: 'zoo', name: 'Zoo', nextBillingDate: '2026-11-01' }),
    makeRecord({ id: 'gym', name: 'Gym' }),
    makeRecord({ id: 'music', name: 'Music', nextBillingDate: '2026-10-25' }),
    makeRecord({ id: 'atlas', name: 'Atlas', nextBillingDate: '2026-10-25' }),
  ];

  it('sorts by name alphabetically', () => {
    expect(sortSubscriptions(items, 'name').map((s) => s.name)).toEqual([
      'Atlas',
      'Gym',
      'Music',
      'Zoo',
    ]);
  });

  it('sorts by next renewal earliest first, undated last, ties by name, and leaves the input unchanged', () => {
    const before = items.map((s) => s.id);

    expect(sortSubscriptions(items, 'nextRenewal').map((s) => s.name)).toEqual([
      'Atlas',
      'Music',
      'Zoo',
      'Gym',
    ]);
    expect(items.map((s) => s.id)).toEqual(before);
  });
});
