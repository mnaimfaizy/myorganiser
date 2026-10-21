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
 * E2E tests for addresses management (create / add place / delete / detail navigation).
 * Uses the vault mocking patterns from `vault.spec.ts` and an in-memory blob store
 * per-test to ensure isolation.
 *
 * Single continuous test covering:
 * - Step A: Empty list, add an Address via the sheet
 * - Step B: Follow the post-save step to the detail page
 * - Step C: Add a place (Usage Location) through its dialog
 * - Step D: Delete it, refused until confirmed, cancel destroys nothing
 * - Step E: Prove the detail route resolves from a direct navigation
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
 * Setup route handlers and an in-memory store for addresses and other blobs.
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
    const blobType = blobTypeMatch ? blobTypeMatch[1] : 'addresses';

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

/**
 * Assert the delete-place ConfirmDialog (role alertdialog) is open with the
 * expected interpolated title, and return it scoped for further assertions.
 */
async function expectDeleteConfirmDialogVisible(
  page: import('@playwright/test').Page,
  organisationName: string,
) {
  // ConfirmDeleteDialog wraps ConfirmDialog, which is an alertdialog.
  const dialog = page.getByRole('alertdialog');
  await expect(
    dialog.getByText(new RegExp(`Delete "${organisationName}"\\?`)),
  ).toBeVisible({ timeout: 10000 });
  return dialog;
}

test.describe('Addresses (E2E)', () => {
  test.setTimeout(120000);

  test('should create an address, add and delete usage location, and verify detail route navigation', async ({
    page,
  }) => {
    // Setup mock routes for vault
    await setupRoutes(page);

    // Step 0: Login
    await login(page);

    // Step A1: Navigate to addresses page
    await gotoStable(page, '/dashboard/addresses');

    // Step A2: Create the vault and acknowledge the recovery key, which leaves
    // the gate on its unlock panel.
    await createOwnedVault(page, { passphrase: E2E_VAULT_PHRASE });

    // Step A3: Unlock vault with the passphrase
    await unlockWithPassphrase(page, E2E_VAULT_PHRASE);

    // Step A4: Assert list page empty state
    await expect(page.getByText('No addresses yet')).toBeVisible({
      timeout: 30000,
    });
    const addAddressButton = page
      .getByRole('button', { name: 'Add address' })
      .first();
    await expect(addAddressButton).toBeVisible();

    // Step A5: Click "Add address" button to open sheet
    await addAddressButton.click();

    // Assert the Add address sheet is open
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Add address')).toBeVisible({
      timeout: 10000,
    });

    // Step A7: Fill required fields
    await sheet.getByLabel('Label').fill('E2E Home Address');
    await sheet.getByLabel('Street').fill('Baker Street');
    await sheet.getByLabel('Suburb or city').fill('London');
    await sheet.getByLabel('State', { exact: true }).fill('Greater London');
    await sheet.getByLabel('Postcode', { exact: true }).fill('NW1 6XE');

    // Step A8: Submit the form
    const saveButton = sheet.getByRole('button', { name: 'Save address' });
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    // Step A9: Assert success state
    await expect(sheet.getByText('Address saved')).toBeVisible({
      timeout: 10000,
    });
    const setUpUsageLocationsButton = sheet.getByRole('button', {
      name: 'Set up usage locations',
    });
    await expect(setUpUsageLocationsButton).toBeVisible();

    // Step B1: Click "Set up usage locations" to navigate to detail page
    await setUpUsageLocationsButton.click();

    // Step B2: Assert the detail page loaded and has the correct URL
    await expect(page).toHaveURL(/\/dashboard\/addresses\/[^/]+$/);

    // Extract the address ID from the URL for Step E
    const urlMatch = page.url().match(/\/dashboard\/addresses\/([^/]+)$/);
    const addressId = urlMatch ? urlMatch[1] : null;
    expect(addressId).toBeTruthy();

    // Step B3: Assert the places checklist is empty on arrival, no dialog opened
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByText('No places yet', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: 'Places to update',
        exact: true,
      }),
    ).toBeVisible();

    // Step C1: Click "Add place" to open the dialog (the card header and the
    // empty state both carry it while the list is empty, so take the first)
    const addPlaceButton = page
      .getByRole('button', { name: 'Add place', exact: true })
      .first();
    await expect(addPlaceButton).toBeVisible();
    await addPlaceButton.click();

    // Step C2: Assert the Add place dialog opened
    const dialog = page.getByRole('dialog', { name: 'Add place', exact: true });
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Step C3: Fill the Organisation field
    await dialog.getByLabel('Organisation', { exact: true }).fill('ATO');

    // Step C4: Submit the dialog (the submit is "Add place" too, scoped to the dialog)
    const addPlaceSubmitButton = dialog.getByRole('button', {
      name: 'Add place',
      exact: true,
    });
    await expect(addPlaceSubmitButton).toBeEnabled({ timeout: 10000 });
    await addPlaceSubmitButton.click();

    // Step C5: Assert the dialog closed
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Step C6: Assert the checklist now shows the new place, as its ticked row
    const row = page.getByRole('listitem').filter({
      has: page.getByRole('checkbox', {
        name: 'Updated at ATO',
        exact: true,
      }),
    });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText('No places yet', { exact: true }),
    ).not.toBeVisible();

    // Step D1: Open the row's "More for ATO" menu and choose "Delete place…"
    const moreButton = row.getByRole('button', {
      name: 'More for ATO',
      exact: true,
    });
    await moreButton.click();
    await page
      .getByRole('menuitem', { name: 'Delete place…', exact: true })
      .click();

    // Step D2: Assert the confirm dialog opened
    const confirmDialog = await expectDeleteConfirmDialogVisible(page, 'ATO');
    await expect(
      confirmDialog.getByText(
        /This action cannot be undone\. This usage location will be permanently removed from this address\./,
      ),
    ).toBeVisible();

    // Step D3: Cancel the deletion - nothing should be deleted
    const cancelButton = confirmDialog.getByRole('button', {
      name: 'Cancel',
      exact: true,
    });
    await cancelButton.click();

    // Assert the dialog closed and the row is still present
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row).toBeVisible();

    // Step D4: Delete for real - reopen the menu, choose "Delete place…", then confirm
    await moreButton.click();
    await page
      .getByRole('menuitem', { name: 'Delete place…', exact: true })
      .click();

    // Assert confirm dialog opened again (reopened after the cancelled attempt)
    const reopenedConfirmDialog = await expectDeleteConfirmDialogVisible(
      page,
      'ATO',
    );

    // Click the confirm button, which is named "Delete place" (not the menu item)
    const confirmDeleteButton = reopenedConfirmDialog.getByRole('button', {
      name: 'Delete place',
      exact: true,
    });
    await confirmDeleteButton.click();

    // Step D5: Assert the dialog closed and the row is gone
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row).toHaveCount(0);
    await expect(page.getByText('No places yet', { exact: true })).toBeVisible({
      timeout: 10000,
    });

    // Step E1: Direct navigation to the detail page (full page navigation, requires re-unlock)
    await gotoStable(page, `/dashboard/addresses/${addressId}`);

    // Step E2: Re-unlock vault after the full page navigation
    await unlockWithPassphrase(page, E2E_VAULT_PHRASE);

    // Step E3: Assert the page renders the same address (its h1 is the label)
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'E2E Home Address',
        exact: true,
      }),
    ).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: 'Places to update',
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText('No places yet', { exact: true })).toBeVisible({
      timeout: 10000,
    });
  });
});
