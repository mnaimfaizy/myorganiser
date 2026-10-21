import { expect, test, type Page } from '@playwright/test';
import { login, routeApi, setupBackend, type IdentityEntry } from './helpers';

/**
 * Installed phone shell at 390x844 (issue #1249).
 *
 * Covers the three shell behaviours a phone user meets on every tab:
 * - the bottom tab bar is present on the tab roots with the right tab current;
 * - Home, Vault, More and the pushed Account screen do not scroll sideways.
 *   The other shell screens (Tasks, Groceries, Subscriptions, Addresses,
 *   Mobile numbers) are not overflow-checked yet: the vault unlock gate
 *   overflows there, and that is tracked by #1257 (Vault slice);
 * - More reaches a pushed screen, and its back link returns to More.
 *
 * Not asserted here, because Playwright cannot emulate them or they are visual:
 * - safe-area insets and viewport-fit=cover (env(safe-area-inset-*));
 * - the compact app bar that appears once the large title scrolls away;
 * - toast offset above the tab bar;
 * - sticky positioning and colours;
 * - the Lock vault button (needs an unlocked vault);
 * - the "Updated" badge on Your reports;
 * - the Admin portal row (platform admin only);
 * - the YouTube row (feature-gated);
 * - standalone display mode.
 *
 * Hermetic: the backend is stubbed by setupBackend (no vault on the server).
 * The reads that the shell makes on mount are stubbed here: the feedback
 * reports list (More), YouTube availability (the Home and More YouTube checks)
 * and YouTube status (read by the Account page). With availability off, Home
 * does not read status, and no further YouTube reads follow.
 */

const EMAIL = 'phone-shell-01@example.com';
const LOGIN_FIXTURE = 'phone-e2e-01';

const IDENTITIES: IdentityEntry[] = [
  {
    match: 'phone-shell-01',
    userId: 'phone-shell-1',
    userName: 'Phone Shell Owner',
  },
];

const PHONE_VIEWPORT = { width: 390, height: 844 };

function corsHeaders(origin: string) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  } as const;
}

/**
 * Answer GET with a fixed JSON body and OPTIONS with a CORS preflight. Any
 * other method is handed to the network. The body shapes are the generated
 * client's response types: ListFeedbackReportsResponse,
 * YouTubeAvailabilityResponse and the `connected` field the Account page and
 * Home read from GET /youtube/status.
 */
async function stubJsonGet(page: Page, url: RegExp, body: unknown) {
  await routeApi(page, url, async (route) => {
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
        body: JSON.stringify(body),
      });
      return;
    }

    await route.continue();
  });
}

/**
 * Sign in and land on the dashboard at phone width. `login()` waits for the
 * tab bar (see waitForDashboardReady) and the mount-time vault work to settle.
 * Navigation after this point is by clicking links only: a `gotoStable` to
 * another dashboard route remounts VaultSessionProvider after login.
 */
async function signInToPhoneDashboard(page: Page) {
  setupBackend(page, IDENTITIES);
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
  await login(page, EMAIL, LOGIN_FIXTURE);
  await expect(page).toHaveURL(/.*dashboard/);
}

function tabBar(page: Page) {
  return page.getByRole('navigation', { name: 'App sections' });
}

async function expectNoHorizontalOverflow(page: Page, route: string) {
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

test.describe('Phone shell (E2E)', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('shows the tab bar with Home current on the dashboard and no desktop sidebar toggle', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await signInToPhoneDashboard(page);

    const bar = tabBar(page);
    await expect(bar).toBeVisible();

    const labels = ['Home', 'Tasks', 'Groceries', 'Vault', 'More'];
    for (const label of labels) {
      await expect(
        bar.getByRole('link', { name: label, exact: true }),
      ).toBeVisible();
    }

    await expect(
      bar.getByRole('link', { name: 'Home', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    for (const label of labels.slice(1)) {
      await expect(
        bar.getByRole('link', { name: label, exact: true }),
      ).not.toHaveAttribute('aria-current');
    }

    await expect(
      page.getByRole('button', { name: /^(Collapse|Expand|Open) sidebar$/ }),
    ).not.toBeVisible();
  });

  test('has no horizontal overflow on Home, Vault, More and the pushed Account screen', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await signInToPhoneDashboard(page);
    await expect(
      page.getByText('Quick Actions', { exact: true }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, 'Home');

    const bar = tabBar(page);

    await bar.getByRole('link', { name: 'Tasks', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/tasks\/?$/);
    await expect(
      bar.getByRole('link', { name: 'Tasks', exact: true }),
    ).toHaveAttribute('aria-current', 'page');

    await bar.getByRole('link', { name: 'Groceries', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/groceries\/?$/);
    await expect(
      bar.getByRole('link', { name: 'Groceries', exact: true }),
    ).toHaveAttribute('aria-current', 'page');

    await bar.getByRole('link', { name: 'Vault', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/vault\/?$/);
    await expect(
      bar.getByRole('link', { name: 'Vault', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    // The Vault page has no heading of its own on the phone; with no Local
    // Vault its always-rendered Export card is the stable content to wait for.
    await expect(
      page.getByText('Export encrypted vault', { exact: true }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, 'Vault');

    await bar.getByRole('link', { name: 'More', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/more\/?$/);
    await expect(
      bar.getByRole('link', { name: 'More', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      page.getByRole('link', { name: 'Account', exact: true }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, 'More');

    await page.getByRole('link', { name: 'Account', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/account\/?$/);
    await expect(
      page.getByRole('link', { name: 'Back to More' }),
    ).toBeVisible();
    await expect(bar).toHaveCount(0);
    await expectNoHorizontalOverflow(page, 'Account');
  });

  test('More opens its sections, pushes Subscriptions, and Back to More returns to the tab root', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await signInToPhoneDashboard(page);

    const bar = tabBar(page);
    await bar.getByRole('link', { name: 'More', exact: true }).click();

    await expect(page).toHaveURL(/\/dashboard\/more\/?$/);
    await expect(
      bar.getByRole('link', { name: 'More', exact: true }),
    ).toHaveAttribute('aria-current', 'page');

    const title = page.getByRole('heading', { level: 1, name: 'More' });
    await expect(title).toBeAttached();
    await expect(title).toHaveText('More');

    for (const label of [
      'Subscriptions',
      'Addresses',
      'Mobile numbers',
      'Account',
      'Your reports',
    ]) {
      await expect(
        page.getByRole('link', { name: label, exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();

    await page
      .getByRole('link', { name: 'Subscriptions', exact: true })
      .click();

    await expect(page).toHaveURL(/\/dashboard\/subscriptions\/?$/);
    await expect(
      page.getByRole('link', { name: 'Back to More' }),
    ).toBeVisible();
    await expect(bar).toHaveCount(0);

    await page.getByRole('link', { name: 'Back to More' }).click();

    await expect(page).toHaveURL(/\/dashboard\/more\/?$/);
    await expect(bar).toBeVisible();
    await expect(
      bar.getByRole('link', { name: 'More', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
  });
});
