import { expect, test } from '@playwright/test';
import {
  createAndUnlockVault,
  gotoStable,
  writeAddressToVault,
  login,
  setupBackend,
  waitForDashboardReady,
  type IdentityEntry,
} from './helpers';

/**
 * Vault Locked Policy end-to-end (Issue #663, ADR 0068)
 *
 * Proves ADR 0068's locked-vault rule: a locked Vault blocks exactly the two
 * operations that need the Master Key (change-passphrase, rotate-recovery-key)
 * and nothing else. Each blocked operation's opener button is disabled, and its
 * form (inside a dialog) is not mounted until the dialog opens. Export and
 * removal remain available while locked because they only touch Ciphertext.
 *
 * This spec deliberately hard-navigates (via gotoStable/page.goto) to
 * /dashboard/vault to reach the locked state. The Master Key lives only in
 * React state, so a full page reload drops it, re-locking the vault. This
 * navigation pattern is the load-bearing assertion for issue constraint
 * "reaches the locked state by hard navigation rather than soft navigation".
 */

const EMAIL = 'vault-locked-policy-owner@example.com';
const PASSWORD = 'vaultlocked-e2e';
const USER_ID = 'vault-locked-policy-owner-1';
const VAULT_PASSPHRASE = 'locked-policy';

const IDENTITIES: IdentityEntry[] = [
  {
    match: 'vault-locked-policy-owner',
    userId: USER_ID,
    userName: 'Vault Locked Policy Owner',
  },
];

test.describe('Vault Locked Policy (E2E)', () => {
  test('Locked vault blocks change-passphrase and recovery-key-rotation; export and removal remain available', async ({
    page,
  }) => {
    test.setTimeout(180000);

    setupBackend(page, IDENTITIES);

    // 1. Sign in
    await login(page, EMAIL, PASSWORD);
    await expect(page).toHaveURL(/.*dashboard/, { timeout: 60000 });

    // 2. Create and unlock vault via /dashboard/addresses route
    await gotoStable(page, '/dashboard/addresses');
    await createAndUnlockVault(page, USER_ID, VAULT_PASSPHRASE);

    // 2b. Seed one Vault Blob. `exportVault` refuses an envelope with no
    // blobs (`empty-envelope`), so a freshly created Vault cannot be exported
    // at all — locked or unlocked. Without this the download in step 6 never
    // fires and the failure reads as "export is blocked while locked", which
    // is the opposite of what this spec exists to prove. The helper does its
    // own unlock and asserts the row landed, so the write is real Ciphertext.
    await writeAddressToVault(page, '12 Baker Street', VAULT_PASSPHRASE);

    // 3. Hard navigation to /dashboard/vault (the re-lock trigger)
    // This is page.goto(), not a sidebar link, so the vault is locked on arrival
    await gotoStable(page, '/dashboard/vault');
    await waitForDashboardReady(page);

    // 4. Assert locked state before testing operations.
    // VaultUnlockCard renders its submit control if and only if
    // useVaultDisabledState() resolves exactly to 'locked' (it returns null for
    // every other state, including 'no-local-vault' and 'signed-out'), so the
    // unlock submit and its "Unlock your vault" heading are the selectors that
    // prove 'locked' rather than merely "some operation is unavailable" — the
    // VaultUnavailableNotice testids below fire for any blocked state and would
    // not distinguish it.
    await expect(
      page.getByRole('heading', { level: 1, name: 'Unlock your vault' }),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId('vault-unlock-submit')).toBeVisible();

    // 5. Assert export is available while locked
    await expect(page.getByTestId('export-vault-button')).toBeEnabled();

    // 6. Click export and prove it completes
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-vault-button').click(),
    ]);
    expect(download.suggestedFilename()).toBeTruthy();

    // 7. Assert removal is available while locked
    await expect(page.getByTestId('remove-vault-button')).toBeEnabled();

    // 8. Click removal button and assert the confirmation dialog opens.
    // ConfirmDialog is role="alertdialog", so `dialog` queries do not match it.
    await page.getByTestId('remove-vault-button').click();
    await expect(page.getByRole('alertdialog')).toBeVisible({ timeout: 30000 });

    // 9. Close the dialog via Cancel (do not complete the removal)
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Cancel' })
      .click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    // 10. Assert change-passphrase is blocked while locked. The opener is the
    // element that is disabled; the form only exists inside the dialog it opens.
    await expect(page.getByTestId('change-passphrase-open')).toBeDisabled();
    await expect(page.getByTestId('change-passphrase-submit')).toHaveCount(0);

    // 11. Assert its "why" notice is present
    await expect(
      page.getByTestId('change-passphrase-unavailable'),
    ).toBeVisible();

    // 12. Assert rotate-recovery-key is blocked while locked. The opener is
    // disabled; the mint control only exists inside the dialog it opens.
    await expect(page.getByTestId('recovery-key-rotation-open')).toBeDisabled();
    await expect(page.getByTestId('recovery-key-rotation-mint')).toHaveCount(0);

    // 13. Assert its "why" notice is present
    await expect(
      page.getByTestId('recovery-key-rotation-unavailable'),
    ).toBeVisible();
  });
});
