import { Page, expect } from '@playwright/test';

import { PBKDF2_BUDGET_MS } from './vaultGate';

/**
 * Unlock the vault on the Vault Settings page via `VaultUnlockCard`.
 *
 * This differs from `unlockWithPassphrase` (which operates on the VaultGate panel)
 * because the Vault Settings page uses different selectors: 'Passphrase' label
 * instead of '#unlock-passphrase' input and 'vault-unlock-submit' test ID instead
 * of the Unlock button role. The unlock landing signal is the same: the passphrase
 * input disappearing after submission, not the click resolving. PBKDF2 is slow by
 * design, especially on WebKit.
 */
export async function unlockVaultOnSettingsPage(
  page: Page,
  passphrase: string,
): Promise<void> {
  const vaultUnlockPassphrase = page.getByLabel('Passphrase', {
    exact: true,
  });
  await expect(vaultUnlockPassphrase).toBeVisible({
    timeout: PBKDF2_BUDGET_MS,
  });
  await vaultUnlockPassphrase.fill(passphrase);

  const vaultUnlockSubmit = page.getByTestId('vault-unlock-submit');
  await expect(vaultUnlockSubmit).toBeVisible();
  await vaultUnlockSubmit.click();

  // The passphrase input disappearing is the unlock landing signal — not the
  // click resolving. PBKDF2 is slow by design, and slower again on WebKit.
  await expect(vaultUnlockPassphrase).toHaveCount(0, {
    timeout: PBKDF2_BUDGET_MS,
  });
}

/**
 * Change the vault passphrase on the Vault Settings page via `ChangePassphraseCard`.
 *
 * The card's form lives in a Radix dialog ('Change passphrase'), so this helper
 * first opens it with `change-passphrase-open`. That opener is disabled while
 * the vault is locked, so the helper waits for it to be enabled (PBKDF2 budget)
 * before clicking. It then fills the three passphrase inputs ('Current
 * passphrase', 'New passphrase', 'Confirm new passphrase') inside the dialog,
 * waits for the submit to be enabled, clicks it, waits for the 'Passphrase
 * changed' success toast, and waits for the dialog to close.
 * Use `exact: true` on label selectors to avoid matching similar labels
 * (e.g., 'New passphrase' vs 'Confirm new passphrase').
 */
export async function changePassphrase(
  page: Page,
  { current, next }: { current: string; next: string },
): Promise<void> {
  const open = page.getByTestId('change-passphrase-open');
  await expect(open).toBeEnabled({ timeout: PBKDF2_BUDGET_MS });
  await open.click();

  const dialog = page.getByRole('dialog', { name: 'Change passphrase' });
  await expect(dialog).toBeVisible();

  // Without `exact`, 'New passphrase' would also match 'Confirm new passphrase'.
  const currentPassphrase = dialog.getByLabel('Current passphrase', {
    exact: true,
  });
  const newPassphrase = dialog.getByLabel('New passphrase', { exact: true });
  const confirmPassphrase = dialog.getByLabel('Confirm new passphrase', {
    exact: true,
  });
  const changeSubmit = dialog.getByTestId('change-passphrase-submit');

  await expect(currentPassphrase).toBeVisible({ timeout: PBKDF2_BUDGET_MS });
  await expect(newPassphrase).toBeVisible({ timeout: PBKDF2_BUDGET_MS });
  await expect(confirmPassphrase).toBeVisible({ timeout: PBKDF2_BUDGET_MS });
  await expect(changeSubmit).toBeVisible({ timeout: PBKDF2_BUDGET_MS });

  await currentPassphrase.fill(current);
  await newPassphrase.fill(next);
  await confirmPassphrase.fill(next);

  // The submit is disabled while the form is changing or the vault is locked
  // (`PassphraseChange` is `needsMasterKey: true`). Asserting enabled before
  // the click names that state directly instead of letting `click()` auto-wait
  // and report a generic actionability timeout.
  await expect(changeSubmit).toBeEnabled({ timeout: PBKDF2_BUDGET_MS });
  await changeSubmit.click();

  // Wait for the success toast to confirm the passphrase change landed, then
  // for the dialog to close (the form unmounts on done).
  await expect(
    page.getByText('Passphrase changed', { exact: true }),
  ).toBeVisible({ timeout: PBKDF2_BUDGET_MS });
  await expect(dialog).toHaveCount(0, { timeout: PBKDF2_BUDGET_MS });
}
