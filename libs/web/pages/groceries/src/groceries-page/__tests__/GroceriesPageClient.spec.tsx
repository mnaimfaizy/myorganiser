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

const CATALOG = {
  milk: catalogItem('cat-milk', 'Milk', 'dairy', { price: 2.5 }),
  bread: catalogItem('cat-bread', 'Bread', 'bakery', { price: 4 }),
  eggs: catalogItem('cat-eggs', 'Eggs', 'dairy'),
  apples: catalogItem('cat-apples', 'Apples', 'produce', { price: 3 }),
  butter: catalogItem('cat-butter', 'Butter', 'dairy', { price: 3.5 }),
  rice: catalogItem('cat-rice', 'Rice', 'other', { price: 2 }),
};

const ALL_CATALOG = Object.values(CATALOG);

interface VaultFixture {
  lists?: GroceryList[];
  catalog?: CatalogItem[];
  loading?: boolean;
  error?: string | null;
}

/** A controllable stand-in for useGroceriesVault; mutators resolve by default. */
function makeVault({
  lists = [],
  catalog = ALL_CATALOG,
  loading = false,
  error = null,
}: VaultFixture = {}) {
  return {
    lists,
    catalog,
    loading,
    error,
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

/** Radix opens a dropdown on Enter keydown on its trigger. */
function openCardMenu(listName: string) {
  fireEvent.keyDown(
    screen.getByRole('button', { name: `Actions for ${listName}` }),
    { key: 'Enter' },
  );
}

describe('GroceriesPageClient', () => {
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

  describe('before the breakpoint is decided', () => {
    it('renders nothing, so neither the phone nor the desktop layout paints first', () => {
      (useIsMobileState as jest.Mock).mockReturnValue(undefined);
      (useGroceriesVault as jest.Mock).mockReturnValue(makeVault());

      const { container } = render(<GroceriesPageClient />);

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('loading', () => {
    it('shows a busy placeholder while the vault loads', () => {
      renderPage({ loading: true });

      const placeholder = screen.getByLabelText('Loading groceries list');
      expect(placeholder).toHaveAttribute('aria-busy', 'true');
      expect(
        screen.queryByRole('heading', { level: 1, name: 'Groceries' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('desktop Lists tab', () => {
    const weeklyShop = groceryList('list-weekly', 'Weekly shop', [
      listLine('line-1', 'cat-milk'),
      listLine('line-2', 'cat-eggs'),
    ]);
    const party = groceryList('list-party', 'Party', [
      listLine('line-3', 'cat-bread', true),
    ]);

    it('renders one page heading and a summary that names the unpriced items', () => {
      renderPage({ lists: [weeklyShop, party] });

      const headings = screen.getAllByRole('heading', { level: 1 });
      expect(headings).toHaveLength(1);
      expect(headings[0]).toHaveTextContent('Groceries');
      expect(
        screen.getByText('2 lists · $6.50 known spend · 1 item unpriced'),
      ).toBeInTheDocument();
    });

    it('omits the unpriced segment from the summary when every line is priced', () => {
      renderPage({
        lists: [
          groceryList('list-weekly', 'Weekly shop', [
            listLine('line-1', 'cat-milk'),
          ]),
          party,
        ],
      });

      expect(
        screen.getByText('2 lists · $6.50 known spend'),
      ).toBeInTheDocument();
      expect(screen.queryByText(/unpriced/)).not.toBeInTheDocument();
    });

    it('opens Create List from the header and calls createList with the typed name', async () => {
      const vault = renderPage({ lists: [weeklyShop] });

      fireEvent.click(screen.getByRole('button', { name: 'New list' }));
      const dialog = await screen.findByRole('dialog', {
        name: 'Create New List',
      });
      fireEvent.change(within(dialog).getByRole('textbox'), {
        target: { value: 'Camping' },
      });
      await act(async () => {
        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Create List' }),
        );
      });

      await waitFor(() => {
        expect(vault.createList).toHaveBeenCalledWith('Camping');
      });
      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'Create New List' }),
        ).not.toBeInTheDocument();
      });
    });

    it('selects Lists by default and shows the Catalog summary after clicking Catalog', async () => {
      renderPage({ lists: [weeklyShop, party] });

      expect(screen.getByRole('tab', { name: 'Lists · 2' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(
        screen.getByRole('button', { name: 'New list' }),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: 'Catalog · 6' }));

      expect(screen.getByRole('tab', { name: 'Catalog · 6' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(
        screen.getByText(
          'Your Catalog keeps names, prices and notes so every list can reuse them.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'New Catalog Item' }),
      ).toBeInTheDocument();
    });

    it('moves the selected tab with ArrowRight on the tablist', () => {
      renderPage({ lists: [weeklyShop, party] });

      fireEvent.keyDown(screen.getByRole('tab', { name: 'Lists · 2' }), {
        key: 'ArrowRight',
      });

      expect(screen.getByRole('tab', { name: 'Catalog · 6' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByRole('tab', { name: 'Lists · 2' })).toHaveAttribute(
        'aria-selected',
        'false',
      );
    });

    it('wraps ArrowLeft from Lists to Catalog, and Home and End jump to the ends', () => {
      renderPage({ lists: [weeklyShop, party] });
      const tablist = screen.getByRole('tablist', { name: 'Groceries' });

      fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
      expect(screen.getByRole('tab', { name: 'Catalog · 6' })).toHaveAttribute(
        'aria-selected',
        'true',
      );

      fireEvent.keyDown(tablist, { key: 'Home' });
      expect(screen.getByRole('tab', { name: 'Lists · 2' })).toHaveAttribute(
        'aria-selected',
        'true',
      );

      fireEvent.keyDown(tablist, { key: 'End' });
      expect(screen.getByRole('tab', { name: 'Catalog · 6' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    it('leaves the selected tab unchanged for keys the tablist does not handle', () => {
      renderPage({ lists: [weeklyShop, party] });

      fireEvent.keyDown(screen.getByRole('tablist', { name: 'Groceries' }), {
        key: 'ArrowDown',
      });

      expect(screen.getByRole('tab', { name: 'Lists · 2' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByRole('tab', { name: 'Catalog · 6' })).toHaveAttribute(
        'aria-selected',
        'false',
      );
    });
  });

  describe('list cards', () => {
    it('shows the list link, known spend, unpriced count, progress and checked counts', () => {
      renderPage({
        lists: [
          groceryList('list-weekly', 'Weekly shop', [
            listLine('line-1', 'cat-milk'),
            listLine('line-2', 'cat-eggs'),
            listLine('line-3', 'cat-bread', true),
          ]),
        ],
      });

      const card = screen.getByRole('article');
      expect(
        within(card).getByRole('link', { name: 'Weekly shop' }),
      ).toHaveAttribute('href', '/dashboard/groceries/list-weekly');
      expect(within(card).getByText('$6.50')).toBeInTheDocument();
      expect(within(card).getByText('1 unpriced')).toBeInTheDocument();
      expect(
        within(card).getByRole('progressbar', {
          name: 'Weekly shop progress',
        }),
      ).toHaveAttribute('aria-valuenow', '1');
      expect(
        within(card).getByText('1 of 3 checked · 2 left'),
      ).toBeInTheDocument();
    });

    it('names the first four open items in STILL TO BUY and counts the rest', () => {
      renderPage({
        lists: [
          groceryList('list-weekly', 'Weekly shop', [
            listLine('line-1', 'cat-milk'),
            listLine('line-2', 'cat-bread'),
            listLine('line-3', 'cat-apples'),
            listLine('line-4', 'cat-butter'),
            listLine('line-5', 'cat-rice'),
            listLine('line-6', 'cat-eggs'),
          ]),
        ],
      });

      const card = screen.getByRole('article');
      expect(within(card).getByText('STILL TO BUY')).toBeInTheDocument();
      for (const name of ['Milk', 'Bread', 'Apples', 'Butter']) {
        expect(within(card).getByText(name)).toBeInTheDocument();
      }
      expect(within(card).queryByText('Rice')).not.toBeInTheDocument();
      expect(within(card).getByText('+2 more')).toBeInTheDocument();
    });

    it('shows the all-bought callout and calls uncheckAllLines from Uncheck All', async () => {
      const vault = renderPage({
        lists: [
          groceryList('list-weekly', 'Weekly shop', [
            listLine('line-1', 'cat-milk', true),
            listLine('line-2', 'cat-bread', true),
          ]),
        ],
      });

      const card = screen.getByRole('article');
      expect(
        within(card).getByText('All bought. Uncheck All to use it again.'),
      ).toBeInTheDocument();
      expect(within(card).queryByText('STILL TO BUY')).not.toBeInTheDocument();

      await act(async () => {
        fireEvent.click(
          within(card).getByRole('button', { name: 'Uncheck All' }),
        );
      });

      await waitFor(() => {
        expect(vault.uncheckAllLines).toHaveBeenCalledWith('list-weekly');
      });
      expect(mockToast).not.toHaveBeenCalled();
    });

    it('shows the Error toast when uncheckAllLines rejects', async () => {
      const consoleError = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      try {
        const vault = renderPage({
          lists: [
            groceryList('list-weekly', 'Weekly shop', [
              listLine('line-1', 'cat-milk', true),
            ]),
          ],
        });
        const failure = new Error('vault write failed');
        vault.uncheckAllLines.mockRejectedValue(failure);

        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Uncheck All' }));
        });

        await waitFor(() => {
          expect(mockToast).toHaveBeenCalledWith({
            title: 'Error',
            description: 'Failed to save your changes. Please try again.',
            variant: 'destructive',
          });
        });
        expect(consoleError).toHaveBeenCalledWith(
          'Failed to uncheck all lines:',
          failure,
        );
      } finally {
        consoleError.mockRestore();
      }
    });

    it('shows the empty copy and an Add items link for a list with no lines', () => {
      renderPage({
        lists: [groceryList('list-empty', 'Camping', [])],
      });

      const card = screen.getByRole('article');
      expect(
        within(card).getByText('Nothing on this list yet'),
      ).toBeInTheDocument();
      expect(
        within(card).getByRole('link', { name: 'Add items' }),
      ).toHaveAttribute('href', '/dashboard/groceries/list-empty');
    });

    it('renames a list through the card menu and calls renameList with the new name', async () => {
      const vault = renderPage({
        lists: [
          groceryList('list-weekly', 'Weekly shop', [
            listLine('line-1', 'cat-milk'),
          ]),
        ],
      });

      openCardMenu('Weekly shop');
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Rename list' }),
      );

      const dialog = await screen.findByRole('dialog', { name: 'Rename List' });
      const input = within(dialog).getByRole('textbox');
      expect(input).toHaveValue('Weekly shop');
      fireEvent.change(input, { target: { value: 'Party shop' } });
      await act(async () => {
        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Rename List' }),
        );
      });

      await waitFor(() => {
        expect(vault.renameList).toHaveBeenCalledWith(
          'list-weekly',
          'Party shop',
        );
      });
      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'Rename List' }),
        ).not.toBeInTheDocument();
      });
    });

    it('deletes a list through the card menu and calls deleteList once confirmed', async () => {
      const vault = renderPage({
        lists: [
          groceryList('list-weekly', 'Weekly shop', [
            listLine('line-1', 'cat-milk'),
          ]),
        ],
      });

      openCardMenu('Weekly shop');
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Delete Grocery List…' }),
      );

      const dialog = await screen.findByRole('dialog', {
        name: 'Delete "Weekly shop"?',
      });
      await act(async () => {
        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Delete List' }),
        );
      });

      await waitFor(() => {
        expect(vault.deleteList).toHaveBeenCalledWith('list-weekly');
      });
    });

    it('shows the New list tile with zero lists and opens Create List from it', async () => {
      renderPage({ lists: [] });

      const tile = screen.getByRole('button', {
        name: /For the next shop or an occasion/,
      });
      fireEvent.click(tile);

      expect(
        await screen.findByRole('dialog', { name: 'Create New List' }),
      ).toBeInTheDocument();
    });

    it('calls setError(null) when Dismiss is clicked on the vault error banner', () => {
      const vault = renderPage({
        lists: [],
        error: 'Failed to save your changes. Please try again.',
      });

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(
        'Failed to save your changes. Please try again.',
      );
      fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }));

      expect(vault.setError).toHaveBeenCalledWith(null);
    });
  });

  describe('phone', () => {
    beforeEach(() => {
      (useIsMobileState as jest.Mock).mockReturnValue(true);
    });

    it('keeps one visually hidden page heading and a phone summary without the unpriced segment', () => {
      renderPage({
        lists: [
          groceryList('list-weekly', 'Weekly shop', [
            listLine('line-1', 'cat-milk'),
          ]),
          groceryList('list-party', 'Party', [
            listLine('line-2', 'cat-bread', true),
          ]),
        ],
      });

      const headings = screen.getAllByRole('heading', { level: 1 });
      expect(headings).toHaveLength(1);
      expect(headings[0]).toHaveTextContent('Groceries');
      expect(headings[0]).toHaveClass('sr-only');
      expect(screen.getByText('2 lists · $6.50 known')).toBeInTheDocument();
    });

    it('shows the phone sub-line for each list state', () => {
      renderPage({
        lists: [
          groceryList('list-empty', 'Camping', []),
          groceryList('list-done', 'Done list', [
            listLine('line-1', 'cat-bread', true),
          ]),
          groceryList('list-mixed', 'Mixed list', [
            listLine('line-2', 'cat-milk', true),
            listLine('line-3', 'cat-eggs'),
          ]),
          groceryList('list-open', 'Open list', [
            listLine('line-4', 'cat-apples'),
          ]),
        ],
      });

      expect(screen.getByText('Nothing on it yet')).toBeInTheDocument();
      expect(
        screen.getByText('All bought · Uncheck All to reuse'),
      ).toBeInTheDocument();
      expect(screen.getByText('1 of 2 · 1 unpriced')).toBeInTheDocument();
      expect(screen.getByText('0 of 1 checked')).toBeInTheDocument();
    });

    it('opens Create List from the Lists FAB and the add dialog from the Catalog FAB', async () => {
      renderPage({ lists: [] });

      fireEvent.click(screen.getByRole('button', { name: 'New list' }));
      expect(
        await screen.findByRole('dialog', { name: 'Create New List' }),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'Create New List' }),
        ).not.toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('tab', { name: 'Catalog · 6' }));
      fireEvent.click(screen.getByRole('button', { name: 'New Catalog Item' }));
      expect(
        await screen.findByRole('dialog', { name: 'New Catalog Item' }),
      ).toBeInTheDocument();
    });

    it('shows the empty copy and the New list FAB on the Lists tab, then New Catalog Item on Catalog', () => {
      renderPage({ lists: [] });

      expect(screen.getByText('No grocery lists yet')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'New list' }),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: 'Catalog · 6' }));

      expect(
        screen.getByRole('button', { name: 'New Catalog Item' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'New list' }),
      ).not.toBeInTheDocument();
    });
  });
});
