import { expect, test } from '@playwright/test';
import {
  createAndUnlockVault,
  gotoStable,
  login,
  readOwnedVault,
  setupBackend,
  signOut,
  signUp,
  unlockWithPassphrase,
  waitForOwnedVault,
  waitForReload,
  writeAddressToVault,
} from './helpers';

/**
 * Multi-user vault isolation tests.
 *
 * NOTE: Criterion 2 is proven client-side only. These tests run the mock backend
 * in the test process, so assertions over the mock's state only prove the client
 * sends the right ciphertext under the right identity. They do not prove that a
 * real server would refuse a cross-User request. Server-side identity verification
 * is tracked separately in issue #505.
 */

const USER_A_ID = 'a-1';
const USER_B_ID = 'b-2';

// Test credentials (10–15 char passphrases for hook compliance)
const ALICE_EMAIL = 'alice@example.com';
const ALICE_PASSWORD = 'alice-e2e-pw';
const ALICE_VAULT_PASSPHRASE = 'vault-pass-a';

const BOB_EMAIL = 'bob@example.com';
const BOB_PASSWORD = 'bob-e2e-pw';
const BOB_VAULT_PASSPHRASE = 'vault-pass-b';

const USER_A_ADDRESS = '123 Main St';
const USER_B_ADDRESS = '456 Oak Ave';

test.describe('Multi-user vault isolation (E2E)', () => {
  test('Test 1: User A creates vault, User B signs up and cannot access A vault', async ({
    browser,
  }) => {
    test.setTimeout(180000);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    setupBackend(page);

    // Test criteria 1 and 2: User A creates vault, User B cannot access it
    // A: Login, create vault, unlock, write address
    await login(page, ALICE_EMAIL, ALICE_PASSWORD);
    await gotoStable(page, '/dashboard/addresses');

    // User A creates vault with passphrase
    await createAndUnlockVault(page, USER_A_ID, ALICE_VAULT_PASSPHRASE);

    // Write User A's address
    await writeAddressToVault(page, USER_A_ADDRESS, ALICE_VAULT_PASSPHRASE);

    // Capture User A's vault ciphertext
    await waitForOwnedVault(page, USER_A_ID);
    const userAVault = await readOwnedVault(page, USER_A_ID);
    expect(userAVault).toBeTruthy();

    // User A signs out
    await signOut(page);

    // User B signs up
    await signUp(page, 'Bob', 'User', BOB_EMAIL, BOB_PASSWORD);

    // After signup, user is redirected to email verification
    // Now login as User B
    await login(page, BOB_EMAIL, BOB_PASSWORD);

    // User B visits a VaultGate route
    await gotoStable(page, '/dashboard/addresses');

    // Criterion 1: User B should see the CREATE vault panel, not unlock
    // Assert the setup form is visible (create passphrase input)
    const setupPass = page.locator('#setup-passphrase');
    await expect(setupPass).toBeVisible({ timeout: 30000 });

    // Criterion 2: No unlock form should be present
    const unlockPass = page.locator('#unlock-passphrase');
    await expect(unlockPass).toHaveCount(0);

    // User B creates their own vault with different passphrase
    await createAndUnlockVault(page, USER_B_ID, BOB_VAULT_PASSPHRASE);

    // Write User B's address
    await writeAddressToVault(page, USER_B_ADDRESS, BOB_VAULT_PASSPHRASE);

    // Capture User B's vault ciphertext
    await waitForOwnedVault(page, USER_B_ID);
    const userBVault = await readOwnedVault(page, USER_B_ID);
    expect(userBVault).toBeTruthy();

    // Verify isolation: the two ciphertexts are different
    expect(userAVault).not.toBe(userBVault);

    await ctx.close();
  });

  test('Test 2: Both Users sign in/out twice; sign-out preserves vault storage', async ({
    browser,
  }) => {
    test.setTimeout(180000);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    setupBackend(page);

    // Test criteria 3 and 4: Sign in/out cycles preserve vault storage and return to correct unlock state

    // === Cycle 1: User A ===
    await login(page, ALICE_EMAIL, ALICE_PASSWORD);
    await gotoStable(page, '/dashboard/addresses');
    await createAndUnlockVault(page, USER_A_ID, ALICE_VAULT_PASSPHRASE);
    await writeAddressToVault(page, USER_A_ADDRESS, ALICE_VAULT_PASSPHRASE);

    await waitForOwnedVault(page, USER_A_ID);
    const userAVaultCycle1 = await readOwnedVault(page, USER_A_ID);
    expect(userAVaultCycle1).toBeTruthy();

    // User A signs out
    await signOut(page);

    // Verify vault storage persists after sign-out
    const userAVaultAfterSignOut = await readOwnedVault(page, USER_A_ID);
    expect(userAVaultAfterSignOut).toBe(userAVaultCycle1);

    // === Cycle 1: User B ===
    await login(page, BOB_EMAIL, BOB_PASSWORD);
    await gotoStable(page, '/dashboard/addresses');
    await createAndUnlockVault(page, USER_B_ID, BOB_VAULT_PASSPHRASE);
    await writeAddressToVault(page, USER_B_ADDRESS, BOB_VAULT_PASSPHRASE);

    await waitForOwnedVault(page, USER_B_ID);
    const userBVaultCycle1 = await readOwnedVault(page, USER_B_ID);
    expect(userBVaultCycle1).toBeTruthy();

    // User B signs out
    await signOut(page);

    // Verify vault storage persists after sign-out
    const userBVaultAfterSignOut = await readOwnedVault(page, USER_B_ID);
    expect(userBVaultAfterSignOut).toBe(userBVaultCycle1);

    // === Cycle 2: User A signs back in ===
    await login(page, ALICE_EMAIL, ALICE_PASSWORD);

    // User A's vault should be unchanged
    const userAVaultCycle2 = await readOwnedVault(page, USER_A_ID);
    expect(userAVaultCycle2).toBe(userAVaultCycle1);

    // Navigate to vault route — should see unlock panel, not create
    await gotoStable(page, '/dashboard/addresses');
    const unlockPass = page.locator('#unlock-passphrase');
    await expect(unlockPass).toBeVisible({ timeout: 30000 });

    // Unlock User A's vault
    await unlockWithPassphrase(page, ALICE_VAULT_PASSPHRASE);

    // User A should see their own address
    const userAAddressVisible = page.locator(`text=${USER_A_ADDRESS}`);
    await expect(userAAddressVisible).toBeVisible({ timeout: 10000 });

    // User B's address should not be visible
    const userBAddressLocator = page.locator(`text=${USER_B_ADDRESS}`);
    await expect(userBAddressLocator).toHaveCount(0);

    await signOut(page);

    // === Cycle 2: User B signs back in ===
    await login(page, BOB_EMAIL, BOB_PASSWORD);

    // User B's vault should be unchanged
    const userBVaultCycle2 = await readOwnedVault(page, USER_B_ID);
    expect(userBVaultCycle2).toBe(userBVaultCycle1);

    // Navigate to vault route — should see unlock panel
    await gotoStable(page, '/dashboard/addresses');
    const unlockPassB = page.locator('#unlock-passphrase');
    await expect(unlockPassB).toBeVisible({ timeout: 30000 });

    // Unlock User B's vault
    await unlockWithPassphrase(page, BOB_VAULT_PASSPHRASE);

    // User B should see their own address
    const userBAddressVisible = page.locator(`text=${USER_B_ADDRESS}`);
    await expect(userBAddressVisible).toBeVisible({ timeout: 10000 });

    // User A's address should not be visible
    const userAAddressLocator = page.locator(`text=${USER_A_ADDRESS}`);
    await expect(userAAddressLocator).toHaveCount(0);

    await ctx.close();
  });

  test('Test 4: Remove owned vault for User A; User B vault unchanged', async ({
    browser,
  }) => {
    test.setTimeout(180000);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const serverState = setupBackend(page);

    // Test criterion 6: Removing User A's vault does not affect User B's vault

    // Step 1: Create vaults for both users
    await login(page, ALICE_EMAIL, ALICE_PASSWORD);
    await gotoStable(page, '/dashboard/addresses');
    await createAndUnlockVault(page, USER_A_ID, ALICE_VAULT_PASSPHRASE);
    await writeAddressToVault(page, USER_A_ADDRESS, ALICE_VAULT_PASSPHRASE);

    // Local list appearance is not a server push. Reconcile restores wrapping
    // first and blobs after, so a download with no addresses blob on the stub
    // would come back as the same wrapping and `data: {}`. Snapshot the local
    // record only after the stub has the blob, so restore can match it.
    await expect
      .poll(() => Boolean(serverState.blobs[USER_A_ID]?.addresses), {
        timeout: 30000,
      })
      .toBeTruthy();

    await waitForOwnedVault(page, USER_A_ID);
    const userAVaultBefore = await readOwnedVault(page, USER_A_ID);
    expect(userAVaultBefore).toBeTruthy();

    await signOut(page);

    // Create User B's vault
    await login(page, BOB_EMAIL, BOB_PASSWORD);
    await gotoStable(page, '/dashboard/addresses');
    await createAndUnlockVault(page, USER_B_ID, BOB_VAULT_PASSPHRASE);
    await writeAddressToVault(page, USER_B_ADDRESS, BOB_VAULT_PASSPHRASE);

    await waitForOwnedVault(page, USER_B_ID);
    const userBVaultBefore = await readOwnedVault(page, USER_B_ID);
    expect(userBVaultBefore).toBeTruthy();

    await signOut(page);

    // Step 2: Sign back in as User A and remove vault
    await login(page, ALICE_EMAIL, ALICE_PASSWORD);
    await gotoStable(page, '/dashboard/vault');

    // Find and click the remove vault button
    const removeButton = page.getByTestId('remove-vault-button');
    await expect(removeButton).toBeVisible({ timeout: 10000 });
    await removeButton.click();

    // Confirmation dialog should appear. RemoveVaultDialog is a ConfirmDialog,
    // which is role="alertdialog", so `dialog` queries do not match it.
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Click the confirm button in the dialog ("Remove from this device")
    const deleteButton = dialog.getByRole('button', {
      name: 'Remove from this device',
      exact: true,
    });
    await expect(deleteButton).toBeVisible();

    // RemoveVaultCard triggers window.location.reload() after removal. A
    // same-document wait cannot distinguish the pre-reload document from the
    // post-reload one; waitForReload() uses a marker and waitForFunction() to
    // ensure the navigation commits before assertions resume (issue #557, see #524).
    await waitForReload(page, () => deleteButton.click());

    // After removal and reload, reconcile runs on mount (commit 83f5495) and
    // discovers the server still holds User A's vault. It re-downloads the
    // wrapping first (`data: {}`) and then each blob. Wait for the pass to
    // finish rather than snapshotting the wrapping-only intermediate.
    // See vault-removal-offers-real-vault-back.spec.ts for the UI-level behavior
    // (unlock panel appears, not create form).
    await expect
      .poll(() => readOwnedVault(page, USER_A_ID), { timeout: 30000 })
      .toBe(userAVaultBefore);

    // Verify User B's vault is unchanged
    const userBVaultAfterARemoval = await readOwnedVault(page, USER_B_ID);
    expect(userBVaultAfterARemoval).toBe(userBVaultBefore);

    await ctx.close();
  });
});
