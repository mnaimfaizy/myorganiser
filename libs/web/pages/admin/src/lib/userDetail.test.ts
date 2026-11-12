import type {
  AdminUserIdentity,
  UserRole,
  YouTubeAccessUsageResponse,
} from '@myorganiser/app-api-client';

import {
  type LifecycleAction,
  type LifecycleActionCopy,
  LIFECYCLE_ACTION_COPY,
  emailVerificationDescription,
  formatYouTubePlacesLeft,
  identityMeta,
  lifecycleRowDescription,
  platformAdminDescription,
  youtubeAccessDescription,
} from './userDetail';

const NOW = new Date(2026, 9, 22, 12);

const USAGE: YouTubeAccessUsageResponse = { everGranted: 18, ceiling: 25 };

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
    createdAt: new Date(2026, 9, 16, 12).toISOString(),
    lastActiveAt: null,
    ...overrides,
  };
}

describe('youtubeAccessDescription', () => {
  it('names the places left out of the ceiling on desktop and shortens it on phone', () => {
    expect(youtubeAccessDescription(true, USAGE, false, 'desktop')).toBe(
      'Granted · 7 of 25 places left',
    );
    expect(youtubeAccessDescription(true, USAGE, false, 'phone')).toBe(
      'Granted · 7 left',
    );
  });

  it('uses the Not granted state for a user without YouTube Access', () => {
    expect(youtubeAccessDescription(false, USAGE, false, 'desktop')).toBe(
      'Not granted · 7 of 25 places left',
    );
  });

  it.each(['desktop', 'phone'] as const)(
    'shows Loading… on %s while usage is pending and has not failed',
    (variant) => {
      expect(youtubeAccessDescription(true, null, false, variant)).toBe(
        'Granted · Loading…',
      );
    },
  );

  it.each(['desktop', 'phone'] as const)(
    'shows Unavailable on %s when the usage call failed',
    (variant) => {
      expect(youtubeAccessDescription(false, null, true, variant)).toBe(
        'Not granted · Unavailable',
      );
    },
  );
});

describe('formatYouTubePlacesLeft', () => {
  it('reads 0 of the ceiling when every place has been granted', () => {
    expect(formatYouTubePlacesLeft({ everGranted: 25, ceiling: 25 })).toBe(
      '0 of 25 places left',
    );
  });
});

describe('platformAdminDescription', () => {
  it('gives the same desktop sentence for a platform admin and a plain user', () => {
    const sentence =
      'Can see accounts and the audit log. Never vault contents.';
    expect(platformAdminDescription('platform_admin', 'desktop')).toBe(
      sentence,
    );
    expect(platformAdminDescription('user', 'desktop')).toBe(sentence);
  });

  it.each<[UserRole, string]>([
    ['platform_admin', 'Admin'],
    ['user', 'Not an admin'],
  ])('gives %s the phone text "%s"', (role, expected) => {
    expect(platformAdminDescription(role, 'phone')).toBe(expected);
  });
});

describe('emailVerificationDescription', () => {
  it.each([
    [true, 'Verified'],
    [false, 'Not verified'],
  ])('maps verified=%s to "%s"', (verified, expected) => {
    expect(emailVerificationDescription(verified)).toBe(expected);
  });
});

describe('identityMeta', () => {
  it('states the year on desktop and ends with Never active when there is no last-active day', () => {
    expect(identityMeta(userFixture(), 'desktop', NOW)).toBe(
      'ana@example.com · Joined 16 Oct 2026 · Never active',
    );
  });

  it('omits the year on phone in the same year and includes it in an earlier year', () => {
    expect(identityMeta(userFixture(), 'phone', NOW)).toBe(
      'ana@example.com · Joined 16 Oct · Never active',
    );
    const earlier = userFixture({
      createdAt: new Date(2025, 9, 16, 12).toISOString(),
    });
    expect(identityMeta(earlier, 'phone', NOW)).toBe(
      'ana@example.com · Joined 16 Oct 2025 · Never active',
    );
  });

  it.each(['desktop', 'phone'] as const)(
    'places the phone between the email and Joined on %s, and Never active last',
    (variant) => {
      const user = userFixture({ phone: '+44 20 7946 0018' });
      expect(identityMeta(user, variant, NOW).split(' · ')).toEqual([
        'ana@example.com',
        '+44 20 7946 0018',
        variant === 'desktop' ? 'Joined 16 Oct 2026' : 'Joined 16 Oct',
        'Never active',
      ]);
    },
  );

  it('ends with Last active today after a phone and Joined when the user was active today', () => {
    const user = userFixture({
      phone: '+44 20 7946 0018',
      lastActiveAt: new Date(2026, 9, 22, 8).toISOString(),
    });
    expect(identityMeta(user, 'desktop', NOW).split(' · ')).toEqual([
      'ana@example.com',
      '+44 20 7946 0018',
      'Joined 16 Oct 2026',
      'Last active today',
    ]);
  });

  it('gives three parts when no phone is set', () => {
    expect(identityMeta(userFixture(), 'desktop', NOW).split(' · ')).toEqual([
      'ana@example.com',
      'Joined 16 Oct 2026',
      'Never active',
    ]);
  });
});

describe('identityMeta for a Disabled User', () => {
  const disabledThreeDaysAgo = new Date(2026, 9, 19, 12).toISOString();

  it.each(['desktop', 'phone'] as const)(
    'ends with the disabled day after Last active on %s',
    (variant) => {
      const user = userFixture({
        phone: '+44 20 7946 0018',
        disabled: true,
        disabledAt: disabledThreeDaysAgo,
        lastActiveAt: new Date(2026, 9, 22, 8).toISOString(),
      });
      expect(identityMeta(user, variant, NOW).split(' · ')).toEqual([
        'ana@example.com',
        '+44 20 7946 0018',
        variant === 'desktop' ? 'Joined 16 Oct 2026' : 'Joined 16 Oct',
        'Last active today',
        'Disabled 3 days ago',
      ]);
    },
  );

  it('ends with plain Disabled when the User has no disabled day', () => {
    const user = userFixture({ disabled: true, disabledAt: null });
    expect(identityMeta(user, 'desktop', NOW)).toBe(
      'ana@example.com · Joined 16 Oct 2026 · Never active · Disabled',
    );
  });
});

describe('lifecycleRowDescription', () => {
  it('returns the per-layout static text for a row with fixed copy', () => {
    expect(lifecycleRowDescription('disable', 'desktop')).toBe(
      'Blocks sign-in until re-enabled.',
    );
    expect(lifecycleRowDescription('disable', 'phone')).toBe('Blocks sign-in');
  });

  it('returns undefined on both layouts for promote, which has no static row description', () => {
    expect(lifecycleRowDescription('promote', 'desktop')).toBeUndefined();
    expect(lifecycleRowDescription('promote', 'phone')).toBeUndefined();
  });
});

describe('LIFECYCLE_ACTION_COPY', () => {
  const copy: Record<LifecycleAction, LifecycleActionCopy> =
    LIFECYCLE_ACTION_COPY;
  const actions = Object.keys(copy) as LifecycleAction[];

  it('withdraw confirmTitle names the user being withdrawn', () => {
    expect(copy.withdrawYouTubeAccess.confirmTitle('Ana Costa')).toBe(
      'Withdraw YouTube Access from Ana Costa?',
    );
  });

  it.each(actions.filter((action) => action !== 'withdrawYouTubeAccess'))(
    'confirmTitle for %s ignores the display name',
    (action) => {
      expect(copy[action].confirmTitle('Ana Costa')).toBe(
        copy[action].confirmTitle('Ben Ortiz'),
      );
    },
  );

  it.each(actions)(
    'ariaLabel for %s contains the desktop label stem and the phone label',
    (action) => {
      const { ariaLabel, desktopLabel, phoneLabel } = copy[action];
      const desktopStem = desktopLabel.replace(/…$/, '');
      expect(ariaLabel).toContain(desktopStem);
      expect(ariaLabel.toLowerCase()).toContain(phoneLabel.toLowerCase());
    },
  );

  it('marks exactly disable, demote and withdrawYouTubeAccess as destructive', () => {
    const destructive = actions
      .filter((action) => copy[action].tone === 'destructive')
      .sort();
    expect(destructive).toEqual(
      ['demote', 'disable', 'withdrawYouTubeAccess'].sort(),
    );
  });
});
