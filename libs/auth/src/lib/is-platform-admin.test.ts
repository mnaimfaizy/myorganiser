import type { AuthUser } from './auth-session-types';

import { isPlatformAdmin } from './is-platform-admin';

const baseUser: AuthUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  role: 'user',
  disabled: false,
};

describe('isPlatformAdmin', () => {
  it('returns true when role is platform_admin', () => {
    expect(isPlatformAdmin({ ...baseUser, role: 'platform_admin' })).toBe(true);
  });

  it('returns false when role is user', () => {
    expect(isPlatformAdmin({ ...baseUser, role: 'user' })).toBe(false);
  });

  it('returns false when user is null', () => {
    expect(isPlatformAdmin(null)).toBe(false);
  });

  it('returns false when user is undefined', () => {
    expect(isPlatformAdmin(undefined)).toBe(false);
  });
});
