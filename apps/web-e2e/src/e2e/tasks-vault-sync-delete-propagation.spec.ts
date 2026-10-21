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
  vaultBlobInventoryRouteRelative,
  waitForOwnedVault,
  readOwnedVault,
} from './helpers';

/**
 * E2E tests for multi-device vault sync deletion propagation (PRD #544, issue #551).
 * Two browser contexts, shared stubbed backend, test task deletion propagation and
 * resurrection prevention via Deletion Log merge semantics (issue #506).
 *
 * Deletion merging keeps the newer deletedAt; a record loses to a deletion at or
 * after its own changedAt. The merged result is re-sent by both devices, preventing
 * resurrection via stale pushes.
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

test.describe('Tasks Vault Sync Delete Propagation (E2E)', () => {
  test('should propagate task deletion across devices and prevent resurrection', async ({
    browser,
  }, testInfo) => {
    // Spec B timeout: 180s on Chromium/Firefox, 280s on WebKit (PBKDF2 slow).
    test.setTimeout(testInfo.project.name === 'webkit' ? 280000 : 180000);

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

    // Throwaway, test-only: every vault endpoint here is stubbed in-process,
    // so this passphrase protects nothing and reaches no real backend. It is
    // long enough only to clear VaultGate's 10-character minimum. Never
    // replace it with a real credential (AGENTS.md: no secrets in specs).
    const passphrase = 'TestPass1234';

    // ========== SEED PHASE (same as Spec A steps 1-17) ==========
    // Step 1: Session 1 (ctx1) — login
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await setupRoutes(page1);

    await login(page1);

    // Step 2: Create vault
    await gotoStable(page1, '/dashboard/tasks');
    await createOwnedVault(page1, { passphrase });

    // Step 3: Unlock — VaultGate does not auto-unlock after creation
    await unlockWithPassphrase(page1, passphrase);

    // Step 4: Re-navigate to force a reconcile upload. The runner passes on
    // every mount since ADR 0066 — there is no session flag left to clear
    // first (issue #645).
    await gotoStable(page1, '/dashboard/tasks');

    // Re-navigating dropped the in-memory Master Key, so ctx1 is locked
    // again and its VaultGate is showing the unlock form rather than the
    // tasks UI. Unlock before anything below reaches for a task control.
    await unlockWithPassphrase(page1, passphrase);

    // Step 5: Poll for Meta upload
    await expect
      .poll(() => Boolean(serverMeta), { timeout: 60000 })
      .toBeTruthy();

    // Step 6: Assert no whole-Vault conflict prompt in ctx1
    await expect(page1.getByTestId('vault-standoff-dialog')).toHaveCount(0);

    // Step 7: Session 2 (ctx2) — login and download Meta
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await setupRoutes(page2);

    await login(page2);

    // Reconcile runner should download the server vault into local storage.
    await waitForOwnedVault(page2, E2E_USER_ID);

    // Step 8: Unlock ctx2
    await gotoStable(page2, '/dashboard/tasks');
    await unlockWithPassphrase(page2, passphrase);

    // Step 9: Assert no whole-Vault conflict prompt in ctx2
    await expect(page2.getByTestId('vault-standoff-dialog')).toHaveCount(0);

    // Step 10: ctx1 adds a task
    const seedTaskTitle = `Seed Task ${Date.now()}`;
    const initialTasksEtag = serverBlobEtags.tasks;

    // The header and all-clear card both carry "Add task", so the trigger is the first.
    await page1
      .getByRole('button', { name: 'Add task', exact: true })
      .first()
      .click();
    await expect(page1.getByRole('dialog')).toBeVisible({ timeout: 30000 });
    await expect(page1.getByLabel('Title', { exact: true })).toBeVisible({
      timeout: 30000,
    });

    await page1.getByLabel('Title', { exact: true }).fill(seedTaskTitle);

    const submitButton = page1
      .getByRole('dialog')
      .getByRole('button', { name: 'Add task', exact: true });
    await expect(submitButton).toBeVisible();
    await submitButton.click();

    // Wait for task to appear in ctx1's DOM
    await expect(
      page1.getByRole('checkbox', {
        name: `Done: ${seedTaskTitle}`,
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });

    // Step 11: Poll for push
    await expect
      .poll(() => serverBlobEtags.tasks !== initialTasksEtag, {
        timeout: 15000,
      })
      .toBeTruthy();

    // Step 12: Assert no whole-Vault conflict prompt in ctx1 after push
    await expect(page1.getByTestId('vault-standoff-dialog')).toHaveCount(0);

    // Step 13: Snapshot ctx2's local vault before pull
    const beforePull = await readOwnedVault(page2, E2E_USER_ID);

    // Step 14: Fire focus event on ctx2 to trigger pull+converge
    // page.bringToFront() is unreliable in headless for dispatching window focus;
    // use page.evaluate + window.dispatchEvent instead (fidelity trade-off: tests
    // the app's registered listener, not real tab-switch behavior).
    await page2.evaluate(() => window.dispatchEvent(new Event('focus')));

    // Step 15: Poll for local-vault mutation in ctx2 (no DOM change yet)
    await expect
      .poll(() => readOwnedVault(page2, E2E_USER_ID), { timeout: 15000 })
      .not.toBe(beforePull);

    // Step 16: Assert no whole-Vault conflict prompt in ctx2 after pull
    await expect(page2.getByTestId('vault-standoff-dialog')).toHaveCount(0);

    // Step 17: Re-navigate ctx2 to observe the converged task
    await gotoStable(page2, '/dashboard/tasks');
    await unlockWithPassphrase(page2, passphrase);

    // Step 18: Assert task is visible in ctx2 after re-navigation and unlock
    await expect(
      page2.getByRole('checkbox', {
        name: `Done: ${seedTaskTitle}`,
        exact: true,
      }),
    ).toBeVisible({ timeout: 60000 });

    // Both contexts now have the same task. Continue to deletion test.

    // ========== DELETION TEST PHASE ==========

    // Step 1 (deletion): Capture etag before delete
    const etagBeforeDelete = serverBlobEtags.tasks;

    // Step 2 (deletion): ctx1 opens the task from its title, then clicks
    // "Delete…" in the detail panel.
    await page1
      .getByRole('button', { name: seedTaskTitle, exact: true })
      .click();
    await page1
      .getByRole('complementary', { name: 'Task detail' })
      .getByRole('button', { name: 'Delete\u2026', exact: true })
      .click();

    // Step 3 (deletion): The shared confirm is an alertdialog; its action is
    // named for the object, "Delete task", so the button is clicked by that name.
    await expect(
      page1
        .getByRole('alertdialog')
        .filter({ hasText: `Delete "${seedTaskTitle}"?` }),
    ).toBeVisible({ timeout: 30000 });

    const confirmDelete = page1
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete task', exact: true });
    await expect(confirmDelete).toBeVisible();
    await confirmDelete.click();

    // Step 4 (deletion): Assert task is absent in ctx1
    await expect(
      page1.getByRole('checkbox', {
        name: `Done: ${seedTaskTitle}`,
        exact: true,
      }),
    ).toHaveCount(0);

    // Step 5 (deletion): Poll for push — tasks blob etag should change
    await expect
      .poll(() => serverBlobEtags.tasks !== etagBeforeDelete, {
        timeout: 15000,
      })
      .toBeTruthy();

    // Step 6 (deletion): Assert no whole-Vault conflict prompt in ctx1
    await expect(page1.getByTestId('vault-standoff-dialog')).toHaveCount(0);

    // Step 7 (deletion): Snapshot ctx2's local vault before pull
    const beforePullCtx2 = await readOwnedVault(page2, E2E_USER_ID);

    // Step 8 (deletion): Fire focus on ctx2 to trigger pull+converge
    await page2.evaluate(() => window.dispatchEvent(new Event('focus')));

    // Step 9 (deletion): Poll for local-vault mutation in ctx2
    // ctx2's own converge pass re-pushes a record set that already excludes
    // the deleted task (mergeVaultRecords keeps newer deletedAt).
    await expect
      .poll(() => readOwnedVault(page2, E2E_USER_ID), { timeout: 15000 })
      .not.toBe(beforePullCtx2);

    // Step 10 (deletion): Assert no whole-Vault conflict prompt in ctx2
    await expect(page2.getByTestId('vault-standoff-dialog')).toHaveCount(0);

    // Step 11 (deletion): Re-navigate ctx2 to observe deletion
    await gotoStable(page2, '/dashboard/tasks');
    await unlockWithPassphrase(page2, passphrase);

    // Step 12 (deletion): Assert task stays deleted in ctx2 (primary proof)
    await expect(
      page2.getByRole('checkbox', {
        name: `Done: ${seedTaskTitle}`,
        exact: true,
      }),
    ).toHaveCount(0);

    // Step 13 (deletion): Count ctx1's Vault Blob Inventory reads from here on.
    //
    // Under ADR 0087, a Vault Pull Pass reads the Vault Blob Inventory first
    // (`GET /vault/blobs`), and only reads a per-type blob when the inventory
    // etag differs from the device's Sync Bookmark. Since ctx1's last tasks
    // push set its Sync Bookmark to the current tasks etag, and ctx2 re-pushed
    // an already-deleted task, the tasks etag does not change, so ctx1 does not
    // read `/vault/blob/tasks` — only the inventory.
    //
    // ctx1's own pull is what makes step 17 a real resurrection proof rather
    // than an assertion that cannot fail. ctx2 re-pushed a merged record set
    // after converging the deletion; if that merge had resurrected the task,
    // ctx1 only learns it by pulling that set back down. Re-navigating before
    // the pull lands would re-read ctx1's own Local Vault, which trivially
    // still holds the deletion — green, and proving nothing.
    //
    // The vault contents are the wrong thing to wait on here: the merge is
    // idempotent, so a correct pull legitimately leaves the Local Vault
    // byte-identical and a `.not.toBe(before)` poll would flake. The round
    // trip itself is the observable event, so wait on the inventory GET instead.
    let ctx1InventoryReads = 0;
    page1.on('response', (response) => {
      if (
        (response.status() === 200 || response.status() === 304) &&
        vaultBlobInventoryRouteRelative().test(response.url())
      ) {
        ctx1InventoryReads += 1;
      }
    });

    // Step 14 (deletion): Fire focus on ctx1 to trigger its pull.
    await page1.evaluate(() => window.dispatchEvent(new Event('focus')));

    // Step 15 (deletion): Wait for that pull to actually reach the server,
    // covering the 500ms VAULT_PULL_DEBOUNCE_MS without a fixed sleep.
    await expect
      .poll(() => ctx1InventoryReads, { timeout: 15000 })
      .toBeGreaterThan(0);

    // Step 16 (deletion): Re-navigate ctx1 to finalize
    await gotoStable(page1, '/dashboard/tasks');
    await unlockWithPassphrase(page1, passphrase);

    // Step 17 (deletion): Resurrection proof — task absent in ctx1 after
    // the full round trip (if union-by-id merge had resurrected the record,
    // it reappears here).
    await expect(
      page1.getByRole('checkbox', {
        name: `Done: ${seedTaskTitle}`,
        exact: true,
      }),
    ).toHaveCount(0);

    // Step 18 (deletion): Final assertion — no whole-Vault prompt anywhere
    await expect(page1.getByTestId('vault-standoff-dialog')).toHaveCount(0);
    await expect(page2.getByTestId('vault-standoff-dialog')).toHaveCount(0);

    await ctx1.close();
    await ctx2.close();
  });
});
