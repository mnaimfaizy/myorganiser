import type { AdminUserIdentity } from '@myorganiser/app-api-client';

import {
  USER_AVATAR_FILLS,
  avatarFillFor,
  formatAccountsSummary,
  formatJoinedDate,
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
    emailVerified: true,
    youtubeAccess: false,
    createdAt: new Date(2026, 9, 15, 12).toISOString(),
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
});

describe('avatarFillFor', () => {
  it('gives the same user the same fill, and that fill is one of the palette entries', () => {
    const first = avatarFillFor('user-42');
    expect(avatarFillFor('user-42')).toBe(first);
    expect(USER_AVATAR_FILLS).toContain(first);
  });
});
