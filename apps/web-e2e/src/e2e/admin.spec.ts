import type { AdminUserIdentity } from '@myorganiser/app-api-client';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoStable, routeApi } from './helpers';
import {
  corsHeaders,
  seedSession,
  stubAuthRefresh,
  type PersonaUser,
} from './helpers/adminSession';
import { stubAdminAuditLogs, stubAdminOverview } from './helpers/adminOverview';
import { stubAdminUsers } from './helpers/adminUsers';

/**
 * Platform Admin console — access control + Overview landing + user directory
 * smoke (issue #204, Overview #1265).
 *
 * Hermetic stubs:
 * - `/auth/refresh` returns the seeded persona or 401 for guests (OPTIONS + GET/POST).
 * - `GET /admin/overview` returns fixed counts (OPTIONS + GET).
 * - `GET /admin/audit-logs` returns fixed entries (OPTIONS + GET).
 * - `GET /admin/users` returns one page of mock AdminUserIdentity rows, filtered
 *   by `q` (OPTIONS + GET). See `helpers/adminUsers.ts`.
 *
 * No live third-party services or admin mutation endpoints.
 */

async function stubAuthRefreshUnauthorized(page: Page) {
  const refreshUrl = /\/auth\/refresh\/?(\?.*)?$/;

  await routeApi(page, refreshUrl, async (route) => {
    const origin = new URL(page.url() || 'http://localhost:4200').origin;
    const headers = corsHeaders(origin);

    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    await route.fulfill({
      status: 401,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Unauthorized' }),
    });
  });
}

/** The Users section: a region of one link per row. */
function getDirectoryRows(page: Page): Locator {
  return page.getByRole('region', { name: 'Users', exact: true });
}

/**
 * One directory row is one link whose accessible name carries the name, the
 * email, the role pill, the status pill, and the join date.
 */
async function expectDirectoryRow(
  directory: Locator,
  displayName: string,
  expected: {
    email: string;
    roleLabel: string;
    statusLabel: string;
  },
) {
  const row = directory.getByRole('link', { name: displayName });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(expected.email);
  await expect(row).toContainText(expected.roleLabel);
  await expect(row).toContainText(expected.statusLabel);
}

const NORMAL_USER: PersonaUser = {
  id: 'u-normal',
  name: 'Normal User',
  email: 'user@example.com',
  firstName: 'Normal',
  lastName: 'User',
  role: 'user',
  disabled: false,
};

const PLATFORM_ADMIN: PersonaUser = {
  id: 'a-session',
  name: 'Session Admin',
  email: 'session-admin@example.com',
  firstName: 'Session',
  lastName: 'Admin',
  role: 'platform_admin',
  disabled: false,
};

const MOCK_DIRECTORY_USERS: AdminUserIdentity[] = [
  {
    id: 'u-1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: 'user',
    disabled: false,
    emailVerified: true,
    youtubeAccess: false,
    createdAt: '2026-09-02T09:00:00.000Z',
  },
  {
    id: 'a-1',
    name: 'Admin One',
    email: 'admin@example.com',
    firstName: 'Admin',
    lastName: 'One',
    role: 'platform_admin',
    disabled: false,
    emailVerified: true,
    youtubeAccess: false,
    createdAt: '2026-08-15T09:00:00.000Z',
  },
];

test.describe('Platform Admin console', () => {
  test('guest cannot access /admin', async ({ page }) => {
    test.setTimeout(60000);

    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await stubAuthRefreshUnauthorized(page);

    await gotoStable(page, '/admin');

    await expect(page).toHaveURL(/.*login/, { timeout: 60000 });
    await expect(page.locator('h1')).toContainText('Login');
  });

  test('normal user is redirected away from /admin', async ({ page }) => {
    test.setTimeout(60000);

    await seedSession(page, NORMAL_USER);
    await stubAuthRefresh(page, NORMAL_USER);

    await gotoStable(page, '/admin');

    await expect(page).toHaveURL(/.*dashboard/, { timeout: 60000 });
    await expect(page).not.toHaveURL(/.*\/admin/);
  });

  test('platform admin lands on Overview and reaches user directory', async ({
    page,
  }) => {
    test.setTimeout(60000);

    await seedSession(page, PLATFORM_ADMIN);
    await stubAuthRefresh(page, PLATFORM_ADMIN);
    await stubAdminOverview(page);
    await stubAdminAuditLogs(page);
    await stubAdminUsers(page, MOCK_DIRECTORY_USERS);

    await gotoStable(page, '/admin');

    // /admin renders the Overview; it no longer redirects to /admin/users.
    await expect(page).toHaveURL(/\/admin\/?(\?.*)?$/, { timeout: 60000 });
    await expect(
      page.getByRole('heading', { name: 'Platform overview', level: 1 }),
    ).toBeVisible({ timeout: 60000 });

    const sections = page.getByRole('navigation', { name: 'Admin sections' });
    await expect(
      sections.getByRole('link', { name: 'Overview', exact: true }),
    ).toBeVisible();
    await expect(sections.getByRole('link', { name: /^Users/ })).toBeVisible();
    await expect(
      sections.getByRole('link', { name: 'Audit log', exact: true }),
    ).toBeVisible();
    await expect(
      sections.getByRole('link', { name: /^Feedback/ }),
    ).toBeVisible();

    await sections.getByRole('link', { name: /^Users/ }).click();

    await expect(page).toHaveURL(/.*\/admin\/users(?:\/|$|\?)/, {
      timeout: 60000,
    });

    await expect(
      page.getByRole('heading', { name: 'Users', level: 1 }),
    ).toBeVisible({ timeout: 60000 });

    const directory = getDirectoryRows(page);
    await expect(directory).toBeVisible();

    await expectDirectoryRow(directory, 'Ada Lovelace', {
      email: 'ada@example.com',
      roleLabel: 'User',
      statusLabel: 'Active',
    });
    await expectDirectoryRow(directory, 'Admin One', {
      email: 'admin@example.com',
      roleLabel: 'Admin',
      statusLabel: 'Active',
    });

    await expect(directory.getByRole('link')).toHaveCount(2);
    await expect(
      directory.getByRole('link', { name: 'Ada Lovelace' }),
    ).toHaveAttribute('href', '/admin/users/u-1');
  });

  test('directory search keeps the user on the users page', async ({
    page,
  }) => {
    test.setTimeout(60000);

    await seedSession(page, PLATFORM_ADMIN);
    await stubAuthRefresh(page, PLATFORM_ADMIN);
    await stubAdminOverview(page);
    const requests = await stubAdminUsers(page, MOCK_DIRECTORY_USERS);

    await gotoStable(page, '/admin/users');

    await expect(
      page.getByRole('heading', { name: 'Users', level: 1 }),
    ).toBeVisible({ timeout: 60000 });

    const searchInput = page.getByRole('textbox', { name: 'Search users' });
    await searchInput.fill('Ada');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page).toHaveURL(/.*\/admin\/users(?:\/|$|\?)/, {
      timeout: 60000,
    });
    await expect(
      page.getByRole('heading', { name: 'Users', level: 1 }),
    ).toBeVisible();

    const directory = getDirectoryRows(page);
    await expect(directory).toBeVisible({ timeout: 60000 });
    await expectDirectoryRow(directory, 'Ada Lovelace', {
      email: 'ada@example.com',
      roleLabel: 'User',
      statusLabel: 'Active',
    });
    await expect(
      directory.getByRole('link', { name: 'Admin One' }),
    ).toHaveCount(0, { timeout: 60000 });
    expect(requests.at(-1)).toMatchObject({ q: 'Ada', page: '1' });
  });
});
