import { expect, test, type Page } from '@playwright/test';
import {
  E2E_USER_ID,
  expectNoHorizontalOverflow,
  expectSingleH1,
  gotoStable,
  type IdentityEntry,
} from './helpers';
import { stubJsonGet } from './helpers/apiStub';
import { PHONE_VIEWPORT, signInToShell, tabBar } from './helpers/shellLayout';

/**
 * Account page layout and roles (issue #1258, Web v2.0 Account redesign).
 *
 * The acceptance check: one h1 per screen, labelled sections and controls
 * with the right roles, the connected and not-connected YouTube digest, the
 * delete-account dialog and phone sheet through their first two steps, and no
 * horizontal overflow. Checked at 1440px (the full card layout) and at 390px
 * (the phone list, reached from More).
 *
 * Not asserted here:
 * - a real account deletion: the form is never submitted with valid values;
 * - the Escape Copy download, which needs an unlocked vault;
 * - the install section, which depends on the browser's install prompt;
 * - toasts and persistence of the preference and digest saves.
 *
 * Hermetic: the backend is stubbed by signInToShell. The connected tests stub
 * the YouTube status, notification settings, feedback reports and
 * /vault/backups/latest reads. Otherwise the shared sign-in backend (setupBackend)
 * answers the backups read with 404 (no backups), which the not-connected test
 * relies on. The account is not vault-gated, so no vault is created.
 */

const EMAIL = 'account-layout-01@example.com';
const LOGIN_FIXTURE = 'acct-layout-01';
const USER_NAME = 'Sam Rivera';

const IDENTITIES: IdentityEntry[] = [
  {
    match: 'account-layout-01',
    userId: E2E_USER_ID,
    userName: USER_NAME,
  },
];

const DESKTOP_VIEWPORT = { width: 1440, height: 1000 };

/**
 * Sign in as the layout owner. The shared sign-in stubs the feedback reports,
 * YouTube availability and YouTube status (not connected).
 */
async function signIn(page: Page) {
  await signInToShell(page, {
    email: EMAIL,
    loginFixture: LOGIN_FIXTURE,
    identities: IDENTITIES,
  });
}

/**
 * Override the sign-in stubs so the page shows the connected digest, the
 * Updated badge on Your reports, and a Google Drive backup two days old. Later
 * routes win over the shared stubs.
 */
async function stubConnectedAccount(page: Page) {
  await stubJsonGet(page, /\/youtube\/status\/?(\?.*)?$/, { connected: true });
  await stubJsonGet(page, /\/youtube\/notification-settings\/?(\?.*)?$/, {
    enabled: true,
    preferredWeekday: 1,
  });
  await stubJsonGet(page, /\/feedback\/reports\/?(\?.*)?$/, {
    items: [],
    hasChangedSinceLastSeen: true,
  });
  await stubJsonGet(page, /\/vault\/backups\/latest\/?(\?.*)?$/, {
    id: 'acct-layout-backup-1',
    event: 'export',
    source: 'google-drive',
    status: 'success',
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    schemaVersion: 1,
    sizeBytes: 100,
  });
}

/**
 * Phone section captions are drawn in capitals by CSS (`uppercase`), while
 * their text is title case. Match the caption case-insensitively so the check
 * does not depend on how the browser reports the transformed name.
 */
function phoneCaption(name: string): RegExp {
  return new RegExp(`^${name}$`, 'i');
}

test.describe('Account layout (E2E)', () => {
  test.describe('Account layout at 1440px (E2E)', () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test('connected account has one h1, the section headings and controls, the Updated badge, and no horizontal overflow', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await stubConnectedAccount(page);
      await gotoStable(page, '/dashboard/account');

      await expectSingleH1(page, USER_NAME);
      await expect(
        page.getByText('EMAIL VERIFIED', { exact: true }),
      ).toBeVisible({ timeout: 30000 });

      for (const heading of [
        'Preferences',
        'Weekly YouTube digest',
        'Your reports',
        'Delete account',
      ]) {
        await expect(
          page.getByRole('heading', { level: 2, name: heading, exact: true }),
        ).toBeVisible({ timeout: 30000 });
      }

      await expect(
        page.getByText('Last backup 2 days ago to Google Drive', {
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByRole('link', { name: 'Go to Vault →', exact: true }),
      ).toHaveAttribute('href', '/dashboard/vault');

      await expect(
        page.getByRole('combobox', { name: 'Country', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('combobox', { name: 'Preferred currency', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('combobox', { name: 'Send on', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('switch', {
          name: 'Email me a weekly digest',
          exact: true,
        }),
      ).toBeChecked();
      await expect(
        page.getByRole('button', { name: 'Save', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Save digest settings', exact: true }),
      ).toBeVisible();

      await expect(page.getByText('Updated', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'View your reports →', exact: true }),
      ).toHaveAttribute('href', '/dashboard/account/reports');

      await expectNoHorizontalOverflow(page, 'Account connected at 1440px');
    });

    test('the delete dialog walks two steps, requires the password and DELETE, and goes back to step one', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await stubConnectedAccount(page);
      await gotoStable(page, '/dashboard/account');
      await expectSingleH1(page, USER_NAME);

      await page.getByTestId('delete-account-button').click();
      const dialog = page.getByTestId('delete-account-dialog');
      await expect(dialog).toBeVisible({ timeout: 30000 });
      await expect(
        dialog.getByRole('heading', { name: 'Delete account', exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByText('Step 1 of 2', { exact: true }),
      ).toBeVisible();
      await expect(dialog.getByTestId('escape-copy-button')).toBeVisible();

      const continueButton = dialog.getByTestId('delete-account-continue');
      await expect(continueButton).toHaveText('Continue without a copy');
      await continueButton.click();

      await expect(
        dialog.getByText('Step 2 of 2', { exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('heading', {
          name: 'Confirm account deletion',
          exact: true,
        }),
      ).toBeVisible();
      // The password field is type=password, which has no textbox role, so it
      // is found by its label.
      await expect(
        dialog.getByLabel('Account password', { exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('textbox', {
          name: 'Type DELETE to confirm',
          exact: true,
        }),
      ).toBeVisible();

      // Submit with both fields empty: validation blocks the request, so no
      // deletion is sent.
      await dialog
        .getByRole('button', { name: 'Delete my account', exact: true })
        .click();
      await expect(
        dialog.getByText('Enter your password.', { exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByText('Type DELETE to confirm.', { exact: true }),
      ).toBeVisible();

      await dialog.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(
        dialog.getByText('Step 1 of 2', { exact: true }),
      ).toBeVisible();
      await expect(dialog.getByTestId('delete-account-continue')).toBeVisible();

      await expectNoHorizontalOverflow(page, 'Delete account dialog at 1440px');
    });

    test('a not-connected account shows no Weekly YouTube digest section', async ({
      page,
    }) => {
      test.setTimeout(120000);

      // The shared sign-in stubs YouTube status as not connected.
      await signIn(page);
      const statusRead = page.waitForResponse(
        (r) =>
          /\/youtube\/status\/?(\?.*)?$/.test(r.url()) &&
          r.request().method() === 'GET',
      );
      await gotoStable(page, '/dashboard/account');
      await statusRead;
      await expectSingleH1(page, USER_NAME);

      await expect(
        page.getByRole('heading', {
          level: 2,
          name: 'Delete account',
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByRole('heading', {
          level: 2,
          name: 'Weekly YouTube digest',
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('switch', {
          name: 'Email me a weekly digest',
          exact: true,
        }),
      ).toHaveCount(0);
    });
  });

  test.describe('Account layout at 390px (E2E)', () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test('connected account on phone has one h1, the phone captions and controls, the tab bar, and no horizontal overflow', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await stubConnectedAccount(page);
      await openAccountFromMore(page);

      await expectSingleH1(page, USER_NAME);

      for (const caption of [
        'Preferences',
        'Weekly YouTube digest',
        'Feedback',
        'Delete account',
      ]) {
        await expect(
          page.getByRole('heading', {
            level: 2,
            name: phoneCaption(caption),
          }),
        ).toBeVisible({ timeout: 30000 });
      }

      await expect(
        page.getByRole('combobox', { name: 'Country', exact: true }),
      ).toContainText('Australia (AU)');
      await expect(
        page.getByRole('combobox', { name: 'Preferred currency', exact: true }),
      ).toContainText('AUD');
      await expect(
        page.getByRole('combobox', { name: 'Send on', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('switch', {
          name: 'Email me a weekly digest',
          exact: true,
        }),
      ).toBeChecked();

      const reports = page.getByRole('link', { name: /^Your reports/ });
      await expect(reports).toHaveAttribute(
        'href',
        '/dashboard/account/reports',
      );

      await expect(tabBar(page)).toBeVisible();
      await expect(
        tabBar(page).getByRole('link', { name: 'More', exact: true }),
      ).toHaveAttribute('aria-current', 'page');

      await expectNoHorizontalOverflow(page, 'Account connected at 390px');
    });

    test('the delete sheet opens at step one, walks to labelled fields on step two, and does not overflow', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await stubConnectedAccount(page);
      await openAccountFromMore(page);

      await page.getByTestId('delete-account-button').click();
      const sheet = page.getByTestId('delete-account-dialog');
      await expect(sheet).toBeVisible({ timeout: 30000 });
      await expect(
        sheet.getByText('Step 1 of 2', { exact: true }),
      ).toBeVisible();

      await sheet.getByTestId('delete-account-continue').click();
      await expect(
        sheet.getByText('Step 2 of 2', { exact: true }),
      ).toBeVisible();
      await expect(
        sheet.getByLabel('Account password', { exact: true }),
      ).toBeVisible();
      await expect(
        sheet.getByRole('textbox', {
          name: 'Type DELETE to confirm',
          exact: true,
        }),
      ).toBeVisible();

      await expectNoHorizontalOverflow(page, 'Delete account sheet at 390px');
    });
  });
});

/**
 * Phone has no Account tab: it sits under More. Open More from the tab bar,
 * then follow its Account link. Navigation is by clicking, not `gotoStable`,
 * so the vault session is not remounted after sign-in.
 */
async function openAccountFromMore(page: Page): Promise<void> {
  await tabBar(page).getByRole('link', { name: 'More', exact: true }).click();
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/account\/?$/);
}
