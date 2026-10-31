// Mocks sit above every import, so the module graph sees them first.
const mockToast = jest.fn();

jest.mock('@myorganiser/web-vault-ui', () => ({
  VaultGate: ({
    children,
  }: {
    children: (props: { handle: unknown }) => unknown;
  }) => children({ handle: { isUnlocked: true } }),
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
  useToast: jest.fn(),
}));

import type {
  CatalogItem,
  GroceryList,
  ListLine,
} from '@myorganiser/vault-core';
import { useIsMobileState, useToast } from '@myorganiser/web-ui';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { useGroceriesVault } from '../../shared/hooks';
import { GroceriesPageClient } from '../GroceriesPageClient';

// Radix menus and dialogs need a ResizeObserver in jsdom.
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

const TIMESTAMP = '2026-10-01T09:00:00.000Z';

function catalogItem(
  id: string,
  name: string,
  category: CatalogItem['category'],
  extras: Partial<CatalogItem> = {},
): CatalogItem {
  return {
    id,
    name,
    category,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...extras,
  };
}

function listLine(
  id: string,
  catalogItemId: string,
  checked = false,
): ListLine {
  return {
    id,
    catalogItemId,
    checked,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

function groceryList(
  id: string,
  name: string,
  lines: ListLine[] = [],
): GroceryList {
  return { id, name, lines, createdAt: TIMESTAMP, updatedAt: TIMESTAMP };
}

// Milk is on both lists, Eggs on one, the rest on none.
const CATALOG = {
  milk: catalogItem('cat-milk', 'Milk', 'dairy', {
    price: 2.5,
    notes: 'Semi-skimmed',
  }),
  bread: catalogItem('cat-bread', 'Bread', 'bakery', { price: 4 }),
  eggs: catalogItem('cat-eggs', 'Eggs', 'dairy'),
  apples: catalogItem('cat-apples', 'Apples', 'produce', { price: 3 }),
  butter: catalogItem('cat-butter', 'Butter', 'dairy', { price: 3.5 }),
  rice: catalogItem('cat-rice', 'Rice', 'other', { price: 2 }),
};

const ALL_CATALOG = Object.values(CATALOG);

const weeklyShop = groceryList('list-weekly', 'Weekly shop', [
  listLine('line-1', 'cat-milk'),
  listLine('line-2', 'cat-eggs'),
]);
const party = groceryList('list-party', 'Party', [
  listLine('line-3', 'cat-bread', true),
  listLine('line-4', 'cat-milk'),
]);

interface VaultFixture {
  lists?: GroceryList[];
  catalog?: CatalogItem[];
}

/** A controllable stand-in for useGroceriesVault; mutators resolve by default. */
function makeVault({ lists = [], catalog = ALL_CATALOG }: VaultFixture = {}) {
  return {
    lists,
    catalog,
    loading: false,
    error: null,
    setError: jest.fn(),
    createList: jest.fn().mockResolvedValue(undefined),
    renameList: jest.fn().mockResolvedValue(undefined),
    deleteList: jest.fn().mockResolvedValue(undefined),
    uncheckAllLines: jest.fn().mockResolvedValue(undefined),
    addItemToLists: jest.fn().mockResolvedValue(undefined),
    addExistingCatalogItemToLists: jest.fn().mockResolvedValue([]),
    updateCatalogItem: jest.fn().mockResolvedValue(undefined),
    deleteCatalogItem: jest.fn().mockResolvedValue(undefined),
  };
}

function renderPage(fixture: VaultFixture = {}) {
  const vault = makeVault(fixture);
  (useGroceriesVault as jest.Mock).mockReturnValue(vault);
  render(<GroceriesPageClient />);
  return vault;
}

/** Switches the page to the Catalog tab and returns its panel. */
function openCatalogTab() {
  fireEvent.click(screen.getByRole('tab', { name: /^Catalog ·/ }));
  return screen.getByRole('tabpanel', { name: /^Catalog ·/ });
}

/** The Catalog row that holds the named item. */
function rowFor(name: string): HTMLElement {
  let node: HTMLElement | null = within(catalogPanel()).getByRole('button', {
    name: `Edit ${name}`,
  });
  while (
    node &&
    !(
      within(node).queryByText(name) &&
      within(node).queryByRole('button', { name: 'Add to lists' })
    )
  ) {
    node = node.parentElement;
  }
  if (!node) {
    throw new Error(`No Catalog row for ${name}`);
  }
  return node;
}

function catalogPanel() {
  return screen.getByRole('tabpanel', { name: /^Catalog ·/ });
}

const consoleSpies: jest.SpyInstance[] = [];

/** Radix opens a dropdown on Enter keydown on its trigger. */
function openRowMenu(name: string) {
  fireEvent.keyDown(
    within(catalogPanel()).getByRole('button', { name: `More for ${name}` }),
    { key: 'Enter' },
  );
}

describe('CatalogPanel', () => {
  afterEach(() => {
    for (const spy of consoleSpies.splice(0)) {
      spy.mockRestore();
    }
  });

  beforeEach(() => {
    (useGroceriesVault as jest.Mock).mockReset();
    (useIsMobileState as jest.Mock).mockReset();
    (useIsMobileState as jest.Mock).mockReturnValue(false);
    (useToast as jest.Mock).mockReset();
    (useToast as jest.Mock).mockReturnValue({
      toast: mockToast,
      toasts: [],
      dismiss: jest.fn(),
    });
    mockToast.mockReset();
  });

  it('groups items by category in shop-walk order and keeps the delete footnote', () => {
    renderPage({ lists: [weeklyShop, party] });
    openCatalogTab();

    const regions = within(catalogPanel())
      .getAllByRole('region')
      .map((region) => region.getAttribute('aria-label'));
    expect(regions).toEqual(['Produce', 'Dairy', 'Bakery', 'Other']);

    const dairy = within(catalogPanel()).getByRole('region', { name: 'Dairy' });
    expect(
      within(dairy).getByRole('heading', { level: 2, name: 'Dairy · 3' }),
    ).toBeInTheDocument();
    expect(
      within(dairy)
        .getAllByRole('button', { name: /^Edit / })
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Edit Milk', 'Edit Eggs', 'Edit Butter']);

    expect(
      within(catalogPanel()).getByText(
        `"Delete from Catalog" lives in each item's menu and asks for the item's name, because it removes the item from every list.`,
      ),
    ).toBeInTheDocument();
  });

  it('shows each row name, notes or "No notes", price or "No price", and its list-count pill', () => {
    renderPage({ lists: [weeklyShop, party] });
    openCatalogTab();

    const milk = rowFor('Milk');
    expect(within(milk).getByText('Milk')).toBeInTheDocument();
    expect(within(milk).getByText('Semi-skimmed')).toBeInTheDocument();
    expect(within(milk).getByText('$2.50')).toBeInTheDocument();
    expect(within(milk).getByText('On 2 lists')).toBeInTheDocument();

    const eggs = rowFor('Eggs');
    expect(within(eggs).getByText('No notes')).toBeInTheDocument();
    expect(within(eggs).getByText('No price')).toBeInTheDocument();
    expect(within(eggs).getByText('On 1 list')).toBeInTheDocument();

    expect(
      within(rowFor('Apples')).getByText('Not on a list'),
    ).toBeInTheDocument();
  });

  it('narrows the rows by name case-insensitively and shows the no-match status', () => {
    renderPage({ lists: [weeklyShop, party] });
    openCatalogTab();
    const filter = screen.getByRole('searchbox', {
      name: 'Filter your Catalog',
    });

    fireEvent.change(filter, { target: { value: 'BREAD' } });

    expect(
      within(catalogPanel()).getByRole('region', { name: 'Bakery' }),
    ).toBeInTheDocument();
    expect(
      within(catalogPanel()).queryByRole('region', { name: 'Dairy' }),
    ).not.toBeInTheDocument();
    expect(within(catalogPanel()).queryByText('Milk')).not.toBeInTheDocument();

    fireEvent.change(filter, { target: { value: 'zzz' } });

    expect(screen.getByRole('status')).toHaveTextContent('No catalog matches');
    expect(
      within(catalogPanel()).queryByRole('region'),
    ).not.toBeInTheDocument();
  });

  it('shows the empty-catalog copy when there are no Catalog Items', () => {
    renderPage({ lists: [], catalog: [] });
    openCatalogTab();

    expect(
      within(catalogPanel()).getByText(
        'No Catalog Items yet — add one to seed the catalog.',
      ),
    ).toBeInTheDocument();
    expect(
      within(catalogPanel()).queryByRole('region'),
    ).not.toBeInTheDocument();
  });

  it('selects All by default and narrows to one category from a chip, offering only categories in use', () => {
    renderPage({ lists: [weeklyShop, party] });
    openCatalogTab();

    const all = screen.getByRole('button', { name: 'All · 6' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    for (const label of [
      'Produce · 1',
      'Dairy · 3',
      'Bakery · 1',
      'Other · 1',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(
      screen.queryByRole('button', { name: /^Meat ·/ }),
    ).not.toBeInTheDocument();

    const dairy = screen.getByRole('button', { name: 'Dairy · 3' });
    fireEvent.click(dairy);

    expect(dairy).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveAttribute('aria-pressed', 'false');
    expect(
      within(catalogPanel()).getByRole('region', { name: 'Dairy' }),
    ).toBeInTheDocument();
    expect(
      within(catalogPanel()).queryByRole('region', { name: 'Bakery' }),
    ).not.toBeInTheDocument();
    expect(within(catalogPanel()).queryByText('Bread')).not.toBeInTheDocument();
  });

  it('disables Add to lists on every row when the vault has no lists', () => {
    renderPage({ lists: [] });
    openCatalogTab();

    const addButtons = within(catalogPanel()).getAllByRole('button', {
      name: 'Add to lists',
    });
    expect(addButtons).toHaveLength(ALL_CATALOG.length);
    for (const button of addButtons) {
      expect(button).toBeDisabled();
    }
  });

  it('disables Add to lists for an item already on every list but not for a partial one', () => {
    renderPage({ lists: [weeklyShop, party] });
    openCatalogTab();

    expect(
      within(rowFor('Milk')).getByRole('button', { name: 'Add to lists' }),
    ).toBeDisabled();
    expect(
      within(rowFor('Eggs')).getByRole('button', { name: 'Add to lists' }),
    ).toBeEnabled();
  });

  it('opens Add From Catalog preselected for the item and adds it to the chosen list with its amount', async () => {
    const vault = renderPage({ lists: [weeklyShop, party] });
    vault.addExistingCatalogItemToLists.mockResolvedValue(['list-party']);
    openCatalogTab();

    fireEvent.click(
      within(rowFor('Eggs')).getByRole('button', { name: 'Add to lists' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Add From Catalog',
    });
    expect(
      within(dialog).getByRole('heading', { name: 'Add From Catalog' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Eggs' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: 'Add to Party' }),
    );
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Amount/ }), {
      target: { value: '2' },
    });
    const submit = within(dialog).getByRole('button', { name: 'Add to Lists' });
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    await act(async () => {
      fireEvent.click(submit);
    });

    await waitFor(() => {
      expect(vault.addExistingCatalogItemToLists).toHaveBeenCalledWith(
        'cat-eggs',
        ['list-party'],
        '2',
      );
    });
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Added to lists',
      description: 'Added to 1 list.',
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('toasts the partial count when only some selected lists took the item', async () => {
    const vault = renderPage({ lists: [weeklyShop, party] });
    vault.addExistingCatalogItemToLists.mockResolvedValue(['list-party']);
    openCatalogTab();

    fireEvent.click(
      within(rowFor('Eggs')).getByRole('button', { name: 'Add to lists' }),
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: 'Add to Weekly shop' }),
    );
    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: 'Add to Party' }),
    );
    const submit = within(dialog).getByRole('button', { name: 'Add to Lists' });
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    await act(async () => {
      fireEvent.click(submit);
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Added to lists',
        description: 'Added to 1 of 2 lists (already on the rest).',
      });
    });
    expect(vault.addExistingCatalogItemToLists).toHaveBeenCalledWith(
      'cat-eggs',
      ['list-weekly', 'list-party'],
      undefined,
    );
  });

  it('toasts that nothing was added when every selected list already has the item', async () => {
    const vault = renderPage({ lists: [weeklyShop, party] });
    vault.addExistingCatalogItemToLists.mockResolvedValue([]);
    openCatalogTab();

    fireEvent.click(
      within(rowFor('Bread')).getByRole('button', { name: 'Add to lists' }),
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: 'Add to Party' }),
    );
    const submit = within(dialog).getByRole('button', { name: 'Add to Lists' });
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    await act(async () => {
      fireEvent.click(submit);
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Already on every selected list.',
      });
    });
    expect(vault.addExistingCatalogItemToLists).toHaveBeenCalledWith(
      'cat-bread',
      ['list-party'],
      undefined,
    );
  });

  // The edit-save rejection path is untested: CatalogItemEditDialog does not catch onSave rejections (pre-existing; tracked as a follow-up).
  it('opens Edit Catalog Item prefilled and saves the changed name through updateCatalogItem', async () => {
    const vault = renderPage({ lists: [weeklyShop, party] });
    openCatalogTab();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Milk' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Edit Catalog Item',
    });
    const nameField = within(dialog).getByRole('textbox', {
      name: 'Catalog Item Name',
    });
    expect(nameField).toHaveValue('Milk');
    fireEvent.change(nameField, { target: { value: 'Whole milk' } });

    const save = within(dialog).getByRole('button', {
      name: 'Save Catalog Item',
    });
    await waitFor(() => {
      expect(save).toBeEnabled();
    });
    await act(async () => {
      fireEvent.click(save);
    });

    await waitFor(() => {
      expect(vault.updateCatalogItem).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'cat-milk',
          name: 'Whole milk',
          category: 'dairy',
          price: 2.5,
        }),
      );
    });
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Edit Catalog Item' }),
      ).not.toBeInTheDocument();
    });
  });

  it('deletes from Catalog only after the exact name is typed, then toasts the deletion', async () => {
    const vault = renderPage({ lists: [weeklyShop, party] });
    openCatalogTab();

    openRowMenu('Milk');
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Delete from Catalog' }),
    );

    const dialog = await screen.findByRole('dialog', {
      name: 'Delete "Milk" from Catalog?',
    });
    const confirm = within(dialog).getByRole('button', {
      name: 'Delete From Catalog',
    });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Type "Milk" to confirm'), {
      target: { value: 'Milk' },
    });
    expect(confirm).toBeEnabled();

    await act(async () => {
      fireEvent.click(confirm);
    });

    await waitFor(() => {
      expect(vault.deleteCatalogItem).toHaveBeenCalledWith('cat-milk');
    });
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Deleted "Milk" from Catalog',
    });
  });

  it('toasts the Error copy and logs when deleting from Catalog rejects', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    consoleSpies.push(consoleError);
    const vault = renderPage({ lists: [weeklyShop, party] });
    const failure = new Error('vault write failed');
    vault.deleteCatalogItem.mockRejectedValue(failure);
    openCatalogTab();

    openRowMenu('Eggs');
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Delete from Catalog' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete "Eggs" from Catalog?',
    });
    fireEvent.change(within(dialog).getByLabelText('Type "Eggs" to confirm'), {
      target: { value: 'Eggs' },
    });
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Delete From Catalog' }),
      );
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Error',
        description: 'Failed to save your changes. Please try again.',
        variant: 'destructive',
      });
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to delete catalog item:',
      failure,
    );
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Deleted "Eggs" from Catalog' }),
    );
  });

  it('opens New Catalog Item from the header and adds the item to the catalog with no list', async () => {
    const vault = renderPage({ lists: [weeklyShop, party] });
    openCatalogTab();

    fireEvent.click(screen.getByRole('button', { name: 'New Catalog Item' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'New Catalog Item',
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Item' }), {
      target: { value: 'Oat milk' },
    });

    const submit = within(dialog).getByRole('button', {
      name: 'Add to catalog',
    });
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    await act(async () => {
      fireEvent.click(submit);
    });

    await waitFor(() => {
      expect(vault.addItemToLists).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ name: 'Oat milk', category: 'other' }),
      );
    });
    expect(mockToast).toHaveBeenCalledWith({ title: 'Added to catalog' });
  });

  it('toasts the Error copy and logs when adding to lists rejects, and keeps the dialog open', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    consoleSpies.push(consoleError);
    const vault = renderPage({ lists: [weeklyShop, party] });
    const failure = new Error('vault write failed');
    vault.addExistingCatalogItemToLists.mockRejectedValue(failure);
    openCatalogTab();

    fireEvent.click(
      within(rowFor('Eggs')).getByRole('button', { name: 'Add to lists' }),
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: 'Add to Party' }),
    );
    const submit = within(dialog).getByRole('button', { name: 'Add to Lists' });
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    await act(async () => {
      fireEvent.click(submit);
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Error',
        description: 'Failed to save your changes. Please try again.',
        variant: 'destructive',
      });
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to add existing catalog item to lists:',
      failure,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('toasts the Error copy and logs when adding a new Catalog Item rejects, and keeps the dialog open', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    consoleSpies.push(consoleError);
    const vault = renderPage({ lists: [weeklyShop, party] });
    const failure = new Error('vault write failed');
    vault.addItemToLists.mockRejectedValue(failure);
    openCatalogTab();

    fireEvent.click(screen.getByRole('button', { name: 'New Catalog Item' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'New Catalog Item',
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Item' }), {
      target: { value: 'Oat milk' },
    });
    const submit = within(dialog).getByRole('button', {
      name: 'Add to catalog',
    });
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    await act(async () => {
      fireEvent.click(submit);
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Error',
        description: 'Failed to save your changes. Please try again.',
        variant: 'destructive',
      });
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to add catalog item:',
      failure,
    );
    expect(
      screen.getByRole('dialog', { name: 'New Catalog Item' }),
    ).toBeInTheDocument();
  });
});
