import type { AdminUserIdentity } from '@myorganiser/app-api-client';

import {
  USER_AVATAR_FILLS,
  avatarFillFor,
  formatAccountsSummary,
  formatDisabledPhrase,
  formatJoinedDate,
  formatLastActive,
  formatLastActivePhrase,
  formatShowingRange,
  isAdminUserSort,
  phoneChipIdFor,
  phoneUserMeta,
  userDirectoryStatus,
  userInitials,
} from './userDirectory';

function userFixture(
  overrides: Partial<AdminUserIdentity> = {},
): AdminUserIdentity {
  return {
    id: 'user-1',
    name: 'Ana Costa',
    email: 'ana@example.com',
    firstName: 'Ana',
    lastName: 'Costa',
    role: 'user',
    disabled: false,
    disabledAt: null,
    emailVerified: true,
    youtubeAccess: false,
    createdAt: new Date(2026, 9, 15, 12).toISOString(),
    lastActiveAt: null,
    ...overrides,
  };
}

describe('userDirectoryStatus', () => {
  it.each([
    [
      'disabled wins over unverified',
      { disabled: true, emailVerified: false },
      'disabled',
    ],
    [
      'unverified when not disabled',
      { disabled: false, emailVerified: false },
      'unverified',
    ],
    [
      'active when verified and not disabled',
      { disabled: false, emailVerified: true },
      'active',
    ],
  ] as const)('%s', (_label, flags, expected) => {
    expect(userDirectoryStatus(flags)).toBe(expected);
  });
});

describe('phoneChipIdFor', () => {
  it.each([
    ['no filters press the All chip', {}, 'all'],
    [
      'an unverified status presses Unverified',
      { status: 'unverified' },
      'unverified',
    ],
    [
      'a platform_admin role presses Admins',
      { role: 'platform_admin' },
      'admins',
    ],
    [
      'a combination with no phone chip presses nothing',
      { status: 'active', role: 'platform_admin' },
      undefined,
    ],
  ] as const)('%s', (_label, filters, expected) => {
    expect(phoneChipIdFor(filters)).toBe(expected);
  });
});

describe('formatJoinedDate', () => {
  const now = new Date(2026, 9, 22, 12);

  it('omits the year when the join is in the same year as now, with en-US "Sep" not "Sept"', () => {
    const joined = new Date(2026, 8, 2, 12).toISOString();
    expect(formatJoinedDate(joined, now)).toBe('2 Sep');
  });

  it('appends the year when the join is in a different year', () => {
    const joined = new Date(2025, 2, 3, 12).toISOString();
    expect(formatJoinedDate(joined, now)).toBe('3 Mar 2025');
  });
});

describe('formatShowingRange', () => {
  it.each([
    ['a full first page', [1, 25, 25, 148], 'Showing 1–25 of 148'],
    ['a short last page', [2, 25, 5, 30], 'Showing 26–30 of 30'],
    ['zero rows', [1, 25, 0, 0], 'Showing 0 of 0'],
  ] as const)('%s', (_label, [page, pageSize, shownCount, total], expected) => {
    expect(formatShowingRange(page, pageSize, shownCount, total)).toBe(
      expected,
    );
  });
});

describe('userInitials', () => {
  it.each([
    ['two words give two letters', userFixture(), 'AC'],
    [
      'three words give two letters',
      userFixture({ name: 'Ana Maria Costa' }),
      'AM',
    ],
    [
      'a blank name falls back to first and last name',
      userFixture({ name: '', firstName: 'ana', lastName: 'costa' }),
      'AC',
    ],
    [
      'all blank falls back to the upper-cased email initial',
      userFixture({
        name: '',
        firstName: '',
        lastName: '',
        email: 'ada@example.com',
      }),
      'A',
    ],
  ] as const)('%s', (_label, user, expected) => {
    expect(userInitials(user)).toBe(expected);
  });
});

describe('isAdminUserSort', () => {
  it.each([
    ['name', true],
    ['newest', true],
    ['sideways', false],
    ['toString', false],
  ] as const)('%s → %s', (value, expected) => {
    expect(isAdminUserSort(value)).toBe(expected);
  });
});

describe('formatAccountsSummary', () => {
  it('shows accounts and platform admins on desktop', () => {
    expect(
      formatAccountsSummary({ users: 148, platformAdmins: 3 }, 'desktop'),
    ).toBe('148 accounts · 3 platform admins');
  });

  it('shows only the account count on phone', () => {
    expect(
      formatAccountsSummary({ users: 148, platformAdmins: 3 }, 'phone'),
    ).toBe('148 accounts');
  });

  it('uses singular nouns when the count is one', () => {
    expect(
      formatAccountsSummary({ users: 1, platformAdmins: 1 }, 'desktop'),
    ).toBe('1 account · 1 platform admin');
  });
});

describe('phoneUserMeta', () => {
  const now = new Date(2026, 9, 22, 12);

  it('shows only the join for a user', () => {
    expect(
      phoneUserMeta(
        userFixture({ createdAt: new Date(2026, 9, 15, 12).toISOString() }),
        now,
      ),
    ).toBe('Joined 15 Oct');
  });

  it('prefixes Admin for a platform admin', () => {
    const admin = userFixture({
      role: 'platform_admin',
      createdAt: new Date(2026, 8, 2, 12).toISOString(),
    });
    expect(phoneUserMeta(admin, now)).toBe('Admin · Joined 2 Sep');
  });

  it('shows Active and the relative last-active day once the user has one', () => {
    const lastActiveNow = new Date(2026, 10, 4, 9);
    expect(
      phoneUserMeta(
        userFixture({ lastActiveAt: lastActiveOn(3) }),
        lastActiveNow,
      ),
    ).toBe('Active 3 days ago');
  });

  it('prefixes Admin to the relative last-active day for a platform admin', () => {
    const admin = userFixture({
      role: 'platform_admin',
      lastActiveAt: lastActiveOn(1),
    });
    expect(phoneUserMeta(admin, new Date(2026, 10, 4, 9))).toBe(
      'Admin · yesterday',
    );
  });
});

describe('phoneUserMeta for a Disabled User', () => {
  const now = new Date(2026, 10, 4, 9);

  it.each([
    [
      'the disabled day, in relative days',
      { disabledAt: lastActiveOn(3) },
      'Disabled 3 days ago',
    ],
    ['the same local day', { disabledAt: lastActiveOn(0) }, 'Disabled today'],
    ['the previous day', { disabledAt: lastActiveOn(1) }, 'Disabled yesterday'],
    ['no disabled day', { disabledAt: null }, 'Disabled'],
    [
      'no disabled day, even with a last-active day (never Active)',
      { disabledAt: null, lastActiveAt: lastActiveOn(3) },
      'Disabled',
    ],
    [
      'a disabled day, even with a last-active day (never Active)',
      { disabledAt: lastActiveOn(3), lastActiveAt: lastActiveOn(1) },
      'Disabled 3 days ago',
    ],
  ] as const)('gives %s as %s', (_label, overrides, expected) => {
    expect(
      phoneUserMeta(userFixture({ disabled: true, ...overrides }), now),
    ).toBe(expected);
  });

  it.each([
    [
      'a disabled platform admin',
      lastActiveOn(3),
      'Admin · Disabled 3 days ago',
    ],
    [
      'a disabled platform admin with no disabled day',
      null,
      'Admin · Disabled',
    ],
  ] as const)('prefixes Admin for %s', (_label, disabledAt, expected) => {
    const admin = userFixture({
      role: 'platform_admin',
      disabled: true,
      disabledAt,
    });
    expect(phoneUserMeta(admin, now)).toBe(expected);
  });
});

/** The ISO instant at noon, `days` calendar days before 4 Nov 2026 (negative: after). */
function lastActiveOn(days: number): string {
  return new Date(2026, 10, 4 - days, 12).toISOString();
}

describe('formatDisabledPhrase', () => {
  const now = new Date(2026, 10, 4, 9);

  it.each([
    ['a valid disabled day', lastActiveOn(3), 'Disabled 3 days ago'],
    ['no disabled day', null, 'Disabled'],
    ['an unparseable disabled day', 'not a date', 'Disabled'],
  ] as const)('gives %s as %s', (_label, iso, expected) => {
    expect(formatDisabledPhrase(iso, now)).toBe(expected);
  });
});

describe('formatLastActive', () => {
  const now = new Date(2026, 10, 4, 9);

  it('gives Never for a null or unparseable last-active day', () => {
    expect(formatLastActive(null, now)).toBe('Never');
    expect(formatLastActive('not a date', now)).toBe('Never');
  });

  it.each([
    ['the same local day', 0, 'Today'],
    ['the previous day', 1, 'Yesterday'],
    ['three days back', 3, '3 days ago'],
    ['14 days back, in weeks', 14, '2 weeks ago'],
    ['60 days back, in months', 60, '2 months ago'],
    ['800 days back, in years', 800, '2 years ago'],
  ])('reads %s as %s', (_label, days, expected) => {
    expect(formatLastActive(lastActiveOn(days), now)).toBe(expected);
  });

  it('reads a future last-active day (clock skew) as Today', () => {
    expect(formatLastActive(lastActiveOn(-2), now)).toBe('Today');
  });
});

describe('formatLastActivePhrase', () => {
  const now = new Date(2026, 10, 4, 9);

  it.each([
    ['today', lastActiveOn(0), 'Last active today'],
    ['three days back', lastActiveOn(3), 'Last active 3 days ago'],
    ['no last-active day', null, 'Never active'],
  ] as const)('gives %s as %s', (_label, iso, expected) => {
    expect(formatLastActivePhrase(iso, now)).toBe(expected);
  });
});

describe('avatarFillFor', () => {
  it('gives the same user the same fill, and that fill is one of the palette entries', () => {
    const first = avatarFillFor('user-42');
    expect(avatarFillFor('user-42')).toBe(first);
    expect(USER_AVATAR_FILLS).toContain(first);
  });
});
