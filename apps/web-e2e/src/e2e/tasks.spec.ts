import { expect, test } from '@playwright/test';
import {
  createOwnedVault,
  E2E_VAULT_PHRASE,
  gotoStable,
  routeApi,
  routeVaultBlobInventoryOverStore,
  submitLoginForm,
  unlockWithPassphrase,
  vaultBlobRouteRelative,
  vaultBlobTypeExtractor,
} from './helpers';

/**
 * E2E tests for tasks management (create / persistence across reload / delete)
 * Uses the vault mocking patterns from `vault.spec.ts` and an in-memory blob store
 * per-test to ensure isolation.
 *
 * Focused test: Create a task with default priority, reload the page,
 * verify the task persists in the vault after unlock.
 */

function corsHeaders(origin: string) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,if-match',
  } as const;
}

async function login(page: import('@playwright/test').Page) {
  // Mock the login API endpoint
  const loginUrl = /\/auth\/login\/?(\?.*)?$/;
  await routeApi(page, loginUrl, async (route) => {
    const request = route.request();
    const origin = new URL(page.url() || 'http://localhost:3000').origin;

    // Handle CORS preflight
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: corsHeaders(origin),
      });
      return;
    }

    // Return mock login response
    await route.fulfill({
      status: 200,
      headers: corsHeaders(origin),
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

  await page.goto('/login');
  await expect(page).toHaveURL(/.*login/);
  await expect(page.locator('h1')).toContainText('Login');

  await submitLoginForm(page);
}

/**
 * Setup route handlers and an in-memory store for tasks and other blobs.
 */
async function setupRoutes(page: import('@playwright/test').Page) {
  const loginUrl = /\/auth\/login\/?(\?.*)?$/;
  const vaultMetaUrl = /\/vault\/?(\?.*)?$/;
  const vaultBlobUrl = vaultBlobRouteRelative();

  // Absence is 404, not an empty object. A truthy placeholder makes GET /vault
  // 200, which Vault Absent Evidence reads as server-holds-vault and withholds
  // the create offer on a fresh browser.
  let serverMeta: any | null = null;
  let serverMetaEtag = 'W/"0"';
  let serverMetaUpdatedAt = new Date(0).toISOString();

  const serverBlobs: Record<string, any | null> = {
    addresses: null,
    mobileNumbers: null,
    subscriptions: null,
    tasks: null,
  };
  const serverBlobEtags: Record<string, string> = {
    addresses: 'W/"0"',
    mobileNumbers: 'W/"0"',
    subscriptions: 'W/"0"',
    tasks: 'W/"0"',
  };
  const serverBlobUpdatedAt: Record<string, string> = {
    addresses: new Date(0).toISOString(),
    mobileNumbers: new Date(0).toISOString(),
    subscriptions: new Date(0).toISOString(),
    tasks: new Date(0).toISOString(),
  };

  // Login route
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

  // Vault meta route
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
      const bodyStr = request.postData();
      let body: any = undefined;
      try {
        body = bodyStr ? JSON.parse(bodyStr) : undefined;
      } catch (e) {
        body = undefined;
      }

      serverMeta = body?.meta ?? serverMeta;
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

  // Vault blob route (handles addresses, mobileNumbers, subscriptions, tasks)
  await routeApi(page, vaultBlobUrl, async (route) => {
    const request = route.request();
    const origin = new URL(page.url() || 'http://localhost:3000').origin;
    const headers = corsHeaders(origin);

    // Extract blob type from URL
    const blobTypeMatch = request.url().match(vaultBlobTypeExtractor());
    const blobType = blobTypeMatch ? blobTypeMatch[1] : 'tasks';

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    if (request.method() === 'GET') {
      const blob = serverBlobs[blobType];
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
          type: blobType,
          blob,
          etag: serverBlobEtags[blobType],
          updatedAt: serverBlobUpdatedAt[blobType],
        }),
      });
      return;
    }

    if (request.method() === 'PUT') {
      const bodyStr = request.postData();
      let body: any = undefined;
      try {
        body = bodyStr ? JSON.parse(bodyStr) : undefined;
      } catch (e) {
        body = undefined;
      }

      const nextBlob = body?.blob;
      const created = !serverBlobs[blobType];
      serverBlobs[blobType] = nextBlob;
      serverBlobUpdatedAt[blobType] = new Date().toISOString();
      serverBlobEtags[blobType] = `W/"${Date.now()}"`;

      await route.fulfill({
        status: created ? 201 : 200,
        headers,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          etag: serverBlobEtags[blobType],
          updatedAt: serverBlobUpdatedAt[blobType],
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

test.describe('Tasks (E2E)', () => {
  test.setTimeout(120000);

  test('should create a task, reload page, and verify task persists', async ({
    page,
  }) => {
    const taskTitle = 'Buy groceries for E2E test';
    // The task's row: the element whose direct child is its Done checkbox.
    const rowSelector = `div:has(> [role="checkbox"][aria-label="Done: ${taskTitle}"])`;

    // Setup mock routes for vault
    await setupRoutes(page);

    // Step 1: Login
    await login(page);

    // Step 2: Navigate to tasks page
    await gotoStable(page, '/dashboard/tasks');

    // Step 3: Create the vault and acknowledge the recovery key, which leaves
    // the gate on its unlock panel.
    await createOwnedVault(page, { passphrase: E2E_VAULT_PHRASE });

    // Step 4: Unlock vault with the passphrase
    await unlockWithPassphrase(page, E2E_VAULT_PHRASE);

    // Step 5: Open the add-task dialog. The header and the all-clear card both
    // carry an "Add task" button, so the trigger is the first match; the
    // dialog's own submit button is scoped to the dialog below.
    await page
      .getByRole('button', { name: 'Add task', exact: true })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30000 });
    await expect(page.getByLabel('Title', { exact: true })).toBeVisible({
      timeout: 30000,
    });

    // Step 6: Fill task title
    await page.getByLabel('Title', { exact: true }).fill(taskTitle);

    // Priority is already 'medium' by default (no need to change)

    // Step 7: Submit the form. Scoped to the dialog so the header trigger is
    // not matched.
    const submitButton = page
      .getByRole('dialog')
      .getByRole('button', { name: 'Add task', exact: true });
    await expect(submitButton).toBeVisible();
    await submitButton.click();

    // Step 8: Wait for the task's row to appear in the board.
    await expect(
      page.getByRole('checkbox', { name: `Done: ${taskTitle}`, exact: true }),
    ).toBeVisible({ timeout: 30000 });

    // Step 9: Verify priority 'Med' (medium) is shown on that task's row. The
    // row is the element whose direct child is the task's checkbox.
    await expect(
      page.locator(rowSelector).getByText('Med', { exact: true }),
    ).toBeVisible();

    // Step 10: Reload the page
    await page.reload();

    // Step 11: After reload, vault is locked again - unlock it
    await unlockWithPassphrase(page, E2E_VAULT_PHRASE);

    // Step 12: Wait for the task's row after unlock
    await expect(
      page.getByRole('checkbox', { name: `Done: ${taskTitle}`, exact: true }),
    ).toBeVisible({ timeout: 30000 });

    // Step 13: Priority 'Med' is still on the row after reload
    await expect(
      page.locator(rowSelector).getByText('Med', { exact: true }),
    ).toBeVisible();
  });
});
