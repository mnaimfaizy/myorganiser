import {
  AdminAuditAction,
  type AdminAuditLogEntry,
} from '@myorganiser/app-api-client';

import { AUDIT_ACTION_LABELS } from './formatAuditLog';
import {
  AUDIT_ACTION_VALUES,
  AUDIT_LOG_MESSAGES,
  type AuditLogUserFilter,
  auditParty,
  countActiveAuditFilters,
  formatActionFilterSummary,
  formatAuditShowingRange,
  formatAuditTime,
  formatAuditWhen,
  groupAuditEntriesByDay,
} from './auditLog';

const NOW = new Date(2026, 9, 22, 12, 0);

function entryFixture(
  overrides: Partial<AdminAuditLogEntry> = {},
): AdminAuditLogEntry {
  return {
    id: 'entry-1',
    actorUserId: 'admin-1',
    targetUserId: 'user-2',
    actorName: 'Ana Costa',
    targetName: 'Ben Ortiz',
    actorDeleted: false,
    targetDeleted: false,
    action: AdminAuditAction.Disable,
    createdAt: new Date(2026, 9, 22, 9, 58).toISOString(),
    ...overrides,
  };
}

describe('formatAuditTime', () => {
  it.each<[string, Date, string]>([
    ['zero-pads a morning time', new Date(2026, 9, 22, 9, 5), '09:05'],
    [
      'keeps an afternoon hour in 24-hour form',
      new Date(2026, 9, 22, 14, 5),
      '14:05',
    ],
    [
      'reads midnight as 00 rather than 12',
      new Date(2026, 9, 22, 0, 5),
      '00:05',
    ],
  ])('%s', (_label, date, expected) => {
    expect(formatAuditTime(date.toISOString())).toBe(expected);
  });
});

describe('formatAuditWhen', () => {
  it('reads "Today" for an entry on the same local day as now', () => {
    const iso = new Date(2026, 9, 22, 9, 58).toISOString();
    expect(formatAuditWhen(iso, NOW)).toBe('Today 09:58');
  });

  it('reads "Yesterday" for an entry on the previous local day', () => {
    const iso = new Date(2026, 9, 21, 17, 20).toISOString();
    expect(formatAuditWhen(iso, NOW)).toBe('Yesterday 17:20');
  });

  it('reads "Yesterday" across a year boundary instead of a date', () => {
    const newYearNow = new Date(2026, 0, 1, 10, 0);
    const iso = new Date(2025, 11, 31, 17, 20).toISOString();
    expect(formatAuditWhen(iso, newYearNow)).toBe('Yesterday 17:20');
  });

  it('reads a day and month, without a year, for an earlier day in the same year', () => {
    const iso = new Date(2026, 9, 14, 11, 3).toISOString();
    expect(formatAuditWhen(iso, NOW)).toBe('14 Oct 11:03');
  });

  it('abbreviates September as "Sep", never "Sept"', () => {
    const iso = new Date(2026, 8, 3, 11, 3).toISOString();
    expect(formatAuditWhen(iso, NOW)).toBe('3 Sep 11:03');
  });

  it('appends the year for an earlier year that is not yesterday', () => {
    const iso = new Date(2025, 9, 14, 11, 3).toISOString();
    expect(formatAuditWhen(iso, NOW)).toBe('14 Oct 2025 11:03');
  });
});

describe('groupAuditEntriesByDay', () => {
  it('groups by local day, keeps input order, and labels Today, Yesterday, and day-month', () => {
    const entries = [
      entryFixture({
        id: 'today-late',
        createdAt: new Date(2026, 9, 22, 11, 30).toISOString(),
      }),
      entryFixture({
        id: 'today-early',
        createdAt: new Date(2026, 9, 22, 9, 58).toISOString(),
      }),
      entryFixture({
        id: 'yesterday',
        createdAt: new Date(2026, 9, 21, 17, 20).toISOString(),
      }),
      entryFixture({
        id: 'earlier',
        createdAt: new Date(2026, 9, 14, 11, 3).toISOString(),
      }),
    ];

    const groups = groupAuditEntriesByDay(entries, NOW);

    expect(groups.map((group) => group.label)).toEqual([
      'Today',
      'Yesterday',
      '14 Oct',
    ]);
    expect(groups.map((group) => group.key)).toEqual([
      '2026-10-22',
      '2026-10-21',
      '2026-10-14',
    ]);
    expect(groups[0]?.entries.map((entry) => entry.id)).toEqual([
      'today-late',
      'today-early',
    ]);
    expect(groups[1]?.entries.map((entry) => entry.id)).toEqual(['yesterday']);
    expect(groups[2]?.entries.map((entry) => entry.id)).toEqual(['earlier']);
  });

  it('returns no groups for no entries', () => {
    expect(groupAuditEntriesByDay([], NOW)).toEqual([]);
  });
});

describe('formatAuditShowingRange', () => {
  it.each<[string, [number, number, number, number, boolean], string]>([
    [
      'a later page while filtered',
      [2, 25, 8, 33, true],
      'Showing 26–33 of 33 matching entries',
    ],
    [
      'zero rows while unfiltered',
      [1, 25, 0, 7, false],
      'Showing 0 of 7 entries',
    ],
  ])('%s', (_label, args, expected) => {
    expect(formatAuditShowingRange(...args)).toBe(expected);
  });
});

describe('formatActionFilterSummary', () => {
  it.each<[string, AdminAuditAction[], string]>([
    ['no actions reads "Any action"', [], 'Any action'],
    ['one action reads its label', ['disable'], 'Disable'],
    [
      'two actions join their labels in the given order',
      ['disable', 'enable'],
      'Disable, Enable',
    ],
    [
      'three or more actions read a count',
      ['disable', 'enable', 'promote'],
      '3 actions',
    ],
  ])('%s', (_label, actions, expected) => {
    expect(formatActionFilterSummary(actions)).toBe(expected);
  });
});

describe('auditParty', () => {
  it.each([
    [
      'a live actor shows the raw name',
      { actorUserId: 'admin-1', actorName: 'Ana Costa', actorDeleted: false },
      'actor',
      { userId: 'admin-1', name: 'Ana Costa', deleted: false },
    ],
    [
      'a deleted target shows "Deleted user"',
      {
        targetUserId: null,
        targetName: 'Ben Ortiz',
        targetDeleted: true,
      },
      'target',
      { userId: null, name: 'Deleted user', deleted: true },
    ],
    [
      'a null name with deleted false still shows "Deleted user"',
      { targetUserId: 'user-2', targetName: null, targetDeleted: false },
      'target',
      { userId: 'user-2', name: 'Deleted user', deleted: false },
    ],
  ] as const)('%s', (_label, overrides, side, expected) => {
    expect(auditParty(entryFixture(overrides), side)).toEqual(expected);
  });
});

describe('AUDIT_ACTION_VALUES', () => {
  it('lists the label table keys, each AdminAuditAction value once', () => {
    expect(AUDIT_ACTION_VALUES).toEqual(Object.keys(AUDIT_ACTION_LABELS));

    const enumValues = Object.values(AdminAuditAction);
    expect(AUDIT_ACTION_VALUES).toHaveLength(enumValues.length);
    for (const value of enumValues) {
      expect(AUDIT_ACTION_VALUES.filter((item) => item === value)).toHaveLength(
        1,
      );
    }
  });
});

describe('AUDIT_LOG_MESSAGES', () => {
  it('keeps the loading, error, and empty wording', () => {
    expect(AUDIT_LOG_MESSAGES.loading).toBe('Loading…');
    expect(AUDIT_LOG_MESSAGES.error).toBe(
      'Unable to load audit log. Please try again.',
    );
    expect(AUDIT_LOG_MESSAGES.empty).toBe('No audit log entries yet.');
  });
});

describe('countActiveAuditFilters', () => {
  it.each<[string, AdminAuditAction[], AuditLogUserFilter | undefined, number]>(
    [
      ['no actions and no user counts zero', [], undefined, 0],
      [
        'two actions and a user count three',
        ['disable', 'enable'],
        { id: 'user-2', name: 'Ben Ortiz' },
        3,
      ],
    ],
  )('%s', (_label, actions, user, expected) => {
    expect(countActiveAuditFilters(actions, user)).toBe(expected);
  });
});
