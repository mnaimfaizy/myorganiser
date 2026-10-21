import { expect, test, type Page } from '@playwright/test';
import {
  createOwnedVault,
  E2E_USER_ID,
  gotoStable,
  unlockWithPassphrase,
  type IdentityEntry,
} from './helpers';
import {
  expectNoHorizontalOverflow,
  PHONE_VIEWPORT,
  signInToShell,
  tabBar,
} from './helpers/shellLayout';

/**
 * Tasks page layout and roles (issue #1252).
 *
 * The acceptance check: no horizontal overflow at 390px, one h1 per page, and
 * labelled controls with the right roles. Checked at 1440px (desktop board
 * with the add dialog and the detail panel) and at 390px (phone list, the
 * capture sheet, and the pushed detail screen).
 *
 * Not asserted here:
 * - the locked vault gate at 390px, which overflows and is owned by #1257;
 * - toast timing, Undo, and concurrent mutations;
 * - the real backend: the vault and the reads the dashboard makes on mount are
 *   stubbed, so the spec is hermetic.
 */

const EMAIL = 'tasks-layout-01@example.com';
const LOGIN_FIXTURE = 'layout-e2e-01';

const IDENTITIES: IdentityEntry[] = [
  {
    match: 'tasks-layout-01',
    userId: E2E_USER_ID,
    userName: 'Tasks Layout Owner',
  },
];

// Throwaway fixture: the backend is stubbed in-process, so it guards nothing.
const VAULT_PASSPHRASE = 'layout-vault-01';

const DESKTOP_VIEWPORT = { width: 1440, height: 1000 };

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

/** Create the owner's vault and unlock it, leaving the Tasks board rendered. */
async function createAndUnlockTasksVault(page: Page) {
  await createOwnedVault(page, { passphrase: VAULT_PASSPHRASE });
  await unlockWithPassphrase(page, VAULT_PASSPHRASE);
}

async function expectSingleH1(page: Page, text: string) {
  const headings = page.getByRole('heading', { level: 1 });
  await expect(headings).toHaveCount(1);
  await expect(headings).toHaveText(text);
}

test.describe('Tasks layout at 1440px (E2E)', () => {
  test.use({ viewport: DESKTOP_VIEWPORT });

  test('empty board has one h1, the all-clear state, and no horizontal overflow', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await signIn(page);
    await gotoStable(page, '/dashboard/tasks');
    await createAndUnlockTasksVault(page);

    await expect(
      page.getByRole('heading', { level: 2, name: 'All clear', exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expectSingleH1(page, 'Tasks');

    await expect(
      page.getByRole('button', { name: 'Show done', exact: true }),
    ).toBeVisible();
    // The header and the all-clear card each carry an "Add task" button.
    await expect(
      page.getByRole('button', { name: 'Add task', exact: true }).first(),
    ).toBeVisible();

    await expectNoHorizontalOverflow(page, 'Tasks at 1440px');
  });

  test('adding a task files it under No date, shows the filters, and opens the detail panel', async ({
    page,
  }) => {
    test.setTimeout(120000);

    const title = 'Layout desktop task';

    await signIn(page);
    await gotoStable(page, '/dashboard/tasks');
    await createAndUnlockTasksVault(page);

    await expect(
      page.getByRole('heading', { level: 2, name: 'All clear', exact: true }),
    ).toBeVisible({ timeout: 30000 });

    await page
      .getByRole('button', { name: 'Add task', exact: true })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: 'Add task', exact: true });
    await expect(dialog).toBeVisible({ timeout: 30000 });
    await dialog.getByLabel('Title', { exact: true }).fill(title);
    await dialog.getByRole('button', { name: 'Add task', exact: true }).click();

    await expect(dialog).toHaveCount(0);

    const noDate = page.getByRole('region', { name: 'No date', exact: true });
    await expect(
      noDate.getByRole('checkbox', { name: `Done: ${title}`, exact: true }),
    ).toBeVisible({ timeout: 30000 });

    await expect(
      page.getByRole('group', { name: 'Context', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('radio', { name: 'All', exact: true }),
    ).toBeChecked();

    const statusGroup = page.getByRole('group', {
      name: 'Status',
      exact: true,
    });
    await expect(
      statusGroup.getByRole('button', { name: 'Open · 1', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');

    await expectSingleH1(page, 'Tasks');

    await page.getByRole('button', { name: title, exact: true }).click();

    const detail = page.getByRole('complementary', {
      name: 'Task detail',
      exact: true,
    });
    await expect(detail).toBeVisible();
    await expect(
      detail.getByRole('textbox', { name: 'Task', exact: true }),
    ).toHaveValue(title);

    await expectNoHorizontalOverflow(page, 'Tasks with detail at 1440px');
  });
});

test.describe('Tasks layout at 390px (E2E)', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('empty list has one h1, the all-clear state, the tab bar, and no horizontal overflow', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await signIn(page);

    const bar = tabBar(page);
    await bar.getByRole('link', { name: 'Tasks', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/tasks\/?$/);

    await createAndUnlockTasksVault(page);

    await expect(
      page.getByRole('heading', { level: 2, name: 'All clear', exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expectSingleH1(page, 'Tasks');
    await expect(bar).toBeVisible();

    await expectNoHorizontalOverflow(page, 'Tasks at 390px');
  });

  test('a task captured from the sheet is listed, and its row opens the detail screen', async ({
    page,
  }) => {
    test.setTimeout(120000);

    const title = 'Layout phone task';

    await signIn(page);

    const bar = tabBar(page);
    await bar.getByRole('link', { name: 'Tasks', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/tasks\/?$/);

    await createAndUnlockTasksVault(page);

    await expect(
      page.getByRole('heading', { level: 2, name: 'All clear', exact: true }),
    ).toBeVisible({ timeout: 30000 });

    await page.getByRole('button', { name: 'Add task', exact: true }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible({ timeout: 30000 });

    const capture = sheet.getByLabel('New task', { exact: true });
    await capture.fill(title);
    await sheet.getByRole('button', { name: 'Save task', exact: true }).click();
    // The field clears only once the save has resolved; Escape is ignored
    // while a save is in flight, so wait for it first.
    await expect(capture).toHaveValue('');

    // A successful save shows a "Task created" toast, which Radix treats as the
    // topmost layer. The first Escape dismisses the toast and the sheet stays
    // open, so retry Escape until the sheet closes.
    await expect(async () => {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 1000 });
    }).toPass({ timeout: 10000 });

    await expect(
      page.getByRole('checkbox', { name: `Done: ${title}`, exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expectNoHorizontalOverflow(page, 'Tasks with a row at 390px');

    await page.getByRole('link', { name: title }).click();

    await expect(page).toHaveURL(/\/dashboard\/tasks\/[^/?#]+\/?$/);
    await expectSingleH1(page, title);
    await expect(
      page.getByRole('link', { name: 'Back to Tasks', exact: true }),
    ).toBeVisible();
    await expect(bar).toHaveCount(0);
    await expectNoHorizontalOverflow(page, 'Task detail at 390px');
  });
});
