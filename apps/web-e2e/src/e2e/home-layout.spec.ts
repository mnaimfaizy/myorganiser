import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  createOwnedVault,
  E2E_USER_ID,
  expectNoHorizontalOverflow,
  unlockWithPassphrase,
  type IdentityEntry,
} from './helpers';
import { PHONE_VIEWPORT, signInToShell, tabBar } from './helpers/shellLayout';

/**
 * Home page layout and roles (issues #1250 and #1613).
 *
 * The acceptance check: one h1 per breakpoint, the section landmarks each
 * breakpoint shows, the Vault states Home can show, the quick-add menu, space
 * links with real hrefs, and no horizontal overflow. Checked at 1440px (hero,
 * spaces grid, coming-up cards) and at 390px (Today card, spaces tiles, FAB).
 *
 * The three Vault states:
 * - no vault: the stubbed GET /vault is 404, so the server is proven to hold
 *   none and Home offers Create your vault, a link to the vault page;
 * - owned and locked: the same owner after creating and unlocking a vault,
 *   then locking it from Home's lock control. Home stays mounted, so the
 *   locked treatment is checked on the page it was unlocked on;
 * - unlocked: the zero-state copy, the space links and the quick-add menu.
 *
 * Not asserted here:
 * - seeded vault data: the vault is created empty, so the zero-state copy is
 *   what is checked, not the due-task or renewal rows;
 * - YouTube cards: the availability stub is off, so they are absent by design;
 * - the install strip, which depends on the browser's install capability;
 * - the greeting's time of day, which is matched with a pattern;
 * - the vault summary and the backup line, which depend on the backups read;
 * - the sidebar's Vault status card in the locked states, which is out of scope.
 *
 * Hermetic: the backend is stubbed by signInToShell, and the vault is created
 * through the Tasks setup gate. Navigation after sign-in is by clicking links
 * only, so the vault session is not remounted.
 */

const EMAIL = 'home-layout-01@example.com';
const LOGIN_FIXTURE = 'home-layout-01';
/** The stubbed sign-in returns this as the user's first name. */
const FIRST_NAME = 'Home Layout Owner';

const IDENTITIES: IdentityEntry[] = [
  {
    match: 'home-layout-01',
    userId: E2E_USER_ID,
    userName: FIRST_NAME,
  },
];

// Throwaway fixture: the backend is stubbed in-process, so it guards nothing.
const VAULT_PASSPHRASE = 'home-vault-0001';

const DESKTOP_VIEWPORT = { width: 1440, height: 1000 };

const GREETING_PATTERN = new RegExp(
  `^Good (morning|afternoon|evening), ${FIRST_NAME}$`,
);

/** Sign in and land on Home (the dashboard root). */
async function signIn(page: Page) {
  await signInToShell(page, {
    email: EMAIL,
    loginFixture: LOGIN_FIXTURE,
    identities: IDENTITIES,
  });
}

/**
 * Create and unlock the owner's vault from the Tasks setup gate, reached by
 * `openTasks` (the sidebar link on desktop, the tab bar on phone).
 */
async function createAndUnlockVault(page: Page, openTasks: Locator) {
  await openTasks.click();
  await expect(page).toHaveURL(/\/dashboard\/tasks\/?$/);
  await createOwnedVault(page, { passphrase: VAULT_PASSPHRASE });
  await unlockWithPassphrase(page, VAULT_PASSPHRASE);
}

/** The Home h1 must be the only one; its text is checked by the caller. */
async function expectOnlyH1(page: Page, text: string | RegExp) {
  const h1 = page.locator('h1');
  await expect(h1).toHaveCount(1);
  await expect(h1).toHaveText(text);
}

function spacesRegion(page: Page) {
  return page.getByRole('region', { name: 'Your spaces', exact: true });
}

/** The Home header on phone: the only header that holds the page's h1. */
function phoneHomeHeader(page: Page) {
  return page
    .locator('header')
    .filter({ has: page.getByRole('heading', { level: 1 }) });
}

test.describe('Home layout (E2E)', () => {
  test.describe('Home layout at 1440px (E2E)', () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test('no-vault Home offers Create your vault in place of the locked hero, and no horizontal overflow', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);

      const createLink = page.getByRole('link', {
        name: 'Create your vault',
        exact: true,
      });
      await expect(createLink).toBeVisible({ timeout: 30000 });
      await expect(createLink).toHaveAttribute('href', '/dashboard/vault');
      await expectOnlyH1(page, GREETING_PATTERN);
      await expect(
        page.getByText(
          'Set up your encrypted vault to start using your spaces.',
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Unlock vault', exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('link', { name: 'Use recovery key', exact: true }),
      ).toHaveCount(0);

      const spaces = spacesRegion(page);
      await expect(spaces.getByText('Locked', { exact: true })).toHaveCount(0);
      await expect(spaces.getByText('Not set up', { exact: true })).toHaveCount(
        1,
      );
      await expect(
        spaces.getByRole('link', { name: /^Groceries/ }),
      ).toHaveAttribute('href', '/dashboard/groceries');
      await expect(
        spaces.getByRole('link', { name: /^Vault/ }),
      ).toHaveAttribute('href', '/dashboard/vault');

      // Coming up is unlocked-only, and YouTube is off under the availability stub.
      await expect(page.getByRole('region', { name: 'Coming up' })).toHaveCount(
        0,
      );
      await expect(spaces.getByRole('link', { name: /^YouTube/ })).toHaveCount(
        0,
      );

      await expectNoHorizontalOverflow(page, 'Home without a vault at 1440px');
    });

    test('unlocked Home has landmarks, zero-state copy, space links, the quick-add menu, and no horizontal overflow, then locks back to the locked Home', async ({
      page,
    }) => {
      test.setTimeout(180000);

      await signIn(page);
      await createAndUnlockVault(
        page,
        page.getByRole('link', { name: 'Tasks', exact: true }),
      );

      await page.getByRole('link', { name: 'Home', exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard\/?$/);

      await expectOnlyH1(page, GREETING_PATTERN);
      await expect(
        page.getByText(
          'No tasks are due today and no subscriptions renew this week.',
          { exact: true },
        ),
      ).toBeVisible({ timeout: 30000 });

      const spaces = spacesRegion(page);
      await expect(spaces).toBeVisible();
      await expect(
        spaces.getByRole('link', { name: /^Groceries/ }),
      ).toHaveAttribute('href', '/dashboard/groceries');
      await expect(
        spaces.getByRole('link', { name: /^Tasks/ }),
      ).toHaveAttribute('href', '/dashboard/tasks');
      await expect(spaces.getByText('No grocery lists yet')).toBeVisible({
        timeout: 30000,
      });

      const coming = page.getByRole('region', { name: 'Coming up' });
      await expect(coming).toBeVisible();
      await expect(
        page.getByRole('region', { name: 'Due today', exact: true }),
      ).toContainText('Nothing due today.', { timeout: 30000 });
      await expect(
        page.getByRole('region', { name: 'Renewing soon', exact: true }),
      ).toContainText('Nothing renews this week.');
      await expect(
        page.getByRole('heading', { name: 'New videos', exact: true }),
      ).toHaveCount(0);

      await page
        .getByRole('button', { name: 'Quick add', exact: true })
        .click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      for (const label of [
        'Tasks',
        'Groceries',
        'Addresses',
        'Subscriptions',
        'Mobile numbers',
      ]) {
        await expect(
          menu.getByRole('menuitem', { name: label, exact: true }),
        ).toBeVisible();
      }
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);

      await expectNoHorizontalOverflow(page, 'Home unlocked at 1440px');

      // Lock from the sidebar's Vault status card. Home stays mounted and
      // re-renders in the owned-locked state.
      await page
        .getByRole('region', { name: 'Vault status', exact: true })
        .getByRole('button', { name: 'Lock vault', exact: true })
        .click();
      await page.getByRole('link', { name: 'Home', exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard\/?$/);

      await expect(
        page.getByRole('link', { name: 'Unlock vault', exact: true }),
      ).toHaveAttribute('href', '/dashboard/vault', { timeout: 30000 });
      await expect(
        page.getByRole('link', { name: 'Use recovery key', exact: true }),
      ).toHaveAttribute('href', '/dashboard/vault');
      await expect(
        page.getByText(
          "Your vault is locked. Unlock it to see what's due, your lists and your spending.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Create your vault', exact: true }),
      ).toHaveCount(0);
      await expect(
        spacesRegion(page).getByText('Locked', { exact: true }),
      ).toHaveCount(6);
    });
  });

  test.describe('Home layout at 390px (E2E)', () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test('no-vault Home offers Create your vault in the set-up card, with no FAB and no horizontal overflow', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);

      const setUp = page.getByRole('region', {
        name: 'Set up your vault',
        exact: true,
      });
      await expect(setUp).toBeVisible({ timeout: 30000 });
      await expectOnlyH1(page, FIRST_NAME);
      await expect(
        setUp.getByRole('link', { name: 'Create your vault', exact: true }),
      ).toHaveAttribute('href', '/dashboard/vault');
      await expect(
        page.getByRole('region', { name: 'Vault locked', exact: true }),
      ).toHaveCount(0);
      await expect(
        phoneHomeHeader(page).getByText('Not set up', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', {
          name: 'Use recovery key instead',
          exact: true,
        }),
      ).toHaveCount(0);

      const spaces = spacesRegion(page);
      const groceriesTile = spaces.getByRole('link', { name: /^Groceries/ });
      await expect(groceriesTile).toHaveAttribute(
        'href',
        '/dashboard/groceries',
      );
      await expect(groceriesTile).toContainText('Needs a vault');
      await expect(groceriesTile).not.toContainText('Locked');
      // Tasks is not a tile on phone: the Today card covers it.
      await expect(spaces.getByRole('link', { name: /^Tasks/ })).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Quick add', exact: true }),
      ).toHaveCount(0);

      await expectNoHorizontalOverflow(page, 'Home without a vault at 390px');
    });

    test('unlocked Home has the Today card, the Lock vault control, the quick-add FAB menu, and no horizontal overflow, then locks back to the locked card', async ({
      page,
    }) => {
      test.setTimeout(180000);

      await signIn(page);
      await createAndUnlockVault(
        page,
        tabBar(page).getByRole('link', { name: 'Tasks', exact: true }),
      );

      await tabBar(page)
        .getByRole('link', { name: 'Home', exact: true })
        .click();
      await expect(page).toHaveURL(/\/dashboard\/?$/);

      await expectOnlyH1(page, FIRST_NAME);

      const today = page.getByRole('region', { name: 'Today', exact: true });
      await expect(today).toBeVisible({ timeout: 30000 });
      await expect(
        today.getByText('Nothing due today', { exact: true }),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByRole('link', { name: "Open today's tasks", exact: true }),
      ).toHaveAttribute('href', '/dashboard/tasks');

      await expect(
        page.getByRole('button', { name: 'Lock vault', exact: true }),
      ).toBeVisible();

      const spaces = spacesRegion(page);
      await expect(
        spaces.getByRole('heading', {
          level: 2,
          name: 'Your spaces',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        spaces.getByRole('link', { name: /^Groceries/ }),
      ).toHaveAttribute('href', '/dashboard/groceries');
      await expect(spaces.getByRole('link', { name: /^YouTube/ })).toHaveCount(
        0,
      );

      const fab = page.getByRole('button', { name: 'Quick add', exact: true });
      await expect(fab).toBeVisible();
      await fab.click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      for (const label of ['Tasks', 'Groceries']) {
        await expect(
          menu.getByRole('menuitem', { name: label, exact: true }),
        ).toBeVisible();
      }
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);

      await expectNoHorizontalOverflow(page, 'Home unlocked at 390px');

      // Lock from the header. Home is already current, so no navigation: the
      // same page re-renders with the locked card.
      await page
        .getByRole('button', { name: 'Lock vault', exact: true })
        .click();
      const locked = page.getByRole('region', {
        name: 'Vault locked',
        exact: true,
      });
      await expect(locked).toBeVisible({ timeout: 30000 });
      await expect(
        locked.getByRole('link', { name: 'Unlock', exact: true }),
      ).toBeVisible();
      await expect(
        locked.getByRole('link', {
          name: 'Use recovery key instead',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Create your vault', exact: true }),
      ).toHaveCount(0);
    });
  });
});
