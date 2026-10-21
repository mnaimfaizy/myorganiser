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
 * Subscriptions page layout and roles (issue #1255).
 *
 * The acceptance check: no horizontal overflow at 390px, one h1 per page, and
 * labelled controls with the right roles. Checked at 1440px (desktop board
 * with the add dialog, the list, and the detail panel) and at 390px (phone
 * list, the add sheet, and the pushed detail screen).
 *
 * Not asserted here:
 * - currency conversion, which calls the FX endpoint only on an explicit
 *   "Show all in" press;
 * - toast timing and the Saved/Deleted copy;
 * - the locked vault gate at 390px, which overflows and is owned by #1257;
 * - the real backend: the vault and the reads the page makes on mount are
 *   stubbed, so the spec is hermetic.
 */

const EMAIL = 'subscriptions-layout-01@example.com';
const LOGIN_FIXTURE = 'subs-layout-01';

const IDENTITIES: IdentityEntry[] = [
  {
    match: 'subscriptions-layout-01',
    userId: E2E_USER_ID,
    userName: 'Subscriptions Layout Owner',
  },
];

// Throwaway fixture: the backend is stubbed in-process, so it guards nothing.
const VAULT_PASSPHRASE = 'subs-vault-0001';

const DESKTOP_VIEWPORT = { width: 1440, height: 1000 };

const DESKTOP_NAME = 'Layout Streamer';
const PHONE_NAME = 'Layout Phone Plan';

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

/** Create the owner's vault and unlock it, leaving the Subscriptions page rendered. */
async function createAndUnlockSubscriptionsVault(page: Page) {
  await createOwnedVault(page, { passphrase: VAULT_PASSPHRASE });
  await unlockWithPassphrase(page, VAULT_PASSPHRASE);
}

/**
 * Phone has no Subscriptions tab: it sits under More. Open More from the tab
 * bar, then follow its link. Navigation is by clicking, not `gotoStable`, so
 * the vault session is not remounted after sign-in.
 */
async function openSubscriptionsFromMore(page: Page) {
  await tabBar(page).getByRole('link', { name: 'More', exact: true }).click();
  await page.getByRole('link', { name: 'Subscriptions', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/subscriptions\/?$/);
}

/** Fill the fields the add and edit forms share on both surfaces. */
async function fillNameAndAmount(scope: Locator, name: string) {
  await scope.getByLabel('Name', { exact: true }).fill(name);
  await scope.getByLabel('Amount', { exact: true }).fill('12.50');
}

/** Desktop: open the add dialog from the header, save a named subscription. */
async function addDesktopSubscription(page: Page, name: string) {
  await page
    .getByRole('button', { name: 'Add subscription', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Add subscription',
    exact: true,
  });
  await expect(dialog).toBeVisible({ timeout: 30000 });
  await fillNameAndAmount(dialog, name);
  await dialog
    .getByRole('button', { name: 'Add subscription', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}

/**
 * Phone: tap the one "Add subscription" control (the empty-state button, or
 * the FAB once the list has rows), then save through the "New subscription"
 * sheet.
 */
async function addPhoneSubscription(page: Page, name: string) {
  await page
    .getByRole('button', { name: 'Add subscription', exact: true })
    .click();
  const sheet = page.getByRole('dialog', {
    name: 'New subscription',
    exact: true,
  });
  await expect(sheet).toBeVisible({ timeout: 30000 });
  await fillNameAndAmount(sheet, name);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

test.describe('Subscriptions layout (E2E)', () => {
  test.describe('Subscriptions layout at 1440px (E2E)', () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test('empty page has one h1, the empty state, and no horizontal overflow', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await gotoStable(page, '/dashboard/subscriptions');
      await createAndUnlockSubscriptionsVault(page);

      await expect(
        page.getByRole('heading', {
          level: 2,
          name: 'No subscriptions yet',
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });
      await expectSingleH1(page, 'Subscriptions');

      await expect(
        page.getByRole('button', { name: 'Add subscription', exact: true }),
      ).toBeVisible();

      await expectNoHorizontalOverflow(page, 'Subscriptions empty at 1440px');
    });

    test('adding a subscription validates the name, lists it, and opens the detail panel', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await gotoStable(page, '/dashboard/subscriptions');
      await createAndUnlockSubscriptionsVault(page);

      await expect(
        page.getByRole('heading', {
          level: 2,
          name: 'No subscriptions yet',
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });

      await page
        .getByRole('button', { name: 'Add subscription', exact: true })
        .click();
      const dialog = page.getByRole('dialog', {
        name: 'Add subscription',
        exact: true,
      });
      await expect(dialog).toBeVisible({ timeout: 30000 });
      await expect(dialog.getByLabel('Name', { exact: true })).toBeVisible();
      await expect(dialog.getByLabel('Amount', { exact: true })).toBeVisible();

      // An empty name is refused inline, and the dialog stays open.
      await dialog
        .getByRole('button', { name: 'Add subscription', exact: true })
        .click();
      await expect(
        dialog.getByText('Name is required', { exact: true }),
      ).toBeVisible();
      await expect(dialog).toBeVisible();

      await fillNameAndAmount(dialog, DESKTOP_NAME);
      await dialog
        .getByRole('button', { name: 'Add subscription', exact: true })
        .click();
      await expect(dialog).toHaveCount(0);

      const totals = page.getByRole('region', { name: 'Totals', exact: true });
      await expect(totals).toContainText(/each month \(active\)/i, {
        timeout: 30000,
      });

      const activeList = page.getByRole('region', {
        name: 'Active subscriptions',
        exact: true,
      });
      const row = activeList.getByRole('button', { name: DESKTOP_NAME });
      await expect(row).toBeVisible();

      const statusGroup = page.getByRole('group', {
        name: 'Status',
        exact: true,
      });
      await expect(
        statusGroup.getByRole('button', { name: 'Active · 1', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');

      await expect(
        page.getByRole('combobox', { name: 'Sort', exact: true }),
      ).toBeVisible();

      await expectSingleH1(page, 'Subscriptions');

      await row.click();

      const detail = page.getByRole('complementary', {
        name: 'Subscription detail',
        exact: true,
      });
      await expect(detail).toBeVisible();
      await expect(
        detail.getByRole('heading', {
          level: 2,
          name: DESKTOP_NAME,
          exact: true,
        }),
      ).toBeVisible();
      for (const name of [
        'Edit',
        'Mark cancelled',
        'Delete…',
        'Close detail',
      ]) {
        await expect(
          detail.getByRole('button', { name, exact: true }),
        ).toBeVisible();
      }

      await expectSingleH1(page, 'Subscriptions');
      await expectNoHorizontalOverflow(
        page,
        'Subscriptions with detail at 1440px',
      );
    });

    test('editing from the panel prefills the form, and delete returns to the empty state', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await gotoStable(page, '/dashboard/subscriptions');
      await createAndUnlockSubscriptionsVault(page);

      await expect(
        page.getByRole('heading', {
          level: 2,
          name: 'No subscriptions yet',
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });

      await addDesktopSubscription(page, DESKTOP_NAME);

      await page
        .getByRole('region', { name: 'Active subscriptions', exact: true })
        .getByRole('button', { name: DESKTOP_NAME })
        .click();

      const detail = page.getByRole('complementary', {
        name: 'Subscription detail',
        exact: true,
      });
      await expect(detail).toBeVisible();

      await detail.getByRole('button', { name: 'Edit', exact: true }).click();
      const editDialog = page.getByRole('dialog', {
        name: 'Edit subscription',
        exact: true,
      });
      await expect(editDialog).toBeVisible({ timeout: 30000 });
      await expect(editDialog.getByLabel('Name', { exact: true })).toHaveValue(
        DESKTOP_NAME,
      );

      await editDialog
        .getByRole('button', { name: 'Cancel', exact: true })
        .click();
      await expect(editDialog).toHaveCount(0);

      await detail
        .getByRole('button', { name: 'Delete…', exact: true })
        .click();
      const confirm = page.getByRole('alertdialog', {
        name: `Delete "${DESKTOP_NAME}"?`,
        exact: true,
      });
      await expect(confirm).toBeVisible({ timeout: 30000 });
      await confirm
        .getByRole('button', { name: 'Delete subscription', exact: true })
        .click();
      await expect(confirm).toHaveCount(0);

      await expect(
        page.getByRole('heading', {
          level: 2,
          name: 'No subscriptions yet',
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });
      await expectSingleH1(page, 'Subscriptions');
    });
  });

  test.describe('Subscriptions layout at 390px (E2E)', () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test('empty list has one h1, the empty state, and no horizontal overflow', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await openSubscriptionsFromMore(page);
      await createAndUnlockSubscriptionsVault(page);

      await expect(
        page.getByRole('heading', {
          level: 2,
          name: 'No subscriptions yet',
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });
      await expectSingleH1(page, 'Subscriptions');
      await expect(
        page.getByRole('button', { name: 'Add subscription', exact: true }),
      ).toBeVisible();

      await expectNoHorizontalOverflow(page, 'Subscriptions empty at 390px');
    });

    test('a subscription added from the sheet is listed with a status segmented control and a FAB', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await openSubscriptionsFromMore(page);
      await createAndUnlockSubscriptionsVault(page);

      await expect(
        page.getByRole('heading', {
          level: 2,
          name: 'No subscriptions yet',
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });

      await addPhoneSubscription(page, PHONE_NAME);

      await expect(
        page
          .getByRole('region', { name: 'Active subscriptions', exact: true })
          .getByRole('link', { name: PHONE_NAME }),
      ).toBeVisible({ timeout: 30000 });

      const statusGroup = page.getByRole('group', {
        name: 'Status',
        exact: true,
      });
      await expect(
        statusGroup.getByRole('radio', { name: 'Active · 1', exact: true }),
      ).toBeChecked();
      await expect(
        statusGroup.getByRole('radio', { name: 'Others · 0', exact: true }),
      ).not.toBeChecked();

      await expect(
        page.getByRole('button', { name: 'Add subscription', exact: true }),
      ).toBeVisible();

      await expectSingleH1(page, 'Subscriptions');
      await expectNoHorizontalOverflow(page, 'Subscriptions list at 390px');
    });

    test('the row opens the pushed detail, and Mark cancelled stays on the detail', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await openSubscriptionsFromMore(page);
      await createAndUnlockSubscriptionsVault(page);

      await expect(
        page.getByRole('heading', {
          level: 2,
          name: 'No subscriptions yet',
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });

      await addPhoneSubscription(page, PHONE_NAME);

      await page
        .getByRole('region', { name: 'Active subscriptions', exact: true })
        .getByRole('link', { name: PHONE_NAME })
        .click();

      await expect(page).toHaveURL(/\/dashboard\/subscriptions\/[^/?#]+\/?$/);
      await expectSingleH1(page, PHONE_NAME);
      await expect(
        page.getByRole('link', { name: 'Back to Subscriptions', exact: true }),
      ).toBeVisible();
      for (const name of ['Edit', 'Mark cancelled', 'Delete…']) {
        await expect(
          page.getByRole('button', { name, exact: true }),
        ).toBeVisible();
      }
      await expectNoHorizontalOverflow(page, 'Subscription detail at 390px');

      // The phone detail stays on its route after cancelling: the action is
      // replaced by the Cancelled status pill.
      await page
        .getByRole('button', { name: 'Mark cancelled', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'Mark cancelled', exact: true }),
      ).toHaveCount(0, { timeout: 30000 });
      await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
      await expect(page).toHaveURL(/\/dashboard\/subscriptions\/[^/?#]+\/?$/);
      await expectSingleH1(page, PHONE_NAME);
    });
  });
});
