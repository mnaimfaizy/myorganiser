import type { AuthUser } from './auth-session-types';

/**
 * Whether the signed-in User holds the Platform Admin role. A missing User
 * (signed out, or not yet read) is not a Platform Admin.
 */
export function isPlatformAdmin(user: AuthUser | undefined | null): boolean {
  return user?.role === 'platform_admin';
}
