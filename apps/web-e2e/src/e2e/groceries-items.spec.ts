import { expect, test } from '@playwright/test';
import {
  E2E_USER_ID,
  gotoStable,
  routeApi,
  routeVaultBlobInventoryOverStore,
  submitLoginForm,
  unlockWithPassphrase,
  vaultBlobRouteRelative,
  vaultBlobTypeExtractor,
  waitForOwnedVault,
} from './helpers';

/**
 * E2E tests for groceries items (create / edit / delete / filter / persistence)
 * Reuses vault unlock and login patterns from groceries.spec.ts
 */

const passphrase = 'correct horse battery staple';

function corsHeaders(origin: string) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,if-match',
  } as const;
}

async function setupVaultRoutes(page: import('@playwright/test').Page) {
  const vaultMetaUrl = /\/vault\/?(\?.*)?$/;
  const vaultBlobUrl = vaultBlobRouteRelative();

  // Absence is 404, not an empty object. A truthy placeholder makes GET /vault
  // 200, which Vault Absent Evidence reads as server-holds-vault and withholds
  // the create offer on a fresh browser.
  let serverMeta: any | null = null;
  let serverMetaEtag = 'W/"0"';
  let serverMetaUpdatedAt = new Date(0).toISOString();

  const serverBlobs: Record<string, any | null> = {};
  const serverBlobEtags: Record<string, string> = {};
  const serverBlobUpdatedAt: Record<string, string> = {};

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
      } catch {
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

  await routeApi(page, vaultBlobUrl, async (route) => {
    const request = route.request();
    const origin = new URL(page.url() || 'http://localhost:3000').origin;
    const headers = corsHeaders(origin);
    const blobTypeMatch = request.url().match(vaultBlobTypeExtractor());
    const blobType = blobTypeMatch ? blobTypeMatch[1] : undefined;

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    if (!blobType) {
      await route.fulfill({ status: 400, headers });
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
          etag: serverBlobEtags[blobType] ?? 'W/"0"',
          updatedAt: serverBlobUpdatedAt[blobType] ?? new Date(0).toISOString(),
        }),
      });
      return;
    }

    if (request.method() === 'PUT') {
      const bodyStr = request.postData();
      let body: any = undefined;
      try {
        body = bodyStr ? JSON.parse(bodyStr) : undefined;
      } catch {
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

async function login(page: import('@playwright/test').Page) {
  const loginUrl = /\/auth\/login\/?(\?.*)?$/;
  await routeApi(page, loginUrl, async (route) => {
    const request = route.request();
    const origin = new URL(page.url() || 'http://localhost:3000').origin;

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders(origin) });
      return;
    }

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

async function gotoGroceriesAndUnlock(
  page: import('@playwright/test').Page,
  passphrase: string,
) {
  await gotoStable(page, '/dashboard/groceries');

  // The page is ready once it has settled into one of its two states: the
  // vault gate, or the unlocked list. `networkidle` was DISCOURAGED and hung
  // here against a production build (ADR 0050, issue #524).
  const unlockButton = page.getByRole('button', { name: 'Use passphrase' });
  await expect(
    unlockButton
      .or(page.getByRole('heading', { level: 1, name: 'Groceries' }))
      .first(),
  ).toBeVisible({ timeout: 30000 });

  const isLocked = await unlockButton
    .isVisible({ timeout: 10000 })
    .catch(() => false);

  if (isLocked) await unlockWithPassphrase(page, passphrase);

  await expect(
    page.getByRole('heading', { level: 1, name: 'Groceries' }),
  ).toBeVisible({ timeout: 30000 });

  // The heading renders before the decrypted trips do; the board's primary
  // action is what depends on that list having resolved.
  await expect(
    page.getByRole('button', { name: 'New list', exact: true }).first(),
  ).toBeVisible({ timeout: 30000 });
}

async function clickNewList(page: import('@playwright/test').Page) {
  await page
    .getByRole('button', { name: 'New list', exact: true })
    .first()
    .click();
}

function tripCard(page: import('@playwright/test').Page, tripName: string) {
  return page.getByRole('article').filter({
    has: page.getByRole('link', { name: tripName, exact: true }),
  });
}

async function createListViaUI(
  page: import('@playwright/test').Page,
  name: string,
) {
  await clickNewList(page);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const input = page.getByPlaceholder('e.g., Weekly Shopping');
  await expect(input).toBeVisible();
  await input.fill(name);

  await expect(page.getByText(/\d+ \/ 100/)).toBeVisible();

  await page.getByRole('button', { name: 'Create List' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 60000 });
  await expect(tripCard(page, name)).toBeVisible({ timeout: 60000 });
}

async function openListByName(
  page: import('@playwright/test').Page,
  listName: string,
  passphraseParam?: string,
) {
  const link = tripCard(page, listName)
    .getByRole('link', { name: listName, exact: true })
    .first();

  // Get the href and navigate to it
  const href = await link.getAttribute('href');
  if (!href) {
    throw new Error(`Could not find link for list "${listName}"`);
  }

  await page.goto(href);

  // The detail route settles into one of two states: the vault gate, or the
  // board itself. Wait for that before probing which one arrived — a fixed
  // `isVisible` probe otherwise races the render, and the `networkidle` that
  // used to sit here was hiding the race rather than removing it (issue #524).
  const passphraseInput = page
    .locator('#unlock-passphrase, [data-testid="unlock-passphrase"]')
    .first();
  const listHeading = page.locator('h1, h2').filter({ hasText: listName });
  await expect(passphraseInput.or(listHeading).first()).toBeVisible({
    timeout: 30000,
  });

  // Check if vault unlock is required on this page
  if (await passphraseInput.isVisible().catch(() => false)) {
    // Vault unlock is required; fill and submit
    if (!passphraseParam) {
      throw new Error(
        `Vault unlock required but passphrase not provided to openListByName`,
      );
    }
    await passphraseInput.fill(passphraseParam);
    const unlockBtn = page
      .getByRole('button', { name: /Unlock|Confirm/ })
      .first();
    await unlockBtn.click();
    // The gate closing is the unlock signal, not network quiet.
    await expect(
      page.locator('#unlock-passphrase, [data-testid="unlock-passphrase"]'),
    ).toHaveCount(0, { timeout: 120000 });
  }

  await expect(listHeading.first()).toBeVisible({ timeout: 30000 });
}

async function addItemViaDialog(
  page: import('@playwright/test').Page,
  name: string,
) {
  await page.getByRole('button', { name: 'Add item', exact: true }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 30000 });

  const nameInput = page.getByRole('combobox', { name: 'Item', exact: true });
  await expect(nameInput).toBeVisible({ timeout: 10000 });
  await nameInput.fill(name);

  const addBtn = dialog.getByRole('button', { name: 'Add to list' });
  await expect(addBtn).toBeEnabled({ timeout: 10000 });
  await addBtn.click();

  await expect(dialog).toHaveCount(0, { timeout: 30000 });
  await expect(
    page.getByRole('checkbox', { name: `Bought ${name}`, exact: true }),
  ).toBeVisible({
    timeout: 30000,
  });
}

async function openRowActionsMenu(
  page: import('@playwright/test').Page,
  itemName: string,
) {
  await page.getByRole('button', { name: `More for ${itemName}` }).click();
}

async function editCatalogItemViaMenu(
  page: import('@playwright/test').Page,
  originalName: string,
  updates: {
    name?: string;
    category?: string;
    price?: string;
    notes?: string;
  },
) {
  await openRowActionsMenu(page, originalName);
  await page.getByRole('menuitem', { name: 'Edit Catalog Item' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 30000 });

  if (updates.name) {
    await page.getByLabel('Catalog Item Name').fill(updates.name);
  }
  if (updates.category) {
    await dialog.getByRole('radio', { name: updates.category }).click();
  }
  if (updates.price) {
    await page.getByLabel('Default Price').fill(updates.price);
  }
  if (updates.notes) {
    await page.getByLabel('Notes').fill(updates.notes);
  }

  await page.getByRole('button', { name: 'Save Catalog Item' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30000 });
}

async function editListLineViaPencil(
  page: import('@playwright/test').Page,
  itemName: string,
  updates: { amount?: string },
) {
  await page
    .getByRole('button', { name: `Edit amount for ${itemName}` })
    .click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 30000 });

  if (updates.amount) {
    await page.getByLabel('Quantity / Amount').fill(updates.amount);
  }

  await page.getByRole('button', { name: 'Save List Line' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30000 });
}

async function removeLineViaMenu(
  page: import('@playwright/test').Page,
  itemName: string,
) {
  await openRowActionsMenu(page, itemName);
  await page.getByRole('menuitem', { name: 'Remove from list' }).click();
  await page.getByRole('menuitem', { name: 'Confirm remove line' }).click();
}

/**
 * Expand the collapsed "Checked · n" section so a checked line is back in the
 * DOM. A line moves there the moment it is checked.
 */
async function expandCheckedSection(page: import('@playwright/test').Page) {
  const toggle = page.getByRole('button', { name: /^Checked · / });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false', {
    timeout: 30000,
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/**
 * The list row for `itemName`. Item names and prices also appear in the catalog
 * chips and the trip summary, so assertions about a line must be scoped here or
 * they match several elements at once (issue #506).
 */
function listLine(page: import('@playwright/test').Page, itemName: string) {
  return page
    .locator('[data-testid^="list-line-"]')
    .filter({ hasText: itemName });
}

async function assertItemRowVisible(
  page: import('@playwright/test').Page,
  itemName: string,
) {
  await expect(
    page.getByRole('checkbox', { name: `Bought ${itemName}`, exact: true }),
  ).toBeVisible({ timeout: 30000 });
}

test.describe('Groceries Items (E2E)', () => {
  test.beforeEach(async ({ page }) => {
    await setupVaultRoutes(page);
    // start from root to ensure clean navigation state
    await page.goto('/');
  });

  test.afterEach(async ({ page }) => {
    // Clear local storage to isolate tests (vault state)
    try {
      await page.evaluate(() => window.localStorage.clear());
    } catch {
      // Teardown only: the page may already be closed, and that must not fail the test.
    }
  });

  test('1 — Add Single Item (full fields) ', async ({ page }) => {
    test.setTimeout(120000);

    await login(page);

    // Create vault and unlock
    await gotoStable(page, '/dashboard/addresses');
    await page.fill('#setup-passphrase', passphrase);
    await page.fill('#setup-confirm', passphrase);
    await page.getByRole('button', { name: 'Create encrypted vault' }).click();
    await waitForOwnedVault(page, E2E_USER_ID);
    await gotoGroceriesAndUnlock(page, passphrase);

    // Create and open list
    await createListViaUI(page, 'Single Item List');
    await openListByName(page, 'Single Item List', passphrase);

    // Add item via dialog
    await addItemViaDialog(page, 'Organic Bananas');

    await editCatalogItemViaMenu(page, 'Organic Bananas', {
      name: 'Organic Bananas - Ripe',
      category: 'Produce',
      price: '3.50',
      notes: 'Choose ripe ones',
    });
    await editListLineViaPencil(page, 'Organic Bananas - Ripe', {
      amount: '1 dozen',
    });

    await assertItemRowVisible(page, 'Organic Bananas - Ripe');
    await expect(listLine(page, 'Organic Bananas - Ripe')).toContainText(
      '$3.50',
      { timeout: 30000 },
    );
  });

  test('2 — Add Multiple Items and persist', async ({ page }) => {
    test.setTimeout(120000);

    await login(page);
    await gotoStable(page, '/dashboard/addresses');
    await page.fill('#setup-passphrase', passphrase);
    await page.fill('#setup-confirm', passphrase);
    await page.getByRole('button', { name: 'Create encrypted vault' }).click();
    await waitForOwnedVault(page, E2E_USER_ID);
    await gotoGroceriesAndUnlock(page, passphrase);

    await createListViaUI(page, 'Multiple Items List');
    await openListByName(page, 'Multiple Items List', passphrase);

    const items = ['Milk', 'Eggs', 'Bread'];
    for (const it of items) await addItemViaDialog(page, it);

    for (const it of items) await assertItemRowVisible(page, it);

    await page.reload();
    await gotoGroceriesAndUnlock(page, passphrase);
    await expect(tripCard(page, 'Multiple Items List')).toBeVisible({
      timeout: 60000,
    });
    await openListByName(page, 'Multiple Items List', passphrase);

    for (const it of items) await assertItemRowVisible(page, it);
  });

  test('4 — Edit Item (name, category, price)', async ({ page }) => {
    test.setTimeout(120000);

    await login(page);
    await gotoStable(page, '/dashboard/addresses');
    await page.fill('#setup-passphrase', passphrase);
    await page.fill('#setup-confirm', passphrase);
    await page.getByRole('button', { name: 'Create encrypted vault' }).click();
    await waitForOwnedVault(page, E2E_USER_ID);
    await gotoGroceriesAndUnlock(page, passphrase);

    await createListViaUI(page, 'Edit Flow List');
    await openListByName(page, 'Edit Flow List', passphrase);

    await addItemViaDialog(page, 'Cherry Tomatoes');
    await editCatalogItemViaMenu(page, 'Cherry Tomatoes', {
      name: 'Cherry Tomatoes - Sweet',
      category: 'Produce',
      price: '2.99',
    });

    await assertItemRowVisible(page, 'Cherry Tomatoes - Sweet');
    await expect(listLine(page, 'Cherry Tomatoes - Sweet')).toContainText(
      '$2.99',
      { timeout: 30000 },
    );
  });

  test('5 — Mark as Done visual change', async ({ page }) => {
    test.setTimeout(120000);

    await login(page);
    await gotoStable(page, '/dashboard/addresses');
    await page.fill('#setup-passphrase', passphrase);
    await page.fill('#setup-confirm', passphrase);
    await page.getByRole('button', { name: 'Create encrypted vault' }).click();
    await waitForOwnedVault(page, E2E_USER_ID);
    await gotoGroceriesAndUnlock(page, passphrase);

    await createListViaUI(page, 'Done State List');
    await openListByName(page, 'Done State List', passphrase);

    await addItemViaDialog(page, 'Cucumber');

    // Find and check the checkbox by aria-label
    const checkbox = page.getByRole('checkbox', {
      name: 'Bought Cucumber',
      exact: true,
    });
    await expect(checkbox).toBeVisible({ timeout: 30000 });
    // Use click + expect instead of check() because the toggle is async and
    // must persist through the vault before `checked` re-renders.
    // Playwright's check() does not retry its state verification (issue #557).
    await checkbox.click();
    // A checked line moves into the collapsed "Checked · n" section.
    await expandCheckedSection(page);
    await expect(checkbox).toBeChecked({ timeout: 30000 });

    // Visual change: name should have line-through class.
    // The line-through is applied to the span containing the item name, and
    // `toHaveClass` retries until React has re-rendered it (issue #524).
    const nameElement = listLine(page, 'Cucumber').getByText('Cucumber', {
      exact: true,
    });
    await expect(nameElement).toHaveClass(/line-through/, { timeout: 30000 });
  });

  test('6 — Delete Item via confirm click', async ({ page }) => {
    test.setTimeout(120000);

    await login(page);
    await gotoStable(page, '/dashboard/addresses');
    await page.fill('#setup-passphrase', passphrase);
    await page.fill('#setup-confirm', passphrase);
    await page.getByRole('button', { name: 'Create encrypted vault' }).click();
    await waitForOwnedVault(page, E2E_USER_ID);
    await gotoGroceriesAndUnlock(page, passphrase);

    await createListViaUI(page, 'Delete Item List');
    await openListByName(page, 'Delete Item List', passphrase);

    await addItemViaDialog(page, 'Chips');
    await removeLineViaMenu(page, 'Chips');

    await expect(
      page.getByRole('checkbox', { name: 'Bought Chips', exact: true }),
    ).toHaveCount(0, {
      timeout: 30000,
    });
  });

  test('7 — Full CRUD Journey', async ({ page }) => {
    test.setTimeout(120000);

    await login(page);
    await gotoStable(page, '/dashboard/addresses');
    await page.fill('#setup-passphrase', passphrase);
    await page.fill('#setup-confirm', passphrase);
    await page.getByRole('button', { name: 'Create encrypted vault' }).click();
    await waitForOwnedVault(page, E2E_USER_ID);
    await gotoGroceriesAndUnlock(page, passphrase);

    await createListViaUI(page, 'Full CRUD List');
    await openListByName(page, 'Full CRUD List', passphrase);

    await addItemViaDialog(page, 'Alpha');

    await editCatalogItemViaMenu(page, 'Alpha', {
      name: 'Alpha v2',
    });
    await assertItemRowVisible(page, 'Alpha v2');

    const chk = page.getByRole('checkbox', {
      name: 'Bought Alpha v2',
      exact: true,
    });
    await expect(chk).toBeVisible({ timeout: 30000 });
    await chk.click();
    await expandCheckedSection(page);
    await expect(chk).toBeChecked({ timeout: 30000 });
    // Unchecking moves the line back to the open list.
    await chk.click();
    await expect(chk).not.toBeChecked({ timeout: 30000 });

    await removeLineViaMenu(page, 'Alpha v2');
    await expect(
      page.getByRole('checkbox', { name: 'Bought Alpha v2', exact: true }),
    ).toHaveCount(0, { timeout: 30000 });
  });

  test('8 — Persistence & Reload', async ({ page }) => {
    test.setTimeout(120000);

    await login(page);
    await gotoStable(page, '/dashboard/addresses');
    await page.fill('#setup-passphrase', passphrase);
    await page.fill('#setup-confirm', passphrase);
    await page.getByRole('button', { name: 'Create encrypted vault' }).click();
    await waitForOwnedVault(page, E2E_USER_ID);
    await gotoGroceriesAndUnlock(page, passphrase);

    await createListViaUI(page, 'Persistence List');
    await openListByName(page, 'Persistence List', passphrase);

    await addItemViaDialog(page, 'Persistent One');
    await addItemViaDialog(page, 'Persistent Two');

    await page.reload();
    await gotoGroceriesAndUnlock(page, passphrase);
    await expect(tripCard(page, 'Persistence List')).toBeVisible({
      timeout: 60000,
    });
    await openListByName(page, 'Persistence List', passphrase);

    await assertItemRowVisible(page, 'Persistent One');
    await assertItemRowVisible(page, 'Persistent Two');
  });

  test('9 — Validation Error Handling blocks submit', async ({ page }) => {
    test.setTimeout(120000);

    await login(page);
    await gotoStable(page, '/dashboard/addresses');
    await page.fill('#setup-passphrase', passphrase);
    await page.fill('#setup-confirm', passphrase);
    await page.getByRole('button', { name: 'Create encrypted vault' }).click();
    await waitForOwnedVault(page, E2E_USER_ID);
    await gotoGroceriesAndUnlock(page, passphrase);

    await createListViaUI(page, 'Validation List');
    await openListByName(page, 'Validation List', passphrase);

    await addItemViaDialog(page, 'To Be Invalid');
    await openRowActionsMenu(page, 'To Be Invalid');
    await page.getByRole('menuitem', { name: 'Edit Catalog Item' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 30000 });

    const nameInput = page.getByLabel('Catalog Item Name');
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill('');
    await nameInput.blur();

    const saveBtn = dialog.getByRole('button', { name: 'Save Catalog Item' });
    await saveBtn.click({ force: true });

    await expect(dialog.getByText('Item name is required')).toBeVisible({
      timeout: 10000,
    });
    await expect(dialog).toBeVisible();
  });
});
