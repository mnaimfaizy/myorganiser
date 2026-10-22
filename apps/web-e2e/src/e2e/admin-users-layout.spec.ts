import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoStable } from './helpers';
import {
  seedSession,
  stubAuthRefresh,
  type PersonaUser,
} from './helpers/adminSession';
import { stubAdminAuditLogs, stubAdminOverview } from './helpers/adminOverview';
import {
  buildAdminUsers,
  stubAdminUsers,
  type AdminUsersRequest,
} from './helpers/adminUsers';
import {
  PHONE_VIEWPORT,
  expectNoHorizontalOverflow,
} from './helpers/shellLayout';

/**
 * Admin Users directory layout (#1266): the /admin/users page at desktop and
 * phone widths. The header and count, the filter chips, the sort select, the
 * paging (desktop) and the append-on-scroll list (phone).
 *
 * Hermetic stubs (every request the page makes is answered here):
 * - `/auth/refresh` returns the seeded platform admin (OPTIONS + GET).
 * - `GET /admin/overview` returns fixed counts (148 accounts, 3 platform
 *   admins). The layout's provider and the page header read it on mount.
 * - `GET /admin/audit-logs` returns fixed entries. The shell may fetch it.
 * - `GET /admin/users` returns a 30-user fixture, filtered, sorted, and paged
 *   the way the endpoint does. Each request's search params are recorded.
 *
 * No live third-party services and no admin mutation endpoints.
 */

const PLATFORM_ADMIN: PersonaUser = {
  id: 'a-session',
  name: 'Session Admin',
  email: 'session-admin@example.com',
  firstName: 'Session',
  lastName: 'Admin',
  role: 'platform_admin',
  disabled: false,
};

const DESKTOP_VIEWPORT = { width: 1440, height: 1000 };

const DIRECTORY_USERS = buildAdminUsers(30);
const UNVERIFIED_USERS = DIRECTORY_USERS.filter(
  (user) => !user.disabled && !user.emailVerified,
);
const UNVERIFIED_ADMINS = UNVERIFIED_USERS.filter(
  (user) => user.role === 'platform_admin',
);
const ADMIN_USERS = DIRECTORY_USERS.filter(
  (user) => user.role === 'platform_admin',
);

/** Seeds the session, stubs the reads, and opens /admin/users. */
async function openAdminUsers(page: Page): Promise<AdminUsersRequest[]> {
  await seedSession(page, PLATFORM_ADMIN);
  await stubAuthRefresh(page, PLATFORM_ADMIN);
  await stubAdminOverview(page);
  await stubAdminAuditLogs(page);
  const requests = await stubAdminUsers(page, DIRECTORY_USERS);

  await gotoStable(page, '/admin/users');

  return requests;
}

/** Every directory row, on both widths: one link per user, each with its join date. */
function getDirectoryRows(page: Page): Locator {
  return page.getByRole('link', { name: /Joined/ });
}

test.describe('Admin Users layout (E2E)', () => {
  test.describe('Admin Users at desktop width', () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test('header, filters, the first page of rows, and the pager render', async ({
      page,
    }) => {
      test.setTimeout(60000);

      await openAdminUsers(page);

      const headings = page.getByRole('heading', { level: 1 });
      await expect(headings).toHaveCount(1, { timeout: 60000 });
      await expect(headings).toHaveText('Users');
      await expect(
        page.getByText('148 accounts · 3 platform admins', { exact: true }),
      ).toBeVisible({ timeout: 60000 });

      const statusGroup = page.getByRole('group', {
        name: 'Status',
        exact: true,
      });
      await expect(
        statusGroup.getByRole('button', { name: 'All', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');

      const roleGroup = page.getByRole('group', { name: 'Role', exact: true });
      await expect(
        roleGroup.getByRole('button', { name: 'Any', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');

      await expect(
        page.getByRole('combobox', { name: 'Sort', exact: true }),
      ).toBeVisible();

      const rows = getDirectoryRows(page);
      await expect(rows).toHaveCount(25, { timeout: 60000 });
      await expect(
        rows.and(page.locator(':not([href^="/admin/users/"])')),
      ).toHaveCount(0);

      const pages = page.getByRole('navigation', {
        name: 'Pages',
        exact: true,
      });
      await expect(
        pages.getByText('Showing 1–25 of 30', { exact: true }),
      ).toBeVisible();
      await expect(
        pages.getByRole('button', { name: 'Previous', exact: true }),
      ).toBeDisabled();

      await expectNoHorizontalOverflow(page, 'Admin Users at 1440px');
    });

    test('status and role chips send the filtered request and keep one pressed chip per group', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const requests = await openAdminUsers(page);

      const rows = getDirectoryRows(page);
      await expect(rows).toHaveCount(25, { timeout: 60000 });

      const statusGroup = page.getByRole('group', {
        name: 'Status',
        exact: true,
      });
      const roleGroup = page.getByRole('group', { name: 'Role', exact: true });

      await statusGroup
        .getByRole('button', { name: 'Unverified', exact: true })
        .click();

      await expect(
        statusGroup.getByRole('button', { name: 'Unverified', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(
        statusGroup.getByRole('button', { name: 'All', exact: true }),
      ).toHaveAttribute('aria-pressed', 'false');
      await expect(rows).toHaveCount(UNVERIFIED_USERS.length, {
        timeout: 60000,
      });
      await expect(rows.filter({ hasNotText: 'Unverified' })).toHaveCount(0);
      expect(requests.at(-1)).toEqual({
        sort: 'newest',
        page: '1',
        pageSize: '25',
        status: 'unverified',
      });

      await roleGroup
        .getByRole('button', { name: 'Admin', exact: true })
        .click();

      await expect(
        roleGroup.getByRole('button', { name: 'Admin', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(
        roleGroup.getByRole('button', { name: 'Any', exact: true }),
      ).toHaveAttribute('aria-pressed', 'false');
      await expect(rows).toHaveCount(UNVERIFIED_ADMINS.length, {
        timeout: 60000,
      });
      expect(requests.at(-1)).toEqual({
        sort: 'newest',
        page: '1',
        pageSize: '25',
        status: 'unverified',
        role: 'platform_admin',
      });
    });

    test('Next and Previous move between pages, and the request carries the page', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const requests = await openAdminUsers(page);

      const rows = getDirectoryRows(page);
      await expect(rows).toHaveCount(25, { timeout: 60000 });

      const pages = page.getByRole('navigation', {
        name: 'Pages',
        exact: true,
      });
      const previous = pages.getByRole('button', {
        name: 'Previous',
        exact: true,
      });
      const next = pages.getByRole('button', { name: 'Next', exact: true });

      await next.click();

      await expect(
        pages.getByText('Showing 26–30 of 30', { exact: true }),
      ).toBeVisible({ timeout: 60000 });
      await expect(rows).toHaveCount(5, { timeout: 60000 });
      expect(requests.at(-1)).toEqual({
        sort: 'newest',
        page: '2',
        pageSize: '25',
      });
      await expect(next).toBeDisabled();
      await expect(previous).toBeEnabled();

      await previous.click();

      await expect(
        pages.getByText('Showing 1–25 of 30', { exact: true }),
      ).toBeVisible({ timeout: 60000 });
      await expect(rows).toHaveCount(25);
      expect(requests.at(-1)).toEqual({
        sort: 'newest',
        page: '1',
        pageSize: '25',
      });
    });

    test('choosing Name in the Sort select sends sort=name', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const requests = await openAdminUsers(page);

      const rows = getDirectoryRows(page);
      await expect(rows).toHaveCount(25, { timeout: 60000 });

      const sort = page.getByRole('combobox', { name: 'Sort', exact: true });
      await sort.click();
      await page.getByRole('option', { name: 'Name', exact: true }).click();

      await expect(sort).toHaveText('Name');
      await expect(rows.first()).toContainText('member1@example.com', {
        timeout: 60000,
      });
      expect(requests.at(-1)).toEqual({
        sort: 'name',
        page: '1',
        pageSize: '25',
      });
    });
  });

  test.describe('Admin Users at phone width', () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test('one Users heading, the count, five filter chips, and no sort or pager', async ({
      page,
    }) => {
      test.setTimeout(60000);

      await openAdminUsers(page);

      const headings = page.getByRole('heading', { level: 1 });
      await expect(headings).toHaveCount(1, { timeout: 60000 });
      await expect(headings).toHaveText('Users');
      await expect(page.getByText('148 accounts', { exact: true })).toBeVisible(
        { timeout: 60000 },
      );

      const toolbar = page.getByRole('toolbar', {
        name: 'Filter users',
        exact: true,
      });
      await expect(toolbar.getByRole('button')).toHaveText([
        'All',
        'Active',
        'Unverified',
        'Disabled',
        'Admins',
      ]);
      await expect(
        toolbar.getByRole('button', { name: 'All', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');

      await expect(
        page.getByRole('combobox', { name: 'Sort', exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('navigation', { name: 'Pages', exact: true }),
      ).toHaveCount(0);

      const tabs = page.getByRole('navigation', {
        name: 'Admin sections',
        exact: true,
      });
      await expect(tabs.getByRole('link', { name: /^Users/ })).toHaveAttribute(
        'aria-current',
        'page',
      );

      await expectNoHorizontalOverflow(page, 'Admin Users at 390px');
    });

    test('scrolling to the end of the list loads the next page of rows', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const requests = await openAdminUsers(page);

      const rows = getDirectoryRows(page);
      await expect(rows).toHaveCount(25, { timeout: 60000 });

      const more = page.getByText('Scroll for more · 25 of 30', {
        exact: true,
      });
      await expect(more).toBeVisible();
      // The count sits just under the sentinel that loads the next page.
      await more.scrollIntoViewIfNeeded();

      await expect(page.getByText('30 of 30', { exact: true })).toBeVisible({
        timeout: 60000,
      });
      await expect(rows).toHaveCount(30);
      expect(requests.at(-1)).toEqual({
        sort: 'newest',
        page: '2',
        pageSize: '25',
      });
    });

    test('the Admins chip sends role=platform_admin and lists only admins', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const requests = await openAdminUsers(page);

      const rows = getDirectoryRows(page);
      await expect(rows).toHaveCount(25, { timeout: 60000 });

      const toolbar = page.getByRole('toolbar', {
        name: 'Filter users',
        exact: true,
      });
      const admins = toolbar.getByRole('button', {
        name: 'Admins',
        exact: true,
      });
      await admins.click();

      await expect(admins).toHaveAttribute('aria-pressed', 'true');
      await expect(
        toolbar.getByRole('button', { name: 'All', exact: true }),
      ).toHaveAttribute('aria-pressed', 'false');
      await expect(rows).toHaveCount(ADMIN_USERS.length, { timeout: 60000 });
      await expect(rows.filter({ hasNotText: 'Admin ·' })).toHaveCount(0);
      expect(requests.at(-1)).toEqual({
        sort: 'newest',
        page: '1',
        pageSize: '25',
        role: 'platform_admin',
      });
    });
  });
});
