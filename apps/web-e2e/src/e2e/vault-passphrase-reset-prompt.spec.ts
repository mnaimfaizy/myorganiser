import { expect, test, type Page } from '@playwright/test';
import {
  createOwnedVault,
  createOwnedVaultWithRecoveryKey,
  gotoStable,
  login,
  PBKDF2_BUDGET_MS,
  setupBackend,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  type IdentityEntry,
} from './helpers';

/**
 * Passphrase Reset Prompt end-to-end (ADR 0095).
 *
 * Recovery-key unlock owes a one-time prompt to set or skip a new passphrase.
 * Passphrase unlock must not show it. Component tests live in Jest; this spec
 * is the browser tracer for the prompt, skip, and vault-card recovery mode.
 */

const SKIP_LABEL =
  'Skip for now. The forgotten passphrase stays the live one on every device.';

const PROMPT_DIALOG_NAME = 'Set a passphrase you know';

async function assertPassphraseResetPrompt(page: Page) {
  const dialog = page.getByRole('dialog', { name: PROMPT_DIALOG_NAME });
  await expect(dialog).toBeVisible({ timeout: PBKDF2_BUDGET_MS });

  await expect(
    dialog.getByLabel('New passphrase', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel('Confirm new passphrase', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel('Current passphrase', { exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Close' })).toHaveCount(0);
}

async function assertRecoveryModeChangePassphraseCard(page: Page) {
  // The card's opener is the entry point; its form lives in a dialog. The
  // dialog title and submit label ('Set new passphrase') are the recovery-mode
  // signal, and there is no 'Current passphrase' field in that mode.
  await expect(page.getByTestId('change-passphrase-open')).toBeEnabled({
    timeout: PBKDF2_BUDGET_MS,
  });
  await page.getByTestId('change-passphrase-open').click();

  const dialog = page.getByRole('dialog', { name: 'Set new passphrase' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByLabel('Current passphrase', { exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByTestId('change-passphrase-submit')).toHaveText(
    'Set new passphrase',
  );

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe('Passphrase Reset Prompt (E2E)', () => {
  test('recovery-key unlock → set new passphrase → vault card stays in recovery mode', async ({
    page,
  }) => {
    test.setTimeout(180000);

    const EMAIL = 'reset-prompt-set-01@example.com';
    const LOGIN_FIXTURE = 'resetprompt-set-e2e';
    const USER_ID = 'reset-prompt-set-1';
    const VAULT_FIXTURE = 'create-fixture-set';
    const NEW_FIXTURE = 'reset-phrase-01';

    const IDENTITIES: IdentityEntry[] = [
      {
        match: 'reset-prompt-set-01',
        userId: USER_ID,
        userName: 'Reset Prompt Set Owner',
      },
    ];

    setupBackend(page, IDENTITIES);
    await login(page, EMAIL, LOGIN_FIXTURE);
    await gotoStable(page, '/dashboard/addresses');

    const recoveryKey = await createOwnedVaultWithRecoveryKey(page, {
      passphrase: VAULT_FIXTURE,
      owner: USER_ID,
    });

    await unlockWithRecoveryKey(page, recoveryKey);

    await expect(page.getByText('Recovered', { exact: true })).toBeVisible({
      timeout: PBKDF2_BUDGET_MS,
    });

    await assertPassphraseResetPrompt(page);

    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: PROMPT_DIALOG_NAME }),
    ).toBeVisible();

    const dialog = page.getByRole('dialog', { name: PROMPT_DIALOG_NAME });
    await dialog
      .getByLabel('New passphrase', { exact: true })
      .fill(NEW_FIXTURE);
    await dialog
      .getByLabel('Confirm new passphrase', { exact: true })
      .fill(NEW_FIXTURE);
    await dialog.getByRole('button', { name: 'Set new passphrase' }).click();

    await expect(
      page.getByText('Passphrase changed', { exact: true }),
    ).toBeVisible({
      timeout: PBKDF2_BUDGET_MS,
    });
    await expect(
      page.getByRole('dialog', { name: PROMPT_DIALOG_NAME }),
    ).toHaveCount(0);

    await page.getByRole('link', { name: 'Vault', exact: true }).click();

    await expect(
      page.getByRole('dialog', { name: PROMPT_DIALOG_NAME }),
    ).toHaveCount(0);
    await assertRecoveryModeChangePassphraseCard(page);
  });

  test('recovery-key unlock → skip → reload → recovery unlock → prompt returns', async ({
    page,
  }) => {
    test.setTimeout(180000);

    const EMAIL = 'reset-prompt-skip-01@example.com';
    const LOGIN_FIXTURE = 'resetprompt-skip-e2e';
    const USER_ID = 'reset-prompt-skip-1';
    const VAULT_FIXTURE = 'create-fixture-skip';

    const IDENTITIES: IdentityEntry[] = [
      {
        match: 'reset-prompt-skip-01',
        userId: USER_ID,
        userName: 'Reset Prompt Skip Owner',
      },
    ];

    setupBackend(page, IDENTITIES);
    await login(page, EMAIL, LOGIN_FIXTURE);
    await gotoStable(page, '/dashboard/addresses');

    const recoveryKey = await createOwnedVaultWithRecoveryKey(page, {
      passphrase: VAULT_FIXTURE,
      owner: USER_ID,
    });

    await unlockWithRecoveryKey(page, recoveryKey);

    await expect(page.getByText('Recovered', { exact: true })).toBeVisible({
      timeout: PBKDF2_BUDGET_MS,
    });

    await assertPassphraseResetPrompt(page);

    await page.getByRole('button', { name: SKIP_LABEL }).click();

    await expect(
      page.getByRole('dialog', { name: PROMPT_DIALOG_NAME }),
    ).toHaveCount(0);

    await page.getByRole('link', { name: 'Vault', exact: true }).click();

    await expect(
      page.getByRole('dialog', { name: PROMPT_DIALOG_NAME }),
    ).toHaveCount(0);
    await assertRecoveryModeChangePassphraseCard(page);

    await page.reload();
    // Reload keeps the vault URL. That page's locked card is passphrase-only
    // ("Unlock"); recovery unlock is the gate on a gated route.
    await gotoStable(page, '/dashboard/addresses');

    await expect(
      page.getByRole('button', { name: 'Use passphrase' }),
    ).toBeVisible({
      timeout: PBKDF2_BUDGET_MS,
    });

    await unlockWithRecoveryKey(page, recoveryKey);

    await expect(page.getByText('Recovered', { exact: true })).toBeVisible({
      timeout: PBKDF2_BUDGET_MS,
    });

    await assertPassphraseResetPrompt(page);
  });

  test('passphrase unlock does not show the reset prompt', async ({ page }) => {
    test.setTimeout(180000);

    const EMAIL = 'reset-prompt-none-01@example.com';
    const LOGIN_FIXTURE = 'resetprompt-none-e2e';
    const USER_ID = 'reset-prompt-none-1';
    const VAULT_FIXTURE = 'create-fixture-none';

    const IDENTITIES: IdentityEntry[] = [
      {
        match: 'reset-prompt-none-01',
        userId: USER_ID,
        userName: 'Reset Prompt None Owner',
      },
    ];

    setupBackend(page, IDENTITIES);
    await login(page, EMAIL, LOGIN_FIXTURE);
    await gotoStable(page, '/dashboard/addresses');

    await createOwnedVault(page, {
      passphrase: VAULT_FIXTURE,
      owner: USER_ID,
    });
    await unlockWithPassphrase(page, VAULT_FIXTURE);

    await expect(
      page.getByRole('dialog', { name: PROMPT_DIALOG_NAME }),
    ).toHaveCount(0);
  });
});
