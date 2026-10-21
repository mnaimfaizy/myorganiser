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
} from './helpers';

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

test.describe('Vault (E2E)', () => {
  test('should create vault, sync to server, then load on a new session', async ({
    browser,
  }, testInfo) => {
    // The heaviest test in the suite: two browser contexts, several PBKDF2
    // derivations (slow by design, and slower still on WebKit), and a full
    test.setTimeout(testInfo.project.name === 'webkit' ? 240000 : 120000);

    // In-memory "server" backing store shared across both sessions.
    let serverMeta: any | null = null;
    let serverMetaEtag = 'W/"0"';
    let serverMetaUpdatedAt = new Date(0).toISOString();

    const serverBlobs: Record<string, any | null> = {
      addresses: null,
      mobileNumbers: null,
      subscriptions: null,
    };
    const serverBlobEtags: Record<string, string> = {
      addresses: 'W/"0"',
      mobileNumbers: 'W/"0"',
      subscriptions: 'W/"0"',
    };
    const serverBlobUpdatedAt: Record<string, string> = {
      addresses: new Date(0).toISOString(),
      mobileNumbers: new Date(0).toISOString(),
      subscriptions: new Date(0).toISOString(),
    };

    async function setupRoutes(page: import('@playwright/test').Page) {
      const loginUrl = /\/auth\/login\/?(\?.*)?$/;
      const vaultMetaUrl = /\/vault\/?(\?.*)?$/;
      // Every VaultBlobType must be stubbed: the download path fetches all of
      // them, and one unmatched type escapes to the real (absent) backend and
      // rejects the whole reconcile. `tasks` was missing (issue #506).
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
          const created = !serverMeta;

          serverMeta = nextMeta;
          serverMetaUpdatedAt = new Date().toISOString();
          serverMetaEtag = `W/"${Date.now()}"`;

          await route.fulfill({
            status: created ? 201 : 200,
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

          const created = !serverBlobs[type];
          serverBlobs[type] = nextBlob;
          serverBlobUpdatedAt[type] = new Date().toISOString();
          serverBlobEtags[type] = `W/"${Date.now()}"`;

          await route.fulfill({
            status: created ? 201 : 200,
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

    // Session 1: create local vault + data
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await setupRoutes(page1);

    await login(page1);

    const passphrase = 'correct horse battery staple';

    await gotoStable(page1, '/dashboard/addresses');
    await createOwnedVault(page1, { passphrase });

    // VaultGate does not auto-unlock after creation.
    await unlockWithPassphrase(page1, passphrase);

    await page1.getByRole('button', { name: 'Add address' }).first().click();
    await expect(page1.getByLabel('Label')).toBeVisible({ timeout: 60000 });

    await page1.getByLabel('Label').fill('Home');
    await page1.fill('#addr-property', '221B');
    await page1.fill('#addr-street', 'Baker Street');
    await page1.fill('#addr-suburb', 'London');
    await page1.fill('#addr-state', 'Greater London');
    await page1.fill('#addr-zipcode', 'NW1');
    await page1.locator('#addr-country').click();
    await page1.getByText('United Kingdom (GB)').click();

    const addAddress = page1.getByRole('button', { name: 'Save address' });
    await expect(addAddress).toBeEnabled({ timeout: 60000 });
    await addAddress.click();
    await expect(page1.getByText('221B Baker Street').first()).toBeVisible({
      timeout: 60000,
    });
    // Saving leaves the sheet open on its success step. The "View address"
    // button this spec used no longer exists; "Set up usage locations" is its
    // successor and pushes the same /dashboard/addresses/{id} route
    // (AddAddressCard.handleSetUpUsageLocations). Issue #506.
    await page1.getByRole('button', { name: 'Set up usage locations' }).click();
    await expect(
      page1.getByRole('heading', {
        level: 2,
        name: 'Places to update',
        exact: true,
      }),
    ).toBeVisible({
      timeout: 60000,
    });
    await expect(page1.getByText('Address not found.')).toHaveCount(0);

    await gotoStable(page1, '/dashboard/mobile-numbers');
    await unlockWithPassphrase(page1, passphrase);

    // The mobile-number form moved into AddMobileNumberDialog and its fields
    // were renamed (#mn-* -> #mobile-*). The page trigger and the dialog's
    // submit share the accessible name, so the submit is scoped. Issue #506.
    await page1
      .getByRole('button', { name: 'Add mobile number' })
      .first()
      .click();
    const mobileDialog = page1.getByRole('dialog');
    await expect(mobileDialog).toBeVisible({ timeout: 60000 });

    await page1.fill('#mobile-label', 'Personal');
    await page1.fill('#mobile-phone-number', '555 123 4567');
    const addMobile = mobileDialog.getByRole('button', {
      name: 'Add mobile number',
    });
    await expect(addMobile).toBeEnabled({ timeout: 60000 });
    await addMobile.click();
    await expect(page1.locator('text=Personal')).toBeVisible({
      timeout: 60000,
    });

    // Force the reconcile runner to re-run now that we have a local vault.
    // Navigating is enough since ADR 0066: the runner passes on every mount,
    // and there is no session flag left to clear first. Issue #645.
    await gotoStable(page1, '/dashboard');

    // The runner should upload to server (our in-memory store should now be populated).
    await expect
      .poll(() => Boolean(serverMeta), { timeout: 60000 })
      .toBeTruthy();
    await expect
      .poll(() => Boolean(serverBlobs.addresses), { timeout: 60000 })
      .toBeTruthy();
    await expect
      .poll(() => Boolean(serverBlobs.mobileNumbers), { timeout: 60000 })
      .toBeTruthy();

    await ctx1.close();

    // Session 2: new device/session should download from server and show data after unlock.
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await setupRoutes(page2);

    await login(page2);

    // Reconcile runner should download the server vault into local storage.
    await waitForOwnedVault(page2, E2E_USER_ID);

    await gotoStable(page2, '/dashboard/addresses');
    await unlockWithPassphrase(page2, passphrase);
    // The list card splits the address over two lines, so match its first line.
    await expect(page2.getByText('221B Baker Street').first()).toBeVisible({
      timeout: 60000,
    });

    await gotoStable(page2, '/dashboard/mobile-numbers');
    await unlockWithPassphrase(page2, passphrase);
    await expect(page2.locator('text=Personal')).toBeVisible({
      timeout: 60000,
    });

    await ctx2.close();
  });
});
