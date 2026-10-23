/*
  Route-level tests for GroceriesListDetailClient on the phone layout.
  - Covers the list heading and progress, category grouping, the checked
    disclosure, the list-actions menu, the spend bar, the empty state, and the
    add sheet (often bought, catalog search, new-item handoff, dismissal).
  - Renders the real page hook, phone screen, dialogs, and web-ui (Radix).
  - Mocks: useGroceriesVault (controllable vault fake), next/navigation
    useRouter, useIsMobileState (forced to phone), and useToast (a spy, because
    the toast store is module-global and would leak between tests).
*/

/** Mocking rule: place jest.mock calls before any imports */
const mockToast = jest.fn();
const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('../../shared/hooks', () => ({
  useGroceriesVault: jest.fn(),
  useGroceriesErrorToast: jest.requireActual(
    '../../shared/hooks/useGroceriesErrorToast',
  ).useGroceriesErrorToast,
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useIsMobileState: jest.fn(),
  useToast: () => ({ toast: mockToast }),
}));

// Radix menus, checkboxes, and dialogs need a ResizeObserver in jsdom.
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type {
  CatalogItem,
  GroceryList,
  ListLine,
} from '@myorganiser/vault-core';
import type { VaultHandle } from '@myorganiser/web-vault';
import { useIsMobileState } from '@myorganiser/web-ui';
import { useRouter } from 'next/navigation';
import { useGroceriesVault } from '../../shared/hooks';
import { GroceriesListDetailClient } from '../GroceriesListDetailClient';

// Every fixture was last edited three hours ago, so the activity line is stable.
const LAST_EDITED = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
const LIST_ID = 'list-1';
const LIST_NAME = 'Weekly shop';

const handle = { isUnlocked: true } as unknown as VaultHandle;

function makeItem(
  id: string,
  name: string,
  category: CatalogItem['category'],
  price?: number,
): CatalogItem {
  return {
    id,
    name,
    category,
    ...(price === undefined ? {} : { price }),
    createdAt: LAST_EDITED,
    updatedAt: LAST_EDITED,
  };
}

function makeLine(
  id: string,
  catalogItemId: string,
  checked = false,
): ListLine {
  return {
    id,
    catalogItemId,
    checked,
    createdAt: LAST_EDITED,
    updatedAt: LAST_EDITED,
  };
}

function makeList(
  lines: ListLine[],
  id = LIST_ID,
  name = LIST_NAME,
): GroceryList {
  return {
    id,
    name,
    lines,
    createdAt: LAST_EDITED,
    updatedAt: LAST_EDITED,
  };
}

const CATALOG = {
  milk: makeItem('cat-milk', 'Milk', 'dairy', 2.5),
  bread: makeItem('cat-bread', 'Bread', 'bakery', 4),
  eggs: makeItem('cat-eggs', 'Eggs', 'dairy'),
  apples: makeItem('cat-apples', 'Apples', 'produce', 3),
  butter: makeItem('cat-butter', 'Butter', 'dairy', 3.5),
  rice: makeItem('cat-rice', 'Rice', 'other', 2),
};

const ALL_CATALOG = Object.values(CATALOG);

interface VaultFixture {
  lists?: GroceryList[];
  catalog?: CatalogItem[];
}

/** Vault fake: every write resolves unless a test overrides it. */
function makeVault({ lists = [], catalog = ALL_CATALOG }: VaultFixture = {}) {
  return {
    loading: false,
    lists,
    catalog,
    toggleLineChecked: jest.fn().mockResolvedValue(undefined),
    uncheckAllLines: jest.fn().mockResolvedValue(undefined),
    removeCheckedLines: jest.fn().mockResolvedValue([]),
    restoreLines: jest.fn().mockResolvedValue(undefined),
    deleteListLine: jest.fn().mockResolvedValue(undefined),
    addCatalogItemAndLine: jest.fn().mockResolvedValue(undefined),
    addExistingCatalogItemToLists: jest.fn().mockResolvedValue([LIST_ID]),
    deleteCatalogItem: jest.fn().mockResolvedValue(undefined),
    updateCatalogItem: jest.fn().mockResolvedValue(undefined),
    updateListLine: jest.fn().mockResolvedValue(undefined),
    renameList: jest.fn().mockResolvedValue(undefined),
    deleteList: jest.fn().mockResolvedValue(undefined),
  };
}

function renderPhoneDetail(fixture: VaultFixture = {}) {
  const vault = makeVault(fixture);
  (useGroceriesVault as jest.Mock).mockReturnValue(vault);
  render(<GroceriesListDetailClient listId={LIST_ID} handle={handle} />);
  return vault;
}

/** Clicks inside act so the async handler's state updates flush before asserting. */
async function press(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

/** Radix opens a dropdown on Enter keydown on its trigger. */
async function openMenu(triggerName: string, itemName: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: triggerName }), {
    key: 'Enter',
  });
  return screen.findByRole('menuitem', { name: itemName });
}

/** Opens the add sheet from the spend bar and returns the sheet dialog. */
function openSheetFromSpendBar() {
  fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
  return screen.findByRole('dialog', { name: `Add to ${LIST_NAME}` });
}

describe('GroceryListPhoneScreen', () => {
  beforeEach(() => {
    mockToast.mockReset();
    mockPush.mockReset();
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
    (useIsMobileState as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('list header and progress', () => {
    it('shows the list name as the level-1 heading, with no in-page back link, and the progress counts', () => {
      renderPhoneDetail({
        lists: [
          makeList([
            makeLine('line-milk', 'cat-milk'),
            makeLine('line-bread', 'cat-bread', true),
            makeLine('line-apples', 'cat-apples'),
          ]),
        ],
      });

      expect(
        screen.getByRole('heading', { level: 1, name: LIST_NAME }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.queryByRole('link', { name: /back/i })).toBeNull();
      expect(screen.getByText('1 of 3')).toBeInTheDocument();
      expect(screen.getByText('checked')).toBeInTheDocument();
      expect(screen.getByText('2 left')).toBeInTheDocument();
      expect(
        screen.getByRole('progressbar', { name: `${LIST_NAME} progress` }),
      ).toBeInTheDocument();
      // Every line is priced, so no unpriced note appears.
      expect(screen.queryByText(/unpriced/)).toBeNull();
    });
  });

  describe('line rows', () => {
    it('groups open lines by category and leaves checked lines out of the groups', () => {
      renderPhoneDetail({
        lists: [
          makeList([
            makeLine('line-milk', 'cat-milk'),
            makeLine('line-eggs', 'cat-eggs'),
            makeLine('line-bread', 'cat-bread', true),
            makeLine('line-apples', 'cat-apples'),
          ]),
        ],
      });

      const dairy = screen.getByRole('region', { name: 'Dairy' });
      expect(
        within(dairy).getByRole('heading', { name: 'Dairy · 2' }),
      ).toBeInTheDocument();
      expect(
        within(dairy).getByRole('checkbox', { name: 'Bought Milk' }),
      ).toBeInTheDocument();
      expect(
        within(dairy).getByRole('checkbox', { name: 'Bought Eggs' }),
      ).toBeInTheDocument();

      const produce = screen.getByRole('region', { name: 'Produce' });
      expect(
        within(produce).getByRole('checkbox', { name: 'Bought Apples' }),
      ).toBeInTheDocument();

      // Bread is checked, so it sits in the collapsed disclosure, not a group.
      expect(screen.queryByRole('region', { name: 'Bakery' })).toBeNull();
      expect(
        screen.queryByRole('checkbox', { name: 'Bought Bread' }),
      ).toBeNull();
    });

    it('toggles a line through the vault when its checkbox is pressed', async () => {
      const vault = renderPhoneDetail({
        lists: [makeList([makeLine('line-milk', 'cat-milk')])],
      });

      await press(screen.getByRole('checkbox', { name: 'Bought Milk' }));

      expect(vault.toggleLineChecked).toHaveBeenCalledWith(
        LIST_ID,
        'line-milk',
      );
    });

    it('opens the line edit dialog from the More menu’s Edit amount item', async () => {
      renderPhoneDetail({
        lists: [makeList([makeLine('line-milk', 'cat-milk')])],
      });

      fireEvent.click(await openMenu('More for Milk', 'Edit amount'));

      const dialog = await screen.findByRole('dialog', {
        name: 'Edit List Line',
      });
      expect(within(dialog).getByText('Quantity / Amount')).toBeInTheDocument();
    });
  });

  describe('list actions menu', () => {
    it('renames the list through the rename dialog', async () => {
      const vault = renderPhoneDetail({
        lists: [makeList([makeLine('line-milk', 'cat-milk')])],
      });

      fireEvent.click(await openMenu('List actions', 'Rename list'));

      const dialog = await screen.findByRole('dialog', { name: 'Rename List' });
      fireEvent.change(within(dialog).getByRole('textbox'), {
        target: { value: 'Errands' },
      });
      await press(within(dialog).getByRole('button', { name: 'Rename List' }));

      await waitFor(() => {
        expect(vault.renameList).toHaveBeenCalledWith(LIST_ID, 'Errands');
      });
    });

    it('disables Uncheck All and Remove Checked when no line is checked', async () => {
      const vault = renderPhoneDetail({
        lists: [makeList([makeLine('line-milk', 'cat-milk')])],
      });

      const uncheckAll = await openMenu('List actions', 'Uncheck All');
      expect(uncheckAll).toHaveAttribute('aria-disabled', 'true');
      expect(
        screen.getByRole('menuitem', { name: 'Remove Checked' }),
      ).toHaveAttribute('aria-disabled', 'true');

      await press(uncheckAll);
      expect(vault.uncheckAllLines).not.toHaveBeenCalled();
    });

    it('runs Uncheck All and Remove Checked against the vault once a line is checked', async () => {
      const vault = renderPhoneDetail({
        lists: [makeList([makeLine('line-bread', 'cat-bread', true)])],
      });

      await press(await openMenu('List actions', 'Uncheck All'));
      expect(vault.uncheckAllLines).toHaveBeenCalledWith(LIST_ID);

      await press(await openMenu('List actions', 'Remove Checked'));
      expect(vault.removeCheckedLines).toHaveBeenCalledWith(LIST_ID);
    });

    it('deletes the list after confirmation, then navigates back to Groceries', async () => {
      const vault = renderPhoneDetail({
        lists: [makeList([makeLine('line-milk', 'cat-milk')])],
      });

      fireEvent.click(await openMenu('List actions', 'Delete Grocery List…'));
      const dialog = await screen.findByRole('dialog', {
        name: `Delete "${LIST_NAME}"?`,
      });
      await press(within(dialog).getByRole('button', { name: 'Delete List' }));

      await waitFor(() => {
        expect(vault.deleteList).toHaveBeenCalledWith(LIST_ID);
      });
      expect(mockPush).toHaveBeenCalledWith('/dashboard/groceries');
    });
  });

  describe('checked disclosure', () => {
    it('stays collapsed by default and expands to show the checked lines', () => {
      renderPhoneDetail({
        lists: [
          makeList([
            makeLine('line-milk', 'cat-milk'),
            makeLine('line-bread', 'cat-bread', true),
          ]),
        ],
      });

      const toggle = screen.getByRole('button', { name: /Checked · 1/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(
        screen.queryByRole('checkbox', { name: 'Bought Bread' }),
      ).toBeNull();

      fireEvent.click(toggle);

      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(
        screen.getByRole('checkbox', { name: 'Bought Bread' }),
      ).toBeChecked();
    });
  });

  describe('all bought', () => {
    it('shows the all-bought callout when every line is checked, and its Uncheck All calls uncheckAllLines', async () => {
      const vault = renderPhoneDetail({
        lists: [
          makeList([
            makeLine('line-milk', 'cat-milk', true),
            makeLine('line-bread', 'cat-bread', true),
          ]),
        ],
      });

      expect(
        screen.getByText('All bought. Uncheck All to use it again.'),
      ).toBeInTheDocument();

      const callout = screen.getByText(
        'All bought. Uncheck All to use it again.',
      ).parentElement as HTMLElement;
      await press(within(callout).getByRole('button', { name: 'Uncheck All' }));

      expect(vault.uncheckAllLines).toHaveBeenCalledWith(LIST_ID);
    });
  });

  describe('spend bar', () => {
    it('shows known spend across all priced lines and the unpriced count', () => {
      renderPhoneDetail({
        lists: [
          makeList([
            makeLine('line-milk', 'cat-milk', true),
            makeLine('line-eggs', 'cat-eggs'),
            makeLine('line-apples', 'cat-apples'),
          ]),
        ],
      });

      expect(screen.getByText('KNOWN SPEND')).toBeInTheDocument();
      // Milk 2.50 + Apples 3.00; Eggs has no price.
      expect(screen.getByText('$5.50')).toBeInTheDocument();
      expect(screen.getByText('· 1 unpriced')).toBeInTheDocument();
    });
  });

  describe('empty list', () => {
    it('explains the empty list, points at the Catalog count, and opens the add sheet', async () => {
      renderPhoneDetail({ lists: [makeList([])] });

      expect(
        screen.getByRole('heading', {
          level: 2,
          name: 'Nothing on this list yet',
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          `Add what you need for this shop, or pick from the ${ALL_CATALOG.length} items in your Catalog.`,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText('KNOWN SPEND')).toBeNull();
      expect(screen.queryByRole('progressbar')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Add items' }));

      expect(
        await screen.findByRole('dialog', { name: `Add to ${LIST_NAME}` }),
      ).toBeInTheDocument();
    });
  });

  describe('add to list sheet', () => {
    /**
     * Milk is on this list. Eggs is on three lists, Apples and Butter on two,
     * Bread and Rice on none, so the often-bought order is deterministic.
     */
    const SHEET_LISTS = [
      makeList([makeLine('line-milk', 'cat-milk')]),
      makeList(
        [
          makeLine('line-other-eggs', 'cat-eggs'),
          makeLine('line-other-apples', 'cat-apples'),
        ],
        'list-2',
        'Party',
      ),
      makeList(
        [makeLine('h-eggs', 'cat-eggs'), makeLine('h-butter', 'cat-butter')],
        'list-3',
        'Holiday',
      ),
      makeList(
        [
          makeLine('c-eggs', 'cat-eggs'),
          makeLine('c-apples', 'cat-apples'),
          makeLine('c-butter', 'cat-butter'),
        ],
        'list-4',
        'Camping',
      ),
    ];

    it('offers up to four often-bought Catalog Items that are not on this list, most carried first', async () => {
      renderPhoneDetail({ lists: SHEET_LISTS });

      const sheet = await openSheetFromSpendBar();

      expect(
        within(sheet).getByRole('searchbox', { name: 'Search your Catalog' }),
      ).toBeInTheDocument();
      expect(
        within(sheet).getByRole('heading', { name: 'OFTEN BOUGHT' }),
      ).toBeInTheDocument();
      const chips = within(sheet)
        .getAllByRole('button', { name: /^\+ / })
        .map((chip) => chip.textContent);
      expect(chips).toEqual(['+ Eggs', '+ Apples', '+ Butter', '+ Bread']);
    });

    it('adds an often-bought chip to this list through the vault', async () => {
      const vault = renderPhoneDetail({ lists: SHEET_LISTS });

      const sheet = await openSheetFromSpendBar();
      await press(within(sheet).getByRole('button', { name: '+ Eggs' }));

      expect(vault.addExistingCatalogItemToLists).toHaveBeenCalledWith(
        'cat-eggs',
        [LIST_ID],
      );
    });

    it('searches the Catalog, marks items already on this list, and adds the others', async () => {
      const vault = renderPhoneDetail({ lists: SHEET_LISTS });

      const sheet = await openSheetFromSpendBar();
      const search = within(sheet).getByRole('searchbox');

      // Milk (already on this list) and Rice (on no list) contain "i".
      fireEvent.change(search, { target: { value: 'i' } });
      expect(
        within(sheet).getByText('FROM YOUR CATALOG · 2'),
      ).toBeInTheDocument();
      expect(
        within(sheet).getByText('already on this list'),
      ).toBeInTheDocument();
      expect(
        within(sheet).queryByRole('button', { name: 'Add Milk' }),
      ).toBeNull();

      await press(within(sheet).getByRole('button', { name: 'Add Rice' }));
      expect(vault.addExistingCatalogItemToLists).toHaveBeenCalledWith(
        'cat-rice',
        [LIST_ID],
      );

      // Apples is carried by two other lists, so the row says so.
      fireEvent.change(search, { target: { value: 'ap' } });
      expect(
        within(sheet).getByText('FROM YOUR CATALOG · 1'),
      ).toBeInTheDocument();
      expect(within(sheet).getByText('· on 2 other lists')).toBeInTheDocument();

      await press(within(sheet).getByRole('button', { name: 'Add Apples' }));
      expect(vault.addExistingCatalogItemToLists).toHaveBeenCalledWith(
        'cat-apples',
        [LIST_ID],
      );
    });

    it('hands an unknown name to the add dialog with the Item field prefilled', async () => {
      renderPhoneDetail({ lists: SHEET_LISTS });

      const sheet = await openSheetFromSpendBar();
      fireEvent.change(within(sheet).getByRole('searchbox'), {
        target: { value: 'Sourdough' },
      });
      fireEvent.click(
        within(sheet).getByRole('button', { name: /New item “Sourdough”/ }),
      );

      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: `Add to ${LIST_NAME}` }),
        ).toBeNull();
      });
      expect(await screen.findByLabelText('Item')).toHaveValue('Sourdough');
    });

    it('hides the New item offer when the query matches a Catalog name exactly, ignoring case', async () => {
      renderPhoneDetail({ lists: SHEET_LISTS });

      const sheet = await openSheetFromSpendBar();
      fireEvent.change(within(sheet).getByRole('searchbox'), {
        target: { value: 'EGGS' },
      });

      expect(
        within(sheet).getByText('FROM YOUR CATALOG · 1'),
      ).toBeInTheDocument();
      expect(
        within(sheet).queryByRole('button', { name: /New item/ }),
      ).toBeNull();
    });

    it('dismisses on Close and on Done', async () => {
      renderPhoneDetail({ lists: SHEET_LISTS });

      let sheet = await openSheetFromSpendBar();
      fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: `Add to ${LIST_NAME}` }),
        ).toBeNull();
      });

      sheet = await openSheetFromSpendBar();
      fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: `Add to ${LIST_NAME}` }),
        ).toBeNull();
      });
    });
  });
});
