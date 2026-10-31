/*
  Desktop Grocery List body tests, rendered through GroceriesListDetailClient.
  - Covers the open lines in shop-walk order, the Bought checkbox, the collapsed
    Checked section (Uncheck All, Remove Checked with Undo), the all-bought and
    empty states, the Catalog add strip, the row menu (two-step remove, delete
    from Catalog, edit amount), and the List summary aside.
  - Error paths: five rejected writes (Uncheck All, Remove Checked, remove line,
    add Catalog chip, delete from Catalog) each raise the Error toast. A rejected
    line-amount save raises one Error toast and keeps its dialog open with the
    typed amount.
  - Renders the real page hook, view, dialogs, and web-ui (Radix menus and dialogs).
  - Mocks: useGroceriesVault (controllable vault fake), next/navigation
    useRouter, useIsMobileState (forced to desktop), and useToast (a spy, because
    the toast store is module-global; the Undo action is rendered in a real toast root).
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

import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import type {
  CatalogItem,
  GroceryList,
  ListLine,
} from '@myorganiser/vault-core';
import type { VaultHandle } from '@myorganiser/web-vault';
import { Toast, ToastProvider, ToastViewport } from '@myorganiser/web-ui';
import { useIsMobileState } from '@myorganiser/web-ui';
import { useRouter } from 'next/navigation';
import { useGroceriesVault } from '../../shared/hooks';
import { GroceriesListDetailClient } from '../GroceriesListDetailClient';

// Every fixture was last edited three hours ago, so the activity line is stable.
const LAST_EDITED = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
const LIST_ID = 'list-1';
const ERROR_TOAST = {
  title: 'Error',
  description: 'Failed to save your changes. Please try again.',
  variant: 'destructive',
};

const handle = { isUnlocked: true } as unknown as VaultHandle;
const mockUseGroceriesVault = useGroceriesVault as jest.Mock;
const mockUseRouter = useRouter as jest.Mock;
const mockUseIsMobileState = useIsMobileState as jest.Mock;

const apples: CatalogItem = {
  id: 'cat-apples',
  name: 'Apples',
  category: 'produce',
  price: 3,
  createdAt: LAST_EDITED,
  updatedAt: LAST_EDITED,
};
const milk: CatalogItem = {
  id: 'cat-milk',
  name: 'Milk',
  category: 'dairy',
  price: 2.5,
  notes: 'semi-skimmed',
  createdAt: LAST_EDITED,
  updatedAt: LAST_EDITED,
};
const bread: CatalogItem = {
  id: 'cat-bread',
  name: 'Bread',
  category: 'bakery',
  createdAt: LAST_EDITED,
  updatedAt: LAST_EDITED,
};
const CATALOG = [apples, milk, bread];

function makeLine(
  id: string,
  catalogItemId: string,
  overrides: Partial<ListLine> = {},
): ListLine {
  return {
    id,
    catalogItemId,
    checked: false,
    createdAt: LAST_EDITED,
    updatedAt: LAST_EDITED,
    ...overrides,
  };
}

function makeList(
  lines: ListLine[],
  overrides: Partial<GroceryList> = {},
): GroceryList {
  return {
    id: LIST_ID,
    name: 'Weekly shop',
    lines,
    createdAt: LAST_EDITED,
    updatedAt: LAST_EDITED,
    ...overrides,
  };
}

/** Vault fake: every write resolves unless a test overrides it. */
function makeVault(overrides: Record<string, unknown> = {}) {
  return {
    loading: false,
    lists: [] as GroceryList[],
    catalog: CATALOG,
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
    ...overrides,
  };
}

function renderDetail() {
  return render(<GroceriesListDetailClient listId={LIST_ID} handle={handle} />);
}

/** Clicks inside act so the async handler's state updates flush before asserting. */
async function press(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

/** Opens a row's "More for {name}" menu the way a keyboard user would. */
async function openRowMenu(name: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: `More for ${name}` }), {
    key: 'Enter',
  });
  return screen.findByRole('menu');
}

/** Renders a toast action (Undo) inside a real toast root so it can be clicked. */
function renderToastAction(action: ReactNode) {
  return render(
    <ToastProvider>
      <Toast>{action}</Toast>
      <ToastViewport />
    </ToastProvider>,
  );
}

describe('GroceryListView (desktop body)', () => {
  beforeEach(() => {
    mockToast.mockReset();
    mockPush.mockReset();
    mockUseRouter.mockReturnValue({ push: mockPush });
    mockUseIsMobileState.mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('open lines', () => {
    it('groups open lines in shop-walk order and shows each line’s meta, or No price', () => {
      // Inserted milk, bread, apples: the groups must follow the shop, not the insertion order.
      const lines = [
        makeLine('line-milk', 'cat-milk', { amount: '2' }),
        makeLine('line-bread', 'cat-bread'),
        makeLine('line-apples', 'cat-apples', { amount: '6' }),
      ];
      mockUseGroceriesVault.mockReturnValue(
        makeVault({ lists: [makeList(lines)] }),
      );

      renderDetail();

      const groupNames = screen
        .getAllByRole('region')
        .map((region) => region.getAttribute('aria-label'))
        .filter((name) => ['Produce', 'Dairy', 'Bakery'].includes(name ?? ''));
      expect(groupNames).toEqual(['Produce', 'Dairy', 'Bakery']);
      expect(
        within(screen.getByRole('region', { name: 'Produce' })).getByRole(
          'heading',
        ),
      ).toHaveTextContent('Produce · 1');
      expect(screen.getByText('6 · $3.00')).toBeInTheDocument();
      expect(screen.getByText('2 · $2.50 · semi-skimmed')).toBeInTheDocument();
      expect(screen.getByText('No price')).toBeInTheDocument();
    });

    it('toggles a line through toggleLineChecked when its Bought checkbox is clicked', async () => {
      const vault = makeVault({
        lists: [makeList([makeLine('line-milk', 'cat-milk')])],
      });
      mockUseGroceriesVault.mockReturnValue(vault);
      renderDetail();

      await press(screen.getByRole('checkbox', { name: 'Bought Milk' }));

      await waitFor(() =>
        expect(vault.toggleLineChecked).toHaveBeenCalledWith(
          LIST_ID,
          'line-milk',
        ),
      );
    });

    it('shows an error toast and re-enables the line when toggling it is rejected', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      mockUseGroceriesVault.mockReturnValue(
        makeVault({
          lists: [makeList([makeLine('line-milk', 'cat-milk')])],
          toggleLineChecked: jest
            .fn()
            .mockRejectedValue(new Error('write failed')),
        }),
      );
      renderDetail();

      await press(screen.getByRole('checkbox', { name: 'Bought Milk' }));

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Error',
          description: 'Failed to save your changes. Please try again.',
          variant: 'destructive',
        }),
      );
      await waitFor(() =>
        expect(
          screen.getByRole('checkbox', { name: 'Bought Milk' }),
        ).toBeEnabled(),
      );
    });

    it('edits a line amount through updateListLine', async () => {
      const vault = makeVault({
        lists: [makeList([makeLine('line-milk', 'cat-milk', { amount: '2' })])],
      });
      mockUseGroceriesVault.mockReturnValue(vault);
      renderDetail();

      await press(screen.getByRole('button', { name: 'Edit amount for Milk' }));
      const dialog = await screen.findByRole('dialog', {
        name: 'Edit List Line',
      });
      fireEvent.change(within(dialog).getByLabelText('Quantity / Amount'), {
        target: { value: '3' },
      });
      await press(
        within(dialog).getByRole('button', { name: 'Save List Line' }),
      );

      await waitFor(() =>
        expect(vault.updateListLine).toHaveBeenCalledWith(LIST_ID, {
          id: 'line-milk',
          amount: '3',
        }),
      );
    });

    it('keeps the line dialog open with the typed amount when updateListLine rejects, and toasts once', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const vault = makeVault({
        lists: [makeList([makeLine('line-milk', 'cat-milk', { amount: '2' })])],
        updateListLine: jest.fn().mockRejectedValue(new Error('write failed')),
      });
      mockUseGroceriesVault.mockReturnValue(vault);
      renderDetail();

      await press(screen.getByRole('button', { name: 'Edit amount for Milk' }));
      const dialog = await screen.findByRole('dialog', {
        name: 'Edit List Line',
      });
      fireEvent.change(within(dialog).getByLabelText('Quantity / Amount'), {
        target: { value: '3' },
      });
      await press(
        within(dialog).getByRole('button', { name: 'Save List Line' }),
      );

      await waitFor(() => expect(mockToast).toHaveBeenCalledWith(ERROR_TOAST));
      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(vault.updateListLine).toHaveBeenCalledWith(LIST_ID, {
        id: 'line-milk',
        amount: '3',
      });
      expect(
        screen.getByRole('dialog', { name: 'Edit List Line' }),
      ).toBeInTheDocument();
      expect(within(dialog).getByLabelText('Quantity / Amount')).toHaveValue(
        '3',
      );
    });

    it('removes a line only after the second Remove from list selection', async () => {
      const vault = makeVault({
        lists: [makeList([makeLine('line-milk', 'cat-milk')])],
      });
      mockUseGroceriesVault.mockReturnValue(vault);
      renderDetail();

      await openRowMenu('Milk');
      await press(screen.getByRole('menuitem', { name: 'Remove from list' }));

      expect(vault.deleteListLine).not.toHaveBeenCalled();
      await press(
        await screen.findByRole('menuitem', { name: 'Confirm remove line' }),
      );

      await waitFor(() =>
        expect(vault.deleteListLine).toHaveBeenCalledWith(LIST_ID, 'line-milk'),
      );
    });

    it('deletes a Catalog Item after its name is typed, warns about other lists, and toasts', async () => {
      const vault = makeVault({
        lists: [
          makeList([makeLine('line-milk', 'cat-milk')]),
          makeList([makeLine('line-other', 'cat-milk')], {
            id: 'list-2',
            name: 'Party',
          }),
        ],
      });
      mockUseGroceriesVault.mockReturnValue(vault);
      renderDetail();

      await openRowMenu('Milk');
      await press(
        screen.getByRole('menuitem', { name: 'Delete from Catalog' }),
      );
      const dialog = await screen.findByRole('dialog', {
        name: 'Delete "Milk" from Catalog?',
      });
      expect(
        within(dialog).getByText(
          /This will also remove it from 1 other Grocery List\./,
        ),
      ).toBeInTheDocument();

      fireEvent.change(
        within(dialog).getByLabelText('Type "Milk" to confirm'),
        {
          target: { value: 'Milk' },
        },
      );
      await press(
        within(dialog).getByRole('button', { name: 'Delete From Catalog' }),
      );

      await waitFor(() =>
        expect(vault.deleteCatalogItem).toHaveBeenCalledWith('cat-milk'),
      );
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Deleted "Milk" from Catalog',
      });
    });
  });

  describe('checked lines', () => {
    it('keeps checked lines hidden in a collapsed section until it is expanded', async () => {
      mockUseGroceriesVault.mockReturnValue(
        makeVault({
          lists: [
            makeList([
              makeLine('line-milk', 'cat-milk', { checked: true }),
              makeLine('line-apples', 'cat-apples'),
            ]),
          ],
        }),
      );
      renderDetail();

      const checked = screen.getByRole('region', { name: 'Checked' });
      const toggle = within(checked).getByRole('button', {
        name: /^Checked · 1/,
      });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(
        screen.queryByRole('checkbox', { name: 'Bought Milk' }),
      ).not.toBeInTheDocument();

      await press(toggle);

      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(
        screen.getByRole('checkbox', { name: 'Bought Milk' }),
      ).toBeChecked();
      expect(within(checked).getByText('Milk')).toHaveClass('line-through');
    });

    it('Uncheck All in the Checked section calls uncheckAllLines', async () => {
      const vault = makeVault({
        lists: [
          makeList([
            makeLine('line-milk', 'cat-milk', { checked: true }),
            makeLine('line-apples', 'cat-apples'),
          ]),
        ],
      });
      mockUseGroceriesVault.mockReturnValue(vault);
      renderDetail();

      await press(
        within(screen.getByRole('region', { name: 'Checked' })).getByRole(
          'button',
          { name: 'Uncheck All' },
        ),
      );

      await waitFor(() =>
        expect(vault.uncheckAllLines).toHaveBeenCalledWith(LIST_ID),
      );
    });

    it('Remove Checked calls removeCheckedLines, and Undo restores the removed lines', async () => {
      const checkedMilk = makeLine('line-milk', 'cat-milk', { checked: true });
      const vault = makeVault({
        lists: [makeList([checkedMilk, makeLine('line-apples', 'cat-apples')])],
        removeCheckedLines: jest.fn().mockResolvedValue([checkedMilk]),
      });
      mockUseGroceriesVault.mockReturnValue(vault);
      renderDetail();

      await press(
        within(screen.getByRole('region', { name: 'Checked' })).getByRole(
          'button',
          { name: 'Remove Checked' },
        ),
      );

      await waitFor(() =>
        expect(vault.removeCheckedLines).toHaveBeenCalledWith(LIST_ID),
      );
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Checked items removed',
          description: '1 Checked Item removed from this Grocery List.',
        }),
      );

      const { action } = mockToast.mock.calls[0][0];
      renderToastAction(action);
      await press(screen.getByRole('button', { name: 'Undo' }));

      expect(vault.restoreLines).toHaveBeenCalledWith(LIST_ID, [checkedMilk]);
    });

    it('reports that there is nothing to remove when the vault removes no lines', async () => {
      mockUseGroceriesVault.mockReturnValue(
        makeVault({
          lists: [
            makeList([
              makeLine('line-milk', 'cat-milk', { checked: true }),
              makeLine('line-apples', 'cat-apples'),
            ]),
          ],
          removeCheckedLines: jest.fn().mockResolvedValue([]),
        }),
      );
      renderDetail();

      await press(
        within(screen.getByRole('region', { name: 'Checked' })).getByRole(
          'button',
          { name: 'Remove Checked' },
        ),
      );

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith({
          title: 'No checked items to remove.',
        }),
      );
    });

    it('shows the all-bought callout when every open line is checked, and its Uncheck All clears them', async () => {
      const vault = makeVault({
        lists: [
          makeList([
            makeLine('line-milk', 'cat-milk', { checked: true }),
            makeLine('line-apples', 'cat-apples', { checked: true }),
          ]),
        ],
      });
      mockUseGroceriesVault.mockReturnValue(vault);
      renderDetail();

      const callout = screen.getByText(
        'All bought. Uncheck All to use it again.',
      ).parentElement as HTMLElement;
      await press(within(callout).getByRole('button', { name: 'Uncheck All' }));

      await waitFor(() =>
        expect(vault.uncheckAllLines).toHaveBeenCalledWith(LIST_ID),
      );
    });
  });

  describe('empty list', () => {
    it('explains the empty list, counts the Catalog, and opens the add dialog from Add items', async () => {
      mockUseGroceriesVault.mockReturnValue(
        makeVault({ lists: [makeList([])] }),
      );
      renderDetail();

      expect(
        screen.getByRole('heading', { name: 'Nothing on this list yet' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Add what you need for this shop, or pick from the 3 items in your Catalog.',
        ),
      ).toBeInTheDocument();

      await press(screen.getByRole('button', { name: 'Add items' }));

      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('Catalog add strip', () => {
    it('adds a Catalog item to this list from its chip and disables chips already on it', async () => {
      const vault = makeVault({
        lists: [makeList([makeLine('line-milk', 'cat-milk')])],
      });
      mockUseGroceriesVault.mockReturnValue(vault);
      renderDetail();

      expect(
        screen.getByRole('button', { name: 'Milk already on list' }),
      ).toBeDisabled();

      await press(screen.getByRole('button', { name: 'Add Apples to list' }));

      await waitFor(() =>
        expect(vault.addExistingCatalogItemToLists).toHaveBeenCalledWith(
          'cat-apples',
          [LIST_ID],
        ),
      );
    });

    it('reports when the chosen Catalog item is already on the list', async () => {
      mockUseGroceriesVault.mockReturnValue(
        makeVault({
          lists: [makeList([])],
          addExistingCatalogItemToLists: jest.fn().mockResolvedValue([]),
        }),
      );
      renderDetail();

      await press(screen.getByRole('button', { name: 'Add Bread to list' }));

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Already on this list.',
        }),
      );
    });

    it('filters the Catalog chips by the name typed in Add from your Catalog', () => {
      mockUseGroceriesVault.mockReturnValue(
        makeVault({ lists: [makeList([])] }),
      );
      renderDetail();

      // Query the input once: its accessible name can include the typed value.
      const search = screen.getByRole('searchbox', {
        name: 'Add from your Catalog',
      });
      fireEvent.change(search, { target: { value: 'app' } });

      expect(
        screen.getByRole('button', { name: 'Add Apples to list' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Add Bread to list' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('List summary aside', () => {
    it('states known spend, basket, remaining, and unpriced counts from Catalog prices, not amounts', () => {
      // Milk is checked with amount 3; amounts are labels, so spend stays at the catalog price.
      mockUseGroceriesVault.mockReturnValue(
        makeVault({
          lists: [
            makeList([
              makeLine('line-milk', 'cat-milk', { checked: true, amount: '3' }),
              makeLine('line-apples', 'cat-apples', { amount: '6' }),
              makeLine('line-bread', 'cat-bread'),
            ]),
          ],
        }),
      );
      renderDetail();

      const aside = screen.getByRole('complementary', { name: 'List summary' });
      expect(within(aside).getByText('$5.50')).toBeInTheDocument();
      expect(
        within(
          within(aside).getByText('In the basket').parentElement as HTMLElement,
        ).getByText('$2.50'),
      ).toBeInTheDocument();
      expect(
        within(
          within(aside).getByText('Still to buy').parentElement as HTMLElement,
        ).getByText('$3.00'),
      ).toBeInTheDocument();
      expect(
        within(
          within(aside).getByText('Without a price')
            .parentElement as HTMLElement,
        ).getByText('1 item'),
      ).toBeInTheDocument();
    });
  });

  describe('rejected writes', () => {
    it('shows the error toast when Uncheck All is rejected', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      mockUseGroceriesVault.mockReturnValue(
        makeVault({
          lists: [
            makeList([
              makeLine('line-milk', 'cat-milk', { checked: true }),
              makeLine('line-apples', 'cat-apples'),
            ]),
          ],
          uncheckAllLines: jest
            .fn()
            .mockRejectedValue(new Error('write failed')),
        }),
      );
      renderDetail();

      await press(
        within(screen.getByRole('region', { name: 'Checked' })).getByRole(
          'button',
          { name: 'Uncheck All' },
        ),
      );

      await waitFor(() => expect(mockToast).toHaveBeenCalledWith(ERROR_TOAST));
    });

    it('shows the error toast when Remove Checked is rejected', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      mockUseGroceriesVault.mockReturnValue(
        makeVault({
          lists: [
            makeList([
              makeLine('line-milk', 'cat-milk', { checked: true }),
              makeLine('line-apples', 'cat-apples'),
            ]),
          ],
          removeCheckedLines: jest
            .fn()
            .mockRejectedValue(new Error('write failed')),
        }),
      );
      renderDetail();

      await press(
        within(screen.getByRole('region', { name: 'Checked' })).getByRole(
          'button',
          { name: 'Remove Checked' },
        ),
      );

      await waitFor(() => expect(mockToast).toHaveBeenCalledWith(ERROR_TOAST));
    });

    it('shows the error toast when the second Remove from list selection is rejected', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      mockUseGroceriesVault.mockReturnValue(
        makeVault({
          lists: [makeList([makeLine('line-milk', 'cat-milk')])],
          deleteListLine: jest
            .fn()
            .mockRejectedValue(new Error('write failed')),
        }),
      );
      renderDetail();

      await openRowMenu('Milk');
      await press(screen.getByRole('menuitem', { name: 'Remove from list' }));
      await press(
        await screen.findByRole('menuitem', { name: 'Confirm remove line' }),
      );

      await waitFor(() => expect(mockToast).toHaveBeenCalledWith(ERROR_TOAST));
    });

    it('shows the error toast when adding a Catalog chip is rejected', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      mockUseGroceriesVault.mockReturnValue(
        makeVault({
          lists: [makeList([])],
          addExistingCatalogItemToLists: jest
            .fn()
            .mockRejectedValue(new Error('write failed')),
        }),
      );
      renderDetail();

      await press(screen.getByRole('button', { name: 'Add Apples to list' }));

      await waitFor(() => expect(mockToast).toHaveBeenCalledWith(ERROR_TOAST));
    });

    it('shows the error toast when deleting the Catalog item is rejected', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      mockUseGroceriesVault.mockReturnValue(
        makeVault({
          lists: [makeList([makeLine('line-milk', 'cat-milk')])],
          deleteCatalogItem: jest
            .fn()
            .mockRejectedValue(new Error('write failed')),
        }),
      );
      renderDetail();

      await openRowMenu('Milk');
      await press(
        screen.getByRole('menuitem', { name: 'Delete from Catalog' }),
      );
      const dialog = await screen.findByRole('dialog', {
        name: 'Delete "Milk" from Catalog?',
      });
      fireEvent.change(
        within(dialog).getByLabelText('Type "Milk" to confirm'),
        {
          target: { value: 'Milk' },
        },
      );
      await press(
        within(dialog).getByRole('button', { name: 'Delete From Catalog' }),
      );

      await waitFor(() => expect(mockToast).toHaveBeenCalledWith(ERROR_TOAST));
    });
  });
});
