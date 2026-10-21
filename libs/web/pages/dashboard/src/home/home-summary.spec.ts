import type {
  CatalogItem,
  GroceryList,
  SubscriptionRecord,
  Task,
} from '@myorganiser/vault-core';
import {
  formatDateCaption,
  formatRenewalDay,
  formatUsd,
  getGreeting,
  localDateKey,
  pluralize,
  summarizeCountedRecords,
  summarizeGroceries,
  summarizeSubscriptions,
  summarizeTasks,
} from './home-summary';

// Wednesday 21 October 2026, 09:30 local. Every date below is built from local
// calendar parts, so the assertions hold in any timezone.
const NOW = new Date(2026, 9, 21, 9, 30);
const STAMP = '2026-10-01T00:00:00.000Z';

/** The local `YYYY-MM-DD` key `offset` days from NOW's calendar day. */
function dayKey(offset: number): string {
  return localDateKey(new Date(2026, 9, 21 + offset));
}

/** A local-time instant on October `day`, as the ISO string the vault stores. */
function localIso(day: number, hour: number, minute = 0): string {
  return new Date(2026, 9, day, hour, minute).toISOString();
}

function task(overrides: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    status: 'pending',
    priority: 'medium',
    archived: false,
    createdAt: STAMP,
    ...overrides,
  };
}

function sub(
  overrides: Partial<SubscriptionRecord> &
    Pick<SubscriptionRecord, 'id' | 'name'>,
): SubscriptionRecord {
  return {
    startDate: '2026-01-01',
    status: 'active',
    billingCycle: 'monthly',
    amount: 10,
    currency: 'USD',
    paymentMethod: 'creditCard',
    renewalType: 'autoRenew',
    tier: 'basic',
    ...overrides,
  };
}

function catalogItem(id: string, price?: number): CatalogItem {
  return {
    id,
    name: id,
    category: 'other',
    price,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

type GroceryLine = GroceryList['lines'][number];

function line(
  id: string,
  catalogItemId: string,
  checked: boolean,
): GroceryLine {
  return { id, catalogItemId, checked, createdAt: STAMP, updatedAt: STAMP };
}

function list(id: string, lines: GroceryLine[]): GroceryList {
  return { id, name: id, lines, createdAt: STAMP, updatedAt: STAMP };
}

describe('localDateKey', () => {
  it.each([
    ['early January, late evening', new Date(2026, 0, 5, 23, 59), '2026-01-05'],
    [
      'end of November, just after midnight',
      new Date(2026, 10, 30, 0, 1),
      '2026-11-30',
    ],
  ])('pads month and day for %s', (_label, date, expected) => {
    expect(localDateKey(date)).toBe(expected);
  });
});

describe('getGreeting', () => {
  it.each([
    [0, 0, 'Good morning'],
    [11, 59, 'Good morning'],
    [12, 0, 'Good afternoon'],
    [17, 59, 'Good afternoon'],
    [18, 0, 'Good evening'],
  ])('at %i:%i reads "%s"', (hour, minute, expected) => {
    expect(getGreeting(new Date(2026, 9, 21, hour, minute))).toBe(expected);
  });
});

describe('summarizeTasks', () => {
  it('counts only non-archived, non-closed tasks as open and never lists archived tasks as due', () => {
    const summary = summarizeTasks(
      [
        task({ id: 'a', title: 'Pending' }),
        task({ id: 'b', title: 'In progress', status: 'in_progress' }),
        task({ id: 'c', title: 'Blocked', status: 'blocked' }),
        task({ id: 'd', title: 'Done', status: 'done' }),
        task({ id: 'e', title: 'Cancelled', status: 'cancelled' }),
        task({
          id: 'f',
          title: 'Archived',
          archived: true,
          dueDate: dayKey(0),
        }),
      ],
      NOW,
    );

    expect(summary.open).toBe(3);
    expect(summary.dueOpen).toEqual([]);
  });

  it('lists open tasks due today or earlier, overdue first, then priority high to low, then title', () => {
    const summary = summarizeTasks(
      [
        task({ id: 'old', title: 'Old', dueDate: dayKey(-3), priority: 'low' }),
        task({
          id: 'mid',
          title: 'Mid',
          dueDate: dayKey(-1),
          priority: 'high',
        }),
        task({
          id: 'zeta',
          title: 'Zeta',
          dueDate: dayKey(0),
          priority: 'high',
        }),
        task({
          id: 'alpha',
          title: 'Alpha',
          dueDate: dayKey(0),
          priority: 'high',
        }),
        task({
          id: 'medium',
          title: 'Medium',
          dueDate: dayKey(0),
          priority: 'medium',
        }),
        task({ id: 'low', title: 'Low', dueDate: dayKey(0), priority: 'low' }),
        task({ id: 'future', title: 'Future', dueDate: dayKey(1) }),
        task({ id: 'undated', title: 'Undated' }),
        task({
          id: 'finished',
          title: 'Finished',
          status: 'done',
          dueDate: dayKey(0),
          closedAt: localIso(21, 8),
        }),
      ],
      NOW,
    );

    expect(summary.dueOpen).toEqual([
      { id: 'old', title: 'Old', dueDate: dayKey(-3), overdue: true },
      { id: 'mid', title: 'Mid', dueDate: dayKey(-1), overdue: true },
      { id: 'alpha', title: 'Alpha', dueDate: dayKey(0), overdue: false },
      { id: 'zeta', title: 'Zeta', dueDate: dayKey(0), overdue: false },
      { id: 'medium', title: 'Medium', dueDate: dayKey(0), overdue: false },
      { id: 'low', title: 'Low', dueDate: dayKey(0), overdue: false },
    ]);
    // Six due, plus the future and undated open tasks; the done task is not open.
    expect(summary.open).toBe(8);
  });

  it.each<[string, Partial<Task>, number]>([
    ['done today, due today, closed late in the evening', {}, 1],
    ['done yesterday', { closedAt: localIso(20, 23, 30) }, 0],
    ['cancelled today', { status: 'cancelled' }, 0],
    ['done today with no dueDate', { dueDate: undefined }, 0],
    ['done today with a future dueDate', { dueDate: dayKey(1) }, 0],
    ['done today but archived', { archived: true }, 0],
    ['done today with no closedAt', { closedAt: undefined }, 0],
  ])('counts done-today tasks only: %s', (_label, overrides, expected) => {
    const base = task({
      id: 'base',
      title: 'Base',
      status: 'done',
      dueDate: dayKey(0),
      closedAt: localIso(21, 23, 30),
    });

    const summary = summarizeTasks([{ ...base, ...overrides }], NOW);

    expect(summary.doneToday).toBe(expected);
  });

  it('totals today as due-open plus done-today, with done-today as the done count', () => {
    const summary = summarizeTasks(
      [
        task({ id: 'due', title: 'Due', dueDate: dayKey(-1) }),
        task({
          id: 'finished',
          title: 'Finished',
          status: 'done',
          dueDate: dayKey(0),
          closedAt: localIso(21, 8),
        }),
        task({ id: 'later', title: 'Later', dueDate: dayKey(2) }),
      ],
      NOW,
    );

    expect(summary).toMatchObject({
      open: 2,
      todayTotal: 2,
      todayDone: 1,
      doneToday: 1,
    });
  });

  it.each<[string, Task[], ('Personal' | 'Work')[]]>([
    [
      'a done personal task does not add its context',
      [
        task({ id: 'w', title: 'Work open', context: 'work' }),
        task({
          id: 'p',
          title: 'Personal done',
          context: 'personal',
          status: 'done',
        }),
      ],
      ['Work'],
    ],
    [
      'Personal is listed before Work whatever the input order',
      [
        task({ id: 'w', title: 'Work pending', context: 'work' }),
        task({
          id: 'p',
          title: 'Personal in progress',
          context: 'personal',
          status: 'in_progress',
        }),
      ],
      ['Personal', 'Work'],
    ],
    [
      'context-less and archived tasks contribute no context',
      [
        task({ id: 'n', title: 'No context' }),
        task({
          id: 'a',
          title: 'Archived work',
          context: 'work',
          archived: true,
        }),
      ],
      [],
    ],
  ])('lists open contexts: %s', (_label, tasks, expected) => {
    expect(summarizeTasks(tasks, NOW).openContexts).toEqual(expected);
  });
});

describe('summarizeSubscriptions', () => {
  it('counts only Active subscriptions and sums monthly equivalents per currency', () => {
    const summary = summarizeSubscriptions(
      [
        sub({
          id: 'a',
          name: 'Streaming',
          amount: 10,
          billingCycle: 'monthly',
          currency: 'USD',
        }),
        sub({
          id: 'b',
          name: 'Domain',
          amount: 12,
          billingCycle: 'yearly',
          currency: 'AUD',
        }),
        sub({ id: 'c', name: 'Pending', amount: 99, status: 'pending' }),
        sub({
          id: 'd',
          name: 'Cancelled',
          amount: 50,
          status: 'cancelled',
          currency: 'AUD',
        }),
      ],
      NOW,
    );

    expect(summary.active).toBe(2);
    // Each currency keeps its own total, in the order it first appears among Active subscriptions.
    const parts = summary.monthly.split(' + ');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('10.00');
    expect(parts[1]).toContain('1.00');
    expect(summary.monthly).not.toContain('99');
    expect(summary.monthly).not.toContain('50');
  });

  it('reports no active subscriptions and an empty monthly total when none are Active', () => {
    const summary = summarizeSubscriptions(
      [sub({ id: 'p', name: 'Pending', status: 'pending' })],
      NOW,
    );

    expect(summary).toMatchObject({ active: 0, monthly: '', renewingSoon: [] });
  });

  it('sums same-currency Active subscriptions into a single monthly total', () => {
    const summary = summarizeSubscriptions(
      [
        sub({ id: 'a', name: 'Streaming', amount: 10, currency: 'USD' }),
        sub({ id: 'b', name: 'Music', amount: 5, currency: 'USD' }),
      ],
      NOW,
    );

    expect(summary.active).toBe(2);
    expect(summary.monthly.split(' + ')).toHaveLength(1);
    expect(summary.monthly).toContain('15.00');
  });

  it('counts an Active subscription with an unparseable nextBillingDate but never lists it as renewing soon', () => {
    const summary = summarizeSubscriptions(
      [sub({ id: 'x', name: 'Broken date', nextBillingDate: 'not-a-date' })],
      NOW,
    );

    expect(summary.active).toBe(1);
    expect(summary.renewingSoon).toEqual([]);
  });

  it.each<[number, boolean]>([
    [-1, false],
    [0, true],
    [7, true],
    [8, false],
  ])(
    'renewing-soon window is 0 to 7 days inclusive (offset %i days, included %s)',
    (offset, included) => {
      const summary = summarizeSubscriptions(
        [sub({ id: 's', name: 'Window', nextBillingDate: dayKey(offset) })],
        NOW,
      );

      expect(summary.renewingSoon.map((renewal) => renewal.id)).toEqual(
        included ? ['s'] : [],
      );
    },
  );

  it('sorts renewals soonest first then by name, and ignores undated and non-Active subscriptions', () => {
    const summary = summarizeSubscriptions(
      [
        sub({ id: 'z', name: 'Zeta', nextBillingDate: dayKey(3), amount: 5 }),
        sub({ id: 'a', name: 'Alpha', nextBillingDate: dayKey(3), amount: 6 }),
        sub({
          id: 'm',
          name: 'Mid',
          nextBillingDate: dayKey(0),
          amount: 7,
          currency: 'AUD',
        }),
        sub({ id: 'u', name: 'Undated' }),
        sub({
          id: 'p',
          name: 'Paused',
          nextBillingDate: dayKey(1),
          status: 'pending',
        }),
      ],
      NOW,
    );

    expect(summary.renewingSoon.map((renewal) => renewal.name)).toEqual([
      'Mid',
      'Alpha',
      'Zeta',
    ]);
    expect(summary.renewingSoon[0]).toEqual({
      id: 'm',
      name: 'Mid',
      renewsOn: new Date(2026, 9, 21),
      amount: 7,
      currency: 'AUD',
    });
  });
});

describe('summarizeGroceries', () => {
  it('counts lists, unchecked lines and known spend, ignoring unpriced and unknown catalog items', () => {
    const catalog = [
      catalogItem('milk', 2.5),
      catalogItem('bread'),
      catalogItem('eggs', 4),
      catalogItem('nan', Number.NaN),
    ];
    const lists = [
      list('weekly', [line('l1', 'milk', true), line('l2', 'bread', false)]),
      list('party', [
        line('l3', 'eggs', false),
        line('l4', 'milk', false),
        line('l5', 'ghost', false),
        line('l6', 'nan', false),
      ]),
    ];

    // Spend: milk on l1 and l4 (2.5 + 2.5) plus eggs (4). Bread, the unknown
    // ghost item and the NaN price add nothing, but unchecked lines still count.
    expect(summarizeGroceries({ lists, catalog })).toEqual({
      listCount: 2,
      itemsLeft: 5,
      knownSpend: 9,
    });
    expect(summarizeGroceries({ lists: [], catalog })).toEqual({
      listCount: 0,
      itemsLeft: 0,
      knownSpend: 0,
    });
  });
});

describe('summarizeCountedRecords', () => {
  it('counts records, usage places, and places marked changed across every record', () => {
    expect(
      summarizeCountedRecords([
        { usageLocations: [{ changed: true }, { changed: false }] },
        { usageLocations: [] },
        { usageLocations: [{ changed: true }] },
      ]),
    ).toEqual({ count: 3, places: 3, updatedPlaces: 2 });
  });
});

describe('formatting helpers', () => {
  it.each([
    [0, '$0.00'],
    [12.5, '$12.50'],
    [3, '$3.00'],
  ])('formatUsd(%s) is %s', (amount, expected) => {
    expect(formatUsd(amount)).toBe(expected);
  });

  it('pluralizes by count, formats the renewal day and the date caption', () => {
    expect(pluralize(1, 'item', 'items')).toBe('item');
    expect(pluralize(0, 'item', 'items')).toBe('items');
    expect(pluralize(2, 'item', 'items')).toBe('items');
    expect(formatRenewalDay(new Date(2026, 9, 25))).toBe('Sun 25 Oct');
    expect(formatDateCaption(NOW)).toBe('Wednesday, 21 October');
  });
});
