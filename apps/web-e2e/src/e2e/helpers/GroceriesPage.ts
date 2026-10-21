import { Page, expect } from '@playwright/test';

import { unlockWithPassphrase } from './vaultGate';

/**
 * Page Object Model for Groceries Trip Board.
 * Provides a higher-level API for interacting with the groceries feature
 * across multiple test scenarios, reducing code duplication.
 */
export class GroceriesPage {
  constructor(private readonly page: Page) {}

  /**
   * Navigate to /dashboard/groceries and unlock the vault if needed.
   */
  async gotoAndUnlock(passphrase: string): Promise<void> {
    await this.page.goto('/dashboard/groceries');

    const unlockButton = this.page.getByRole('button', {
      name: 'Use passphrase',
    });

    // The route is ready once it has settled into one of its two states —
    // the vault gate, or the unlocked Trip Board. Waiting for network quiet
    // said nothing about either (issue #524).
    await expect(
      unlockButton
        .or(this.page.getByRole('heading', { level: 1, name: 'Groceries' }))
        .first(),
    ).toBeVisible({ timeout: 30000 });

    const isLocked = await unlockButton
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    if (isLocked) {
      await this.unlockWithPassphrase(passphrase);
    }

    await this.waitForGroceriesReady();
  }

  /**
   * Wait for the Trip Board index to be ready after unlock.
   */
  async waitForGroceriesReady(): Promise<void> {
    await expect(
      this.page.getByRole('heading', { level: 1, name: 'Groceries' }),
    ).toBeVisible({ timeout: 30000 });

    // The heading renders before the decrypted trips do. The board's primary
    // action is the first thing that depends on that list having resolved —
    // "New list" in the header, present whether or not any lists exist, so it
    // is the honest end of "the board is ready".
    await expect(
      this.page.getByRole('button', { name: 'New list', exact: true }).first(),
    ).toBeVisible({ timeout: 30000 });
  }

  /**
   * Click the "New list" header button.
   */
  async clickNewList(): Promise<void> {
    await this.page
      .getByRole('button', { name: 'New list', exact: true })
      .first()
      .click();
  }

  /**
   * Unlock the vault using passphrase.
   *
   * Delegates to the shared gate helper. The variant that used to live here
   * opened with `isVisible({ timeout }).catch(() => false)` and returned early
   * when that came back false — the same silent skip that broke the nightly
   * WebKit leg, because `isVisible` samples once and never waits. The `throw`s
   * further down never fired: the early return had already decided (#597).
   * `gotoAndUnlock` settles the route before calling this, so there is nothing
   * left to guess at.
   */
  async unlockWithPassphrase(passphrase: string): Promise<void> {
    await unlockWithPassphrase(this.page, passphrase);
  }

  /**
   * Scope a trip card on the index by its linked trip name.
   */
  tripCard(tripName: string) {
    return this.page.getByRole('article').filter({
      has: this.page.getByRole('link', { name: tripName, exact: true }),
    });
  }

  /**
   * Create a new grocery trip via the UI.
   */
  async createList(name: string): Promise<void> {
    await this.clickNewList();

    const dialog = this.page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const input = this.page.getByPlaceholder('e.g., Weekly Shopping');
    await expect(input).toBeVisible();
    await input.fill(name);

    await expect(this.page.getByText(/\d+ \/ 100/)).toBeVisible();

    await this.page.getByRole('button', { name: 'Create List' }).click();

    await expect(this.page.getByRole('dialog')).toHaveCount(0, {
      timeout: 60000,
    });

    await expect(this.tripCard(name)).toBeVisible({ timeout: 60000 });
  }

  /**
   * Open a grocery trip by name and navigate to its detail board.
   */
  async openList(listName: string, passphraseParam?: string): Promise<void> {
    const link = this.tripCard(listName)
      .getByRole('link', { name: listName, exact: true })
      .first();

    const href = await link.getAttribute('href');
    if (!href) {
      throw new Error(`Could not find link for trip "${listName}"`);
    }

    await this.page.goto(href);

    // The detail route settles into one of two states: the vault gate, or the
    // board itself. Wait for that before probing which one arrived — a fixed
    // `isVisible` probe otherwise races the render, and the `networkidle` that
    // used to sit here was hiding the race rather than removing it (#524).
    const passphraseInput = this.page
      .locator('#unlock-passphrase, [data-testid="unlock-passphrase"]')
      .first();
    const listHeading = this.page
      .locator('h1, h2')
      .filter({ hasText: listName });
    await expect(passphraseInput.or(listHeading).first()).toBeVisible({
      timeout: 30000,
    });

    if (await passphraseInput.isVisible().catch(() => false)) {
      if (!passphraseParam) {
        throw new Error(
          `Vault unlock required but passphrase not provided to openList`,
        );
      }
      await passphraseInput.fill(passphraseParam);
      const unlockBtn = this.page
        .getByRole('button', { name: /Unlock|Confirm/ })
        .first();
      await unlockBtn.click();
      // The gate closing is the unlock signal, not network quiet.
      await expect(
        this.page.locator(
          '#unlock-passphrase, [data-testid="unlock-passphrase"]',
        ),
      ).toHaveCount(0, { timeout: 120000 });
    }

    await expect(listHeading.first()).toBeVisible({ timeout: 30000 });
  }

  /**
   * Rename a grocery trip.
   */
  async renameList(oldName: string, newName: string): Promise<void> {
    await this.openTripActionsMenu(oldName);
    await this.page.getByRole('menuitem', { name: 'Rename list' }).click();

    const dialog = this.page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const input = this.page.getByPlaceholder('e.g., Weekly Shopping');
    await expect(input).toHaveValue(oldName);

    await input.fill(newName);
    await this.page.getByRole('button', { name: 'Rename List' }).click();
    await expect(this.page.getByRole('dialog')).toHaveCount(0);
    await expect(this.tripCard(newName)).toBeVisible({ timeout: 60000 });
  }

  /**
   * Delete a grocery trip with confirmation.
   */
  async deleteList(listName: string): Promise<void> {
    await this.openTripActionsMenu(listName);
    await this.page
      .getByRole('menuitem', { name: 'Delete Grocery List…' })
      .click();

    const dialog = this.page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await this.page.getByRole('button', { name: 'Delete List' }).click();

    await expect(this.page.getByRole('dialog')).toHaveCount(0);
    await expect(this.tripCard(listName)).toHaveCount(0);
  }

  /**
   * Open the trip actions menu for a card on the index.
   */
  private async openTripActionsMenu(tripName: string): Promise<void> {
    const card = this.tripCard(tripName).first();
    await card.getByRole('button', { name: `Actions for ${tripName}` }).click();
  }

  /**
   * Open the row actions menu for a list line on the detail board.
   */
  private async openRowActionsMenu(itemName: string): Promise<void> {
    await this.page
      .getByRole('button', { name: `More for ${itemName}` })
      .click();
  }

  /**
   * Add an item to the current list via the Add item dialog.
   */
  async addItem(name: string): Promise<void> {
    await this.page
      .getByRole('button', { name: 'Add item', exact: true })
      .click();

    const dialog = this.page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 30000 });

    const nameInput = this.page.getByRole('combobox', {
      name: 'Item',
      exact: true,
    });
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill(name);

    const addBtn = dialog.getByRole('button', { name: 'Add to list' });
    await expect(addBtn).toBeEnabled({ timeout: 10000 });
    await addBtn.click();

    await expect(dialog).toHaveCount(0, { timeout: 30000 });
    await expect(
      this.page.getByRole('checkbox', { name: `Bought ${name}`, exact: true }),
    ).toBeVisible({
      timeout: 30000,
    });
  }

  /**
   * Edit catalog-level fields (name, category, price, notes).
   */
  async editCatalogItem(
    originalName: string,
    updates: {
      name?: string;
      category?: string;
      price?: string;
      notes?: string;
    },
  ): Promise<void> {
    await this.openRowActionsMenu(originalName);
    await this.page
      .getByRole('menuitem', { name: 'Edit Catalog Item' })
      .click();

    const dialog = this.page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 30000 });

    if (updates.name) {
      await this.page.getByLabel('Catalog Item Name').fill(updates.name);
    }

    if (updates.category) {
      await dialog.getByRole('radio', { name: updates.category }).click();
    }

    if (updates.price) {
      await this.page.getByLabel('Default Price').fill(updates.price);
    }

    if (updates.notes) {
      await this.page.getByLabel('Notes').fill(updates.notes);
    }

    await this.page.getByRole('button', { name: 'Save Catalog Item' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30000 });
  }

  /**
   * Edit list-line fields (amount) via the pencil control.
   */
  async editListLine(
    itemName: string,
    updates: { amount?: string },
  ): Promise<void> {
    await this.page
      .getByRole('button', { name: `Edit amount for ${itemName}` })
      .click();

    const dialog = this.page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 30000 });

    if (updates.amount) {
      await this.page.getByLabel('Quantity / Amount').fill(updates.amount);
    }

    await this.page.getByRole('button', { name: 'Save List Line' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30000 });
  }

  /**
   * Edit an item — routes catalog vs list-line updates to the correct dialog.
   */
  async editItem(
    originalName: string,
    updates: {
      name?: string;
      category?: string;
      price?: string;
      amount?: string;
      notes?: string;
    },
  ): Promise<void> {
    const { amount, ...catalogUpdates } = updates;
    const hasCatalogUpdates = Object.values(catalogUpdates).some(
      (value) => value !== undefined,
    );

    if (hasCatalogUpdates) {
      await this.editCatalogItem(originalName, catalogUpdates);
    }

    const currentName = updates.name ?? originalName;
    if (amount !== undefined) {
      await this.editListLine(currentName, { amount });
    }
  }

  /**
   * Toggle the checked state of an item (the line moves into the collapsed Checked section).
   */
  async toggleItemChecked(itemName: string): Promise<void> {
    const checkbox = this.page.getByRole('checkbox', {
      name: `Bought ${itemName}`,
      exact: true,
    });
    await expect(checkbox).toBeVisible({ timeout: 30000 });
    await checkbox.click();
  }

  /**
   * Check if an item is checked.
   */
  async isItemChecked(itemName: string): Promise<boolean> {
    const checkbox = this.page.getByRole('checkbox', {
      name: `Bought ${itemName}`,
      exact: true,
    });
    return await checkbox.isChecked();
  }

  /**
   * Remove a list line with the two-step menu confirmation.
   */
  async deleteItem(itemName: string): Promise<void> {
    await this.openRowActionsMenu(itemName);
    await this.page.getByRole('menuitem', { name: 'Remove from list' }).click();
    await this.page
      .getByRole('menuitem', { name: 'Confirm remove line' })
      .click();

    await expect(
      this.page.getByRole('checkbox', {
        name: `Bought ${itemName}`,
        exact: true,
      }),
    ).toHaveCount(0, { timeout: 30000 });
  }

  /**
   * Verify that an item is visible on the current trip board.
   */
  async assertItemVisible(itemName: string): Promise<void> {
    await expect(
      this.page.getByRole('checkbox', {
        name: `Bought ${itemName}`,
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });
  }

  /**
   * Verify that an item is NOT visible on the current trip board.
   */
  async assertItemNotVisible(itemName: string): Promise<void> {
    await expect(
      this.page.getByRole('checkbox', {
        name: `Bought ${itemName}`,
        exact: true,
      }),
    ).toHaveCount(0, { timeout: 10000 });
  }

  /**
   * Verify that a specific price value is displayed.
   */
  async assertPriceVisible(price: string): Promise<void> {
    await expect(
      this.page
        .locator('[data-testid^="list-line-"]')
        .getByText(`$${price}`)
        .first(),
    ).toBeVisible({
      timeout: 30000,
    });
  }

  /**
   * Close any open dialog by pressing Escape.
   */
  async closeDialogWithEscape(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await expect(this.page.getByRole('dialog')).toHaveCount(0);
  }

  /**
   * Verify the page is still usable after closing a dialog.
   */
  async assertPageUsable(): Promise<void> {
    await expect(
      this.page.getByRole('button', { name: 'New list', exact: true }).first(),
    ).toBeVisible();
  }

  /**
   * Navigate back to the main groceries page.
   */
  async goBack(): Promise<void> {
    await this.page.goBack();
    await this.waitForGroceriesReady();
  }
}
