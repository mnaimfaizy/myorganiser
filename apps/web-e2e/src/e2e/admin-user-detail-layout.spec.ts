import type {
  AdminAuditLogEntry,
  AdminUserIdentity,
  YouTubeAccessUsageResponse,
} from '@myorganiser/app-api-client';
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
  stubAdminAuditLogsPaged,
  type AdminAuditLogRequest,
} from './helpers/adminAuditLogs';
import {
  stubAdminUserDetail,
  stubYouTubeAccessUsage,
  type AdminUserDetailMutation,
} from './helpers/adminUserDetail';
import { PHONE_VIEWPORT } from './helpers/shellLayout';

/**
 * Admin User detail layout (#1267): the /admin/users/[userId] page at desktop
 * and phone widths. The identity, the back link, the Access and Sign-in
 * groups with their lifecycle buttons, the Recent activity list, the
 * withdraw confirmation, and the self-guard on the signed-in admin's own page.
 *
 * Hermetic stubs (every request the page makes is answered here):
 * - `/auth/refresh` returns the seeded platform admin (OPTIONS + GET).
 * - `GET /admin/overview` returns fixed counts. The admin shell reads it on mount.
 * - `GET /admin/users/{userId}` answers the fixture users. Any other method on
 *   that path is recorded, and the spec asserts that none was sent.
 * - `GET /admin/youtube-access` returns fixed usage (18 of 25 granted).
 * - `GET /admin/audit-logs` filters by `userId` (actor or target) and records
 *   each request's query. See `helpers/adminAuditLogs.ts`.
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

const DESKTOP_VIEWPORT = { width: 1440, height: 1100 };

/** The viewed user: a verified, YouTube-enabled member. */
const ANA: AdminUserIdentity = {
  id: 'u-ana',
  name: 'Ana Costa',
  email: 'ana.costa@example.com',
  firstName: 'Ana',
  lastName: 'Costa',
  role: 'user',
  disabled: false,
  emailVerified: true,
  youtubeAccess: true,
  createdAt: '2026-10-16T12:00:00.000Z',
};

/** The persona's own identity, for the self-guard page. */
const SELF: AdminUserIdentity = {
  id: 'a-session',
  name: 'Session Admin',
  email: 'session-admin@example.com',
  firstName: 'Session',
  lastName: 'Admin',
  role: 'platform_admin',
  disabled: false,
  emailVerified: true,
  youtubeAccess: false,
  createdAt: '2026-10-01T12:00:00.000Z',
};

const USERS: AdminUserIdentity[] = [ANA, SELF];

const YOUTUBE_USAGE: YouTubeAccessUsageResponse = {
  everGranted: 18,
  ceiling: 25,
};

const SELF_GUARD_NOTE = "You can't disable or demote yourself.";
const CONFIRM_AUDIT_NOTE =
  'The action is written to the audit log under your name.';
const WITHDRAW_TITLE = 'Withdraw YouTube Access from Ana Costa?';

function auditEntry(
  id: string,
  actor: { id: string; name: string },
  target: { id: string; name: string },
  action: AdminAuditLogEntry['action'],
  createdAt: string,
): AdminAuditLogEntry {
  return {
    id,
    actorUserId: actor.id,
    actorName: actor.name,
    targetUserId: target.id,
    targetName: target.name,
    actorDeleted: false,
    targetDeleted: false,
    action,
    createdAt,
  };
}

const ADMIN = { id: 'a-session', name: 'Session Admin' };
const ANA_REF = { id: 'u-ana', name: 'Ana Costa' };
const MEMBER_3 = { id: 'u-003', name: 'Member 3' };

/**
 * Seven entries touch Ana (as target, or as actor on Member 3), and one
 * unrelated entry targets Member 3. The page shows five, newest first, so
 * al-102 (Ana acting on Member 3) is inside the visible five.
 */
const AUDIT_ENTRIES: AdminAuditLogEntry[] = [
  auditEntry(
    'al-101',
    ADMIN,
    ANA_REF,
    'youtube_access_grant',
    '2026-10-22T08:00:00.000Z',
  ),
  auditEntry(
    'al-102',
    ANA_REF,
    MEMBER_3,
    'promote',
    '2026-10-22T07:00:00.000Z',
  ),
  auditEntry(
    'al-103',
    ADMIN,
    ANA_REF,
    'resend_verification',
    '2026-10-21T08:00:00.000Z',
  ),
  auditEntry('al-104', ADMIN, ANA_REF, 'disable', '2026-10-20T08:00:00.000Z'),
  auditEntry(
    'al-105',
    ADMIN,
    ANA_REF,
    'force_logout',
    '2026-10-19T08:00:00.000Z',
  ),
  auditEntry('al-106', ADMIN, ANA_REF, 'enable', '2026-10-18T08:00:00.000Z'),
  auditEntry('al-107', ADMIN, MEMBER_3, 'disable', '2026-10-17T08:00:00.000Z'),
  auditEntry(
    'al-108',
    ADMIN,
    ANA_REF,
    'youtube_access_withdraw',
    '2026-10-16T08:00:00.000Z',
  ),
];

interface OpenedUserDetail {
  auditRequests: AdminAuditLogRequest[];
  mutations: AdminUserDetailMutation[];
}

/** Seeds the session, stubs every read, and opens /admin/users/{userId}. */
async function openUserDetail(
  page: Page,
  userId: string,
): Promise<OpenedUserDetail> {
  await seedSession(page, PLATFORM_ADMIN);
  await stubAuthRefresh(page, PLATFORM_ADMIN);
  await stubAdminOverview(page);
  await stubYouTubeAccessUsage(page, YOUTUBE_USAGE);
  const auditRequests = await stubAdminAuditLogsPaged(page, AUDIT_ENTRIES);
  const mutations = await stubAdminUserDetail(page, USERS);

  await gotoStable(page, `/admin/users/${userId}`);

  return { auditRequests, mutations };
}

/** The Recent activity section, on either width. */
function getRecentActivity(page: Page): Locator {
  return page.getByRole('region', { name: /^Recent activity$/i });
}

/** The withdraw confirmation. Its title names the viewed user. */
async function openWithdrawDialog(page: Page): Promise<Locator> {
  await page
    .locator('main')
    .getByRole('button', { name: 'Withdraw YouTube Access', exact: true })
    .click();

  const dialog = page.getByRole('alertdialog', {
    name: WITHDRAW_TITLE,
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('Admin User detail layout (E2E)', () => {
  test.describe('at 1440px', () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test('the page has one h1, the user name', async ({ page }) => {
      test.setTimeout(60000);

      await openUserDetail(page, 'u-ana');

      await expectSingleH1(page, 'Ana Costa');
    });

    test('the back link reads All users and points to the user list', async ({
      page,
    }) => {
      test.setTimeout(60000);

      await openUserDetail(page, 'u-ana');
      await expectSingleH1(page, 'Ana Costa');

      await expect(
        page
          .locator('main')
          .getByRole('link', { name: 'All users', exact: true }),
      ).toHaveAttribute('href', '/admin/users');
    });

    test('the Access, Sign-in actions and Recent activity sections are visible', async ({
      page,
    }) => {
      test.setTimeout(60000);

      await openUserDetail(page, 'u-ana');
      await expectSingleH1(page, 'Ana Costa');

      await expect(
        page.getByRole('heading', { level: 2, name: 'Access', exact: true }),
      ).toBeVisible({ timeout: 60000 });
      await expect(
        page.getByRole('heading', {
          level: 2,
          name: 'Sign-in actions',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', {
          level: 2,
          name: 'Recent activity',
          exact: true,
        }),
      ).toBeVisible();
    });

    test('the YouTube Access row text includes Granted · 7 of 25 places left', async ({
      page,
    }) => {
      test.setTimeout(60000);

      await openUserDetail(page, 'u-ana');
      await expectSingleH1(page, 'Ana Costa');

      await expect(
        page
          .locator('main')
          .getByText('Granted · 7 of 25 places left', { exact: false }),
      ).toBeVisible({ timeout: 60000 });
    });

    test('the lifecycle buttons are reachable by name, Resend verification is disabled and the others are enabled', async ({
      page,
    }) => {
      test.setTimeout(60000);

      await openUserDetail(page, 'u-ana');
      await expectSingleH1(page, 'Ana Costa');

      const main = page.locator('main');

      await expect(
        main.getByRole('button', {
          name: 'Withdraw YouTube Access',
          exact: true,
        }),
      ).toBeEnabled({ timeout: 60000 });
      await expect(
        main.getByRole('button', {
          name: 'Promote to Platform Admin',
          exact: true,
        }),
      ).toBeEnabled();
      await expect(
        main.getByRole('button', {
          name: 'Resend verification',
          exact: true,
        }),
      ).toBeDisabled();
      await expect(
        main.getByRole('button', {
          name: 'Log out everywhere',
          exact: true,
        }),
      ).toBeEnabled();
      await expect(
        main.getByRole('button', { name: 'Disable account', exact: true }),
      ).toBeEnabled();
    });

    test('Recent activity requests the audit log filtered to this user', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const { auditRequests } = await openUserDetail(page, 'u-ana');
      await expectSingleH1(page, 'Ana Costa');

      await expect(getRecentActivity(page).getByRole('listitem')).toHaveCount(
        5,
        { timeout: 60000 },
      );
      expect(auditRequests.at(-1)).toMatchObject({ userId: 'u-ana' });
    });

    test('Recent activity shows five entries, including one where Ana acted on Member 3, and links to the full audit log', async ({
      page,
    }) => {
      test.setTimeout(60000);

      await openUserDetail(page, 'u-ana');
      await expectSingleH1(page, 'Ana Costa');

      const recent = getRecentActivity(page);
      await expect(recent.getByRole('listitem')).toHaveCount(5, {
        timeout: 60000,
      });
      const memberRow = recent.getByRole('listitem').filter({
        has: page.getByRole('link', { name: 'Member 3', exact: true }),
      });
      await expect(memberRow).toHaveCount(1);
      await expect(
        memberRow.getByRole('link', { name: 'Ana Costa', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Full audit log', exact: true }),
      ).toHaveAttribute('href', '/admin/audit-logs');
    });

    test('the page does not scroll sideways at 1440px', async ({ page }) => {
      test.setTimeout(60000);

      await openUserDetail(page, 'u-ana');
      await expectSingleH1(page, 'Ana Costa');

      await expectNoHorizontalOverflow(page, 'User detail at 1440px');
    });

    test('Withdraw YouTube Access opens an alert dialog that names the user and notes the audit log', async ({
      page,
    }) => {
      test.setTimeout(60000);

      await openUserDetail(page, 'u-ana');
      await expectSingleH1(page, 'Ana Costa');

      const dialog = await openWithdrawDialog(page);
      await expect(
        dialog.getByText(CONFIRM_AUDIT_NOTE, { exact: true }),
      ).toBeVisible();
    });

    test('Cancel closes the Withdraw dialog and sends no mutation', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const { mutations } = await openUserDetail(page, 'u-ana');
      await expectSingleH1(page, 'Ana Costa');

      const dialog = await openWithdrawDialog(page);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

      await expect(dialog).toBeHidden();
      expect(mutations).toEqual([]);
    });

    test("on the signed-in admin's own page, Disable account and Demote are disabled, and the note explains why", async ({
      page,
    }) => {
      test.setTimeout(60000);

      const { mutations } = await openUserDetail(page, 'a-session');
      await expectSingleH1(page, 'Session Admin');

      const main = page.locator('main');
      const disable = main.getByRole('button', {
        name: 'Disable account',
        exact: true,
      });

      await expect(disable).toBeDisabled({ timeout: 60000 });
      await expect(
        main.getByRole('button', {
          name: 'Demote Platform Admin',
          exact: true,
        }),
      ).toBeDisabled();
      await expect(
        page.getByText(SELF_GUARD_NOTE, { exact: true }),
      ).toBeVisible();
      await expect(disable).toHaveAccessibleDescription(SELF_GUARD_NOTE);
      expect(mutations).toEqual([]);
    });
  });

  test.describe('at 390px', () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test('the page has one h1, the user name', async ({ page }) => {
      test.setTimeout(60000);

      await openUserDetail(page, 'u-ana');

      await expectSingleH1(page, 'Ana Costa');
    });

    test('the back link reads Users and points to the user list', async ({
      page,
    }) => {
      test.setTimeout(60000);

      await openUserDetail(page, 'u-ana');
      await expectSingleH1(page, 'Ana Costa');

      // The phone tab bar sits inside main and has its own Users link.
      await expect(
        page
          .locator('main')
          .getByRole('link', { name: 'Users', exact: true })
          .and(page.locator(':not(nav[aria-label="Admin sections"] *)')),
      ).toHaveAttribute('href', '/admin/users');
    });

    test('the Access, Sign-in and Recent activity sections are visible', async ({
      page,
    }) => {
      test.setTimeout(60000);

      await openUserDetail(page, 'u-ana');
      await expectSingleH1(page, 'Ana Costa');

      await expect(
        page.getByRole('heading', { level: 2, name: /^access$/i }),
      ).toBeVisible({ timeout: 60000 });
      await expect(
        page.getByRole('heading', { level: 2, name: /^sign-in$/i }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { level: 2, name: /^recent activity$/i }),
      ).toBeVisible();
    });

    test('the YouTube Access row reads Granted · 7 left', async ({ page }) => {
      test.setTimeout(60000);

      await openUserDetail(page, 'u-ana');
      await expectSingleH1(page, 'Ana Costa');

      await expect(
        page.locator('main').getByText('Granted · 7 left', { exact: true }),
      ).toBeVisible({ timeout: 60000 });
    });

    test('the page does not scroll sideways at 390px', async ({ page }) => {
      test.setTimeout(60000);

      await openUserDetail(page, 'u-ana');
      await expectSingleH1(page, 'Ana Costa');

      await expectNoHorizontalOverflow(page, 'User detail at 390px');
    });

    test('every button in main has an accessible name', async ({ page }) => {
      test.setTimeout(60000);

      await openUserDetail(page, 'u-ana');
      await expectSingleH1(page, 'Ana Costa');

      const buttons = page.locator('main').getByRole('button');
      await expect(buttons.first()).toBeVisible({ timeout: 60000 });
      const count = await buttons.count();
      expect(count).toBeGreaterThan(0);

      await Promise.all(
        Array.from({ length: count }, (_, index) =>
          expect(buttons.nth(index)).toHaveAccessibleName(/\S/),
        ),
      );
    });

    test('Withdraw opens an alert dialog with the same title, and Cancel closes it', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const { mutations } = await openUserDetail(page, 'u-ana');
      await expectSingleH1(page, 'Ana Costa');

      const dialog = await openWithdrawDialog(page);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

      await expect(dialog).toBeHidden();
      expect(mutations).toEqual([]);
    });
  });
});
