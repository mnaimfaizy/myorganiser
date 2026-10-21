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
 * Addresses page layout and roles (issue #1253).
 *
 * The acceptance check: no horizontal overflow, one h1 per screen, labelled
 * fields and controls with the right roles. Checked at 1440px (the empty
 * state, the add sheet, the list with one card, the detail with the Places
 * checklist and the Add place dialog) and at 390px (the empty state, the
 * list with its FAB, the detail with the Add place sheet).
 *
 * Not asserted here:
 * - the copy confirmation and its timing, or the clipboard contents;
 * - the duplicate-address warning and the place duplicate alert;
 * - the real backend: the vault and the reads the page makes on mount are
 *   stubbed, so the spec is hermetic.
 */

const EMAIL = 'addresses-layout-01@example.com';
const LOGIN_FIXTURE = 'addr-layout-01';

const IDENTITIES: IdentityEntry[] = [
  {
    match: 'addresses-layout-01',
    userId: E2E_USER_ID,
    userName: 'Addresses Layout Owner',
  },
];

// Throwaway fixture: the backend is stubbed in-process, so it guards nothing.
const VAULT_PASSPHRASE = 'addr-vault-0001';

const DESKTOP_VIEWPORT = { width: 1440, height: 1000 };

const DESKTOP_LABEL = 'Layout Home';
const PHONE_LABEL = 'Layout Flat';
const PLACE_NAME = 'ATO';

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

/** Create the owner's vault and unlock it, leaving the Addresses page rendered. */
async function createAndUnlockAddressesVault(page: Page) {
  await createOwnedVault(page, { passphrase: VAULT_PASSPHRASE });
  await unlockWithPassphrase(page, VAULT_PASSPHRASE);
}

/**
 * Phone has no Addresses tab: it sits under More. Open More from the tab bar,
 * then follow its link. Navigation is by clicking, not `gotoStable`, so the
 * vault session is not remounted after sign-in.
 */
async function openAddressesFromMore(page: Page) {
  await tabBar(page).getByRole('link', { name: 'More', exact: true }).click();
  await page.getByRole('link', { name: 'Addresses', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/addresses\/?$/);
}

/** Open the add sheet from whichever Add address control the screen shows. */
async function openAddSheet(page: Page): Promise<Locator> {
  await page
    .getByRole('button', { name: 'Add address', exact: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Add address',
    exact: true,
  });
  await expect(dialog).toBeVisible({ timeout: 30000 });
  return dialog;
}

/** Fill the add sheet and save it. The success panel replaces the form. */
async function saveAddress(dialog: Locator, label: string) {
  await dialog.getByLabel('Label', { exact: true }).fill(label);
  await dialog.getByLabel('Number', { exact: true }).fill('221B');
  await dialog.getByLabel('Street', { exact: true }).fill('Baker Street');
  await dialog.getByLabel('Suburb or city', { exact: true }).fill('London');
  await dialog.getByLabel('State', { exact: true }).fill('Greater London');
  await dialog.getByLabel('Postcode', { exact: true }).fill('NW1 6XE');
  await dialog
    .getByRole('button', { name: 'Save address', exact: true })
    .click();
  await expect(dialog.getByText('Address saved', { exact: true })).toBeVisible({
    timeout: 30000,
  });
}

/** Close the success panel with the sheet's own Close control. */
async function closeAddSheet(dialog: Locator) {
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe('Addresses layout at 1440px (E2E)', () => {
  test.use({ viewport: DESKTOP_VIEWPORT });

  test('empty page has one h1, the empty state, and no horizontal overflow', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await signIn(page);
    await gotoStable(page, '/dashboard/addresses');
    await createAndUnlockAddressesVault(page);

    await expect(
      page.getByRole('heading', {
        level: 2,
        name: 'No addresses yet',
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });
    await expectSingleH1(page, 'Addresses');
    await expect(
      page.getByRole('button', { name: 'Add address', exact: true }).first(),
    ).toBeVisible();

    await expectNoHorizontalOverflow(page, 'Addresses empty at 1440px');
  });

  test('the add sheet has labelled fields and no overflow, and a saved address is listed as one card', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await signIn(page);
    await gotoStable(page, '/dashboard/addresses');
    await createAndUnlockAddressesVault(page);

    await expect(
      page.getByRole('heading', {
        level: 2,
        name: 'No addresses yet',
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });

    const dialog = await openAddSheet(page);
    for (const name of [
      'Label',
      'Number',
      'Street',
      'Suburb or city',
      'State',
      'Postcode',
    ]) {
      await expect(dialog.getByLabel(name, { exact: true })).toBeVisible();
    }
    await expect(
      dialog.getByRole('combobox', { name: 'Country', exact: true }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, 'Add address sheet at 1440px');

    await saveAddress(dialog, DESKTOP_LABEL);
    await closeAddSheet(dialog);

    await expect(
      page.getByRole('link', { name: DESKTOP_LABEL, exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByRole('link', { name: DESKTOP_LABEL, exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: 'Copy address', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: `Actions for ${DESKTOP_LABEL}`,
        exact: true,
      }),
    ).toBeVisible();
    await expectSingleH1(page, 'Addresses');
    await expectNoHorizontalOverflow(page, 'Addresses with one card at 1440px');
  });

  test('the detail has one h1, a labelled Places checklist, and an Add place dialog that ticks a new place', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await signIn(page);
    await gotoStable(page, '/dashboard/addresses');
    await createAndUnlockAddressesVault(page);

    const dialog = await openAddSheet(page);
    await saveAddress(dialog, DESKTOP_LABEL);
    await dialog
      .getByRole('button', { name: 'Set up usage locations', exact: true })
      .click();
    await expect(page).toHaveURL(/\/dashboard\/addresses\/[^/]+$/);

    await expectSingleH1(page, DESKTOP_LABEL);
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: 'Places to update',
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByText('No places yet', { exact: true }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, 'Address detail at 1440px');

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
      'Address detail with a place at 1440px',
    );
  });
});

test.describe('Addresses layout at 390px (E2E)', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('empty list has one h1, the empty state, and no horizontal overflow', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await signIn(page);
    await openAddressesFromMore(page);
    await createAndUnlockAddressesVault(page);

    await expect(
      page.getByRole('heading', {
        name: 'No addresses yet',
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });
    await expectSingleH1(page, 'Addresses');
    await expect(
      page.getByRole('button', { name: 'Add address', exact: true }),
    ).toBeVisible();

    await expectNoHorizontalOverflow(page, 'Addresses empty at 390px');
  });

  test('a saved address is listed under a sr-only h1 with the Add address FAB', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await signIn(page);
    await openAddressesFromMore(page);
    await createAndUnlockAddressesVault(page);

    await expect(
      page.getByRole('heading', {
        name: 'No addresses yet',
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });

    const dialog = await openAddSheet(page);
    await saveAddress(dialog, PHONE_LABEL);
    await closeAddSheet(dialog);

    await expect(
      // The row link's name is the whole row (label, pill, address, progress),
      // so anchor the label rather than match it exactly.
      page.getByRole('link', { name: new RegExp(`^${PHONE_LABEL}\\b`) }),
    ).toBeVisible({
      timeout: 30000,
    });
    await expectSingleH1(page, 'Addresses');
    await expect(
      page.getByRole('button', { name: 'Add address', exact: true }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, 'Addresses list at 390px');
  });

  test('the pushed detail has one h1, and the Add place sheet opens as a dialog', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await signIn(page);
    await openAddressesFromMore(page);
    await createAndUnlockAddressesVault(page);

    const dialog = await openAddSheet(page);
    await saveAddress(dialog, PHONE_LABEL);
    await dialog
      .getByRole('button', { name: 'Set up usage locations', exact: true })
      .click();
    await expect(page).toHaveURL(/\/dashboard\/addresses\/[^/]+$/);

    await expectSingleH1(page, PHONE_LABEL);
    // The phone heading is drawn in capitals, but its text is the same.
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: 'PLACES TO UPDATE',
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });
    await expectNoHorizontalOverflow(page, 'Address detail at 390px');

    await page.getByRole('button', { name: 'Add place', exact: true }).click();
    const sheet = page.getByRole('dialog', {
      name: 'Add place',
      exact: true,
    });
    await expect(sheet).toBeVisible({ timeout: 30000 });
    await expect(
      sheet.getByLabel('Organisation', { exact: true }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, 'Add place sheet at 390px');
  });
});
