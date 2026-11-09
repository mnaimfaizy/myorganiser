import { expect, test, type Page } from '@playwright/test';
import {
  attachVirtualAuthenticator,
  createAndUnlockVault,
  gotoStable,
  login,
  PBKDF2_BUDGET_MS,
  setupBackend,
  signOut,
  waitForReload,
  type IdentityEntry,
  type VirtualAuthenticator,
} from './helpers';

/**
 * Passkey Unlock end-to-end (ADR 0136, issue #1352).
 *
 * Drives the one-time offer after a passphrase unlock, the passkey option on
 * the locked gate after a reload, and the per-owner isolation of both. The
 * WebAuthn ceremony runs against a Chromium virtual authenticator attached
 * over CDP, so no real device or platform prompt is involved.
 *
 * Chromium only: the WebAuthn virtual authenticator is a Chrome DevTools
 * feature. Other engines skip until the blocking Chromium lane (ADR 0050)
 * covers this spec.
 */

const OWNER_EMAIL = 'passkey-owner@example.com';
const OWNER_PASSWORD = 'passkey-e2e-pw';
const OWNER_ID = 'passkey-owner-1';
const OWNER_PASSPHRASE = 'passkey-pass-a';

const OTHER_EMAIL = 'passkey-other@example.com';
const OTHER_PASSWORD = 'passkey-e2e-pw';
const OTHER_ID = 'passkey-other-2';
const OTHER_PASSPHRASE = 'passkey-pass-b';

const IDENTITIES: IdentityEntry[] = [
  { match: 'passkey-owner', userId: OWNER_ID, userName: 'Passkey Owner' },
  { match: 'passkey-other', userId: OTHER_ID, userName: 'Passkey Other' },
];

/**
 * Mirrors `passkeyUnlockStorageKey` in
 * `libs/web/vault/src/lib/vault/passkeyUnlockStorage.ts` — keep the two in step.
 */
function passkeyRecordKey(owner: string): string {
  return `myorganiser_passkey_unlock_v1:${owner}`;
}

function readStorageItem(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => window.localStorage.getItem(k), key);
}

const OFFER_HEADING = 'Unlock faster with a passkey?';
const SET_UP_PASSKEY = 'Set up passkey';
const NOT_NOW = 'Not now';
const PASSKEY_UNLOCK_BUTTON = 'Unlock with passkey';

test.describe('Passkey Unlock (E2E)', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'WebAuthn virtual authenticator (CDP) exists only in Chromium; ADR 0050 blocking Chromium lane',
  );

  let authenticator: VirtualAuthenticator | undefined;

  test.afterEach(async () => {
    await authenticator?.dispose();
    authenticator = undefined;
  });

  test('enrol after a passphrase unlock, then unlock with the passkey after reload', async ({
    page,
  }) => {
    test.setTimeout(180000);

    authenticator = await attachVirtualAuthenticator(page, {
      prf: true,
      userVerification: true,
    });

    setupBackend(page, IDENTITIES);
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await expect(page).toHaveURL(/.*dashboard/, { timeout: 60000 });

    await gotoStable(page, '/dashboard/addresses');
    await createAndUnlockVault(page, OWNER_ID, OWNER_PASSPHRASE);

    // The one-time offer is owed after a passphrase unlock on a PRF-capable device.
    await expect(
      page.getByRole('heading', { name: OFFER_HEADING }),
    ).toBeVisible({ timeout: PBKDF2_BUDGET_MS });
    await page
      .getByRole('button', { name: SET_UP_PASSKEY, exact: true })
      .click();

    // The toast fires only after the passkey record is written.
    await expect(
      page.getByText('Passkey Unlock is on', { exact: true }),
    ).toBeVisible({ timeout: PBKDF2_BUDGET_MS });
    expect(
      await readStorageItem(page, passkeyRecordKey(OWNER_ID)),
    ).not.toBeNull();
    expect(await authenticator.credentialCount()).toBe(1);

    await waitForReload(page, async () => {
      await page.reload();
    });

    // The gate shows the passkey option above the passphrase form, which stays as the fallback.
    const passkeyButton = page.getByRole('button', {
      name: PASSKEY_UNLOCK_BUTTON,
      exact: true,
    });
    await expect(passkeyButton).toBeVisible({ timeout: PBKDF2_BUDGET_MS });
    await expect(page.locator('#unlock-passphrase')).toBeVisible();

    await passkeyButton.click();

    // The passphrase field leaving is the unlock landing, as for a passphrase unlock.
    await expect(page.locator('#unlock-passphrase')).toHaveCount(0, {
      timeout: PBKDF2_BUDGET_MS,
    });
    await expect(
      page.getByText('Vault unlocked with your passkey for this session.', {
        exact: true,
      }),
    ).toBeVisible({ timeout: PBKDF2_BUDGET_MS });
  });

  test('a second User on the same browser is never offered or given the first User passkey', async ({
    page,
  }) => {
    test.setTimeout(180000);

    authenticator = await attachVirtualAuthenticator(page, {
      prf: true,
      userVerification: true,
    });

    setupBackend(page, IDENTITIES);

    // User A enrols a passkey on this browser.
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await expect(page).toHaveURL(/.*dashboard/, { timeout: 60000 });
    await gotoStable(page, '/dashboard/addresses');
    await createAndUnlockVault(page, OWNER_ID, OWNER_PASSPHRASE);
    await expect(
      page.getByRole('heading', { name: OFFER_HEADING }),
    ).toBeVisible({ timeout: PBKDF2_BUDGET_MS });
    await page
      .getByRole('button', { name: SET_UP_PASSKEY, exact: true })
      .click();
    await expect(
      page.getByText('Passkey Unlock is on', { exact: true }),
    ).toBeVisible({ timeout: PBKDF2_BUDGET_MS });

    await signOut(page);

    // User B signs in on the same browser and creates a vault of their own.
    await login(page, OTHER_EMAIL, OTHER_PASSWORD);
    await expect(page).toHaveURL(/.*dashboard/, { timeout: 60000 });
    await gotoStable(page, '/dashboard/addresses');

    // Before B has a vault, the setup card offers no passkey unlock.
    await expect(page.locator('#setup-passphrase')).toBeVisible({
      timeout: PBKDF2_BUDGET_MS,
    });
    await expect(
      page.getByRole('button', { name: PASSKEY_UNLOCK_BUTTON, exact: true }),
    ).toHaveCount(0);

    await createAndUnlockVault(page, OTHER_ID, OTHER_PASSPHRASE);

    // B is owed their own one-time offer. Declining it is recorded for B only.
    await expect(
      page.getByRole('heading', { name: OFFER_HEADING }),
    ).toBeVisible({ timeout: PBKDF2_BUDGET_MS });
    await page.getByRole('button', { name: NOT_NOW, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: OFFER_HEADING }),
    ).toHaveCount(0);

    await waitForReload(page, async () => {
      await page.reload();
    });

    // The locked gate for B shows the passphrase form and no passkey option.
    await expect(page.locator('#unlock-passphrase')).toBeVisible({
      timeout: PBKDF2_BUDGET_MS,
    });
    await expect(
      page.getByRole('button', { name: PASSKEY_UNLOCK_BUTTON, exact: true }),
    ).toHaveCount(0);
    expect(await readStorageItem(page, passkeyRecordKey(OTHER_ID))).toBeNull();
  });

  test('an authenticator without PRF cannot enrol: the offer fails toward the passphrase and nothing is saved', async ({
    page,
  }) => {
    test.setTimeout(180000);

    authenticator = await attachVirtualAuthenticator(page, {
      prf: false,
      userVerification: true,
    });

    setupBackend(page, IDENTITIES);
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await expect(page).toHaveURL(/.*dashboard/, { timeout: 60000 });

    await gotoStable(page, '/dashboard/addresses');
    await createAndUnlockVault(page, OWNER_ID, OWNER_PASSPHRASE);

    // Platform checks cannot rule PRF out before creation, so the offer is still
    // shown. PRF is decided by the credential's output, not before it.
    await expect(
      page.getByRole('heading', { name: OFFER_HEADING }),
    ).toBeVisible({ timeout: PBKDF2_BUDGET_MS });
    await page
      .getByRole('button', { name: SET_UP_PASSKEY, exact: true })
      .click();

    await expect(
      page.getByText("This passkey can't unlock your vault", { exact: true }),
    ).toBeVisible({ timeout: PBKDF2_BUDGET_MS });
    expect(await readStorageItem(page, passkeyRecordKey(OWNER_ID))).toBeNull();

    await waitForReload(page, async () => {
      await page.reload();
    });

    await expect(page.locator('#unlock-passphrase')).toBeVisible({
      timeout: PBKDF2_BUDGET_MS,
    });
    await expect(
      page.getByRole('button', { name: PASSKEY_UNLOCK_BUTTON, exact: true }),
    ).toHaveCount(0);
  });

  test('logging out turns Passkey Unlock off, so the next unlock offers only the passphrase', async ({
    page,
  }) => {
    test.setTimeout(180000);

    authenticator = await attachVirtualAuthenticator(page, {
      prf: true,
      userVerification: true,
    });

    setupBackend(page, IDENTITIES);
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await expect(page).toHaveURL(/.*dashboard/, { timeout: 60000 });

    await gotoStable(page, '/dashboard/addresses');
    await createAndUnlockVault(page, OWNER_ID, OWNER_PASSPHRASE);

    await expect(
      page.getByRole('heading', { name: OFFER_HEADING }),
    ).toBeVisible({ timeout: PBKDF2_BUDGET_MS });
    await page
      .getByRole('button', { name: SET_UP_PASSKEY, exact: true })
      .click();
    await expect(
      page.getByText('Passkey Unlock is on', { exact: true }),
    ).toBeVisible({ timeout: PBKDF2_BUDGET_MS });
    expect(
      await readStorageItem(page, passkeyRecordKey(OWNER_ID)),
    ).not.toBeNull();

    // Log out is what turns Passkey Unlock off: the record is gone once the
    // sign-out has reached the sign-in page, before the next sign-in begins.
    await signOut(page);
    expect(await readStorageItem(page, passkeyRecordKey(OWNER_ID))).toBeNull();

    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await expect(page).toHaveURL(/.*dashboard/, { timeout: 60000 });
    await gotoStable(page, '/dashboard/addresses');

    // The owner's Local Vault survives log out, so the gate still asks for the
    // passphrase, and offers no passkey option.
    await expect(page.locator('#unlock-passphrase')).toBeVisible({
      timeout: PBKDF2_BUDGET_MS,
    });
    await expect(
      page.getByRole('button', { name: PASSKEY_UNLOCK_BUTTON, exact: true }),
    ).toHaveCount(0);
  });
});
