import { expect, test, type Page } from '@playwright/test';
import {
  createOwnedVault,
  expectNoHorizontalOverflow,
  expectSingleH1,
  gotoStable,
  login,
  PBKDF2_BUDGET_MS,
  setupBackend,
  stubJsonGet,
  unlockVaultOnSettingsPage,
  waitForDashboardReady,
  type IdentityEntry,
} from './helpers';

/**
 * Vault page layout end-to-end (issue #1257)
 *
 * Proves the Vault page's structure and dialogs at both layouts, and that
 * neither layout scrolls sideways:
 * - desktop at 1440x900: the sectioned page (Access, Backups and moving your
 *   vault, Danger zone) in each vault state, its three openers in and out of
 *   the locked state, and the Change passphrase, Rotate recovery key and
 *   Remove dialogs;
 * - phone at 390x844: the ListGroup layout, its blocked rows while locked,
 *   the pushed Change passphrase, Rotate recovery key, Backups and Reader
 *   screens, and the Remove sheet.
 *
 * Each vault-backed test reaches the locked state by creating the vault from
 * the Tasks setup form and then navigating softly. Only the last step of a
 * test hard-navigates, because a full page load re-locks the vault.
 *
 * Not asserted: reason text, the Google card, the shell title and breadcrumbs,
 * the chips on the unlocked hero, and any Tasks page internals.
 */

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const PHONE_VIEWPORT = { width: 390, height: 844 };

const PASSWORD = 'vaultlayout-e2e';
const VAULT_PASSPHRASE = 'layout-pass-01';

const DESKTOP_NO_VAULT_EMAIL = 'vault-page-layout-desktop-01@example.com';
const DESKTOP_NO_VAULT_USER_ID = 'vault-page-layout-desktop-1';
const DESKTOP_VAULT_EMAIL = 'vault-page-layout-desktop-02@example.com';
const DESKTOP_VAULT_USER_ID = 'vault-page-layout-desktop-2';
const PHONE_EMAIL = 'vault-page-layout-phone-01@example.com';
const PHONE_USER_ID = 'vault-page-layout-phone-1';

const IDENTITIES: IdentityEntry[] = [
  {
    match: 'vault-page-layout-desktop-01',
    userId: DESKTOP_NO_VAULT_USER_ID,
    userName: 'Vault Layout Desktop Empty',
  },
  {
    match: 'vault-page-layout-desktop-02',
    userId: DESKTOP_VAULT_USER_ID,
    userName: 'Vault Layout Desktop Owner',
  },
  {
    match: 'vault-page-layout-phone-01',
    userId: PHONE_USER_ID,
    userName: 'Vault Layout Phone Owner',
  },
];

function tabBar(page: Page) {
  return page.getByRole('navigation', { name: 'App sections' });
}

const SECTION_H2S = ['Access', 'Backups and moving your vault', 'Danger zone'];

const CARD_H3S = [
  'Change passphrase',
  'Rotate recovery key',
  'Export encrypted vault',
  'Import encrypted vault',
  'Open your Escape Copy without us',
  'Remove local vault',
];

test.describe('Vault page layout (E2E)', () => {
  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test('with no Local Vault shows the three sections, disabled openers with their notices, and no overflow', async ({
      page,
    }) => {
      test.setTimeout(180000);

      setupBackend(page, IDENTITIES);
      await login(page, DESKTOP_NO_VAULT_EMAIL, PASSWORD);
      await expect(page).toHaveURL(/.*dashboard/);

      await gotoStable(page, '/dashboard/vault');
      await waitForDashboardReady(page);

      // The hero is an sr-only h1 until the vault state resolves.
      await expectSingleH1(page, 'Vault');

      for (const name of SECTION_H2S) {
        await expect(
          page.getByRole('heading', { level: 2, name, exact: true }),
        ).toBeVisible();
      }

      await expect(page.getByTestId('change-passphrase-open')).toBeDisabled();
      await expect(
        page.getByTestId('change-passphrase-unavailable'),
      ).toBeVisible();
      await expect(
        page.getByTestId('recovery-key-rotation-open'),
      ).toBeDisabled();
      await expect(
        page.getByTestId('recovery-key-rotation-unavailable'),
      ).toBeVisible();
      await expect(page.getByTestId('remove-vault-button')).toHaveCount(1);

      await expectNoHorizontalOverflow(page, 'Desktop vault, no vault');
    });

    test('locked, unlocked, and back to locked: sections, dialogs, and no overflow at every step', async ({
      page,
    }) => {
      test.setTimeout(180000);

      setupBackend(page, IDENTITIES);
      await login(page, DESKTOP_VAULT_EMAIL, PASSWORD);
      await expect(page).toHaveURL(/.*dashboard/);

      // Create the vault from the Tasks setup form. This is the only place
      // the Vault is created, so the rest of the test runs on the locked state.
      await gotoStable(page, '/dashboard/tasks');
      await waitForDashboardReady(page);
      await createOwnedVault(page, {
        passphrase: VAULT_PASSPHRASE,
        owner: DESKTOP_VAULT_USER_ID,
      });

      // Soft navigation to the Vault page: the vault is owned but locked.
      await page.getByRole('link', { name: 'Vault', exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard\/vault\/?$/);
      await expectSingleH1(page, 'Unlock your vault');
      await expect(page.getByTestId('vault-unlock-submit')).toBeVisible();
      await expectNoHorizontalOverflow(page, 'Desktop vault, locked');

      // Locked: the three sections are present, with the openers disabled
      // and their notices showing. Export and Remove stay available.
      for (const name of SECTION_H2S) {
        await expect(
          page.getByRole('heading', { level: 2, name, exact: true }),
        ).toBeVisible();
      }
      for (const name of CARD_H3S) {
        await expect(
          page.getByRole('heading', { level: 3, name, exact: true }),
        ).toBeVisible();
      }
      await expect(page.getByTestId('change-passphrase-open')).toBeDisabled();
      await expect(
        page.getByTestId('change-passphrase-unavailable'),
      ).toBeVisible();
      await expect(
        page.getByTestId('recovery-key-rotation-open'),
      ).toBeDisabled();
      await expect(
        page.getByTestId('recovery-key-rotation-unavailable'),
      ).toBeVisible();
      await expect(page.getByTestId('export-vault-button')).toBeEnabled();
      await expect(page.getByTestId('remove-vault-button')).toBeEnabled();
      await expect(page.getByTestId('change-passphrase-submit')).toHaveCount(0);
      await expect(page.getByTestId('recovery-key-rotation-mint')).toHaveCount(
        0,
      );
      await expectNoHorizontalOverflow(page, 'Desktop vault sections, locked');

      // Unlock on this page.
      await unlockVaultOnSettingsPage(page, VAULT_PASSPHRASE);
      await expectSingleH1(page, 'Your vault is unlocked');
      await expect(
        page.getByText('Unlocked on this device for this session', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page
          .getByRole('main')
          .getByRole('button', { name: 'Lock vault', exact: true }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page, 'Desktop vault, unlocked');

      // Change passphrase dialog: opens with its three fields and an enabled
      // submit (no dirty gate). Cancel closes it; nothing is submitted.
      await page.getByTestId('change-passphrase-open').click();
      const changeDialog = page.getByRole('dialog', {
        name: 'Change passphrase',
      });
      await expect(changeDialog).toBeVisible();
      await expect(
        changeDialog.getByLabel('Current passphrase', { exact: true }),
      ).toBeVisible();
      await expect(
        changeDialog.getByLabel('New passphrase', { exact: true }),
      ).toBeVisible();
      await expect(
        changeDialog.getByLabel('Confirm new passphrase', { exact: true }),
      ).toBeVisible();
      await expect(
        changeDialog.getByTestId('change-passphrase-submit'),
      ).toBeEnabled();
      await changeDialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(changeDialog).toHaveCount(0);

      // Rotate recovery key dialog: mint needs a passphrase, submit needs the
      // minted key typed back in full. Cancel discards it, so nothing rotates.
      await page.getByTestId('recovery-key-rotation-open').click();
      const rotateDialog = page.getByRole('dialog', {
        name: 'Rotate recovery key',
      });
      await expect(rotateDialog).toBeVisible();
      const mint = rotateDialog.getByTestId('recovery-key-rotation-mint');
      await expect(mint).toBeDisabled();
      await rotateDialog
        .getByLabel('Passphrase to authorize this rotation')
        .fill(VAULT_PASSPHRASE);
      await expect(mint).toBeEnabled();
      await mint.click();

      const keyDisplay = rotateDialog.getByTestId('recovery-key-rotation-key');
      await expect(keyDisplay).toBeVisible();
      const mintedKey = await keyDisplay.inputValue();
      expect(mintedKey).toBeTruthy();

      const submitRotation = rotateDialog.getByTestId(
        'recovery-key-rotation-submit',
      );
      const confirmKey = rotateDialog.getByTestId(
        'recovery-key-rotation-confirm',
      );
      await expect(submitRotation).toBeDisabled();
      await confirmKey.fill(mintedKey.slice(0, -1));
      await expect(submitRotation).toBeDisabled();
      await confirmKey.fill(mintedKey);
      await expect(submitRotation).toBeEnabled();

      await rotateDialog.getByTestId('recovery-key-rotation-cancel').click();
      await expect(rotateDialog).toHaveCount(0);

      // Reopened: the minted key is gone and mint needs the passphrase again.
      await page.getByTestId('recovery-key-rotation-open').click();
      await expect(rotateDialog).toBeVisible();
      await expect(
        rotateDialog.getByTestId('recovery-key-rotation-key'),
      ).toHaveCount(0);
      await expect(
        rotateDialog.getByTestId('recovery-key-rotation-mint'),
      ).toBeDisabled();
      await rotateDialog.getByTestId('recovery-key-rotation-cancel').click();
      await expect(rotateDialog).toHaveCount(0);

      // Remove dialog: an alertdialog with its two buttons. Cancel closes it.
      await page.getByTestId('remove-vault-button').click();
      const removeDialog = page.getByRole('alertdialog', {
        name: 'Remove this Vault from this device?',
      });
      await expect(removeDialog).toBeVisible();
      await expect(
        removeDialog.getByRole('button', {
          name: 'Remove from this device',
          exact: true,
        }),
      ).toBeVisible();
      await removeDialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(removeDialog).toHaveCount(0);

      // Lock from the hero brings the unlock gate back.
      await page
        .getByRole('main')
        .getByRole('button', { name: 'Lock vault', exact: true })
        .click();
      await expectSingleH1(page, 'Unlock your vault');

      // Hard navigation is the last step: it re-locks the vault.
      await gotoStable(page, '/dashboard/vault/backups');
      await waitForDashboardReady(page);
      await expectSingleH1(page, 'Backups');
      await expect(page.getByTestId('export-vault-button')).toBeVisible();
      await expect(page.getByTestId('import-vault-file')).toBeAttached();
      await expectNoHorizontalOverflow(page, 'Desktop backups');

      await gotoStable(page, '/dashboard/vault/passphrase');
      await waitForDashboardReady(page);
      await expect(
        page.getByTestId('change-passphrase-unavailable'),
      ).toBeVisible({ timeout: PBKDF2_BUDGET_MS });
      await expectSingleH1(page, 'Change passphrase');
      await expect(page.getByTestId('change-passphrase-submit')).toHaveCount(0);
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test('locked, unlocked, and the pushed screens: rows, sheet, and no overflow at every step', async ({
      page,
    }) => {
      test.setTimeout(180000);

      setupBackend(page, IDENTITIES);
      // Home and More read these on mount at phone width.
      await stubJsonGet(page, /\/feedback\/reports\/?(\?.*)?$/, {
        items: [],
        hasChangedSinceLastSeen: false,
      });
      await stubJsonGet(page, /\/youtube\/availability\/?(\?.*)?$/, {
        available: false,
      });
      await stubJsonGet(page, /\/youtube\/status\/?(\?.*)?$/, {
        connected: false,
      });
      await login(page, PHONE_EMAIL, PASSWORD);
      await expect(page).toHaveURL(/.*dashboard/);

      await gotoStable(page, '/dashboard/tasks');
      await waitForDashboardReady(page);
      await createOwnedVault(page, {
        passphrase: VAULT_PASSPHRASE,
        owner: PHONE_USER_ID,
      });

      const bar = tabBar(page);
      await bar.getByRole('link', { name: 'Vault', exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard\/vault\/?$/);

      // The phone layout appears one commit after the desktop one. A
      // phone-only row proves it has rendered.
      await expect(
        page.getByRole('link', { name: /^Encrypted Escape Copy/ }),
      ).toBeVisible({ timeout: PBKDF2_BUDGET_MS });
      await expectSingleH1(page, 'Unlock your vault');
      await expectNoHorizontalOverflow(page, 'Phone vault, locked');

      // Locked: the two Access rows are blocked, not links, and carry no
      // opener. The Backups rows and Remove stay available.
      await expect(
        page.getByRole('link', { name: /^Change passphrase/ }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('link', { name: /^Rotate recovery key/ }),
      ).toHaveCount(0);
      await expect(
        page.locator('[aria-disabled="true"]', {
          hasText: /^Change passphrase/,
        }),
      ).toHaveCount(1);
      await expect(
        page.locator('[aria-disabled="true"]', {
          hasText: /^Rotate recovery key/,
        }),
      ).toHaveCount(1);
      await expect(page.getByTestId('change-passphrase-open')).toHaveCount(0);

      for (const name of SECTION_H2S) {
        await expect(
          page.getByRole('heading', { level: 2, name, exact: true }),
        ).toBeVisible();
      }
      await expect(
        page.getByRole('link', { name: /^Encrypted Escape Copy/ }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: /^Export encrypted vault/ }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: /^Import encrypted vault/ }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', {
          name: /^Open your Escape Copy without us/,
        }),
      ).toBeVisible();
      await expect(page.getByTestId('remove-vault-button')).toHaveCount(1);

      // Unlock on this page; the Access rows become links.
      await unlockVaultOnSettingsPage(page, VAULT_PASSPHRASE);
      await expectSingleH1(page, 'Your vault is unlocked');
      await expect(
        page.getByRole('button', { name: 'Lock vault', exact: true }),
      ).toHaveCount(1);
      await expect(
        page.getByRole('link', { name: /^Change passphrase/ }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: /^Rotate recovery key/ }),
      ).toBeVisible();

      // Change passphrase screen: a pushed screen with no tab bar and a form.
      // Nothing is submitted.
      await page.getByRole('link', { name: /^Change passphrase/ }).click();
      await expect(page).toHaveURL(/\/dashboard\/vault\/passphrase\/?$/);
      await expectSingleH1(page, 'Change passphrase');
      await expect(
        page.getByRole('link', { name: 'Back to Vault' }),
      ).toBeVisible();
      await expect(tabBar(page)).toHaveCount(0);
      await expect(
        page.getByLabel('Current passphrase', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByLabel('New passphrase', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByLabel('Confirm new passphrase', { exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId('change-passphrase-submit')).toBeVisible();
      await expectNoHorizontalOverflow(page, 'Phone change passphrase');
      await page.getByRole('link', { name: 'Back to Vault' }).click();
      await expect(page).toHaveURL(/\/dashboard\/vault\/?$/);

      // Rotate recovery key screen: Cancel returns to the Vault page.
      await page.getByRole('link', { name: /^Rotate recovery key/ }).click();
      await expect(page).toHaveURL(/\/dashboard\/vault\/recovery-key\/?$/);
      await expectSingleH1(page, 'Rotate recovery key');
      await expect(
        page.getByTestId('recovery-key-rotation-mint'),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page, 'Phone rotate recovery key');
      await page.getByTestId('recovery-key-rotation-cancel').click();
      await expect(page).toHaveURL(/\/dashboard\/vault\/?$/);

      // Backups screen.
      await page.getByRole('link', { name: /^Encrypted Escape Copy/ }).click();
      await expect(page).toHaveURL(/\/dashboard\/vault\/backups\/?$/);
      await expectSingleH1(page, 'Backups');
      await expect(page.getByTestId('export-vault-button')).toHaveCount(1);
      await expect(page.getByTestId('import-vault-file')).toBeAttached();
      await expectNoHorizontalOverflow(page, 'Phone backups');
      await page.getByRole('link', { name: 'Back to Vault' }).click();
      await expect(page).toHaveURL(/\/dashboard\/vault\/?$/);

      // Reader screen. The GitHub link is not followed.
      await page
        .getByRole('link', { name: /^Open your Escape Copy without us/ })
        .click();
      await expect(page).toHaveURL(/\/dashboard\/vault\/reader\/?$/);
      await expectSingleH1(page, 'Escape Copy reader');
      await expect(
        page.getByTestId('escape-copy-reader-download-link'),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page, 'Phone reader');
      await page.getByRole('link', { name: 'Back to Vault' }).click();
      await expect(page).toHaveURL(/\/dashboard\/vault\/?$/);

      // Remove sheet: a bottom sheet with its two buttons, closed by Cancel.
      await page.getByTestId('remove-vault-button').click();
      const removeSheet = page.getByRole('alertdialog', {
        name: 'Remove this Vault from this device?',
      });
      // ConfirmDialog renders the desktop Radix Dialog for one commit before
      // useIsMobile flips it to a BottomSheet. Wait for the bottom-anchored
      // sheet (fixed inset-x-0 bottom-0) so the overflow check measures the
      // phone layout, not the pre-flip dialog.
      await expect(removeSheet).toBeVisible();
      await expect
        .poll(async () => {
          const box = await removeSheet.boundingBox();
          return box ? Math.round(box.y + box.height) : 0;
        })
        .toBe(PHONE_VIEWPORT.height);
      await expect(
        removeSheet.getByRole('button', {
          name: 'Remove from this device',
          exact: true,
        }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page, 'Phone remove sheet');
      await removeSheet.getByRole('button', { name: 'Cancel' }).click();
      await expect(removeSheet).toHaveCount(0);

      // Hard navigation is the last step: it re-locks the vault, and the
      // pushed screen shows only the notice.
      await gotoStable(page, '/dashboard/vault/passphrase');
      await expect(
        page.getByTestId('change-passphrase-unavailable'),
      ).toBeVisible({ timeout: PBKDF2_BUDGET_MS });
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.getByTestId('change-passphrase-submit')).toHaveCount(0);
      await expectNoHorizontalOverflow(page, 'Phone change passphrase, locked');
    });
  });
});
