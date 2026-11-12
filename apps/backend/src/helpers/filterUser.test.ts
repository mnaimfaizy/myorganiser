import { describe, expect, test } from '@jest/globals';

import filterUser, { toAdminUserIdentity } from './filterUser';
import type { UserInterface } from '../types';

function makeUser(overrides: Partial<UserInterface> = {}): UserInterface {
  return {
    id: 'u1',
    name: 'Alice Example',
    email: 'alice@example.com',
    password: 'hashed',
    password_reset_token: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    first_name: 'Alice',
    last_name: 'Example',
    ...overrides,
  };
}

describe('filterUser', () => {
  test('includes role and disabled with defaults when missing', () => {
    const result = filterUser(makeUser());

    expect(result.role).toBe('user');
    expect(result.disabled).toBe(false);
  });

  test('preserves platform_admin role and disabled flag', () => {
    const result = filterUser(
      makeUser({ role: 'platform_admin', disabled: true } as UserInterface),
    );

    expect(result.role).toBe('platform_admin');
    expect(result.disabled).toBe(true);
  });
});

describe('toAdminUserIdentity', () => {
  test('maps snake_case fields and emailVerified from email_verification_timestamp', () => {
    const result = toAdminUserIdentity({
      id: 'u1',
      name: 'Alice Example',
      first_name: 'Alice',
      last_name: 'Example',
      email: 'alice@example.com',
      phone: null,
      role: 'user',
      disabled: false,
      email_verification_timestamp: new Date('2024-01-01'),
    });

    expect(result).toEqual({
      id: 'u1',
      name: 'Alice Example',
      email: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Example',
      phone: undefined,
      role: 'user',
      disabled: false,
      disabledAt: null,
      emailVerified: true,
      youtubeAccess: false,
      lastActiveAt: null,
    });
  });

  test('youtubeAccess mirrors youtube_access = true', () => {
    const result = toAdminUserIdentity({
      id: 'u3',
      name: 'Carol',
      first_name: 'Carol',
      last_name: 'User',
      email: 'carol@example.com',
      youtube_access: true,
    });

    expect(result.youtubeAccess).toBe(true);
  });

  test('emailVerified is false when email_verification_timestamp is absent', () => {
    const result = toAdminUserIdentity({
      id: 'u2',
      name: 'Bob',
      first_name: 'Bob',
      last_name: 'User',
      email: 'bob@example.com',
    });

    expect(result.emailVerified).toBe(false);
  });

  test('passes last_active_at through as lastActiveAt', () => {
    const lastActiveAt = new Date('2026-11-03T12:00:00.000Z');

    const result = toAdminUserIdentity({
      id: 'u4',
      name: 'Dana',
      email: 'dana@example.com',
      last_active_at: lastActiveAt,
    });

    expect(result.lastActiveAt).toBe(lastActiveAt);
  });

  test('maps a missing or null last_active_at to null lastActiveAt', () => {
    const base = { id: 'u5', name: 'Eve', email: 'eve@example.com' };

    expect(toAdminUserIdentity(base).lastActiveAt).toBeNull();
    expect(
      toAdminUserIdentity({ ...base, last_active_at: null }).lastActiveAt,
    ).toBeNull();
  });

  test('passes disabled_at through as disabledAt for a disabled User', () => {
    const disabledAt = new Date('2026-11-02T08:15:00.000Z');

    const result = toAdminUserIdentity({
      id: 'u6',
      name: 'Frank',
      email: 'frank@example.com',
      disabled: true,
      disabled_at: disabledAt,
    });

    expect(result.disabled).toBe(true);
    expect(result.disabledAt).toBe(disabledAt);
  });

  test('maps a missing or null disabled_at to null disabledAt', () => {
    const base = {
      id: 'u7',
      name: 'Gina',
      email: 'gina@example.com',
      disabled: false,
    };

    expect(toAdminUserIdentity(base).disabledAt).toBeNull();
    expect(
      toAdminUserIdentity({ ...base, disabled: true, disabled_at: null })
        .disabledAt,
    ).toBeNull();
  });
});
