import { expect, test, type Page } from '@playwright/test';
import {
  gotoStable,
  routeApi,
  routeVaultBlobInventoryOverStore,
  waitForDashboardReady,
  waitForVaultMountSettled,
} from './helpers';

/**
 * Feedback Report sending flow — hermetic user journey (issue #1213).
 *
 * Hermetic stubs:
 * - `/auth/refresh` returns the seeded persona (OPTIONS + GET/POST).
 * - `POST /feedback/reports` creates and returns a report with 'received' status.
 * - `GET /feedback/reports` returns the sent report in the list.
 * - `POST /feedback/reports/seen` marks reports as read.
 * - `GET /vault` returns 404 (no vault on server).
 * - `GET /vault/blobs` returns empty inventory.
 *
 * No live network, no email delivery, fully hermetic vault mount.
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

async function stubFeedbackReportsCreate(page: Page, title: string) {
  const createUrl = /\/feedback\/reports\/?(\?.*)?$/;

  await routeApi(page, createUrl, async (route) => {
    const origin = new URL(page.url() || 'http://localhost:4200').origin;
    const headers = corsHeaders(origin);
    const request = route.request();

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    if (request.method() === 'POST') {
      await route.fulfill({
        status: 201,
        headers,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'fr-1',
          kind: 'bug_report',
          status: 'received',
          title,
          createdAt: new Date().toISOString(),
          message: 'Received',
        }),
      });
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
              id: 'fr-1',
              kind: 'bug_report',
              status: 'received',
              title,
              statusNote: null,
              releaseTag: null,
              changelogUrl: null,
              statusChangedAt: null,
              createdAt: new Date().toISOString(),
              followUp: null,
            },
          ],
          hasChangedSinceLastSeen: true,
        }),
      });
      return;
    }

    await route.continue();
  });
}

async function stubFeedbackReportsSeen(page: Page) {
  const seenUrl = /\/feedback\/reports\/seen\/?(\?.*)?$/;

  await routeApi(page, seenUrl, async (route) => {
    const origin = new URL(page.url() || 'http://localhost:4200').origin;
    const headers = corsHeaders(origin);

    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        headers,
        contentType: 'application/json',
        body: JSON.stringify({
          seenAt: new Date().toISOString(),
        }),
      });
      return;
    }

    await route.continue();
  });
}

async function stubVaultMetaAbsent(page: Page) {
  const vaultMetaUrl = /\/vault\/?(\?.*)?$/;

  await routeApi(page, vaultMetaUrl, async (route) => {
    const origin = new URL(page.url() || 'http://localhost:4200').origin;
    const headers = corsHeaders(origin);
    const request = route.request();

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    if (request.method() === 'GET') {
      await route.fulfill({
        status: 404,
        headers,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
      return;
    }

    await route.continue();
  });
}

const NORMAL_USER: PersonaUser = {
  id: 'u-normal',
  name: 'Jane Doe',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  role: 'user',
  disabled: false,
};

test.describe('Feedback Report sending', () => {
  test('signed-in user sends a Feedback Report and sees it Received on Your reports', async ({
    page,
  }) => {
    test.setTimeout(60000);

    const reportTitle = 'Export button does nothing';
    const reportDescription =
      'Clicking Export on the groceries page does not trigger a download.';

    await seedSession(page, NORMAL_USER);
    await stubAuthRefresh(page, NORMAL_USER);
    await stubFeedbackReportsCreate(page, reportTitle);
    await stubFeedbackReportsSeen(page);
    await stubVaultMetaAbsent(page);
    await routeVaultBlobInventoryOverStore(page, {
      cors: corsHeaders,
      blobs: {},
      etags: {},
      updatedAt: {},
    });

    // Navigate to dashboard and wait for shell + vault to settle
    await gotoStable(page, '/dashboard');
    await waitForDashboardReady(page);
    await waitForVaultMountSettled(page);

    // Open feedback dialog via sidebar button
    await page.getByRole('button', { name: 'Send feedback' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 60000 });

    // Fill form: title and description (kind defaults to bug_report)
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Title' }).fill(reportTitle);
    await dialog
      .getByRole('textbox', { name: 'What happened?' })
      .fill(reportDescription);

    // Submit the form
    await dialog.getByRole('button', { name: 'Send report' }).click();

    // Wait for dialog to close (DialogContent unmounts when open=false)
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 60000 });

    // Navigate to Your reports page
    await gotoStable(page, '/dashboard/account/reports');

    // Assert we landed on Your reports. The v2 shell repeats the title in its
    // breadcrumb, title rows and card, so match the breadcrumb's current page.
    await expect(
      page.getByRole('link', { name: 'Your reports', exact: true }),
    ).toHaveAttribute('aria-current', 'page', {
      timeout: 60000,
    });

    // Assert the submitted report appears in the list
    await expect(page.getByText(reportTitle)).toBeVisible({ timeout: 60000 });

    // Assert the "Received" status badge is visible
    await expect(page.getByText('Received')).toBeVisible({ timeout: 60000 });
  });
});
