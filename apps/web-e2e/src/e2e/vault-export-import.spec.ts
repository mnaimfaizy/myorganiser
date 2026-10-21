import { expect, test, type Page } from '@playwright/test';
import {
  changePassphrase,
  createOwnedVault,
  E2E_USER_ID,
  gotoStable,
  readDownloadText,
  readOwnedVault,
  removeOwnedVault,
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
 * Section 9 — End-to-end tests for hardened vault export/import.
 *
 * Both tests stub the backend so they remain hermetic:
 * - `/auth/login` returns a fake JWT.
 * - `/vault/*` (meta + blob endpoints) are mocked just enough for vault setup.
 * - `/vault/backups` audit endpoints are mocked to validate that the client
 *   posts the expected payload and that `LastBackupCard` reflects the stored
 *   record.
 */

function corsHeaders(origin: string) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,if-match',
  } as const;
}

async function login(page: Page) {
  await page.goto('/login');
  await expect(page).toHaveURL(/.*login/);

  await submitLoginForm(page);
}

interface BackupRecord {
  id: string;
  userId: string;
  event: string;
  source: string;
  status: string;
  errorCode: string | null;
  schemaVersion: number;
  blobTypes: string[];
  sizeBytes: number;
  createdAt: string;
}

function setupBackend(page: Page) {
  // In-memory state shared across the routes for the duration of the page.
  let serverMeta: unknown = null;
  let serverMetaEtag = 'W/"0"';
  let serverMetaUpdatedAt = new Date(0).toISOString();

  const serverBlobs: Record<string, unknown | null> = {
    addresses: null,
    mobileNumbers: null,
    subscriptions: null,
    groceries: null,
  };
  const serverBlobEtags: Record<string, string> = {
    addresses: 'W/"0"',
    mobileNumbers: 'W/"0"',
    subscriptions: 'W/"0"',
    groceries: 'W/"0"',
  };
  const serverBlobUpdatedAt: Record<string, string> = {
    addresses: new Date(0).toISOString(),
    mobileNumbers: new Date(0).toISOString(),
    subscriptions: new Date(0).toISOString(),
    groceries: new Date(0).toISOString(),
  };

  const backupRecords: BackupRecord[] = [];

  // Getter for server Vault Meta, exposed to tests that need to verify
  // that importVault does not write Vault Meta to the server.
  const getServerMeta = () => serverMeta;

  const loginUrl = /\/auth\/login\/?(\?.*)?$/;
  const vaultMetaUrl = /\/vault\/?(\?.*)?$/;
  const vaultBlobUrl = vaultBlobRouteRelative();
  const backupsRecordUrl = /\/vault\/backups\/?(\?.*)?$/;
  const backupsLatestUrl = /\/vault\/backups\/latest\/?(\?.*)?$/;

  const headersFor = (origin: string) => corsHeaders(origin);

  routeApi(page, loginUrl, async (route) => {
    const request = route.request();
    const origin = new URL(page.url() || 'http://localhost:3000').origin;
    const headers = headersFor(origin);

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

  routeApi(page, backupsLatestUrl, async (route) => {
    const request = route.request();
    const origin = new URL(page.url() || 'http://localhost:3000').origin;
    const headers = headersFor(origin);
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    if (request.method() !== 'GET') {
      await route.fulfill({ status: 405, headers });
      return;
    }
    const url = new URL(request.url());
    const wantStatus = url.searchParams.get('status');
    const matching = backupRecords
      .filter((r) =>
        wantStatus ? r.status === wantStatus : r.status === 'success',
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (matching.length === 0) {
      await route.fulfill({
        status: 404,
        headers,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'No backup records' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({ ...matching[0], message: 'OK' }),
    });
  });

  routeApi(page, backupsRecordUrl, async (route) => {
    const request = route.request();
    const origin = new URL(page.url() || 'http://localhost:3000').origin;
    const headers = headersFor(origin);
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    if (request.method() !== 'POST') {
      await route.fulfill({ status: 405, headers });
      return;
    }

    const body = (request.postDataJSON?.() ?? {}) as Partial<BackupRecord>;
    const record: BackupRecord = {
      id: `rec-${backupRecords.length + 1}`,
      userId: '1',
      event: String(body.event ?? 'export'),
      source: String(body.source ?? 'local-file'),
      status: String(body.status ?? 'success'),
      errorCode: (body.errorCode ?? null) as string | null,
      schemaVersion: Number(body.schemaVersion ?? 1),
      blobTypes: Array.isArray(body.blobTypes) ? body.blobTypes : [],
      sizeBytes: Number(body.sizeBytes ?? 0),
      createdAt: new Date().toISOString(),
    };
    backupRecords.push(record);
    await route.fulfill({
      status: 201,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({ ...record, message: 'Created' }),
    });
  });

  routeApi(page, vaultMetaUrl, async (route) => {
    const request = route.request();
    const origin = new URL(page.url() || 'http://localhost:3000').origin;
    const headers = headersFor(origin);

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
      const body = (request.postDataJSON?.() ?? {}) as { meta?: unknown };
      serverMeta = body.meta;
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

  routeApi(page, vaultBlobUrl, async (route) => {
    const request = route.request();
    const origin = new URL(page.url() || 'http://localhost:3000').origin;
    const headers = headersFor(origin);

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
      const body = (request.postDataJSON?.() ?? {}) as { blob?: unknown };
      serverBlobs[type] = body.blob ?? null;
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

  routeVaultBlobInventoryOverStore(page, {
    cors: headersFor,
    blobs: serverBlobs,
    etags: serverBlobEtags,
    updatedAt: serverBlobUpdatedAt,
  });

  return { backupRecords, getServerMeta };
}

async function setupVaultWithSampleData(page: Page) {
  const passphrase = 'correct horse battery staple';

  await gotoStable(page, '/dashboard/addresses');
  await createOwnedVault(page, { passphrase });
  await unlockWithPassphrase(page, passphrase);

  await page.getByRole('button', { name: 'Add address' }).first().click();
  await expect(page.getByLabel('Label')).toBeVisible({ timeout: 60000 });
  await page.getByLabel('Label').fill('Home');
  await page.fill('#addr-property', '221B');
  await page.fill('#addr-street', 'Baker Street');
  await page.fill('#addr-suburb', 'London');
  await page.fill('#addr-state', 'Greater London');
  await page.fill('#addr-zipcode', 'NW1');
  await page.locator('#addr-country').click();
  await page.getByText('United Kingdom (GB)').click();

  const addAddress = page.getByRole('button', { name: 'Save address' });
  await expect(addAddress).toBeEnabled({ timeout: 60000 });
  await addAddress.click();
  await expect(page.getByText('221B Baker Street').first()).toBeVisible({
    timeout: 60000,
  });

  return passphrase;
}

async function setupVaultWithGroceryData(page: Page) {
  const passphrase = 'correct horse battery staple';

  await gotoStable(page, '/dashboard/addresses');
  await createOwnedVault(page, { passphrase });
  await unlockWithPassphrase(page, passphrase);

  // Navigate to groceries page and ensure vault is unlocked
  await gotoStable(page, '/dashboard/groceries');

  // The route is ready once it has settled into one of its two states — the
  // vault gate, or the unlocked Trip Board (issue #524).
  const unlockButton = page.getByRole('button', { name: 'Use passphrase' });
  await expect(
    unlockButton
      .or(page.getByRole('heading', { level: 1, name: 'Groceries' }))
      .first(),
  ).toBeVisible({ timeout: 30000 });

  const isLocked = await unlockButton
    .isVisible({ timeout: 10000 })
    .catch(() => false);

  if (isLocked) {
    await unlockWithPassphrase(page, passphrase);
  }

  await expect(
    page.getByRole('heading', { level: 1, name: 'Groceries' }),
  ).toBeVisible({ timeout: 30000 });

  // The heading renders before the decrypted trips do; the board's primary
  // action is what depends on that list having resolved.
  const newList = page
    .getByRole('button', { name: 'New list', exact: true })
    .first();
  await expect(newList).toBeVisible({ timeout: 30000 });
  await newList.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByPlaceholder('e.g., Weekly Shopping').fill('Backup Test List');
  await page.getByRole('button', { name: 'Create List' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 60000 });
  await expect(
    page.getByRole('article').filter({
      has: page.getByRole('link', { name: 'Backup Test List', exact: true }),
    }),
  ).toBeVisible({
    timeout: 60000,
  });

  return passphrase;
}

/**
 * Outcome of the import replace dialog's credential comparison.
 *
 * - `unchanged`: The bundle's Vault Meta is byte-identical to the local one;
 *   no checkbox, confirm enabled immediately.
 * - `unreadable`: The file could not be parsed as a vault export; checkbox
 *   shown and gates confirm.
 * - `different-vault`: The bundle holds a different Vault Identity; checkbox
 *   shown and gates confirm.
 * - `wrapping-reverts-passphrase`: Same Vault Identity, but the bundle is
 *   wrapped with a passphrase older than the one currently in use (e.g. the
 *   passphrase was changed on this device after the backup was made). The
 *   disclosure must name the passphrase specifically and must never read as
 *   a different-Vault warning (issue #700); checkbox shown and gates confirm.
 */
type ImportDisclosureOutcome =
  | 'unchanged'
  | 'unreadable'
  | 'different-vault'
  | 'wrapping-reverts-passphrase';

/**
 * Wipe + reload is not an empty Local Vault: reconcile restores from the stub,
 * so Import opens the replace dialog when loadVault() is truthy.
 *
 * The dialog derives what the import does to the User's credentials by comparing
 * the bundle's Vault Meta against the current one. The expected outcome determines
 * whether the acknowledge checkbox is shown and what the disclosure copy says.
 */
async function confirmImportReplaceDialog(
  page: Page,
  outcome: ImportDisclosureOutcome,
) {
  const replaceDialog = page.getByTestId('import-vault-replace-dialog');
  await expect(replaceDialog).toBeVisible({ timeout: 60000 });
  await expect(
    replaceDialog.getByRole('heading', {
      name: "Replace this device's vault?",
    }),
  ).toBeVisible();

  switch (outcome) {
    case 'unchanged': {
      // The bundle's meta is byte-identical to the local one. The dialog says
      // nothing about credentials changing (the slice's acceptance criterion),
      // and no checkbox is shown. Confirm is enabled without any tick.
      await expect(
        replaceDialog.getByTestId('import-vault-replace-disclosure'),
      ).toContainText('Nothing about opening your Vault changes');

      const acknowledge = replaceDialog.locator(
        '[data-testid="import-vault-replace-acknowledge"]',
      );
      await expect(acknowledge).toHaveCount(0);

      const confirmReplace = replaceDialog.getByTestId(
        'import-vault-replace-confirm',
      );
      await expect(confirmReplace).toBeEnabled();
      await confirmReplace.click();
      break;
    }

    case 'unreadable': {
      // The file could not be parsed as a vault export. The dialog says so and
      // shows a checkbox; confirm is disabled until ticked.
      await expect(
        replaceDialog.getByTestId('import-vault-replace-disclosure'),
      ).toContainText('This backup could not be read');

      const confirmReplace = replaceDialog.getByTestId(
        'import-vault-replace-confirm',
      );
      await expect(confirmReplace).toBeDisabled();

      const acknowledge = replaceDialog.getByTestId(
        'import-vault-replace-acknowledge',
      );
      await acknowledge.click();
      await expect(acknowledge).toBeChecked({ timeout: 30000 });
      await expect(confirmReplace).toBeEnabled();

      await confirmReplace.click();
      break;
    }

    case 'different-vault': {
      // The bundle holds a different Vault. Its passphrase and Recovery Key
      // replace the ones on this device, and this device will stop holding the
      // Vault the server has (issue #701). Confirm is disabled until the
      // checkbox is ticked; the checkbox gates the operation.
      const disclosure = replaceDialog.getByTestId(
        'import-vault-replace-disclosure',
      );
      await expect(disclosure).toHaveText(
        'This backup is a different Vault. Its passphrase and Recovery Key replace the ones on this device, and this device will stop holding the Vault the server has.',
      );
      // Reject the wrapping-reverts row's key phrase to ensure the two rows
      // cannot converge without explicit assertion drift visible in code.
      await expect(disclosure).not.toContainText('already has');

      const confirmReplace = replaceDialog.getByTestId(
        'import-vault-replace-confirm',
      );
      await expect(confirmReplace).toBeDisabled();

      const acknowledge = replaceDialog.getByTestId(
        'import-vault-replace-acknowledge',
      );
      await expect(
        replaceDialog.getByText(
          "I understand the passphrase and Recovery Key on this device will be replaced by the backup's values.",
          { exact: true },
        ),
      ).toBeVisible();

      await acknowledge.click();
      await expect(acknowledge).toBeChecked({ timeout: 30000 });
      await expect(confirmReplace).toBeEnabled();

      await confirmReplace.click();
      break;
    }

    case 'wrapping-reverts-passphrase': {
      // Same Vault, wrapped with the passphrase in use when the backup was
      // made — older than the one currently on this device. The dialog must
      // name the passphrase specifically, and must never read as a
      // different-Vault warning (issue #700's regression: the two rows must
      // not collapse into one).
      const disclosure = replaceDialog.getByTestId(
        'import-vault-replace-disclosure',
      );
      await expect(disclosure).toHaveText(
        'This backup holds the Vault this device already has, wrapped with the passphrase that was in use when the backup was made. After importing, that passphrase unlocks this device and the one you use now stops working. Your Recovery Key is unaffected.',
      );
      await expect(disclosure).not.toContainText('different Vault');

      const confirmReplace = replaceDialog.getByTestId(
        'import-vault-replace-confirm',
      );
      await expect(confirmReplace).toBeDisabled();

      const acknowledge = replaceDialog.getByTestId(
        'import-vault-replace-acknowledge',
      );
      await expect(
        replaceDialog.getByText(
          "I understand the passphrase on this device will revert to the backup's.",
          { exact: true },
        ),
      ).toBeVisible();

      await acknowledge.click();
      await expect(acknowledge).toBeChecked({ timeout: 30000 });
      await expect(confirmReplace).toBeEnabled();

      await confirmReplace.click();
      break;
    }
  }
}

test.describe('Vault export/import (E2E)', () => {
  test('redirect: /dashboard/vault-export navigates to /dashboard/vault', async ({
    browser,
  }) => {
    test.setTimeout(60000);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    setupBackend(page);

    await login(page);

    // Navigate to the old export URL; should redirect to /dashboard/vault.
    await page.goto('/dashboard/vault-export');
    await expect(page).toHaveURL(/.*\/dashboard\/vault$/);
    // Verify the vault page loaded.
    await expect(page.getByTestId('export-vault-button')).toBeVisible({
      timeout: 60000,
    });

    await ctx.close();
  });

  test('happy path: export → reset → import succeeds via local-file', async ({
    browser,
  }) => {
    test.setTimeout(180000);

    const ctx = await browser.newContext({
      acceptDownloads: true,
    });
    const page = await ctx.newPage();
    setupBackend(page);

    await login(page);

    await setupVaultWithSampleData(page);

    // Trigger export and capture the downloaded JSON.
    await gotoStable(page, '/dashboard/vault');
    const exportButton = page.getByTestId('export-vault-button');
    await expect(exportButton).toBeVisible({ timeout: 60000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportButton.click(),
    ]);
    const exportedText = await readDownloadText(download);
    const parsed = JSON.parse(exportedText) as {
      schemaVersion: number;
      exportId: string;
      exportedAt: string;
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.exportId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    // Reset local vault to simulate a fresh device.
    await removeOwnedVault(page, E2E_USER_ID);

    // Reload vault export page to simulate a fresh route transition.
    await gotoStable(page, '/dashboard/vault');

    // Now perform the import using the captured JSON text.
    const importInput = page.getByTestId('import-vault-file');
    await expect(importInput).toBeVisible({ timeout: 60000 });

    // Convert the downloaded text into a virtual file for setInputFiles.
    await importInput.setInputFiles({
      name: 'vault-export.json',
      mimeType: 'application/json',
      buffer: Buffer.from(exportedText, 'utf8'),
    });

    const importButton = page.getByTestId('import-vault-button');
    await expect(importButton).toBeEnabled({ timeout: 60000 });
    await importButton.click();

    // Reconcile restored a Local Vault from the stub — replace dialog is expected.
    // The bundle is the same vault that was exported, so the dialog finds unchanged.
    await confirmImportReplaceDialog(page, 'unchanged');

    await expect(
      page.getByText('Import complete', { exact: true }),
    ).toBeVisible({ timeout: 60000 });

    // After import, local vault should be restored in browser storage.
    await waitForOwnedVault(page, E2E_USER_ID);

    await ctx.close();
  });

  test('failure path: corrupt file shows error and leaves local vault untouched', async ({
    browser,
  }) => {
    test.setTimeout(120000);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    setupBackend(page);

    await login(page);
    await setupVaultWithSampleData(page);

    const beforeVault = await readOwnedVault(page, E2E_USER_ID);
    expect(beforeVault).toBeTruthy();

    await gotoStable(page, '/dashboard/vault');
    const importInput = page.getByTestId('import-vault-file');
    await expect(importInput).toBeVisible({ timeout: 60000 });
    await importInput.setInputFiles({
      name: 'corrupt.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"this is": "not a vault export"', 'utf8'),
    });

    const importButton = page.getByTestId('import-vault-button');
    await expect(importButton).toBeEnabled({ timeout: 60000 });
    await importButton.click();

    // The file is not a valid vault export, so disclosure outcome is unreadable.
    await confirmImportReplaceDialog(page, 'unreadable');

    const replaceDialog = page.getByTestId('import-vault-replace-dialog');

    // A toast should surface a user-facing error message.
    await expect(page.getByText('Import failed', { exact: true })).toBeVisible({
      timeout: 60000,
    });

    // Dialog stays open with an inline alert; local vault must be unchanged.
    await expect(replaceDialog).toBeVisible();
    await expect(replaceDialog.getByRole('alert')).toBeVisible();

    const afterVault = await readOwnedVault(page, E2E_USER_ID);
    expect(afterVault).toBe(beforeVault);

    await ctx.close();
  });

  test('groceries are included in vault export', async ({ browser }) => {
    test.setTimeout(120000);

    const ctx = await browser.newContext({
      acceptDownloads: true,
    });
    const page = await ctx.newPage();
    setupBackend(page);

    await login(page);

    await setupVaultWithGroceryData(page);

    // Trigger export and capture the downloaded JSON
    await gotoStable(page, '/dashboard/vault');
    const exportButton = page.getByTestId('export-vault-button');
    await expect(exportButton).toBeVisible({ timeout: 60000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportButton.click(),
    ]);
    const exportedText = await readDownloadText(download);
    const parsed = JSON.parse(exportedText) as {
      schemaVersion: number;
      blobs?: Record<string, unknown>;
      exportId: string;
      exportedAt: string;
    };

    // Verify groceries blob is included in export
    expect(parsed.blobs?.groceries).toBeDefined();
    expect(parsed.schemaVersion).toBe(1);

    await ctx.close();
  });

  test('groceries are restored from vault import', async ({ browser }) => {
    test.setTimeout(180000);

    const ctx = await browser.newContext({
      acceptDownloads: true,
    });
    const page = await ctx.newPage();
    setupBackend(page);

    await login(page);

    await setupVaultWithGroceryData(page);

    // Export vault with groceries
    await gotoStable(page, '/dashboard/vault');
    const exportButton = page.getByTestId('export-vault-button');
    await expect(exportButton).toBeVisible({ timeout: 60000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportButton.click(),
    ]);
    const exportedText = await readDownloadText(download);

    // Reset local vault to simulate a fresh device
    await removeOwnedVault(page, E2E_USER_ID);

    // Reload and perform import
    await gotoStable(page, '/dashboard/vault');

    const importInput = page.getByTestId('import-vault-file');
    await expect(importInput).toBeVisible({ timeout: 60000 });

    await importInput.setInputFiles({
      name: 'vault-export.json',
      mimeType: 'application/json',
      buffer: Buffer.from(exportedText, 'utf8'),
    });

    const importButton = page.getByTestId('import-vault-button');
    await expect(importButton).toBeEnabled({ timeout: 60000 });
    await importButton.click();

    // Reconcile restored a Local Vault from the stub — replace dialog is expected.
    // The bundle is the same vault that was exported, so the dialog finds unchanged.
    await confirmImportReplaceDialog(page, 'unchanged');

    // Reconcile has already restored a meta-only Local Vault at this point, so the
    // stored record existing does not prove the import committed. The inline note
    // renders only after importVault resolves; navigating before then can abandon
    // the import (#858).
    await expect(
      page
        .getByRole('main')
        .getByText('Imported locally. Audit recorded on server.', {
          exact: true,
        }),
    ).toBeVisible({ timeout: 60000 });

    await waitForOwnedVault(page, E2E_USER_ID);

    await gotoStable(page, '/dashboard/groceries');
    await unlockWithPassphrase(page, 'correct horse battery staple');

    await expect(
      page.getByRole('article').filter({
        has: page.getByRole('link', { name: 'Backup Test List', exact: true }),
      }),
    ).toBeVisible({
      timeout: 60000,
    });

    await ctx.close();
  });

  test('import over existing vault: replace dialog disclosure and succeeds', async ({
    browser,
  }) => {
    test.setTimeout(180000);

    const ctx = await browser.newContext({
      acceptDownloads: true,
    });
    const page = await ctx.newPage();
    setupBackend(page);

    await login(page);
    await setupVaultWithSampleData(page);

    await gotoStable(page, '/dashboard/vault');
    const exportButton = page.getByTestId('export-vault-button');
    await expect(exportButton).toBeVisible({ timeout: 60000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportButton.click(),
    ]);
    const exportedText = await readDownloadText(download);

    const importInput = page.getByTestId('import-vault-file');
    await expect(importInput).toBeVisible({ timeout: 60000 });
    await importInput.setInputFiles({
      name: 'vault-export.json',
      mimeType: 'application/json',
      buffer: Buffer.from(exportedText, 'utf8'),
    });

    const importButton = page.getByTestId('import-vault-button');
    await expect(importButton).toBeEnabled({ timeout: 60000 });
    await importButton.click();

    const replaceDialog = page.getByTestId('import-vault-replace-dialog');
    await expect(
      replaceDialog.getByTestId('import-vault-replace-cancel'),
    ).toBeVisible();

    // Re-importing the same vault without removing it; meta is byte-identical.
    await confirmImportReplaceDialog(page, 'unchanged');

    await expect(
      page.getByText('Import complete', { exact: true }),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId('import-vault-replace-dialog')).toHaveCount(
      0,
    );
    await expect(
      page.getByText('Import canceled', { exact: true }),
    ).toHaveCount(0);
    await expect(importButton).toBeDisabled();

    await ctx.close();
  });

  test('import older backup after passphrase change: wrapping-reverts disclosure', async ({
    browser,
  }) => {
    test.setTimeout(180000);

    const ctx = await browser.newContext({
      acceptDownloads: true,
    });
    const page = await ctx.newPage();
    setupBackend(page);

    // Step 1: Login and setup vault with initial passphrase (P1)
    await login(page);
    const p1 = await setupVaultWithSampleData(page);

    // Step 2: Navigate to vault page and export
    await gotoStable(page, '/dashboard/vault');
    const exportButton = page.getByTestId('export-vault-button');
    await expect(exportButton).toBeVisible({ timeout: 60000 });

    // Step 3: Capture the exported JSON (wrapped with P1)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportButton.click(),
    ]);
    const oldExportedText = await readDownloadText(download);

    // Step 4: Unlock vault on settings page, then change the passphrase from P1 to P2
    await unlockVaultOnSettingsPage(page, p1);
    const p2 = 'other-pass-1';
    await changePassphrase(page, { current: p1, next: p2 });

    // Step 5: Re-import the OLD exported text (still P1-wrapped)
    const importInput = page.getByTestId('import-vault-file');
    await expect(importInput).toBeVisible({ timeout: 60000 });
    await importInput.setInputFiles({
      name: 'vault-export.json',
      mimeType: 'application/json',
      buffer: Buffer.from(oldExportedText, 'utf8'),
    });

    const importButton = page.getByTestId('import-vault-button');
    await expect(importButton).toBeEnabled({ timeout: 60000 });
    await importButton.click();

    // Step 6: Confirm the import replace dialog with wrapping-reverts-passphrase outcome
    await confirmImportReplaceDialog(page, 'wrapping-reverts-passphrase');

    // Step 7: Assert the import landed. Toast title is scoped to the notifications
    // region; the on-page note stays scoped to main so the two do not collide.
    await expect(
      page
        .getByRole('region', { name: /notifications/i })
        .getByText('Import complete', { exact: true }),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      page
        .getByRole('main')
        .getByText('Imported locally. Audit recorded on server.', {
          exact: true,
        }),
    ).toBeVisible({ timeout: 60000 });
    await expect(importButton).toBeDisabled();

    // Step 8: Verify vault ownership
    await waitForOwnedVault(page, E2E_USER_ID);

    // Step 9: Close context
    await ctx.close();
  });

  test('import different vault: disclosure and credential replacement claim holds', async ({
    browser,
  }) => {
    test.setTimeout(180000);

    // Step 1: Context A — set up a Vault, export it, capture its identity
    const ctxA = await browser.newContext({
      acceptDownloads: true,
    });
    const pageA = await ctxA.newPage();
    setupBackend(pageA);

    await login(pageA);
    await setupVaultWithSampleData(pageA);

    await gotoStable(pageA, '/dashboard/vault');
    const exportButtonA = pageA.getByTestId('export-vault-button');
    await expect(exportButtonA).toBeVisible({ timeout: 60000 });

    const [downloadA] = await Promise.all([
      pageA.waitForEvent('download'),
      exportButtonA.click(),
    ]);
    const exportedTextA = await readDownloadText(downloadA);

    // The salt is the Vault Identity: it is the facet `describeVaultMetaDivergence`
    // reads to classify `different-vault`. Read it from the Escape Copy's meta.
    const envelopeA = JSON.parse(exportedTextA) as {
      meta: { kdf_salt: string };
    };
    const vaultIdentityA = envelopeA.meta.kdf_salt;

    // Also read the local vault to verify the identity matches
    const localVaultTextA = await readOwnedVault(pageA, E2E_USER_ID);
    expect(localVaultTextA).toBeTruthy();
    const localVaultA = JSON.parse(localVaultTextA as string) as {
      vault: { kdf: { salt: string } };
    };
    expect(localVaultA.vault.kdf.salt).toBe(vaultIdentityA);

    // Close context A before opening context B to avoid VaultMetaConvergeRunner
    // focus events triggering different-vault dialogs over the test assertions
    // (issue #691, libs/web/vault-ui/src/lib/metaConvergeRunner.tsx).
    await ctxA.close();

    // Step 2: Context B — fresh backend, different Vault with its own identity
    const ctxB = await browser.newContext({
      acceptDownloads: true,
    });
    const pageB = await ctxB.newPage();
    const backendB = setupBackend(pageB);

    await login(pageB);
    const passphraseB = 'vault-b-phrase';
    await gotoStable(pageB, '/dashboard/addresses');
    await createOwnedVault(pageB, { passphrase: passphraseB });
    await unlockWithPassphrase(pageB, passphraseB);

    // Capture context B's Vault Identity before import
    const localVaultTextB = await readOwnedVault(pageB, E2E_USER_ID);
    expect(localVaultTextB).toBeTruthy();
    const localVaultB = JSON.parse(localVaultTextB as string) as {
      vault: { kdf: { salt: string } };
    };
    const vaultIdentityB = localVaultB.vault.kdf.salt;

    // Precondition sanity: A and B have different Vault Identities
    expect(vaultIdentityA).not.toBe(vaultIdentityB);

    // Step 3: Import context A's backup into context B
    await gotoStable(pageB, '/dashboard/vault');
    const importInput = pageB.getByTestId('import-vault-file');
    await expect(importInput).toBeVisible({ timeout: 60000 });

    await importInput.setInputFiles({
      name: 'vault-export.json',
      mimeType: 'application/json',
      buffer: Buffer.from(exportedTextA, 'utf8'),
    });

    const importButton = pageB.getByTestId('import-vault-button');
    await expect(importButton).toBeEnabled({ timeout: 60000 });
    await importButton.click();

    // Step 4: Confirm the import with different-vault disclosure
    await confirmImportReplaceDialog(pageB, 'different-vault');

    // Step 5: Assert the import succeeded.
    await expect(
      pageB.getByText('Import complete', { exact: true }),
    ).toBeVisible({ timeout: 60000 });
    // lastServerNote is scoped to main — the toast description repeats this text.
    await expect(
      pageB
        .getByRole('main')
        .getByText('Imported locally. Audit recorded on server.', {
          exact: true,
        }),
    ).toBeVisible({ timeout: 60000 });
    await expect(importButton).toBeDisabled();
    await waitForOwnedVault(pageB, E2E_USER_ID);

    // Step 6: Assert the claim the disclosure makes: the Local Vault's Vault
    // Identity now equals A's, while the server still holds B's.
    const localVaultTextBAfter = await readOwnedVault(pageB, E2E_USER_ID);
    expect(localVaultTextBAfter).toBeTruthy();
    const localVaultBAfter = JSON.parse(localVaultTextBAfter as string) as {
      vault: { kdf: { salt: string } };
    };
    expect(localVaultBAfter.vault.kdf.salt).toBe(vaultIdentityA);

    // importVault never writes Vault Meta to the server, so the server still
    // has context B's Vault Identity.
    const serverMeta = backendB.getServerMeta();
    expect(serverMeta).toBeTruthy();
    const serverMetaTyped = serverMeta as { kdf_salt?: string };
    expect(serverMetaTyped.kdf_salt).toBe(vaultIdentityB);

    // Step 7: Close context B (no assertion about the follow-on convergence
    // dialog; that is issue #691's surface, not this one).
    await ctxB.close();
  });
});
