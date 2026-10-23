import { expect, test } from '@playwright/test';
import {
  createOwnedVault,
  gotoStable,
  E2E_USER_ID,
  routeApi,
  routeVaultBlobInventoryOverStore,
  submitLoginForm,
  unlockWithPassphrase,
  vaultBlobRouteRelative,
  vaultBlobTypeExtractor,
  waitForOwnedVault,
  readOwnedVault,
} from './helpers';

/**
 * E2E: multi-device groceries vault sync converges without a pick-a-side prompt
 * when each device creates a different trip (ADR 0113).
 *
 * Test-only passphrase against fully stubbed backend — no real credential applies.
 */

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await expect(page).toHaveURL(/.*login/);
  await expect(page.locator('h1')).toContainText('Login');

  await submitLoginForm(page);
}

function corsHeaders(origin: string) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,if-match',
  } as const;
}

async function assertNoPickASideUI(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('vault-standoff-dialog')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Choose which grocery lists to keep' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: "Keep this device's data" }),
  ).toHaveCount(0);
}

async function createTripViaUI(
  page: import('@playwright/test').Page,
  tripName: string,
) {
  const newList = page
    .getByRole('button', { name: 'New list', exact: true })
    .first();
  await expect(newList).toBeVisible({ timeout: 30000 });
  await newList.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole('heading', { name: 'Create New List' }),
  ).toBeVisible({ timeout: 30000 });

  const input = page.getByPlaceholder('e.g., Weekly Shopping');
  await expect(input).toBeVisible();
  await input.fill(tripName);

  await dialog.getByRole('button', { name: 'Create List' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 60000 });
  await expect(
    page.getByRole('link', { name: tripName, exact: true }),
  ).toBeVisible({ timeout: 60000 });
}

async function waitForBothTripsOnPage(
  page: import('@playwright/test').Page,
  passphrase: string,
  tripA: string,
  tripB: string,
  vaultBytesChanged: boolean,
) {
  const linkA = page.getByRole('link', { name: tripA, exact: true });
  const linkB = page.getByRole('link', { name: tripB, exact: true });

  if (vaultBytesChanged) {
    const aVisible = await linkA.isVisible().catch(() => false);
    const bVisible = await linkB.isVisible().catch(() => false);
    if (!aVisible || !bVisible) {
      await gotoStable(page, '/dashboard/groceries');
      await unlockWithPassphrase(page, passphrase);
    }
  }

  await expect(linkA).toBeVisible({ timeout: 60000 });
  await expect(linkB).toBeVisible({ timeout: 60000 });
}

test.describe('Groceries Vault Sync Convergence (E2E)', () => {
  test('should converge trips created on two devices without a pick-a-side prompt', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(testInfo.project.name === 'webkit' ? 240000 : 150000);

    let serverMeta: any | null = null;
    let serverMetaEtag = 'W/"0"';
    let serverMetaUpdatedAt = new Date(0).toISOString();

    const serverBlobs: Record<string, any | null> = {
      addresses: null,
      groceries: null,
      mobileNumbers: null,
      subscriptions: null,
      tasks: null,
    };
    const serverBlobEtags: Record<string, string> = {
      addresses: 'W/"0"',
      groceries: 'W/"0"',
      mobileNumbers: 'W/"0"',
      subscriptions: 'W/"0"',
      tasks: 'W/"0"',
    };
    const serverBlobUpdatedAt: Record<string, string> = {
      addresses: new Date(0).toISOString(),
      groceries: new Date(0).toISOString(),
      mobileNumbers: new Date(0).toISOString(),
      subscriptions: new Date(0).toISOString(),
      tasks: new Date(0).toISOString(),
    };

    async function setupRoutes(page: import('@playwright/test').Page) {
      const loginUrl = /\/auth\/login\/?(\?.*)?$/;
      const vaultMetaUrl = /\/vault\/?(\?.*)?$/;
      const vaultBlobUrl = vaultBlobRouteRelative();

      await routeApi(page, loginUrl, async (route) => {
        const request = route.request();
        const origin = new URL(page.url() || 'http://localhost:3000').origin;
        const headers = corsHeaders(origin);

        if (request.method() === 'OPTIONS') {
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
            user: {
              id: '1',
              name: 'Test User',
              email: 'testuser@example.com',
              firstName: 'Test',
              lastName: 'User',
            },
          }),
        });
      });

      await routeApi(page, vaultMetaUrl, async (route) => {
        const request = route.request();
        const origin = new URL(page.url() || 'http://localhost:3000').origin;
        const headers = corsHeaders(origin);

        if (request.method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers });
          return;
        }

        if (request.method() === 'GET') {
          if (!serverMeta) {
            await route.fulfill({
              status: 404,
              headers,
              contentType: 'application/json',
              body: JSON.stringify({ message: 'Vault not found' }),
            });
            return;
          }

          await route.fulfill({
            status: 200,
            headers,
            contentType: 'application/json',
            body: JSON.stringify({
              meta: serverMeta,
              etag: serverMetaEtag,
              updatedAt: serverMetaUpdatedAt,
            }),
          });
          return;
        }

        if (request.method() === 'PUT') {
          const ifMatch = request.headers()['if-match'];
          if (ifMatch) {
            if (!serverMeta || ifMatch !== serverMetaEtag) {
              await route.fulfill({
                status: 409,
                headers,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'ETag mismatch' }),
              });
              return;
            }
          }

          const body = request.postDataJSON?.() as any;
          const nextMeta = body?.meta;

          serverMeta = nextMeta;
          serverMetaUpdatedAt = new Date().toISOString();
          serverMetaEtag = `W/"${Date.now()}"`;

          await route.fulfill({
            status: 200,
            headers,
            contentType: 'application/json',
            body: JSON.stringify({
              ok: true,
              etag: serverMetaEtag,
              updatedAt: serverMetaUpdatedAt,
            }),
          });
          return;
        }

        await route.fulfill({ status: 405, headers });
      });

      await routeApi(page, vaultBlobUrl, async (route) => {
        const request = route.request();
        const origin = new URL(page.url() || 'http://localhost:3000').origin;
        const headers = corsHeaders(origin);

        const match = request.url().match(vaultBlobTypeExtractor());
        const type = match?.[1];

        if (!type) {
          await route.fulfill({ status: 400, headers });
          return;
        }

        if (request.method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers });
          return;
        }

        if (request.method() === 'GET') {
          const blob = serverBlobs[type];
          if (!blob) {
            await route.fulfill({
              status: 404,
              headers,
              contentType: 'application/json',
              body: JSON.stringify({ message: 'Vault blob not found' }),
            });
            return;
          }

          await route.fulfill({
            status: 200,
            headers,
            contentType: 'application/json',
            body: JSON.stringify({
              type,
              blob,
              etag: serverBlobEtags[type],
              updatedAt: serverBlobUpdatedAt[type],
            }),
          });
          return;
        }

        if (request.method() === 'PUT') {
          const ifMatch = request.headers()['if-match'];
          if (ifMatch) {
            if (!serverBlobs[type] || ifMatch !== serverBlobEtags[type]) {
              await route.fulfill({
                status: 409,
                headers,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'ETag mismatch' }),
              });
              return;
            }
          }

          const body = request.postDataJSON?.() as any;
          const nextBlob = body?.blob;

          serverBlobs[type] = nextBlob;
          serverBlobUpdatedAt[type] = new Date().toISOString();
          serverBlobEtags[type] = `W/"${Date.now()}"`;

          await route.fulfill({
            status: 200,
            headers,
            contentType: 'application/json',
            body: JSON.stringify({
              ok: true,
              etag: serverBlobEtags[type],
              updatedAt: serverBlobUpdatedAt[type],
            }),
          });
          return;
        }

        await route.fulfill({ status: 405, headers });
      });

      await routeVaultBlobInventoryOverStore(page, {
        cors: corsHeaders,
        blobs: serverBlobs,
        etags: serverBlobEtags,
        updatedAt: serverBlobUpdatedAt,
      });
    }

    const passphrase = 'TestPass1234';

    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await setupRoutes(page1);

    await login(page1);

    await gotoStable(page1, '/dashboard/groceries');
    await createOwnedVault(page1, { passphrase });
    await unlockWithPassphrase(page1, passphrase);

    await expect(
      page1.getByRole('heading', { level: 1, name: 'Groceries' }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page1.getByRole('button', { name: 'New list', exact: true }).first(),
    ).toBeVisible({
      timeout: 30000,
    });

    await assertNoPickASideUI(page1);

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await setupRoutes(page2);

    await login(page2);
    await waitForOwnedVault(page2, E2E_USER_ID);

    await gotoStable(page2, '/dashboard/groceries');
    await unlockWithPassphrase(page2, passphrase);

    await assertNoPickASideUI(page2);

    const tripA = `Trip A ${Date.now()}`;
    const initialGroceriesEtag = serverBlobEtags.groceries;

    await createTripViaUI(page1, tripA);

    await expect
      .poll(() => serverBlobEtags.groceries !== initialGroceriesEtag, {
        timeout: 15000,
      })
      .toBeTruthy();

    await assertNoPickASideUI(page1);

    const etagAfterA = serverBlobEtags.groceries;
    const tripB = `Trip B ${Date.now()}`;
    await createTripViaUI(page2, tripB);

    // Page 2's push drains a second after the save. A focus before that
    // pull reads a server that still has only trip A, and that pass does
    // not run again.
    await expect
      .poll(() => serverBlobEtags.groceries !== etagAfterA, {
        timeout: 15000,
      })
      .toBeTruthy();

    await assertNoPickASideUI(page2);

    // Page 1 already pushed trip A, so this pull takes the server blob and
    // does not PUT it back. The etag therefore stays where page 2 left it.
    const page1BeforePull = await readOwnedVault(page1, E2E_USER_ID);
    await page1.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect
      .poll(() => readOwnedVault(page1, E2E_USER_ID), { timeout: 15000 })
      .not.toBe(page1BeforePull);

    await waitForBothTripsOnPage(page1, passphrase, tripA, tripB, true);
    await waitForBothTripsOnPage(page2, passphrase, tripA, tripB, true);

    await assertNoPickASideUI(page1);
    await assertNoPickASideUI(page2);

    await ctx1.close();
    await ctx2.close();
  });
});
