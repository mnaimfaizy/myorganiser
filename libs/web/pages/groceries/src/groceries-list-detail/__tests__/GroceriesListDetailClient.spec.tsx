/*
  Route-level tests for GroceriesListDetailClient on the desktop layout.
  - Covers the loading and not-found states, the list heading and count line,
    and the whole-list actions (rename, delete) with their toast and navigation.
  - Renders the real page hook, desktop view, dialogs, and web-ui (Radix Dialog).
  - Mocks: useGroceriesVault (controllable vault fake), next/navigation
    useRouter, useIsMobileState (forced to desktop), and useToast (a spy, because
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

const handle = { isUnlocked: true } as unknown as VaultHandle;
const mockUseGroceriesVault = useGroceriesVault as jest.Mock;
const mockUseRouter = useRouter as jest.Mock;
const mockUseIsMobileState = useIsMobileState as jest.Mock;

function makeItem(
  id: string,
  name: string,
  overrides: Partial<CatalogItem> = {},
): CatalogItem {
  return {
    id,
    name,
    category: 'produce',
    createdAt: LAST_EDITED,
    updatedAt: LAST_EDITED,
    ...overrides,
  };
}

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

function makeList(lines: ListLine[]): GroceryList {
  return {
    id: LIST_ID,
    name: 'Weekly shop',
    lines,
    createdAt: LAST_EDITED,
    updatedAt: LAST_EDITED,
  };
}

/** Vault fake: every write resolves unless a test overrides it. */
function makeVault(overrides: Record<string, unknown> = {}) {
  return {
    loading: false,
    lists: [] as GroceryList[],
    catalog: [] as CatalogItem[],
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

function renderDetail(listId = LIST_ID) {
  return render(<GroceriesListDetailClient listId={listId} handle={handle} />);
}

/** Clicks inside act so the async handler's state updates flush before asserting. */
async function press(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

describe('GroceriesListDetailClient (desktop)', () => {
  beforeEach(() => {
    mockToast.mockReset();
    mockPush.mockReset();
    mockUseRouter.mockReturnValue({ push: mockPush });
    mockUseIsMobileState.mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('route states', () => {
    it('shows a busy loading placeholder while the vault loads', () => {
      mockUseGroceriesVault.mockReturnValue(makeVault({ loading: true }));

      renderDetail();

      expect(screen.getByLabelText('Loading grocery list')).toHaveAttribute(
        'aria-busy',
        'true',
      );
      expect(
        screen.queryByRole('heading', { level: 1 }),
      ).not.toBeInTheDocument();
    });

    it('shows List not found with a link back to Groceries for an unknown list id', () => {
      mockUseGroceriesVault.mockReturnValue(
        makeVault({ lists: [makeList([])] }),
      );

      renderDetail('missing-list');

      expect(
        screen.getByRole('heading', { name: 'List not found' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Back to Groceries' }),
      ).toHaveAttribute('href', '/dashboard/groceries');
    });

    it('names the page after the list and states its item count and last activity', () => {
      const catalog = [
        makeItem('cat-1', 'Apples'),
        makeItem('cat-2', 'Milk', { category: 'dairy' }),
        makeItem('cat-3', 'Bread', { category: 'bakery' }),
      ];
      const lines = [
        makeLine('line-1', 'cat-1'),
        makeLine('line-2', 'cat-2'),
        makeLine('line-3', 'cat-3'),
      ];
      mockUseGroceriesVault.mockReturnValue(
        makeVault({ catalog, lists: [makeList(lines)] }),
      );

      renderDetail();

      expect(
        screen.getByRole('heading', { level: 1, name: 'Weekly shop' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText('3 items · updated 3 hours ago'),
      ).toBeInTheDocument();
    });
  });

  describe('list actions', () => {
    it('renames the list through the rename dialog', async () => {
      const vault = makeVault({ lists: [makeList([])] });
      mockUseGroceriesVault.mockReturnValue(vault);
      renderDetail();

      await press(screen.getByRole('button', { name: 'Rename list' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByRole('textbox'), {
        target: { value: 'Monthly shop' },
      });
      await press(within(dialog).getByRole('button', { name: 'Rename List' }));

      await waitFor(() =>
        expect(vault.renameList).toHaveBeenCalledWith(LIST_ID, 'Monthly shop'),
      );
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
    });

    it('keeps the rename dialog open with an inline error when the rename is rejected', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      mockUseGroceriesVault.mockReturnValue(
        makeVault({
          lists: [makeList([])],
          renameList: jest.fn().mockRejectedValue(new Error('write failed')),
        }),
      );
      renderDetail();

      await press(screen.getByRole('button', { name: 'Rename list' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByRole('textbox'), {
        target: { value: 'Monthly shop' },
      });
      await press(within(dialog).getByRole('button', { name: 'Rename List' }));

      await waitFor(() =>
        expect(
          within(screen.getByRole('dialog')).getByText('Failed to rename list'),
        ).toBeInTheDocument(),
      );
      expect(mockToast).not.toHaveBeenCalled();
    });

    it('deletes the list and navigates back to Groceries', async () => {
      const vault = makeVault({ lists: [makeList([])] });
      mockUseGroceriesVault.mockReturnValue(vault);
      renderDetail();

      await press(screen.getByRole('button', { name: 'Delete Grocery List…' }));
      const dialog = await screen.findByRole('dialog');
      await press(within(dialog).getByRole('button', { name: 'Delete List' }));

      await waitFor(() =>
        expect(mockPush).toHaveBeenCalledWith('/dashboard/groceries'),
      );
      expect(vault.deleteList).toHaveBeenCalledWith(LIST_ID);
    });

    it('shows the error toast and stays on the list when deleting it is rejected', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      mockUseGroceriesVault.mockReturnValue(
        makeVault({
          lists: [makeList([])],
          deleteList: jest.fn().mockRejectedValue(new Error('write failed')),
        }),
      );
      renderDetail();

      await press(screen.getByRole('button', { name: 'Delete Grocery List…' }));
      const dialog = await screen.findByRole('dialog');
      await press(within(dialog).getByRole('button', { name: 'Delete List' }));

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Error',
          description: 'Failed to save your changes. Please try again.',
          variant: 'destructive',
        }),
      );
      expect(mockPush).not.toHaveBeenCalled();
      expect(
        screen.getByRole('heading', {
          level: 1,
          hidden: true,
          name: 'Weekly shop',
        }),
      ).toBeInTheDocument();
    });
  });
});
