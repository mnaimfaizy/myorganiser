import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  createOwnedVault,
  E2E_USER_ID,
  expectNoHorizontalOverflow,
  expectSingleH1,
  gotoStable,
  unlockWithPassphrase,
  type IdentityEntry,
} from './helpers';
import { PHONE_VIEWPORT, signInToShell, tabBar } from './helpers/shellLayout';

/**
 * Mobile numbers page layout and roles (issue #1254).
 *
 * The acceptance check: no horizontal overflow, one h1 per screen, labelled
 * fields and controls with the right roles. Checked at 1440px (the empty
 * state, the add dialog, the list with one row, the detail with the Places
 * checklist and the Add place dialog) and at 390px (the empty state, the
 * list with its FAB, the detail with the Add place sheet).
 *
 * Not asserted here:
 * - the copy confirmation and its timing, or the clipboard contents;
 * - the duplicate-place warning;
 * - the real backend: the vault and the reads the page makes on mount are
 *   stubbed, so the spec is hermetic.
 */

const EMAIL = 'mobile-numbers-layout-01@example.com';
const LOGIN_FIXTURE = 'mob-layout-01';

const IDENTITIES: IdentityEntry[] = [
  {
    match: 'mobile-numbers-layout-01',
    userId: E2E_USER_ID,
    userName: 'Mobile Numbers Layout Owner',
  },
];

// Throwaway fixture: the backend is stubbed in-process, so it guards nothing.
const VAULT_PASSPHRASE = 'mob-vault-0001';

const DESKTOP_VIEWPORT = { width: 1440, height: 1000 };

const DESKTOP_LABEL = 'Layout Personal';
const PHONE_LABEL = 'Layout Mobile';
const PLACE_NAME = 'Telstra';
const PHONE_NUMBER = '412 345 678';

/**
 * Sign in as the layout owner and land on the dashboard. The shared sign-in
 * stubs the mount-time reads and leaves the vault on the server absent.
 */
async function signIn(page: Page) {
  await signInToShell(page, {
    email: EMAIL,
    loginFixture: LOGIN_FIXTURE,
    identities: IDENTITIES,
  });
}

/** Create the owner's vault and unlock it, leaving the Mobile numbers page rendered. */
async function createAndUnlockVault(page: Page) {
  await createOwnedVault(page, { passphrase: VAULT_PASSPHRASE });
  await unlockWithPassphrase(page, VAULT_PASSPHRASE);
}

/**
 * Phone has no Mobile numbers tab: it sits under More. Open More from the tab
 * bar, then follow its link. Navigation is by clicking, not `gotoStable`, so
 * the vault session is not remounted after sign-in.
 */
async function openMobileNumbersFromMore(page: Page) {
  await tabBar(page).getByRole('link', { name: 'More', exact: true }).click();
  await page.getByRole('link', { name: 'Mobile numbers', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/mobile-numbers\/?$/);
}

/** Open the add dialog from whichever Add mobile number control the screen shows. */
async function openAddDialog(page: Page): Promise<Locator> {
  await page
    .getByRole('button', { name: 'Add mobile number', exact: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Add mobile number',
    exact: true,
  });
  await expect(dialog).toBeVisible({ timeout: 30000 });
  return dialog;
}

/**
 * Fill the add dialog and save it. The dialog closes on success. The country
 * code keeps its default (+1), so only the label and the number are typed.
 */
async function saveMobileNumber(dialog: Locator, label: string) {
  await dialog.getByLabel('Label', { exact: true }).fill(label);
  await dialog.getByLabel('Phone Number', { exact: true }).fill(PHONE_NUMBER);
  const submit = dialog.getByRole('button', {
    name: 'Add mobile number',
    exact: true,
  });
  await expect(submit).toBeEnabled({ timeout: 30000 });
  await submit.click();
  await expect(dialog).toHaveCount(0, { timeout: 30000 });
}

test.describe('Mobile numbers layout (E2E)', () => {
  test.describe('Mobile numbers layout at 1440px (E2E)', () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test('empty page has one h1, the empty state, and no horizontal overflow', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await gotoStable(page, '/dashboard/mobile-numbers');
      await createAndUnlockVault(page);

      await expect(
        page.getByRole('heading', {
          level: 2,
          name: 'No mobile numbers yet',
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });
      await expectSingleH1(page, 'Mobile numbers');
      await expect(
        page
          .getByRole('button', { name: 'Add mobile number', exact: true })
          .first(),
      ).toBeVisible();

      await expectNoHorizontalOverflow(page, 'Mobile numbers empty at 1440px');
    });

    test('the add dialog has labelled fields and no overflow, and a saved number is listed as one row', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await gotoStable(page, '/dashboard/mobile-numbers');
      await createAndUnlockVault(page);

      await expect(
        page.getByRole('heading', {
          level: 2,
          name: 'No mobile numbers yet',
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });

      const dialog = await openAddDialog(page);
      await expect(dialog.getByLabel('Label', { exact: true })).toBeVisible();
      await expect(
        dialog.getByRole('combobox', { name: 'Country Code', exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByLabel('Phone Number', { exact: true }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(
        page,
        'Add mobile number dialog at 1440px',
      );

      await saveMobileNumber(dialog, DESKTOP_LABEL);

      await expect(
        page.getByRole('link', { name: DESKTOP_LABEL, exact: true }),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByRole('link', { name: DESKTOP_LABEL, exact: true }),
      ).toHaveCount(1);
      await expect(
        page.getByRole('button', {
          name: `Copy ${DESKTOP_LABEL} number`,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', {
          name: `Call ${DESKTOP_LABEL}`,
          exact: true,
        }),
      ).toHaveAttribute('href', /^tel:/);
      await expect(
        page.getByRole('link', {
          name: `Open ${DESKTOP_LABEL}`,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', {
          name: `Delete ${DESKTOP_LABEL}`,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('textbox', {
          name: 'Filter mobile numbers',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('region', { name: 'Mobile numbers', exact: true }),
      ).toBeVisible();
      await expectSingleH1(page, 'Mobile numbers');
      await expectNoHorizontalOverflow(
        page,
        'Mobile numbers with one row at 1440px',
      );
    });

    test('the detail has one h1, a labelled Places checklist, and an Add place dialog that ticks a new place', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await gotoStable(page, '/dashboard/mobile-numbers');
      await createAndUnlockVault(page);

      const dialog = await openAddDialog(page);
      await saveMobileNumber(dialog, DESKTOP_LABEL);

      await page
        .getByRole('link', { name: DESKTOP_LABEL, exact: true })
        .click();
      await expect(page).toHaveURL(/\/dashboard\/mobile-numbers\/[^/]+$/);

      await expectSingleH1(page, DESKTOP_LABEL);
      await expect(
        page.getByRole('button', { name: /^Copy number / }),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByRole('link', { name: 'Call', exact: true }),
      ).toHaveAttribute('href', /^tel:/);
      await expect(
        page.getByRole('link', { name: 'Message', exact: true }),
      ).toHaveAttribute('href', /^sms:/);
      await expect(
        page.getByRole('button', { name: 'Edit', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', {
          level: 2,
          name: 'Places to update',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText('No places yet', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', {
          level: 2,
          name: 'Delete this number',
          exact: true,
        }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page, 'Mobile number detail at 1440px');

      await page
        .getByRole('button', { name: 'Add place', exact: true })
        .first()
        .click();
      const placeDialog = page.getByRole('dialog', {
        name: 'Add place',
        exact: true,
      });
      await expect(placeDialog).toBeVisible({ timeout: 30000 });
      await placeDialog
        .getByLabel('Organisation', { exact: true })
        .fill(PLACE_NAME);
      const submit = placeDialog.getByRole('button', {
        name: 'Add place',
        exact: true,
      });
      await expect(submit).toBeEnabled({ timeout: 30000 });
      await submit.click();
      await expect(placeDialog).toHaveCount(0);

      await expect(
        page.getByRole('checkbox', {
          name: `Updated at ${PLACE_NAME}`,
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByRole('progressbar', { name: 'Places updated', exact: true }),
      ).toBeVisible();
      await expectSingleH1(page, DESKTOP_LABEL);
      await expectNoHorizontalOverflow(
        page,
        'Mobile number detail with a place at 1440px',
      );
    });
  });

  test.describe('Mobile numbers layout at 390px (E2E)', () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test('empty list has one h1, the empty state, and no horizontal overflow', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await openMobileNumbersFromMore(page);
      await createAndUnlockVault(page);

      await expect(
        page.getByRole('heading', {
          name: 'No mobile numbers yet',
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });
      await expectSingleH1(page, 'Mobile numbers');
      await expect(
        page.getByRole('button', { name: 'Add mobile number', exact: true }),
      ).toBeVisible();

      await expectNoHorizontalOverflow(page, 'Mobile numbers empty at 390px');
    });

    test('a saved number is listed under a sr-only h1 with the Add mobile number FAB', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await openMobileNumbersFromMore(page);
      await createAndUnlockVault(page);

      await expect(
        page.getByRole('heading', {
          name: 'No mobile numbers yet',
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });

      const dialog = await openAddDialog(page);
      await saveMobileNumber(dialog, PHONE_LABEL);

      await expect(
        // The row link's name is the whole row (label and number), so anchor
        // the label rather than match it exactly.
        page.getByRole('link', { name: new RegExp(`^${PHONE_LABEL}\\b`) }),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByRole('button', {
          name: `Copy ${PHONE_LABEL} number`,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: `Call ${PHONE_LABEL}`, exact: true }),
      ).toHaveAttribute('href', /^tel:/);
      await expectSingleH1(page, 'Mobile numbers');
      await expect(
        page.getByRole('button', { name: 'Add mobile number', exact: true }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page, 'Mobile numbers list at 390px');
    });

    test('the pushed detail has one h1, and the Add place sheet opens as a dialog', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await openMobileNumbersFromMore(page);
      await createAndUnlockVault(page);

      const dialog = await openAddDialog(page);
      await saveMobileNumber(dialog, PHONE_LABEL);

      await page
        .getByRole('link', { name: new RegExp(`^${PHONE_LABEL}\\b`) })
        .click();
      await expect(page).toHaveURL(/\/dashboard\/mobile-numbers\/[^/]+$/);

      await expectSingleH1(page, PHONE_LABEL);
      await expect(
        page.getByRole('button', { name: /^Copy number / }),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByRole('link', { name: 'Call', exact: true }),
      ).toHaveAttribute('href', /^tel:/);
      await expect(
        page.getByRole('link', { name: 'Message', exact: true }),
      ).toHaveAttribute('href', /^sms:/);
      // The phone heading is drawn in capitals, but its text is the same.
      await expect(
        page.getByRole('heading', {
          level: 2,
          name: 'PLACES TO UPDATE',
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByRole('button', { name: 'Delete…', exact: true }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page, 'Mobile number detail at 390px');

      await page
        .getByRole('button', { name: 'Add place', exact: true })
        .click();
      const sheet = page.getByRole('dialog', {
        name: 'Add place',
        exact: true,
      });
      await expect(sheet).toBeVisible({ timeout: 30000 });
      await expect(
        sheet.getByLabel('Organisation', { exact: true }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(
        page,
        'Add place sheet at 390px for a mobile number',
      );
    });
  });
});
