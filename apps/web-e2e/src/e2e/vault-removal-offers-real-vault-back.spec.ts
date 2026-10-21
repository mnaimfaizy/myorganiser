import { expect, test } from '@playwright/test';
import {
  createOwnedVault,
  gotoStable,
  routeApi,
  routeVaultBlobInventoryOverStore,
  submitLoginForm,
  unlockWithPassphrase,
  vaultBlobRouteRelative,
  vaultBlobTypeExtractor,
  waitForReload,
} from './helpers';

/**
 * E2E test for vault removal + recovery convergence (Issue #628).
 *
 * Reproduces the fix: after an explicit Local Vault removal, the reconcile
 * runner re-runs (triggered by Local Vault Revision bump per ADR 0066, decision
 * point 2) instead of being suppressed by a session flag. The reconcile
 * discovers the server holds the User's Vault and downloads it instead of
 * offering to create a fresh one.
 *
 * Single context, one in-memory stubbed backend. Creates a vault, syncs a task
 * to the server, removes the vault (which triggers a reload), then navigates
 * to /dashboard/tasks. VaultGate should render the unlock panel for the
 * downloaded real Vault, not the create-vault form for a fresh one. The task
 * should reappear after unlock, proving sync was persisted.
 *
 * The fix is two-part:
 * 1. Commit 1963142: prevent vault create when server holds vault (gate the create
 *    offer while reconcile is downloading).
 * 2. Commit 83f5495: run reconcile on mount and on Local Vault Revision bump
 *    (trigger reconcile by revision, not by suppression flag).
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

test.describe('Vault Removal Offers Real Vault Back (E2E)', () => {
  test('after vault removal and reload, reconcile downloads real vault instead of offering create', async ({
    page,
  }, testInfo) => {
    // Multiple PBKDF2-bound unlocks: allow extra time on WebKit
    test.setTimeout(testInfo.project.name === 'webkit' ? 240000 : 150000);

    // In-memory "server" backing store
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

    const PASSPHRASE = 'VaultRemov12';

    // Step 1: Setup routes for this single page
    await setupRoutes(page);

    // Step 2: Login
    await login(page);

    // Step 3: Create vault and unlock
    await gotoStable(page, '/dashboard/tasks');
    await createOwnedVault(page, { passphrase: PASSPHRASE });
    await unlockWithPassphrase(page, PASSPHRASE);

    // Step 4: Re-navigate to force a Vault Meta Push (ADR 0060) — not the
    // reconcile pass ADR 0066 covers, which is a separate runner with a
    // different trigger (decision point 2).
    await gotoStable(page, '/dashboard/tasks');
    await unlockWithPassphrase(page, PASSPHRASE);

    // Step 5: Confirm server now holds Vault Meta
    await expect
      .poll(() => Boolean(serverMeta), { timeout: 60000 })
      .toBeTruthy();

    // Step 6: Create a task to prove sync persistence
    const uniqueTitle = `RemovalTest ${Date.now()}`;
    const initialTasksEtag = serverBlobEtags.tasks;

    // Open task creation dialog
    await page.getByRole('button', { name: 'Add Task' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30000 });
    await expect(page.getByLabel('Title')).toBeVisible({ timeout: 30000 });

    // Fill and submit task creation (scoped to dialog to avoid collision)
    await page.getByLabel('Title').fill(uniqueTitle);
    const submitButton = page
      .getByRole('dialog')
      .getByRole('button', { name: 'Add Task' });
    await expect(submitButton).toBeVisible();
    await submitButton.click();

    // Wait for task to appear in DOM (local save)
    await expect(
      page.getByRole('checkbox', { name: `Done: ${uniqueTitle}`, exact: true }),
    ).toBeVisible({
      timeout: 30000,
    });

    // Step 7: Poll for task push to server
    await expect
      .poll(() => serverBlobEtags.tasks !== initialTasksEtag, {
        timeout: 15000,
      })
      .toBeTruthy();

    // Step 8: Navigate to vault settings and remove vault
    // Vault settings page (/dashboard/vault) is not wrapped by VaultGate,
    // so we navigate and remove directly.
    await gotoStable(page, '/dashboard/vault');

    // RemoveVaultCard is visible and clickable when vault is owned
    await expect(page.getByTestId('remove-vault-button')).toBeVisible({
      timeout: 30000,
    });

    // Step 9: Click remove button and confirm, wrapping with waitForReload
    // RemoveVaultCard's handleConfirmRemove calls window.location.reload()
    await waitForReload(page, async () => {
      // Click remove button
      await page.getByTestId('remove-vault-button').click();

      // Confirm in RemoveVaultDialog (ConfirmDialog, role="alertdialog").
      // The dialog contains a "Cancel" button and a "Remove from this device"
      // confirm button, which is named exactly that while idle.
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible({ timeout: 30000 });

      // Find and click the confirm button inside the dialog
      const deleteButton = dialog.getByRole('button', {
        name: 'Remove from this device',
        exact: true,
      });
      await expect(deleteButton).toBeVisible({ timeout: 30000 });
      await deleteButton.click();
    });

    // After waitForReload returns, we are on /dashboard/vault with vault removed.
    // Step 10: Navigate to /dashboard/tasks to trigger VaultGate's reconcile path
    // This is required because only VaultGate subscribes to useLocalVaultRevision
    // and displays the reconcile-driven unlock panel. The vault settings page
    // components do not re-run on revision changes.
    await gotoStable(page, '/dashboard/tasks');

    // Step 11: Assert unlock panel appears (not create form)
    // This proves reconcile ran and downloaded the server vault instead of
    // falling back to the create offer.
    // VaultGate's unlock panel shows "Use passphrase" button when owned
    await expect(
      page.getByRole('button', { name: 'Use passphrase' }),
    ).toBeVisible({ timeout: 60000 });

    // Step 12: Assert create form is NOT present
    // The create form's passphrase input has id="setup-passphrase" (vaultGate.tsx:482)
    await expect(page.locator('#setup-passphrase')).toHaveCount(0);

    // Step 13: Unlock with the original passphrase
    // This proves the real vault came back, not a freshly created one
    await unlockWithPassphrase(page, PASSPHRASE);

    // Step 14: Assert task reappears after unlock and (if needed) re-navigation
    // The task should be visible in the list, proving the synced vault was recovered
    await expect(
      page.getByRole('checkbox', { name: `Done: ${uniqueTitle}`, exact: true }),
    ).toBeVisible({
      timeout: 60000,
    });
  });
});
