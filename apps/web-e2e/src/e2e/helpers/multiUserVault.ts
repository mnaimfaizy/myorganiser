import { expect, Page } from '@playwright/test';
import { routeApi } from './apiStub';
import { submitLoginForm, waitForSignupFormInteractive } from './auth';
import { gotoStable } from './navigation';
import { createOwnedVault, unlockWithPassphrase } from './vaultGate';
import { routeVaultBlobInventory } from './vaultBlobInventoryRoute';
import {
  vaultBlobRouteRelative,
  vaultBlobTypeExtractor,
} from './vaultBlobRoutes';

/**
 * Identity entry for email-to-userId mapping in specs.
 */
export interface IdentityEntry {
  match: string | RegExp; // Substring or regex to match in email
  userId: string;
  userName: string;
}

/**
 * Default identity entries (alice and bob) for multi-user isolation tests.
 */
const DEFAULT_IDENTITIES: IdentityEntry[] = [
  { match: 'alice', userId: 'a-1', userName: 'Alice' },
  { match: 'bob', userId: 'b-2', userName: 'Bob' },
];

/**
 * Map a submitted email to one of the users this spec signs in as.
 *
 * Throws on anything else. An unrecognised email previously fell through to
 * User A, which silently gave both Users the same id and made every isolation
 * assertion in this file compare a User against themselves. Keep it strict.
 */
export function identityForEmail(
  email: string | undefined,
  identities = DEFAULT_IDENTITIES,
): {
  userId: string;
  userName: string;
} {
  for (const identity of identities) {
    const match =
      typeof identity.match === 'string'
        ? email?.includes(identity.match)
        : identity.match.test(email || '');
    if (match) {
      return { userId: identity.userId, userName: identity.userName };
    }
  }

  const identityList = identities
    .map(
      (id) =>
        `${typeof id.match === 'string' ? `"${id.match}"` : `/${id.match}/`} -> userId: ${id.userId}`,
    )
    .join(', ');
  throw new Error(
    `Unrecognised e2e login email: ${JSON.stringify(email)}. ` +
      `Configured identities: [${identityList}].`,
  );
}

function corsHeaders(origin: string) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,if-match',
  } as const;
}

interface ServerState {
  meta: Record<string, unknown | null>;
  metaEtag: Record<string, string>;
  metaUpdatedAt: Record<string, string>;
  blobs: Record<string, Record<string, unknown | null>>;
  blobEtags: Record<string, Record<string, string>>;
  blobUpdatedAt: Record<string, Record<string, string>>;
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

export function setupBackend(
  page: Page,
  identities = DEFAULT_IDENTITIES,
): ServerState {
  const serverState: ServerState = {
    meta: {},
    metaEtag: {},
    metaUpdatedAt: {},
    blobs: {},
    blobEtags: {},
    blobUpdatedAt: {},
  };

  const backupRecords: BackupRecord[] = [];

  const headersFor = (origin: string) => corsHeaders(origin);
  const loginUrl = /\/auth\/login\/?(\?.*)?$/;
  const registerUrl = /\/auth\/register\/?(\?.*)?$/;
  const logoutUrl = /\/auth\/logout\/([a-zA-Z0-9-]+)\/?(\?.*)?$/;
  const vaultMetaUrl = /\/vault\/?(\?.*)?$/;
  const vaultBlobUrl = vaultBlobRouteRelative();
  const vaultBackupsLatestUrl = /\/vault\/backups\/latest\/?(\?.*)?$/;
  const vaultBackupsRecordUrl = /\/vault\/backups\/?(\?.*)?$/;

  routeApi(page, loginUrl, async (route) => {
    const request = route.request();
    const origin = new URL(page.url() || 'http://localhost:3000').origin;
    const headers = headersFor(origin);

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    // The generated client sends UserLoginBody as the request body itself
    // (api.ts: `localVarRequestOptions.data = serializeDataIfNeeded(userLoginBody, ...)`),
    // so the payload is flat — not wrapped in `userLoginBody`.
    const body = (request.postDataJSON?.() ?? {}) as {
      email?: string;
      password?: string;
    };
    const identity = identityForEmail(body.email, identities);

    await route.fulfill({
      status: 200,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({
        token: `e2e-token:${identity.userId}`,
        expires_in: 3600,
        user: {
          id: identity.userId,
          name: identity.userName,
          email: body.email ?? '',
          firstName: identity.userName,
          lastName: 'User',
        },
      }),
    });
  });

  routeApi(page, registerUrl, async (route) => {
    const request = route.request();
    const origin = new URL(page.url() || 'http://localhost:3000').origin;
    const headers = headersFor(origin);

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    const body = (request.postDataJSON?.() ?? {}) as {
      firstName?: string;
      lastName?: string;
      email?: string;
      password?: string;
    };
    const identity = identityForEmail(body.email, identities);

    await route.fulfill({
      status: 201,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({
        message: 'Registration successful. Please verify your email.',
        user: {
          id: identity.userId,
          name: identity.userName,
          email: body.email ?? '',
          firstName: body.firstName,
          lastName: body.lastName,
        },
      }),
    });
  });

  routeApi(page, logoutUrl, async (route) => {
    const request = route.request();
    const origin = new URL(page.url() || 'http://localhost:3000').origin;
    const headers = headersFor(origin);

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    if (request.method() === 'POST') {
      await route.fulfill({ status: 204, headers });
    } else {
      await route.fulfill({ status: 405, headers });
    }
  });

  routeApi(page, vaultMetaUrl, async (route) => {
    const request = route.request();
    const origin = new URL(page.url() || 'http://localhost:3000').origin;
    const headers = headersFor(origin);

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    // `/dashboard/vault` also matches the vault URL patterns, so a page
    // navigation would otherwise be served this stub's JSON instead of the
    // app. Only API calls belong here; let documents reach Next.js.
    if (request.resourceType() === 'document') {
      await route.fallback();
      return;
    }

    const authHeader = request.headers()['authorization'] || '';
    const token = authHeader.replace('Bearer ', '');
    const userId = token.split(':')[1];

    if (!userId) {
      await route.fulfill({
        status: 401,
        headers,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid token format' }),
      });
      return;
    }

    if (request.method() === 'GET') {
      const meta = serverState.meta[userId];
      if (!meta) {
        await route.fulfill({
          status: 404,
          headers,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        headers,
        contentType: 'application/json',
        body: JSON.stringify({
          meta,
          etag: serverState.metaEtag[userId],
          updatedAt: serverState.metaUpdatedAt[userId],
        }),
      });
    } else if (request.method() === 'PUT') {
      const body = (request.postDataJSON?.() ?? {}) as { meta?: unknown };
      serverState.meta[userId] = body.meta ?? null;
      serverState.metaUpdatedAt[userId] = new Date().toISOString();
      serverState.metaEtag[userId] = `W/"${Date.now()}"`;
      await route.fulfill({
        status: 200,
        headers,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          etag: serverState.metaEtag[userId],
          updatedAt: serverState.metaUpdatedAt[userId],
        }),
      });
    } else {
      await route.fulfill({ status: 405, headers });
    }
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

    // `/dashboard/vault` also matches the vault URL patterns, so a page
    // navigation would otherwise be served this stub's JSON instead of the
    // app. Only API calls belong here; let documents reach Next.js.
    if (request.resourceType() === 'document') {
      await route.fallback();
      return;
    }

    const authHeader = request.headers()['authorization'] || '';
    const token = authHeader.replace('Bearer ', '');
    const userId = token.split(':')[1];

    if (!userId) {
      await route.fulfill({
        status: 401,
        headers,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid token format' }),
      });
      return;
    }

    if (!serverState.blobs[userId]) {
      serverState.blobs[userId] = {};
      serverState.blobEtags[userId] = {};
      serverState.blobUpdatedAt[userId] = {};
    }

    if (request.method() === 'GET') {
      const blob = serverState.blobs[userId][type];
      if (!blob) {
        await route.fulfill({
          status: 404,
          headers,
          contentType: 'application/json',
          body: JSON.stringify({}),
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
          etag: serverState.blobEtags[userId][type],
          updatedAt: serverState.blobUpdatedAt[userId][type],
        }),
      });
    } else if (request.method() === 'PUT') {
      const body = (request.postDataJSON?.() ?? {}) as { blob?: unknown };
      serverState.blobs[userId][type] = body.blob ?? null;
      serverState.blobUpdatedAt[userId][type] = new Date().toISOString();
      serverState.blobEtags[userId][type] = `W/"${Date.now()}"`;
      await route.fulfill({
        status: 200,
        headers,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          etag: serverState.blobEtags[userId][type],
          updatedAt: serverState.blobUpdatedAt[userId][type],
        }),
      });
    } else {
      await route.fulfill({ status: 405, headers });
    }
  });

  routeVaultBlobInventory(page, {
    headers: () =>
      headersFor(new URL(page.url() || 'http://localhost:3000').origin),
    state: (request) => {
      const authHeader = request.headers()['authorization'] || '';
      const userId = authHeader.replace('Bearer ', '').split(':')[1];
      if (!userId) return null;

      // A User who has pushed nothing has an empty inventory, not a missing
      // one — the pass reads it and finds nothing to pull.
      return {
        blobs: serverState.blobs[userId] ?? {},
        etags: serverState.blobEtags[userId] ?? {},
        updatedAt: serverState.blobUpdatedAt[userId] ?? {},
      };
    },
  });

  routeApi(page, vaultBackupsLatestUrl, async (route) => {
    const request = route.request();
    const origin = new URL(page.url() || 'http://localhost:3000').origin;
    const headers = headersFor(origin);

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
    } else if (request.method() === 'GET') {
      await route.fulfill({
        status: 404,
        headers,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    } else {
      await route.fulfill({ status: 405, headers });
    }
  });

  routeApi(page, vaultBackupsRecordUrl, async (route) => {
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
      userId: 'user-id-placeholder',
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

  return serverState;
}

export async function signOut(page: Page) {
  // The account menu is the only menu trigger in the page header, so this
  // scopes to it without depending on the signed-in User's name. Radix portals
  // the content, so open, then query.
  const trigger = page.locator('header button[aria-haspopup="menu"]');
  await expect(trigger).toBeVisible({ timeout: 30000 });
  await trigger.click();

  const content = page.getByRole('menuitem', { name: 'Log out' });
  await expect(content).toBeVisible({ timeout: 10000 });
  await content.click();

  await expect(page).toHaveURL(/.*login/, { timeout: 30000 });
}

export async function login(page: Page, email: string, password: string) {
  await gotoStable(page, '/login');
  await expect(page).toHaveURL(/.*login/);

  await submitLoginForm(page, { email, password });
}

export async function signUp(
  page: Page,
  firstName: string,
  lastName: string,
  email: string,
  password: string,
) {
  await gotoStable(page, '/signup');
  await expect(page).toHaveURL(/.*signup/);

  // Wait on the form itself, not on network quiet: `networkidle` is
  // DISCOURAGED by Playwright and hangs here against a production build
  // (ADR 0050, issue #524).
  await expect(page.getByLabel('First name')).toBeVisible({ timeout: 30000 });

  // Visible is not the same as interactive. Every field here is controlled and
  // the terms checkbox gates the submit, so filling before hydration leaves
  // React Hook Form empty and the submit below goes nowhere — the spec then
  // sits on /signup until `toHaveURL` times out (issue #597).
  await waitForSignupFormInteractive(page);

  await page.getByLabel('First name').fill(firstName);
  await page.getByLabel('Last name').fill(lastName);
  await page.getByLabel('Email').fill(email);
  // `exact` is required on both: getByLabel also matches aria-label, and the
  // show/hide eye buttons are labelled "Show password" / "Show confirm password",
  // which contain these strings as substrings.
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);

  // Check terms checkbox
  const termsCheckbox = page.locator('form').getByRole('checkbox').first();
  await termsCheckbox.check();

  // Submit form
  const submitButton = page.getByRole('button', { name: 'Create account' });
  await expect(submitButton).toBeVisible();
  await expect(submitButton).toBeEnabled();
  await submitButton.click();

  // Wait for navigation to email verification page
  await expect(page).toHaveURL(/.*verify.*sent/, { timeout: 60000 });
}

export async function createAndUnlockVault(
  page: Page,
  owner: string,
  passphrase: string,
) {
  await createOwnedVault(page, { passphrase, owner });
  await unlockWithPassphrase(page, passphrase);
}

/**
 * Write one address into the signed-in User's Vault, through the real form.
 *
 * Selectors are the ones `vault.spec.ts` already drives successfully. Every
 * step asserts: a helper that silently skips a field would let an isolation
 * test pass while writing nothing at all, which is worse than failing.
 *
 * `address` is rendered by the list as "<property> <street>", so it is split
 * on the first space to match how the caller asserts on it later.
 */
export async function writeAddressToVault(
  page: Page,
  address: string,
  passphrase: string,
) {
  const [property, ...streetParts] = address.split(' ');
  const street = streetParts.join(' ');

  await gotoStable(page, '/dashboard/addresses');
  await expect(page).toHaveURL(/.*addresses/, { timeout: 30000 });

  // A full navigation drops `masterKeyBytes` from React state, so this route
  // is always locked on arrival. There is nothing to branch on.
  await unlockWithPassphrase(page, passphrase);

  await page.getByRole('button', { name: 'Add address' }).first().click();
  await expect(page.getByLabel('Label')).toBeVisible({ timeout: 60000 });

  await page.getByLabel('Label').fill('Home');
  await page.fill('#addr-property', property);
  await page.fill('#addr-street', street);
  await page.fill('#addr-suburb', 'London');
  await page.fill('#addr-state', 'Greater London');
  await page.fill('#addr-zipcode', 'NW1');
  await page.locator('#addr-country').click();
  await page.getByText('United Kingdom (GB)').click();

  const saveAddress = page.getByRole('button', { name: 'Save address' });
  await expect(saveAddress).toBeEnabled({ timeout: 60000 });
  await saveAddress.click();

  // The dialog is a wizard — Details, Review, Saved — and its final step does
  // not dismiss itself. Confirm the save on that step, then close it.
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Address saved')).toBeVisible({
    timeout: 60000,
  });
  await dialog.getByRole('button', { name: 'Close' }).click();

  // The overlay is `fixed inset-0 z-50` and swallows pointer events, so
  // anything clicked while it lingers — sign-out in particular — times out
  // while reporting itself visible. Asserting the address text before the
  // dialog closes also matches the dialog's own confirmation panel, which is
  // not evidence of a saved row in the list.
  await expect(dialog).toHaveCount(0, { timeout: 60000 });

  // The rendered list entry is the completion signal — encryption and the
  // vault write have both finished by the time it appears.
  await expect(page.getByText(address).first()).toBeVisible({ timeout: 60000 });
}
