import { expect, test } from '@playwright/test';
import {
  createOwnedVault,
  E2E_USER_ID,
  gotoStable,
  readOwnedVault,
  routeApi,
  routeVaultBlobInventoryOverStore,
  submitLoginForm,
  unlockWithPassphrase,
  vaultBlobRouteRelative,
  vaultBlobTypeExtractor,
} from './helpers';

/**
 * E2E test for vault identity standoff reproduction (issue #656).
 *
 * Two browser contexts represent two devices on the same account. Device 1
 * creates a vault and adds a task. The server state is then reset, and device 2
 * creates a new vault with a different passphrase (hence different Master Key and
 * Vault Identity). When device 1's `VaultPullRunner` detects the divergence on a
 * `window focus` event (no reload, no re-unlock), it must refuse to take the
 * divergent ciphertext, leaving device 1's data intact and readable, and showing
 * a visible "standoff" sync status (proving the fix in commit d6f2199 holds).
 *
 * Test-only passphrases against fully stubbed backend — no real credentials apply.
 */

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await expect(page).toHaveURL(/.*login/);
  await expect(page.locator('h1')).toContainText('Login');

  await submitLoginForm(page);
}

/**
 * Mirrors `syncBookmarkStorageKey` in
 * `libs/web/vault/src/lib/vault/syncBookmarkStorage.ts` — not exported from
 * `@myorganiser/web-vault`'s public entry point, so this keeps the format in
 * step by name instead of a bare literal at the call site.
 */
function syncBookmarkStorageKey(owner: string): string {
  return `myorganiser_sync_bookmarks_v1:${owner}`;
}

function corsHeaders(origin: string) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,if-match',
  } as const;
}

test.describe('Vault Identity Standoff Reproduction (E2E)', () => {
  test('should refuse to converge divergent vault identity and show standoff status', async ({
    browser,
  }, testInfo) => {
    // Spec timeout: 150s on Chromium/Firefox, 240s on WebKit (PBKDF2 slow).
    test.setTimeout(testInfo.project.name === 'webkit' ? 240000 : 150000);

    // In-memory "server" backing store shared across both sessions.
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
      // Every VaultBlobType must be stubbed: the download path fetches all of
      // them, and one unmatched type escapes to the real (absent) backend and
      // rejects the whole reconcile (issue #506).
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

    // Step 1: Session 1 (ctx1) — login and setup routes
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await setupRoutes(page1);

    // Step 2: Login
    await login(page1);

    // Step 3: Create vault with PASSPHRASE_1
    // Throwaway, test-only: every vault endpoint here is stubbed in-process,
    // so this passphrase protects nothing and reaches no real backend.
    const PASSPHRASE_1 = 'TestPass1234';
    await gotoStable(page1, '/dashboard/tasks');
    await createOwnedVault(page1, { passphrase: PASSPHRASE_1 });
    await unlockWithPassphrase(page1, PASSPHRASE_1);

    // Step 4: Add a task on device 1
    const T1 = 'Standoff Task ' + Date.now();
    const initialTasksEtag = serverBlobEtags.tasks;

    await page1.getByRole('button', { name: 'Add Task' }).first().click();
    await expect(page1.getByRole('dialog')).toBeVisible({ timeout: 30000 });
    await expect(page1.getByLabel('Title')).toBeVisible({ timeout: 30000 });

    await page1.getByLabel('Title').fill(T1);

    const submitButton = page1
      .getByRole('dialog')
      .getByRole('button', { name: 'Add Task' });
    await expect(submitButton).toBeVisible();
    await submitButton.click();

    // Wait for task to appear in device 1's DOM (local save)
    await expect(
      page1.getByRole('checkbox', { name: `Done: ${T1}`, exact: true }),
    ).toBeVisible({
      timeout: 30000,
    });

    // Step 5: Poll for push confirmation — tasks blob etag should change
    await expect
      .poll(() => serverBlobEtags.tasks !== initialTasksEtag, {
        timeout: 15000,
      })
      .toBeTruthy();

    // Step 6: Reset server state to simulate re-initialization on device 2
    serverMeta = null;
    serverMetaEtag = 'W/"0"';
    serverMetaUpdatedAt = new Date(0).toISOString();
    for (const type of Object.keys(serverBlobs)) {
      serverBlobs[type] = null;
      serverBlobEtags[type] = 'W/"0"';
      serverBlobUpdatedAt[type] = new Date(0).toISOString();
    }

    // Step 7: Session 2 (ctx2) — new device, same account, empty server
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await setupRoutes(page2);

    await login(page2);

    // Step 8: Create vault with PASSPHRASE_2 (different from PASSPHRASE_1)
    // Throwaway, test-only — same rationale as PASSPHRASE_1 above.
    const PASSPHRASE_2 = 'TestPass5678';
    await gotoStable(page2, '/dashboard/tasks');
    await createOwnedVault(page2, { passphrase: PASSPHRASE_2 });
    await unlockWithPassphrase(page2, PASSPHRASE_2);

    // Step 9: Add a task on device 2
    const T2 = 'Device2 Task ' + Date.now();
    await page2.getByRole('button', { name: 'Add Task' }).first().click();
    await expect(page2.getByRole('dialog')).toBeVisible({ timeout: 30000 });
    await expect(page2.getByLabel('Title')).toBeVisible({ timeout: 30000 });

    await page2.getByLabel('Title').fill(T2);

    const submitButton2 = page2
      .getByRole('dialog')
      .getByRole('button', { name: 'Add Task' });
    await expect(submitButton2).toBeVisible();
    await submitButton2.click();

    await expect(
      page2.getByRole('checkbox', { name: `Done: ${T2}`, exact: true }),
    ).toBeVisible({
      timeout: 30000,
    });

    // Step 10: Poll for push confirmation on device 2
    await expect
      .poll(() => serverBlobEtags.tasks !== 'W/"0"', {
        timeout: 15000,
      })
      .toBeTruthy();

    // Step 11: Close device 2 — it has served its purpose
    await ctx2.close();

    // Step 12: Snapshot device 1's local vault before pull
    const beforeRaw = await readOwnedVault(page1, E2E_USER_ID);

    // Step 12.5: Read baseline identity before divergence
    // Device 1 recorded its own matching identity during vault creation in step 3,
    // so observedVaultIdentity.identity is already truthy before the focus dispatch.
    // The real test is that it CHANGES after the server sync; truthiness alone proves nothing.
    const baselineRaw = await page1.evaluate(
      (key) => localStorage.getItem(key),
      syncBookmarkStorageKey(E2E_USER_ID),
    );
    const baselineParsed = baselineRaw ? JSON.parse(baselineRaw) : null;
    const baselineIdentity = baselineParsed?.observedVaultIdentity?.identity;
    expect(baselineIdentity).toBeTruthy();

    // Step 13: First focus dispatch on device 1
    // This triggers VaultPullRunner and related listeners but the network
    // round-trip hasn't completed yet, so observedVaultIdentity won't be
    // recorded in localStorage yet.
    await page1.evaluate(() => window.dispatchEvent(new Event('focus')));

    // Step 14: Poll until observed identity DIFFERS from baseline
    // The identity change is recorded the moment the server's Vault Meta is read,
    // before the "different vault" dialog is even shown or answered. This proves
    // the spec catches the identity divergence and standoff pre-dismissal (issue #691).
    await expect(async () => {
      const raw = await page1.evaluate(
        (key) => localStorage.getItem(key),
        syncBookmarkStorageKey(E2E_USER_ID),
      );
      const parsed = raw ? JSON.parse(raw) : null;
      const currentIdentity = parsed?.observedVaultIdentity?.identity;
      expect(currentIdentity).not.toBe(baselineIdentity);
    }).toPass({ timeout: 30000 });

    // Step 14.5: Dismiss the "different vault" dialog deterministically
    // Wait for it to be visible, click the button, and wait for it to hide.
    const dialog = page1
      .getByRole('dialog')
      .filter({ hasText: 'This device holds a different vault' });
    await expect(dialog).toBeVisible({ timeout: 30000 });
    await dialog
      .getByRole('button', { name: /Keep this device.s vault/i })
      .click();
    await expect(dialog).not.toBeVisible({ timeout: 30000 });

    // Step 15: Assert local vault was not mutated by the refused pull
    const afterRaw = await readOwnedVault(page1, E2E_USER_ID);
    expect(afterRaw).toBe(beforeRaw);

    // Step 16: Second focus dispatch (required — do not omit)
    // This allows useVaultSyncStatus to recompute and read the now-persisted
    // observedVaultIdentity from localStorage, which will trigger the standoff
    // status to render.
    await page1.evaluate(() => window.dispatchEvent(new Event('focus')));

    // Step 17: Assert sync status trigger (header chip) appears. The desktop
    // header and the phone app bar each mount the widget; only one is visible.
    const syncTrigger = page1
      .getByTestId('sync-status-trigger')
      .filter({ visible: true });
    await expect(syncTrigger).toBeVisible({
      timeout: 30000,
    });

    // Step 18: Click the trigger and assert popover contents
    await syncTrigger.click();
    await expect(page1.getByTestId('sync-status-indicator')).toBeVisible({
      timeout: 30000,
    });
    await expect(page1.getByTestId('sync-status-label')).toBeVisible({
      timeout: 30000,
    });
    await expect(page1.getByTestId('sync-status-detail')).toBeVisible({
      timeout: 30000,
    });
    // Assert retry button is absent (standoff is the only non-synced status with canRetry: false)
    await expect(page1.getByTestId('sync-status-retry-button')).toHaveCount(0);

    // Step 19: Close popover and navigate away and back via sidebar
    // This forces TasksPageClient/useTasksWorkflow to re-decrypt the local
    // (unchanged, un-corrupted) ciphertext under the still-live Master Key,
    // proving the refusal succeeded and data integrity held.
    // Scoped to the sidebar, which is what this step means by "via sidebar":
    // the dashboard home also renders a Tasks link of its own, so an
    // unscoped role query matches two and fails Playwright's strict mode.
    // Exactly one `[data-sidebar="sidebar"]` exists at a time — the mobile
    // sheet and the desktop rail are mutually exclusive.
    const sidebar1 = page1.locator('[data-sidebar="sidebar"]');

    await page1.keyboard.press('Escape');
    await sidebar1.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page1).toHaveURL(/.*dashboard\/?$/, { timeout: 60000 });
    await sidebar1.getByRole('link', { name: 'Tasks', exact: true }).click();
    await expect(page1).toHaveURL(/.*dashboard\/tasks/, { timeout: 60000 });

    // Step 20: Assert original task is readable post-pull and post-navigation
    // This is the proof of "data is still readable" — decrypted fresh from
    // the unchanged local ciphertext under the still-live Master Key.
    await expect(
      page1.getByRole('checkbox', { name: `Done: ${T1}`, exact: true }),
    ).toBeVisible({
      timeout: 60000,
    });

    // Step 21: Assert standoff chip persists after round trip
    await expect(syncTrigger).toBeVisible({
      timeout: 30000,
    });

    // Step 22: Cleanup
    await ctx1.close();
  });
});
