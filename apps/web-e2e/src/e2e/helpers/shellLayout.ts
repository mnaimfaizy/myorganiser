import { expect, type Page } from '@playwright/test';
import { stubJsonGet } from './apiStub';
import { login, setupBackend, type IdentityEntry } from './multiUserVault';

/**
 * Shared scaffolding for the phone-width shell specs (`phone-shell.spec.ts`
 * and `tasks-layout.spec.ts`): the phone viewport, the mount-time read stubs,
 * the sign-in that lands on the dashboard, the tab bar, and the horizontal
 * overflow check.
 *
 * Imported by path, not re-exported from `helpers/index.ts`, so only the two
 * shell specs take this dependency.
 */

export const PHONE_VIEWPORT = { width: 390, height: 844 };

export interface ShellAccount {
  email: string;
  /** Throwaway login fixture; the backend is stubbed in-process. */
  loginFixture: string;
  identities: IdentityEntry[];
}

/**
 * Sign in and land on the dashboard at phone width. `login()` waits for the
 * tab bar (see waitForDashboardReady) and the mount-time vault work to settle.
 * Navigation after this point is by clicking links only: a `gotoStable` to
 * another dashboard route remounts VaultSessionProvider after login.
 *
 * The backend starts with no vault on the server (GET /vault is 404 until the
 * spec's own PUT), so the gate offers creation. With the YouTube availability
 * stub off, Home does not read status, and no further YouTube reads follow.
 */
export async function signInToShell(page: Page, account: ShellAccount) {
  setupBackend(page, account.identities);
  await stubJsonGet(page, /\/feedback\/reports\/?(\?.*)?$/, {
    items: [],
    hasChangedSinceLastSeen: false,
  });
  await stubJsonGet(page, /\/youtube\/availability\/?(\?.*)?$/, {
    available: false,
  });
  await stubJsonGet(page, /\/youtube\/status\/?(\?.*)?$/, {
    connected: false,
  });
  await login(page, account.email, account.loginFixture);
  await expect(page).toHaveURL(/.*dashboard/);
}

export function tabBar(page: Page) {
  return page.getByRole('navigation', { name: 'App sections' });
}

export async function expectNoHorizontalOverflow(page: Page, route: string) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      { message: route, timeout: 10000 },
    )
    .toBeLessThanOrEqual(0);
}
