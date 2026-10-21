import { expect, test, type Page } from '@playwright/test';
import { gotoStable, routeApi } from './helpers';
import { stubAdminAuditLogs, stubAdminOverview } from './helpers/adminOverview';

/**
 * Feedback inbox access control — admin vs. normal user (issue #1213).
 *
 * Hermetic stubs:
 * - `/auth/refresh` returns the seeded persona (OPTIONS + GET/POST).
 * - `GET /admin/feedback/reports` returns mock report rows (OPTIONS + GET).
 *
 * No live third-party services or admin mutation endpoints.
 */

interface PersonaUser {
  id: string;
  name: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'user' | 'platform_admin';
  disabled: boolean;
}

function corsHeaders(origin: string) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  } as const;
}

async function seedSession(page: Page, user: PersonaUser) {
  await page.addInitScript((seedUser: PersonaUser) => {
    window.localStorage.setItem('myorganiser_access_token', 'fake-jwt-token');
    window.localStorage.setItem('myorganiser_token_storage', 'local');
    window.localStorage.setItem('myorganiser_user', JSON.stringify(seedUser));
  }, user);
}

async function stubAuthRefresh(page: Page, user: PersonaUser) {
  const refreshUrl = /\/auth\/refresh\/?(\?.*)?$/;

  await routeApi(page, refreshUrl, async (route) => {
    const origin = new URL(page.url() || 'http://localhost:4200').origin;
    const headers = corsHeaders(origin);

    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    await route.fulfill({
      status: 200,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'fake-jwt-token',
        expires_in: 3600,
        user,
      }),
    });
  });
}

async function stubAdminFeedbackReports(page: Page) {
  const adminFeedbackUrl = /\/admin\/feedback\/reports\/?(\?.*)?$/;

  await routeApi(page, adminFeedbackUrl, async (route) => {
    const origin = new URL(page.url() || 'http://localhost:4200').origin;
    const headers = corsHeaders(origin);
    const request = route.request();

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        headers,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'fb-1',
              kind: 'bug_report',
              status: 'received',
              title: 'Export button does nothing',
              platform: 'web',
              trackingIssueNumber: null,
              reporterUserId: 'u-rep-1',
              reporter: {
                id: 'u-rep-1',
                name: 'Ada Lovelace',
                email: 'ada@example.com',
              },
              statusChangedAt: null,
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      });
      return;
    }

    await route.continue();
  });
}

const PLATFORM_ADMIN: PersonaUser = {
  id: 'a-session',
  name: 'Session Admin',
  email: 'session-admin@example.com',
  firstName: 'Session',
  lastName: 'Admin',
  role: 'platform_admin',
  disabled: false,
};

const NORMAL_USER: PersonaUser = {
  id: 'u-normal',
  name: 'Jane Doe',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  role: 'user',
  disabled: false,
};

test.describe('Feedback inbox access', () => {
  test('platform admin reaches the Feedback inbox', async ({ page }) => {
    test.setTimeout(60000);

    await seedSession(page, PLATFORM_ADMIN);
    await stubAuthRefresh(page, PLATFORM_ADMIN);
    await stubAdminFeedbackReports(page);
    await stubAdminOverview(page);
    await stubAdminAuditLogs(page);

    await gotoStable(page, '/admin');

    // /admin renders the Overview; AdminGuard lets a platform admin through
    await expect(page).toHaveURL(/\/admin\/?(\?.*)?$/, { timeout: 60000 });

    // Click the Feedback nav link in the admin sidebar (the phone tab bar
    // carries the same name but is display:none at this viewport)
    await page
      .getByRole('navigation', { name: 'Admin sections' })
      .getByRole('link', { name: /^Feedback/ })
      .click();

    // Assert navigation to /admin/feedback
    await expect(page).toHaveURL(/.*\/admin\/feedback(?:\/|$|\?)/, {
      timeout: 60000,
    });

    // Assert the page heading
    await expect(
      page.getByRole('heading', { name: 'Feedback', level: 1 }),
    ).toBeVisible({ timeout: 60000 });

    // Assert filter controls are visible
    // The Status filter has a Label with htmlFor="status-filter" pointing to a SelectTrigger with id="status-filter"
    await expect(page.locator('#status-filter')).toBeVisible({
      timeout: 60000,
    });

    // Assert the table shows the mocked report row
    const table = page.getByRole('table');
    const reportRow = table
      .getByRole('row')
      .filter({ hasText: 'Export button does nothing' });

    await expect(reportRow).toBeVisible({ timeout: 60000 });
    await expect(reportRow).toContainText('Bug report');
    await expect(reportRow).toContainText('Received');
    await expect(reportRow).toContainText('web');
    await expect(reportRow).toContainText('Ada Lovelace');
  });

  test('non-admin user is redirected away from the Feedback inbox', async ({
    page,
  }) => {
    test.setTimeout(60000);

    await seedSession(page, NORMAL_USER);
    await stubAuthRefresh(page, NORMAL_USER);

    await gotoStable(page, '/admin/feedback');

    // AdminGuard redirects non-admin to dashboard
    await expect(page).toHaveURL(/.*dashboard/, { timeout: 60000 });
    await expect(page).not.toHaveURL(/.*\/admin/);
  });
});
