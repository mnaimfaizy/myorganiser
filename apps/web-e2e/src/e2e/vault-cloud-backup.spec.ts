import { expect, test, type Page } from '@playwright/test';
import {
  createOwnedVault,
  E2E_USER_ID,
  gotoStable,
  removeOwnedVault,
  routeApi,
  routeVaultBlobInventoryOverStore,
  submitLoginForm,
  unlockWithPassphrase,
  vaultBlobInventoryRouteAbsolute,
  vaultBlobRouteAbsolute,
  vaultBlobTypeExtractor,
  waitForOwnedVault,
  waitForReload,
} from './helpers';

/**
 * Section 4 — End-to-end tests for cloud-vault backup via Google Drive.
 *
 * The tests stub:
 * - Backend `/auth/login`, `/vault/*`, and `/vault/backups[/latest]` routes.
 * - The Google Identity Services script load (`accounts.google.com/gsi/client`).
 * - The Google Drive REST endpoints used by `GoogleDriveCloudBackupProvider`.
 *
 * A full GIS namespace is injected into the browser via `addInitScript` so the
 * page-level `useGoogleIdentityScript` hook resolves immediately and the
 * provider can acquire access tokens through the test-controlled mock.
 *
 * The vault settings page reads the Google Client ID from
 * `window.__MYORG_GOOGLE_CLIENT_ID__` as a runtime fallback, which makes it
 * trivial to enable the cloud-backup section in tests without changing the
 * dev-server environment.
 */

const TEST_CLIENT_ID = 'e2e-google-client-id';

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

/**
 * Wires up backend mocks and returns a handle to the in-memory state. The
 * `backupRecords` array is mutated directly by the route handlers.
 */
function setupBackend(page: Page) {
  let serverMeta: unknown = null;
  let serverMetaEtag = 'W/"0"';
  let serverMetaUpdatedAt = new Date(0).toISOString();
  const serverBlobs: Record<string, unknown | null> = {
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
  const backupRecords: BackupRecord[] = [];

  const loginUrl = /\/auth\/login\/?(\?.*)?$/;
  // The vault ROUTE is `/dashboard/vault` and would otherwise match
  // `/\/vault\/?$/`. Anchor these regexes to the API host (anything other
  // than the dev server on port 4200) to avoid intercepting the page
  // navigation itself.
  const vaultMetaUrl = /:\/\/[^/]+\/(?:api\/v\d+\/)?vault\/?(\?.*)?$/;
  const vaultBlobUrl = vaultBlobRouteAbsolute();
  const backupsRecordUrl =
    /:\/\/[^/]+\/(?:api\/v\d+\/)?vault\/backups\/?(\?.*)?$/;
  const backupsLatestUrl =
    /:\/\/[^/]+\/(?:api\/v\d+\/)?vault\/backups\/latest\/?(\?.*)?$/;

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
    const wantSource = url.searchParams.get('source');
    const wantEvent = url.searchParams.get('event');
    const matching = backupRecords
      .filter((r) =>
        wantStatus ? r.status === wantStatus : r.status === 'success',
      )
      .filter((r) => (wantSource ? r.source === wantSource : true))
      .filter((r) => (wantEvent ? r.event === wantEvent : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (matching.length === 0) {
      await route.fulfill({
        status: 200,
        headers,
        contentType: 'application/json',
        body: '',
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
    url: vaultBlobInventoryRouteAbsolute(),
    cors: headersFor,
    blobs: serverBlobs,
    etags: serverBlobEtags,
    updatedAt: serverBlobUpdatedAt,
  });

  return { backupRecords };
}

/**
 * Inject a deterministic Google Identity Services namespace and a fake
 * `appDataFolder` REST surface into the browser BEFORE any page script runs.
 *
 * `tokenFailures` controls the first N silent token attempts. Each entry is
 * either a string error code (e.g. `'consent_required'`) which causes the
 * token client to invoke its callback with `{error}`, or `'ok'` which yields
 * a fresh access token. Interactive (`prompt=consent`) requests always
 * succeed.
 *
 * `tokenTtlSec` (default 1) controls the TTL of issued tokens. For most tests,
 * 1s makes the provider re-request tokens; flow (b) passes 300 to keep a token
 * usable, so we can assert the scheduler did not request a new one.
 */
async function installGoogleMocks(
  page: Page,
  options?: {
    tokenFailures?: ReadonlyArray<'ok' | string>;
    tokenTtlSec?: number;
  },
) {
  // Mock the GIS script load — the loader script itself is irrelevant because
  // we pre-populate `window.google.accounts.oauth2`. We just need the request
  // to resolve so the script tag's `load` event fires.
  // Intercepts the Google Identity Services *script*, not an API, so it must
  // not fall through to the network.
  // eslint-disable-next-line no-restricted-syntax -- GIS script stub, not an API stub
  await page.route(/accounts\.google\.com\/gsi\/client/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: '/* gis stub */',
    });
  });

  // Intercept Drive REST endpoints. State lives in the browser context
  // (via init script) — Playwright cannot share state with `page.route`,
  // so we keep the appDataFolder state inside the browser instead and use
  // route handlers to dispatch into a small worker below. To keep things
  // self-contained, we route into the same in-page handler via window.
  // Third-party Google Drive REST host, not this app's API — no app route can
  // collide with it.
  // eslint-disable-next-line no-restricted-syntax -- third-party Google host, not an API stub
  await page.route(
    /^https:\/\/(www\.)?googleapis\.com\/(upload\/)?drive\/v3\/.*/,
    async (route) => {
      const request = route.request();
      const url = request.url();
      const method = request.method();
      const postData = request.postData() ?? null;
      // Marshal the request into the page so the in-browser drive mock
      // (installed via addInitScript) handles it with full state.
      const result = await page.evaluate(
        async ({ url, method, postData }) => {
          const w = window as unknown as {
            __driveMock: (input: {
              url: string;
              method: string;
              postData: string | null;
            }) => Promise<{
              status: number;
              body: string;
              contentType: string;
            }>;
          };
          return await w.__driveMock({ url, method, postData });
        },
        { url, method, postData },
      );
      await route.fulfill({
        status: result.status,
        contentType: result.contentType,
        body: result.body,
      });
    },
  );

  await page.addInitScript(
    ({ clientId, tokenFailures, tokenTtlSec }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__MYORG_GOOGLE_CLIENT_ID__ = clientId;
      // Counter for auth requests � used to assert scheduler did not request a new auth.
      w.__authRequestCount = 0;

      // ---- Drive appDataFolder state ----
      type FakeFile = {
        id: string;
        name: string;
        createdTime: string;
        size: number;
        appProperties: Record<string, string>;
        text: string;
      };
      const files = new Map<string, FakeFile>();
      let nextId = 1;

      function json(obj: unknown, status = 200) {
        return {
          status,
          contentType: 'application/json',
          body: JSON.stringify(obj),
        };
      }

      function metadata(file: FakeFile) {
        return {
          id: file.id,
          name: file.name,
          createdTime: file.createdTime,
          modifiedTime: file.createdTime,
          size: String(file.size),
          appProperties: { ...file.appProperties },
        };
      }

      w.__driveMock = async ({
        url,
        method,
        postData,
      }: {
        url: string;
        method: string;
        postData: string | null;
      }) => {
        const u = new URL(url);
        const path = u.pathname;
        // POST /drive/v3/files — create metadata
        if (method === 'POST' && /\/drive\/v3\/files\/?$/.test(path)) {
          const body = postData
            ? (JSON.parse(postData) as Partial<FakeFile> & {
                appProperties?: Record<string, string>;
              })
            : {};
          const id = `file-${nextId++}`;
          const file: FakeFile = {
            id,
            name: String(body.name ?? id),
            createdTime: new Date().toISOString(),
            size: 0,
            appProperties: { ...(body.appProperties ?? {}) },
            text: '',
          };
          files.set(id, file);
          return json({ id });
        }
        // PATCH /upload/drive/v3/files/{id}?uploadType=media — upload body
        const uploadMatch = path.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/);
        if (method === 'PATCH' && uploadMatch) {
          const id = decodeURIComponent(uploadMatch[1]);
          const file = files.get(id);
          if (!file) return json({ error: 'not found' }, 404);
          file.text = postData ?? '';
          file.size = file.text.length;
          return json({ id });
        }
        // PATCH /drive/v3/files/{id}?fields=... — finalize metadata
        const patchMatch = path.match(/^\/drive\/v3\/files\/([^/]+)$/);
        if (method === 'PATCH' && patchMatch) {
          const id = decodeURIComponent(patchMatch[1]);
          const file = files.get(id);
          if (!file) return json({ error: 'not found' }, 404);
          const body = postData
            ? (JSON.parse(postData) as {
                appProperties?: Record<string, string>;
              })
            : {};
          if (body.appProperties) {
            file.appProperties = {
              ...file.appProperties,
              ...body.appProperties,
            };
          }
          return json(metadata(file));
        }
        // GET /drive/v3/files/{id}?alt=media — download text
        if (
          method === 'GET' &&
          patchMatch &&
          u.searchParams.get('alt') === 'media'
        ) {
          const id = decodeURIComponent(patchMatch[1]);
          const file = files.get(id);
          if (!file) return json({ error: 'not found' }, 404);
          return {
            status: 200,
            contentType: 'application/json',
            body: file.text,
          };
        }
        // GET /drive/v3/files?spaces=appDataFolder&q=... — list
        if (
          method === 'GET' &&
          /\/drive\/v3\/files\/?$/.test(path) &&
          u.searchParams.get('spaces') === 'appDataFolder'
        ) {
          const list = Array.from(files.values())
            .filter((f) => f.appProperties.kind === 'myorganiser-vault-backup')
            .sort((a, b) => b.createdTime.localeCompare(a.createdTime))
            .map(metadata);
          return json({ files: list });
        }
        // DELETE /drive/v3/files/{id}
        if (method === 'DELETE' && patchMatch) {
          const id = decodeURIComponent(patchMatch[1]);
          files.delete(id);
          return { status: 204, contentType: 'application/json', body: '' };
        }
        return json({ error: 'unsupported' }, 400);
      };

      // ---- GIS namespace ----
      const failures: Array<'ok' | string> = [...(tokenFailures ?? [])];
      let revoked = false;
      // Test-controlled flag to force the *next* silent token attempt to
      // return `consent_required`, simulating a revoked grant.
      let forceNextSilentFailure = false;
      (w as { __myorgRevokeNext?: () => void }).__myorgRevokeNext = () => {
        forceNextSilentFailure = true;
      };

      type TokenCallback = (resp: {
        access_token?: string;
        expires_in?: number;
        scope?: string;
        token_type?: string;
        error?: string;
        error_description?: string;
      }) => void;

      const accounts = {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string;
            scope: string;
            callback: TokenCallback;
          }) => {
            const client = {
              client_id: cfg.client_id,
              scope: cfg.scope,
              callback: cfg.callback,
              requestAccessToken: (req?: { prompt?: string }) => {
                const interactive =
                  (req?.prompt ?? '') === 'consent' ||
                  (req?.prompt ?? '') === 'select_account';
                // Increment counter on every request (used to assert scheduler did not request).
                (w as { __authRequestCount?: number }).__authRequestCount =
                  ((w as { __authRequestCount?: number }).__authRequestCount ??
                    0) + 1;
                queueMicrotask(() => {
                  if (interactive) {
                    revoked = false;
                    forceNextSilentFailure = false;
                    client.callback({
                      access_token: `token-${Math.random().toString(36).slice(2)}`,
                      // Use a tiny TTL so the provider always reacquires on
                      // the silent path, making test-driven failures
                      // deterministic without mocking time.
                      expires_in: tokenTtlSec,
                      scope: cfg.scope,
                      token_type: 'Bearer',
                    });
                    return;
                  }
                  if (forceNextSilentFailure) {
                    forceNextSilentFailure = false;
                    client.callback({ error: 'consent_required' });
                    return;
                  }
                  // Silent path. Honor configured failures (FIFO).
                  const next = failures.shift();
                  if (next && next !== 'ok') {
                    client.callback({ error: next });
                    return;
                  }
                  if (revoked) {
                    client.callback({ error: 'consent_required' });
                    return;
                  }
                  client.callback({
                    access_token: `token-${Math.random().toString(36).slice(2)}`,
                    expires_in: tokenTtlSec,
                    scope: cfg.scope,
                    token_type: 'Bearer',
                  });
                });
              },
            };
            return client;
          },
          revoke: (_token: string, done: () => void) => {
            revoked = true;
            queueMicrotask(done);
          },
        },
      };

      (w as { google?: unknown }).google = { accounts };
    },
    {
      clientId: TEST_CLIENT_ID,
      tokenFailures: options?.tokenFailures ?? [],
      tokenTtlSec: options?.tokenTtlSec ?? 1,
    },
  );
}

async function setupVaultWithSampleData(page: Page) {
  const passphrase = 'testpass99';
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

/**
 * `/dashboard/vault` renders `VaultPageClient` directly — there is no
 * `VaultGate` on this route, and `#unlock-passphrase` exists only inside one.
 * The unlock probe that used to live here could therefore never fire; it only
 * made the route look gated (issue #597).
 */
async function gotoVaultSettings(page: Page) {
  await gotoStable(page, '/dashboard/vault');
}

test.describe('Vault cloud backup via Google Drive (E2E)', () => {
  test('redirect: /dashboard/account/vault navigates to /dashboard/vault', async ({
    browser,
  }) => {
    test.setTimeout(60000);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    setupBackend(page);
    await installGoogleMocks(page);

    await login(page);

    // Navigate to the old account vault URL; should redirect to /dashboard/vault.
    await page.goto('/dashboard/account/vault');
    await expect(page).toHaveURL(/.*\/dashboard\/vault$/);
    // Verify the vault page loaded. This User has no Local Vault, and since
    // ADR 0068 that state disables cloud backup — there is nothing to back up
    // — so the live `cloud-backup-card` is not rendered here and cannot serve
    // as the page-loaded probe. The import card renders in every Vault state
    // (disabled, with a notice saying why), which is what a probe for "the
    // route resolved" needs to be.
    await expect(page.getByTestId('import-vault-file')).toBeVisible({
      timeout: 60000,
    });

    await ctx.close();
  });

  test('(a) connect + manual backup updates the cloud last-backup record', async ({
    browser,
  }) => {
    test.setTimeout(180000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    setupBackend(page);
    await installGoogleMocks(page);

    await login(page);
    await setupVaultWithSampleData(page);

    await gotoVaultSettings(page);

    // Initially disconnected, latest cloud backup empty.
    await expect(page.getByTestId('cloud-backup-card')).toBeVisible({
      timeout: 60000,
    });
    await expect(
      page.getByTestId('cloud-backup-connection-not-linked'),
    ).toBeVisible();
    await expect(page.getByTestId('cloud-backup-latest-empty')).toBeVisible();

    // Connect.
    await page.getByTestId('cloud-backup-connect-button').click();
    await expect(
      page.getByTestId('cloud-backup-connection-linked'),
    ).toBeVisible({ timeout: 30000 });

    // Manual backup.
    const backupNow = page.getByTestId('cloud-backup-now-button');
    await expect(backupNow).toBeEnabled({ timeout: 30000 });
    await backupNow.click();

    // Latest cloud-backup record should appear.
    await expect(page.getByTestId('cloud-backup-latest-recorded')).toBeVisible({
      timeout: 60000,
    });

    await ctx.close();
  });

  test('(b) overdue notice + automatic backup from a held token', async ({
    browser,
  }) => {
    test.setTimeout(180000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    setupBackend(page);
    await installGoogleMocks(page, { tokenTtlSec: 300 });

    await login(page);
    await setupVaultWithSampleData(page);
    await gotoVaultSettings(page);

    await page.getByTestId('cloud-backup-connect-button').click();
    await expect(
      page.getByTestId('cloud-backup-connection-linked'),
    ).toBeVisible({ timeout: 30000 });

    await page.getByTestId('cloud-backup-age-limit-trigger').click();
    await page.getByTestId('cloud-backup-age-limit-1-day').click();

    await expect(page.getByTestId('cloud-backup-overdue')).toBeVisible({
      timeout: 30000,
    });

    const countBefore = await page.evaluate(() => {
      return (
        (window as unknown as { __authRequestCount?: number })
          .__authRequestCount ?? 0
      );
    });

    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });

    await expect(page.getByTestId('cloud-backup-latest-recorded')).toBeVisible({
      timeout: 60000,
    });

    await expect(page.getByTestId('cloud-backup-overdue')).toHaveCount(0, {
      timeout: 30000,
    });

    const countAfter = await page.evaluate(() => {
      return (
        (window as unknown as { __authRequestCount?: number })
          .__authRequestCount ?? 0
      );
    });
    expect(countBefore).toBe(countAfter);

    await ctx.close();
  });

  test('(c) refusal persists across reload', async ({ browser }) => {
    test.setTimeout(180000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    setupBackend(page);
    await installGoogleMocks(page);

    await login(page);
    await setupVaultWithSampleData(page);
    await gotoVaultSettings(page);

    await page.getByTestId('cloud-backup-connect-button').click();
    await expect(
      page.getByTestId('cloud-backup-connection-linked'),
    ).toBeVisible({ timeout: 30000 });

    await page.evaluate(() => {
      (
        window as unknown as { __myorgRevokeNext?: () => void }
      ).__myorgRevokeNext?.();
    });

    await page.getByTestId('cloud-backup-now-button').click();

    await expect(
      page.getByTestId('cloud-backup-connection-reconnect-needed'),
    ).toBeVisible({ timeout: 60000 });

    await waitForReload(page, async () => {
      await page.reload();
    });

    await expect(
      page.getByTestId('cloud-backup-connection-reconnect-needed'),
    ).toBeVisible({ timeout: 60000 });

    await page.getByTestId('cloud-backup-reconnect-button').click();
    await expect(
      page.getByTestId('cloud-backup-connection-linked'),
    ).toBeVisible({ timeout: 30000 });

    await ctx.close();
  });

  test('(d) restore dialog - unreadable disclosure requires checkbox', async ({
    browser,
  }) => {
    test.setTimeout(180000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const { backupRecords } = setupBackend(page);
    await installGoogleMocks(page);

    await login(page);
    await setupVaultWithSampleData(page);
    await gotoVaultSettings(page);

    await page.getByTestId('cloud-backup-connect-button').click();
    await expect(
      page.getByTestId('cloud-backup-connection-linked'),
    ).toBeVisible({ timeout: 30000 });
    const backupNow = page.getByTestId('cloud-backup-now-button');
    await expect(backupNow).toBeEnabled({ timeout: 30000 });
    await backupNow.click();
    await expect(page.getByTestId('cloud-backup-latest-recorded')).toBeVisible({
      timeout: 60000,
    });

    await removeOwnedVault(page, E2E_USER_ID);

    const restore = page.getByTestId('cloud-backup-restore-button');
    await expect(restore).toBeEnabled({ timeout: 30000 });
    await restore.click();

    await expect(page.getByTestId('import-vault-replace-dialog')).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByTestId('import-vault-replace-copy-age'),
    ).toBeVisible();

    await expect(
      page.getByTestId('import-vault-replace-acknowledge'),
    ).toBeVisible();

    const confirmBtn = page.getByTestId('import-vault-replace-confirm');
    await expect(confirmBtn).toBeDisabled();

    const countBefore = backupRecords.length;
    const cancelBtn = page.getByTestId('import-vault-replace-cancel');
    await cancelBtn.click();

    await expect(page.getByTestId('import-vault-replace-dialog')).toHaveCount(
      0,
    );
    expect(backupRecords.length).toBe(countBefore);

    await restore.click();
    await expect(page.getByTestId('import-vault-replace-dialog')).toBeVisible({
      timeout: 30000,
    });

    const checkbox = page.getByTestId('import-vault-replace-acknowledge');
    await checkbox.click();
    await expect(checkbox).toBeChecked({ timeout: 30000 });

    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    await waitForOwnedVault(page, E2E_USER_ID);

    const importRecord = backupRecords.find((r) => r.event === 'import');
    expect(importRecord).toBeDefined();

    await ctx.close();
  });

  test('(e) restore does not reset newest-copy age + unlink', async ({
    browser,
  }) => {
    test.setTimeout(180000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const { backupRecords } = setupBackend(page);
    await installGoogleMocks(page);

    await login(page);
    await setupVaultWithSampleData(page);
    await gotoVaultSettings(page);

    await page.getByTestId('cloud-backup-connect-button').click();
    await expect(
      page.getByTestId('cloud-backup-connection-linked'),
    ).toBeVisible({ timeout: 30000 });
    const backupNow = page.getByTestId('cloud-backup-now-button');
    await expect(backupNow).toBeEnabled({ timeout: 30000 });
    await backupNow.click();
    await expect(page.getByTestId('cloud-backup-latest-recorded')).toBeVisible({
      timeout: 60000,
    });

    const datetimeAttrBefore = await page
      .getByTestId('cloud-backup-latest-recorded')
      .locator('time')
      .getAttribute('datetime');

    const restore = page.getByTestId('cloud-backup-restore-button');
    await restore.click();

    await expect(page.getByTestId('import-vault-replace-dialog')).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByTestId('import-vault-replace-acknowledge'),
    ).toHaveCount(0);

    const confirmBtn = page.getByTestId('import-vault-replace-confirm');
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    await expect(page.getByTestId('import-vault-replace-dialog')).toHaveCount(
      0,
    );
    const importRecord = backupRecords.find((r) => r.event === 'import');
    expect(importRecord).toBeDefined();

    const datetimeAttrAfter = await page
      .getByTestId('cloud-backup-latest-recorded')
      .locator('time')
      .getAttribute('datetime');
    expect(datetimeAttrAfter).toBe(datetimeAttrBefore);

    const disconnect = page.getByTestId('cloud-backup-disconnect-button');
    await disconnect.click();
    await expect(
      page.getByTestId('cloud-backup-connection-not-linked'),
    ).toBeVisible({ timeout: 30000 });

    await ctx.close();
  });
});
