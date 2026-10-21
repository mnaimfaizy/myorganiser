import { expect, test, type Page } from '@playwright/test';
import { gotoStable, stubJsonGet } from './helpers';
import {
  seedSession,
  stubAuthRefresh,
  type PersonaUser,
} from './helpers/adminSession';
import {
  stubAdminAuditLogs,
  stubAdminOverview,
  stubAdminOverviewFailure,
} from './helpers/adminOverview';
import {
  PHONE_VIEWPORT,
  expectNoHorizontalOverflow,
} from './helpers/shellLayout';

/**
 * Admin shell and Overview layout (#1265): the /admin landing at desktop and
 * phone widths, the Needs attention rows, the recent activity, and the
 * overview error state.
 *
 * Hermetic stubs (every request the page makes is answered here):
 * - `/auth/refresh` returns the seeded platform admin (OPTIONS + GET).
 * - `GET /admin/overview` returns fixed counts, or 500 for the error test.
 *   The admin layout's provider fetches it once on mount.
 * - `GET /admin/audit-logs` returns two fixed entries. The Overview's recent
 *   activity fetches `?limit=5` on mount at every width, and the Audit log
 *   page fetches it on the navigation test.
 * - `GET /admin/users` returns an empty directory for the phone tab test.
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

async function openAdminOverview(
  page: Page,
  options: { overviewFails?: boolean } = {},
) {
  await seedSession(page, PLATFORM_ADMIN);
  await stubAuthRefresh(page, PLATFORM_ADMIN);
  if (options.overviewFails) {
    await stubAdminOverviewFailure(page);
  } else {
    await stubAdminOverview(page);
  }
  await stubAdminAuditLogs(page);
  await stubJsonGet(page, /\/admin\/users\/?(\?.*)?$/, []);

  await gotoStable(page, '/admin');
}

test.describe('Admin Overview at desktop width', () => {
  test.use({ viewport: DESKTOP_VIEWPORT });

  test('sidebar lists the admin sections with live badges', async ({
    page,
  }) => {
    test.setTimeout(60000);

    await openAdminOverview(page);

    await expect(
      page.getByRole('heading', { name: 'Platform overview', level: 1 }),
    ).toBeVisible({ timeout: 60000 });

    const sections = page.getByRole('navigation', { name: 'Admin sections' });
    const links = sections.getByRole('link');
    await expect(links).toHaveText([
      /^Overview/,
      /^Users/,
      /^Audit log/,
      /^Feedback/,
    ]);

    await expect(
      sections.getByRole('link', { name: /^Overview/ }),
    ).toHaveAttribute('aria-current', 'page');

    // Badges sit inside each link: Users shows unverified, Feedback shows received reports.
    await expect(sections.getByRole('link', { name: /^Users/ })).toContainText(
      '12',
    );
    await expect(
      sections.getByRole('link', { name: /^Feedback/ }),
    ).toContainText('5');

    await expect(
      page.getByText('Platform admin', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('key numbers and the YouTube Access progress bar show the fixed counts', async ({
    page,
  }) => {
    test.setTimeout(60000);

    await openAdminOverview(page);

    const keyNumbers = page.getByRole('region', { name: 'Key numbers' });
    await expect(keyNumbers).toBeVisible({ timeout: 60000 });

    await expect(
      keyNumbers.getByRole('link', { name: /^USERS/ }),
    ).toContainText('148');
    await expect(
      keyNumbers.getByRole('link', { name: /^USERS/ }),
    ).toContainText('+6 this week');
    await expect(
      keyNumbers.getByRole('link', { name: /^PLATFORM ADMINS/ }),
    ).toContainText('You and 2 others');
    await expect(
      keyNumbers.getByRole('link', { name: /^UNVERIFIED/ }),
    ).toContainText('5 for more than 7 days');
    await expect(
      keyNumbers.getByRole('link', { name: /^DISABLED/ }),
    ).toContainText('Cannot sign in');

    const placesBar = page.getByRole('progressbar', {
      name: 'YouTube Access places used',
    });
    await expect(placesBar).toHaveAttribute('aria-valuenow', '20');
    await expect(placesBar).toHaveAttribute('aria-valuemin', '0');
    await expect(placesBar).toHaveAttribute('aria-valuemax', '25');
    await expect(
      keyNumbers.getByText('5 left · a first grant uses one'),
    ).toBeVisible();
  });

  test('needs attention lists three rows and recent activity shows the stubbed entries', async ({
    page,
  }) => {
    test.setTimeout(60000);

    await openAdminOverview(page);

    const attention = page.getByRole('region', { name: 'Needs attention' });
    await expect(attention).toBeVisible({ timeout: 60000 });
    await expect(attention.getByRole('listitem')).toHaveCount(3);
    await expect(attention).toContainText(
      '5 accounts unverified for over a week',
    );
    await expect(attention).toContainText('YouTube Access places running low');
    await expect(attention).toContainText('5 of 25 left.');
    await expect(attention).toContainText('4 accounts disabled');
    await expect(
      page.getByText('Withdraw unused access', { exact: false }),
    ).toHaveCount(0);

    const activity = page.getByRole('region', {
      name: 'Recent admin activity',
    });
    await expect(activity).toBeVisible({ timeout: 60000 });
    await expect(activity).toContainText('Promote');
    await expect(activity).toContainText('Grant YouTube Access');
    await expect(
      activity.getByRole('link', { name: 'u-1', exact: true }),
    ).toHaveAttribute('href', '/admin/users/u-1');
    await expect(
      activity.getByRole('link', { name: 'Audit log', exact: true }),
    ).toHaveAttribute('href', '/admin/audit-logs');

    await expectNoHorizontalOverflow(page, '/admin at desktop width');
  });

  test('View audit log opens the audit page with its nav item current', async ({
    page,
  }) => {
    test.setTimeout(60000);

    await openAdminOverview(page);

    await page
      .getByRole('link', { name: 'View audit log', exact: true })
      .click();

    await expect(page).toHaveURL(/\/admin\/audit-logs\/?(\?.*)?$/, {
      timeout: 60000,
    });
    await expect(
      page
        .getByRole('navigation', { name: 'Admin sections' })
        .getByRole('link', { name: 'Audit log', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('a failed overview request shows the error and a retry button', async ({
    page,
  }) => {
    test.setTimeout(60000);

    await openAdminOverview(page, { overviewFails: true });

    await expect(
      page.getByText('Unable to load overview. Please try again.', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      page.getByRole('button', { name: 'Try again', exact: true }),
    ).toBeVisible();
  });
});

test.describe('Admin Overview at phone width', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('phone shows one Overview heading, the tab bar, the account button and Needs attention', async ({
    page,
  }) => {
    test.setTimeout(60000);

    await openAdminOverview(page);

    // The desktop hero heading is display:none here, so the only h1 is the phone one.
    const headings = page.getByRole('heading', { level: 1 });
    await expect(headings).toHaveCount(1, { timeout: 60000 });
    await expect(headings).toHaveText('Overview');

    const tabs = page.getByRole('navigation', { name: 'Admin sections' });
    await expect(tabs.getByRole('link')).toHaveText([
      /^Overview/,
      /^Users/,
      /^Audit log/,
      /^Feedback/,
      /^My app/,
    ]);
    await expect(
      tabs.getByRole('link', { name: 'Overview', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      tabs.getByRole('link', { name: 'My app', exact: true }),
    ).toHaveAttribute('href', '/dashboard');

    await expect(
      page.getByRole('button', { name: 'Account menu for Session Admin' }),
    ).toBeVisible();

    await expect(
      page.getByRole('heading', { name: 'NEEDS ATTENTION · 3', level: 2 }),
    ).toBeVisible();

    await expect(
      page.getByRole('link', { name: /^YOUTUBE PLACES/ }),
    ).toContainText('20/25');

    await expectNoHorizontalOverflow(page, '/admin at phone width');
  });

  test('tapping Users in the tab bar opens the user directory', async ({
    page,
  }) => {
    test.setTimeout(60000);

    await openAdminOverview(page);

    await page
      .getByRole('navigation', { name: 'Admin sections' })
      .getByRole('link', { name: 'Users', exact: true })
      .click();

    await expect(page).toHaveURL(/\/admin\/users\/?(\?.*)?$/, {
      timeout: 60000,
    });
  });
});
