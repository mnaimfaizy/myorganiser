import { expect, test, type Page } from '@playwright/test';
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
 * Groceries page layout and roles (issue #1251).
 *
 * The acceptance check: no horizontal overflow at 390px, one h1 per page, and
 * labelled controls with the right roles. Checked at 1440px (the Lists and
 * Catalog tabs, the list detail with its summary, and the add dialog) and at
 * 390px (the phone lists, the empty and stocked list detail, and the add sheet).
 *
 * Not asserted here:
 * - the locked vault gate, which the vault specs own;
 * - illustrations, spend arithmetic, and styling;
 * - the real backend: the vault and the reads the dashboard makes on mount are
 *   stubbed, so the spec is hermetic.
 */

const EMAIL = 'groceries-layout-01@example.com';
const LOGIN_FIXTURE = 'layout-e2e-01';

const IDENTITIES: IdentityEntry[] = [
  {
    match: 'groceries-layout-01',
    userId: E2E_USER_ID,
    userName: 'Groceries Layout Owner',
  },
];

// Throwaway fixture: the backend is stubbed in-process, so it guards nothing.
const VAULT_PASSPHRASE = 'layout-vault-01';

const DESKTOP_VIEWPORT = { width: 1440, height: 1000 };
const LIST_NAME = 'Weekly shop';
const ITEM_NAME = 'Bananas';
const ITEM_CATEGORY = 'Produce';

/** Sign in as the layout owner and land on the dashboard. */
async function signIn(page: Page) {
  await signInToShell(page, {
    email: EMAIL,
    loginFixture: LOGIN_FIXTURE,
    identities: IDENTITIES,
  });
}

/**
 * Sign in, open Groceries at the current width, create the vault, and unlock
 * it. Phone reaches Groceries by its tab-bar link; desktop by a direct visit.
 */
async function enterGroceries(page: Page, phone: boolean) {
  await signIn(page);
  if (phone) {
    await tabBar(page)
      .getByRole('link', { name: 'Groceries', exact: true })
      .click();
    await expect(page).toHaveURL(/\/dashboard\/groceries\/?$/);
  } else {
    await gotoStable(page, '/dashboard/groceries');
  }
  await createOwnedVault(page, { passphrase: VAULT_PASSPHRASE });
  await unlockWithPassphrase(page, VAULT_PASSPHRASE);
  await expectSingleH1(page, 'Groceries');
}

/** Create a list from the New list control, at either width. */
async function createList(page: Page, name: string) {
  await page
    .getByRole('button', { name: 'New list', exact: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 30000 });
  await dialog.getByPlaceholder('e.g., Weekly Shopping').fill(name);
  await dialog
    .getByRole('button', { name: 'Create List', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 60000 });
  await expect(page.getByRole('link', { name }).first()).toBeVisible({
    timeout: 60000,
  });
}

/** Open a list from its card link and wait for its detail h1. */
async function openList(page: Page, name: string) {
  await page.getByRole('link', { name }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/groceries\/[^/?#]+\/?$/);
  await expectSingleH1(page, name);
}

/** Return to the Groceries index with the client-side back navigation. */
async function goBackToIndex(page: Page) {
  await page.goBack();
  await expectSingleH1(page, 'Groceries');
}

/**
 * Fill and save the add-item dialog. Shared by the desktop "Add item" button
 * and the phone "New item" path, which both open the same dialog.
 */
async function completeAddItemDialog(
  page: Page,
  listName: string,
  name: string,
  category: string,
) {
  const dialog = page.getByRole('dialog', {
    name: `Add item to ${listName}`,
    exact: true,
  });
  await expect(dialog).toBeVisible({ timeout: 30000 });
  await dialog.getByRole('combobox', { name: 'Item', exact: true }).fill(name);
  // The category radios are visually hidden; their labels are the target.
  await dialog.getByText(category, { exact: true }).click();
  await expect(
    dialog.getByRole('radio', { name: category, exact: true }),
  ).toBeChecked();
  await dialog
    .getByRole('button', { name: 'Add to list', exact: true })
    .click();
  await expect(dialog).toHaveCount(0, { timeout: 30000 });
}

/** Add one item from the desktop list detail and wait for its row. */
async function addItemOnDesktop(
  page: Page,
  listName: string,
  name: string,
  category: string,
) {
  await page
    .getByRole('button', { name: 'Add item', exact: true })
    .first()
    .click();
  await completeAddItemDialog(page, listName, name, category);
  await expect(
    page.getByRole('checkbox', { name: `Bought ${name}`, exact: true }),
  ).toBeVisible({ timeout: 30000 });
}

/**
 * Add one item from the phone list detail: open the add sheet, search the
 * Catalog, and take the "New item" path into the full dialog.
 */
async function addItemOnPhone(
  page: Page,
  listName: string,
  openButton: 'Add items' | 'Add item',
  name: string,
  category: string,
) {
  await page.getByRole('button', { name: openButton, exact: true }).click();
  const sheet = page.getByRole('dialog', {
    name: `Add to ${listName}`,
    exact: true,
  });
  await expect(sheet).toBeVisible({ timeout: 30000 });
  await sheet
    .getByRole('searchbox', { name: 'Search your Catalog', exact: true })
    .fill(name);
  await sheet.getByRole('button', { name: /^New item/ }).click();
  await completeAddItemDialog(page, listName, name, category);
  await expect(
    page.getByRole('checkbox', { name: `Bought ${name}`, exact: true }),
  ).toBeVisible({ timeout: 30000 });
}

test.describe('Groceries layout at 1440px (E2E)', () => {
  test.use({ viewport: DESKTOP_VIEWPORT });

  test('lists index has one h1, the Lists and Catalog tabs, a list card with progress, and no horizontal overflow', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await enterGroceries(page, false);
    await createList(page, LIST_NAME);
    await openList(page, LIST_NAME);
    await addItemOnDesktop(page, LIST_NAME, ITEM_NAME, ITEM_CATEGORY);
    await goBackToIndex(page);

    const tablist = page.getByRole('tablist', {
      name: 'Groceries',
      exact: true,
    });
    await expect(
      tablist.getByRole('tab', { name: 'Lists · 1', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(
      tablist.getByRole('tab', { name: /^Catalog · \d+$/ }),
    ).toHaveAttribute('aria-selected', 'false');

    const card = page.getByRole('article').filter({
      has: page.getByRole('link', { name: LIST_NAME, exact: true }),
    });
    await expect(card).toHaveCount(1);
    await expect(
      card.getByRole('progressbar', {
        name: `${LIST_NAME} progress`,
        exact: true,
      }),
    ).toBeVisible();

    await expectNoHorizontalOverflow(page, 'Groceries lists at 1440px');
  });

  test('the Catalog tab has the filter and category chips with their pressed state, and no horizontal overflow', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await enterGroceries(page, false);
    await createList(page, LIST_NAME);
    await openList(page, LIST_NAME);
    await addItemOnDesktop(page, LIST_NAME, ITEM_NAME, ITEM_CATEGORY);
    await goBackToIndex(page);

    const catalogTab = page.getByRole('tab', { name: /^Catalog · / });
    await catalogTab.click();
    await expect(catalogTab).toHaveAttribute('aria-selected', 'true');

    // type="search" makes the filter a searchbox, not a textbox.
    await expect(
      page.getByRole('searchbox', { name: 'Filter your Catalog', exact: true }),
    ).toBeVisible();

    const allChip = page.getByRole('button', { name: /^All · / });
    const produceChip = page.getByRole('button', { name: /^Produce · / });
    await expect(allChip).toHaveAttribute('aria-pressed', 'true');
    await expect(produceChip).toHaveAttribute('aria-pressed', 'false');

    await produceChip.click();
    await expect(produceChip).toHaveAttribute('aria-pressed', 'true');
    await expect(allChip).toHaveAttribute('aria-pressed', 'false');

    await expectSingleH1(page, 'Groceries');
    await expectNoHorizontalOverflow(page, 'Groceries catalog at 1440px');
  });

  test('list detail has one h1, the Catalog strip, a category section, a Bought checkbox, and the list summary, with no horizontal overflow', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await enterGroceries(page, false);
    await createList(page, LIST_NAME);
    await openList(page, LIST_NAME);
    await addItemOnDesktop(page, LIST_NAME, ITEM_NAME, ITEM_CATEGORY);

    await expectSingleH1(page, LIST_NAME);
    await expect(
      page.getByRole('region', { name: 'Add from your Catalog', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: ITEM_CATEGORY, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: `Bought ${ITEM_NAME}`, exact: true }),
    ).toBeVisible();

    const summary = page.getByRole('complementary', {
      name: 'List summary',
      exact: true,
    });
    await expect(summary).toBeVisible();
    await expect(
      summary.getByRole('progressbar', { name: 'Items checked', exact: true }),
    ).toBeVisible();

    await expectNoHorizontalOverflow(page, 'List detail at 1440px');
  });

  test('the add dialog is named for the list, its Item combobox offers Catalog matches, and Category is a group', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await enterGroceries(page, false);
    await createList(page, LIST_NAME);
    await openList(page, LIST_NAME);
    // A Catalog Item must exist before the combobox has anything to offer.
    await addItemOnDesktop(page, LIST_NAME, ITEM_NAME, ITEM_CATEGORY);

    await page
      .getByRole('button', { name: 'Add item', exact: true })
      .first()
      .click();
    const dialog = page.getByRole('dialog', {
      name: `Add item to ${LIST_NAME}`,
      exact: true,
    });
    await expect(dialog).toBeVisible({ timeout: 30000 });

    await dialog
      .getByRole('combobox', { name: 'Item', exact: true })
      .fill('Ban');
    await expect(
      dialog.getByRole('listbox', { name: 'From your Catalog', exact: true }),
    ).toBeVisible();
    await expect(dialog.getByRole('option', { name: /Bananas/ })).toBeVisible();
    await expect(
      dialog.getByRole('group', { name: 'Category', exact: true }),
    ).toBeVisible();

    await expectNoHorizontalOverflow(page, 'Add item dialog at 1440px');
  });
});

test.describe('Groceries layout at 390px (E2E)', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('phone lists have one h1, the tabs, a card with progress, the New list button and tab bar, and no horizontal overflow on either tab', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await enterGroceries(page, true);
    await createList(page, LIST_NAME);
    await openList(page, LIST_NAME);
    await addItemOnPhone(
      page,
      LIST_NAME,
      'Add items',
      ITEM_NAME,
      ITEM_CATEGORY,
    );
    await goBackToIndex(page);

    const tablist = page.getByRole('tablist', {
      name: 'Groceries',
      exact: true,
    });
    await expect(
      tablist.getByRole('tab', { name: 'Lists', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');

    const card = page.getByRole('link', { name: LIST_NAME });
    await expect(
      card.getByRole('progressbar', {
        name: `${LIST_NAME} progress`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'New list', exact: true }),
    ).toBeVisible();
    await expect(tabBar(page)).toBeVisible();
    await expectNoHorizontalOverflow(page, 'Groceries lists at 390px');

    const catalogTab = tablist.getByRole('tab', { name: /^Catalog · / });
    await catalogTab.click();
    await expect(catalogTab).toHaveAttribute('aria-selected', 'true');
    await expectNoHorizontalOverflow(page, 'Groceries catalog at 390px');
  });

  test('an empty phone list has one h1, the empty heading, a List actions menu, and no horizontal overflow', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await enterGroceries(page, true);
    await createList(page, LIST_NAME);
    await openList(page, LIST_NAME);

    await expect(
      page.getByRole('heading', {
        level: 2,
        name: 'Nothing on this list yet',
        exact: true,
      }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, 'Empty list at 390px');

    await page
      .getByRole('button', { name: 'List actions', exact: true })
      .click();
    await expect(
      page.getByRole('menuitem', { name: 'Rename list', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: 'Delete Grocery List…', exact: true }),
    ).toBeVisible();
  });

  test('a stocked phone list has one h1 and an add sheet with a Catalog searchbox, and no horizontal overflow', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await enterGroceries(page, true);
    await createList(page, LIST_NAME);
    await openList(page, LIST_NAME);
    await addItemOnPhone(
      page,
      LIST_NAME,
      'Add items',
      ITEM_NAME,
      ITEM_CATEGORY,
    );

    await expectSingleH1(page, LIST_NAME);
    await page.getByRole('button', { name: 'Add item', exact: true }).click();

    const sheet = page.getByRole('dialog', {
      name: `Add to ${LIST_NAME}`,
      exact: true,
    });
    await expect(sheet).toBeVisible({ timeout: 30000 });
    await expect(
      sheet.getByRole('searchbox', {
        name: 'Search your Catalog',
        exact: true,
      }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, 'Add sheet at 390px');
  });
});
