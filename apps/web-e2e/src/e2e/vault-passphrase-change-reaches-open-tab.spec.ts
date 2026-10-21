import { expect, test } from '@playwright/test';
import {
  changePassphrase,
  createOwnedVault,
  gotoStable,
  E2E_USER_ID,
  routeApi,
  routeVaultBlobInventoryOverStore,
  submitLoginForm,
  unlockWithPassphrase,
  unlockVaultOnSettingsPage,
  vaultBlobRouteRelative,
  vaultBlobTypeExtractor,
  waitForOwnedVault,
} from './helpers';

/**
 * E2E test for vault passphrase change convergence (Issue #596).
 *
 * Reproduces the fix: a User who keeps a tab open now learns their passphrase
 * was changed on another device via `VaultMetaConvergeRunner` listening to
 * window focus events (ADR 0066, decision point 2).
 *
 * Two browser contexts, same stubbed backend. page1 changes the passphrase via
 * the Vault Settings page. page2 (never reloaded) receives a window focus event
 * and should show the convergence dialog offering to adopt the new passphrase.
 * The fix is that the focus listener (added in commit 8302356) triggers the
 * convergence runner to ask the server again instead of staying silent.
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

test.describe('Vault Passphrase Change Reaches Open Tab (E2E)', () => {
  test('page2 receives passphrase change dialog via window focus when page1 changes passphrase', async ({
    browser,
  }, testInfo) => {
    // Multiple PBKDF2-bound unlocks across two contexts: allow extra time on WebKit
    test.setTimeout(testInfo.project.name === 'webkit' ? 240000 : 150000);

    // In-memory "server" backing store shared across both contexts
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

    const ORIGINAL_PASSPHRASE = 'PasswdOrig1';
    const NEW_PASSPHRASE = 'PasswdNew12';

    // Step 1-2: Context 1 (page1) login and vault setup
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await setupRoutes(page1);

    await login(page1);

    // Step 3: Create vault on page1
    await gotoStable(page1, '/dashboard/tasks');
    await createOwnedVault(page1, { passphrase: ORIGINAL_PASSPHRASE });

    // Step 4: Unlock page1
    await unlockWithPassphrase(page1, ORIGINAL_PASSPHRASE);

    // Step 5: Re-navigate page1 to force a Vault Meta Push
    // A full navigation drops the in-memory Master Key, and re-navigating is
    // what forces this device to push its own Vault Meta to the server
    // (ADR 0060) — not the reconcile pass ADR 0066 covers, which is a
    // separate runner with a different trigger (decision point 2).
    await gotoStable(page1, '/dashboard/tasks');
    await unlockWithPassphrase(page1, ORIGINAL_PASSPHRASE);

    // Step 6: Confirm server now holds Vault Meta
    await expect
      .poll(() => Boolean(serverMeta), { timeout: 60000 })
      .toBeTruthy();

    // Step 7-9: Context 2 (page2) login and baseline
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await setupRoutes(page2);

    await login(page2);
    await gotoStable(page2, '/dashboard/tasks');
    await waitForOwnedVault(page2, E2E_USER_ID);
    await unlockWithPassphrase(page2, ORIGINAL_PASSPHRASE);

    // Step 10: Baseline assertion - no dialog on page2 yet
    await expect(page2.getByRole('dialog')).toHaveCount(0);

    // Step 11-12: page1 navigates to /dashboard/vault (not wrapped by VaultGate,
    // uses VaultUnlockCard, whose heading is "Unlock your vault" and whose
    // controls are different from VaultGate's unlock flow)
    await gotoStable(page1, '/dashboard/vault');

    // Step 13: Unlock page1 via VaultUnlockCard (vault settings page route)
    // This uses different selectors than VaultGate's unlock panel.
    await unlockVaultOnSettingsPage(page1, ORIGINAL_PASSPHRASE);

    // Step 14: Capture etag before passphrase change
    const priorMetaEtag = serverMetaEtag;

    // Step 15: Open the ChangePassphraseCard dialog, then fill and submit it
    // (changePassphrase opens the dialog via change-passphrase-open)
    await changePassphrase(page1, {
      current: ORIGINAL_PASSPHRASE,
      next: NEW_PASSPHRASE,
    });

    // Step 16: Poll for Meta etag change - proves passphrase change pushed to server
    await expect
      .poll(() => serverMetaEtag !== priorMetaEtag, { timeout: 30000 })
      .toBeTruthy();

    // Step 17: Dispatch focus event on page2 to trigger convergence
    // page2 was never reloaded — only a simulated window focus event per hard constraint
    await page2.evaluate(() => window.dispatchEvent(new Event('focus')));

    // Step 18: Assert dialog appears on page2
    // The dialog is rendered by VaultMetaConvergeRunner when it detects passphrase change.
    // We assert the dialog is visible without asserting on copy text (which comes from
    // VAULT_META_CHANGE_COPY table and may move).
    await expect(page2.getByRole('dialog')).toBeVisible({ timeout: 30000 });
    await expect(page2.getByRole('dialog')).toHaveCount(1);

    // Step 19: Dismiss dialog via Escape
    // Dismissal records a session-scoped refusal, not a real answer.
    await page2.keyboard.press('Escape');

    // Verify dialog closed
    await expect(page2.getByRole('dialog')).toHaveCount(0);

    // Step 20: Cleanup
    await ctx1.close();
    await ctx2.close();
  });
});
