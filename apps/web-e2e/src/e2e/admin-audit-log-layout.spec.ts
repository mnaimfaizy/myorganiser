import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  expectNoHorizontalOverflow,
  expectSingleH1,
  gotoStable,
} from './helpers';
import {
  seedSession,
  stubAuthRefresh,
  type PersonaUser,
} from './helpers/adminSession';
import { stubAdminOverview } from './helpers/adminOverview';
import {
  buildAdminAuditEntries,
  stubAdminAuditLogsPaged,
  type AdminAuditLogRequest,
} from './helpers/adminAuditLogs';
import { buildAdminUsers, stubAdminUsers } from './helpers/adminUsers';
import { PHONE_VIEWPORT } from './helpers/shellLayout';

/**
 * Admin Audit log layout (#1268): the /admin/audit-logs page at desktop and
 * phone widths. The header, the filter toolbar and the Action and User
 * filters, the paging (desktop) and the day-grouped append list (phone), and
 * the phone filter sheet with its removable chips.
 *
 * Hermetic stubs (every request the page makes is answered here):
 * - `/auth/refresh` returns the seeded platform admin (OPTIONS + GET).
 * - `GET /admin/overview` returns fixed counts. The admin shell's provider
 *   reads it on mount.
 * - `GET /admin/audit-logs` returns a 30-entry fixture, filtered by `userId`
 *   (actor or target) and `action`, and paged the way the endpoint does. Each
 *   request's query is recorded. See `helpers/adminAuditLogs.ts`.
 * - `GET /admin/users` returns ten users for the User picker, so "Member 3"
 *   is `u-003`, the id of an audit target. See `helpers/adminUsers.ts`.
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

const AUDIT_ENTRIES = buildAdminAuditEntries(30);
const PICKER_USERS = buildAdminUsers(10);

/** Entries whose actor or target is Member 3 (`u-003`). */
const MEMBER_3_ENTRIES = AUDIT_ENTRIES.filter(
  (entry) => entry.actorUserId === 'u-003' || entry.targetUserId === 'u-003',
);

/** Entries whose action is Disable. */
const DISABLE_ENTRIES = AUDIT_ENTRIES.filter(
  (entry) => entry.action === 'disable',
);

/** Seeds the session, stubs the reads, and opens /admin/audit-logs. */
async function openAuditLog(page: Page): Promise<AdminAuditLogRequest[]> {
  await seedSession(page, PLATFORM_ADMIN);
  await stubAuthRefresh(page, PLATFORM_ADMIN);
  await stubAdminOverview(page);
  const requests = await stubAdminAuditLogsPaged(page, AUDIT_ENTRIES);
  await stubAdminUsers(page, PICKER_USERS);

  await gotoStable(page, '/admin/audit-logs');

  return requests;
}

/** The desktop entries card: a region of one listitem per row. */
function getEntryRows(page: Page): Locator {
  return page
    .getByRole('region', { name: 'Audit entries', exact: true })
    .getByRole('listitem');
}

/** The Action trigger. Its name is "Action" plus the current summary. */
function getActionTrigger(page: Page): Locator {
  return page.getByRole('button', { name: /^Action/ });
}

/** The User picker trigger. Its name is "User" plus the current choice. */
function getUserTrigger(page: Page): Locator {
  return page.getByRole('combobox', { name: /^User/ });
}

test.describe('Admin Audit log layout (E2E)', () => {
  test.describe('Admin Audit log at desktop width', () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test('header, toolbar, the first page of rows, and the pager render', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const requests = await openAuditLog(page);

      await expectSingleH1(page, 'Audit log');
      await expect(
        page.getByText(
          "Every admin action, newest first. Entries can't be edited or removed.",
          { exact: true },
        ),
      ).toBeVisible({ timeout: 60000 });

      await expect(
        page.getByRole('toolbar', {
          name: 'Filter the audit log',
          exact: true,
        }),
      ).toBeVisible();

      const rows = getEntryRows(page);
      await expect(rows).toHaveCount(25, { timeout: 60000 });

      const pages = page.getByRole('navigation', {
        name: 'Pages',
        exact: true,
      });
      await expect(
        pages.getByText('Showing 1–25 of 30 entries', { exact: true }),
      ).toBeVisible();
      await expect(
        pages.getByRole('button', { name: 'Newer', exact: true }),
      ).toBeDisabled();
      await expect(
        pages.getByRole('button', { name: 'Older', exact: true }),
      ).toBeEnabled();

      expect(requests[0]).toEqual({
        userId: null,
        action: [],
        page: 1,
        pageSize: 25,
      });

      await expectNoHorizontalOverflow(page, 'Audit log at 1440px');
    });

    test('a row names its actor and target as links, and a deleted target reads "Deleted user"', async ({
      page,
    }) => {
      test.setTimeout(60000);

      await openAuditLog(page);

      const rows = getEntryRows(page);
      await expect(rows).toHaveCount(25, { timeout: 60000 });

      // Entry 0 is the newest: Sam Miller (a-sam) acted on Member 1 (u-001).
      const firstRow = rows.first();
      await expect(
        firstRow.getByRole('link', { name: 'Sam Miller', exact: true }),
      ).toHaveAttribute('href', '/admin/users/a-sam');
      await expect(
        firstRow.getByRole('link', { name: 'Member 1', exact: true }),
      ).toHaveAttribute('href', '/admin/users/u-001');

      const deletedRow = rows.filter({ hasText: 'Deleted user' });
      await expect(deletedRow).toHaveCount(1);
      await expect(
        page.getByRole('region', { name: 'Audit entries', exact: true }),
      ).not.toContainText(/u-0\d{2}/);
    });

    test('Older moves to page 2 with the rest of the entries', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const requests = await openAuditLog(page);

      const rows = getEntryRows(page);
      await expect(rows).toHaveCount(25, { timeout: 60000 });

      const pages = page.getByRole('navigation', {
        name: 'Pages',
        exact: true,
      });
      const newer = pages.getByRole('button', { name: 'Newer', exact: true });
      const older = pages.getByRole('button', { name: 'Older', exact: true });

      await older.click();

      await expect(
        pages.getByText('Showing 26–30 of 30 entries', { exact: true }),
      ).toBeVisible({ timeout: 60000 });
      await expect(rows).toHaveCount(5, { timeout: 60000 });
      expect(requests.at(-1)).toEqual({
        userId: null,
        action: [],
        page: 2,
        pageSize: 25,
      });
      await expect(older).toBeDisabled();
      await expect(newer).toBeEnabled();
    });

    test('the Action filter keeps only Disable entries and the pager says matching entries', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const requests = await openAuditLog(page);

      const rows = getEntryRows(page);
      await expect(rows).toHaveCount(25, { timeout: 60000 });

      await getActionTrigger(page).click();
      await page
        .getByRole('menuitemcheckbox', { name: 'Disable', exact: true })
        .click();
      // The menu stays open while items are ticked. Close it before asserting.
      await page.keyboard.press('Escape');

      await expect(getActionTrigger(page)).toHaveAccessibleName(/Disable/);
      await expect(rows).toHaveCount(DISABLE_ENTRIES.length, {
        timeout: 60000,
      });
      await expect(
        page
          .getByRole('navigation', { name: 'Pages', exact: true })
          .getByText(
            `Showing 1–${DISABLE_ENTRIES.length} of ${DISABLE_ENTRIES.length} matching entries`,
            { exact: true },
          ),
      ).toBeVisible();
      await expect(rows.getByText('Disable', { exact: true })).toHaveCount(
        DISABLE_ENTRIES.length,
      );

      expect(requests.at(-1)).toEqual({
        userId: null,
        action: ['disable'],
        page: 1,
        pageSize: 25,
      });
    });

    test('choosing Member 3 in User narrows the log, and Clear filters restores it', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const requests = await openAuditLog(page);

      const rows = getEntryRows(page);
      await expect(rows).toHaveCount(25, { timeout: 60000 });

      const clear = page.getByRole('button', {
        name: 'Clear filters',
        exact: true,
      });
      await expect(clear).toBeDisabled();

      await getUserTrigger(page).click();
      await page.getByRole('option', { name: /^Member 3(?![0-9])/ }).click();

      await expect(getUserTrigger(page)).toHaveAccessibleName(/Member 3/);
      await expect(rows).toHaveCount(MEMBER_3_ENTRIES.length, {
        timeout: 60000,
      });
      await expect(
        rows.getByRole('link', { name: 'Member 3', exact: true }),
      ).toHaveCount(MEMBER_3_ENTRIES.length);
      expect(requests.at(-1)).toEqual({
        userId: 'u-003',
        action: [],
        page: 1,
        pageSize: 25,
      });

      await expect(clear).toBeEnabled();
      await clear.click();

      await expect(clear).toBeDisabled();
      await expect(getUserTrigger(page)).toHaveAccessibleName(/Any user/);
      await expect(rows).toHaveCount(25, { timeout: 60000 });
      await expect(
        page
          .getByRole('navigation', { name: 'Pages', exact: true })
          .getByText('Showing 1–25 of 30 entries', { exact: true }),
      ).toBeVisible();
      expect(requests.at(-1)).toEqual({
        userId: null,
        action: [],
        page: 1,
        pageSize: 25,
      });
    });
  });

  test.describe('Admin Audit log at phone width', () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test('one Audit log heading, a Filters button, day headings, and the scroll footer', async ({
      page,
    }) => {
      test.setTimeout(60000);

      await openAuditLog(page);

      await expectSingleH1(page, 'Audit log');
      await expect(
        page.getByRole('button', { name: 'Filters', exact: true }),
      ).toBeVisible({ timeout: 60000 });
      await expect(
        page.getByRole('toolbar', {
          name: 'Filter the audit log',
          exact: true,
        }),
      ).toHaveCount(0);

      // The day heading's caps come from CSS, so match the text case-insensitively.
      await expect(
        page.getByRole('heading', { level: 2, name: /^today$/i }),
      ).toBeVisible({ timeout: 60000 });

      await expect(page.getByText('→')).toHaveCount(25);
      await expect(
        page.getByText('Scroll for more · 25 of 30', { exact: true }),
      ).toBeVisible();

      await expectNoHorizontalOverflow(page, 'Audit log at 390px');
    });

    test('ticking Disable in Filters shows one chip, and removing the chip clears the filter', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const requests = await openAuditLog(page);

      await expect(page.getByText('→')).toHaveCount(25, { timeout: 60000 });

      await page.getByRole('button', { name: 'Filters', exact: true }).click();

      const sheet = page.getByRole('dialog', { name: 'Filters', exact: true });
      await expect(sheet).toBeVisible();
      await sheet
        .getByRole('checkbox', { name: 'Disable', exact: true })
        .click();
      await sheet.getByRole('button', { name: 'Done', exact: true }).click();

      await expect(sheet).toBeHidden();
      await expect(
        page.getByRole('button', { name: 'Filters · 1', exact: true }),
      ).toBeVisible();

      const chips = page.getByRole('list', {
        name: 'Active filters',
        exact: true,
      });
      await expect(
        chips.getByRole('button', {
          name: 'Remove filter Disable',
          exact: true,
        }),
      ).toBeVisible();
      expect(requests.at(-1)).toMatchObject({
        action: ['disable'],
        page: 1,
      });

      await chips
        .getByRole('button', { name: 'Remove filter Disable', exact: true })
        .click();

      await expect(chips).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Filters', exact: true }),
      ).toBeVisible();
      expect(requests.at(-1)).toMatchObject({ action: [], page: 1 });
    });

    test('scrolling to the end of the list appends page 2', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const requests = await openAuditLog(page);

      await expect(page.getByText('→')).toHaveCount(25, { timeout: 60000 });

      const more = page.getByText('Scroll for more · 25 of 30', {
        exact: true,
      });
      await expect(more).toBeVisible();
      // The count sits just above the sentinel that loads the next page.
      await more.scrollIntoViewIfNeeded();

      await expect(page.getByText('30 of 30', { exact: true })).toBeVisible({
        timeout: 60000,
      });
      await expect(page.getByText('→')).toHaveCount(30);
      expect(requests.at(-1)).toEqual({
        userId: null,
        action: [],
        page: 2,
        pageSize: 25,
      });
    });
  });
});
