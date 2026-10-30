/*
  Tests for useGroceriesVault hook.
  - Mocks @myorganiser/web-vault's normalizeGroceries and a VaultHandle
    exposing loadDecryptedData/saveEncryptedData
  - Mocks @myorganiser/core's randomId with a predictable sequential generator
  - Covers the catalog-membership mutation seams: addItemToLists,
    addExistingCatalogItemToLists, deleteCatalogItem, plus a light regression
    pass over pre-existing trip lifecycle actions (toggle/uncheck/remove/
    restore/delete-line) to reinforce that they never destroy Catalog Items.
*/

/** Mocking rule: place jest.mock calls before any imports */
jest.mock('@myorganiser/web-vault', () => {
  const actual = jest.requireActual<typeof import('@myorganiser/web-vault')>(
    '@myorganiser/web-vault',
  );
  return {
    ...actual,
    normalizeGroceries: jest.fn(actual.normalizeGroceries),
  };
});

jest.mock('@myorganiser/core', () => {
  let counter = 0;
  return {
    randomId: jest.fn(() => `id-${++counter}`),
  };
});

jest.mock('@myorganiser/web-vault-ui', () => ({
  useLocalVaultRevision: jest.fn(),
}));

import type {
  CatalogItem,
  GroceriesVaultPayload,
  GroceryList,
  ListLine,
} from '@myorganiser/vault-core';
import { randomId } from '@myorganiser/core';
import { normalizeGroceries, type VaultHandle } from '@myorganiser/web-vault';
import { useLocalVaultRevision } from '@myorganiser/web-vault-ui';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useGroceriesVault } from '../useGroceriesVault';

const mockNormalizeGroceries = normalizeGroceries as jest.Mock;
const mockLoadDecryptedData = jest.fn();
const mockSaveEncryptedData = jest.fn();

/** Shape written by saveGroceriesPayload for assertions. */
function groceriesEncryptedSave(
  records: GroceriesVaultPayload,
  deletions: Record<string, string> = {},
) {
  return {
    type: 'groceries',
    value: {
      records,
      deletions,
    },
  };
}

describe('useGroceriesVault', () => {
  const handle = {
    loadDecryptedData: mockLoadDecryptedData,
    saveEncryptedData: mockSaveEncryptedData,
  } as unknown as VaultHandle;

  function makeCatalogItem(
    overrides: Partial<CatalogItem> & Pick<CatalogItem, 'id' | 'name'>,
  ): CatalogItem {
    return {
      category: 'other',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  function makeLine(
    overrides: Partial<ListLine> & Pick<ListLine, 'id' | 'catalogItemId'>,
  ): ListLine {
    return {
      checked: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  function makeList(
    overrides: Partial<GroceryList> & Pick<GroceryList, 'id' | 'name'>,
  ): GroceryList {
    return {
      lines: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  /** Wires the vault mocks to resolve with the given payload and renders the hook. */
  async function setup(initialPayload: GroceriesVaultPayload) {
    mockLoadDecryptedData.mockResolvedValue(initialPayload);
    mockNormalizeGroceries.mockImplementation((raw: unknown) => ({
      value: raw as GroceriesVaultPayload,
      changed: false,
    }));
    mockSaveEncryptedData.mockResolvedValue(undefined);

    const { result } = renderHook(() => useGroceriesVault({ handle }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    return result;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(useLocalVaultRevision).mockReturnValue(0);
  });

  it('reports a load failure and stops loading without claiming success', async () => {
    mockLoadDecryptedData.mockRejectedValue(new Error('vault unavailable'));

    const { result } = renderHook(() => useGroceriesVault({ handle }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe(
      'Failed to load your grocery lists. Please try again.',
    );
    expect(result.current.catalog).toEqual([]);
    expect(result.current.lists).toEqual([]);
    expect(mockNormalizeGroceries).not.toHaveBeenCalled();
    expect(mockSaveEncryptedData).not.toHaveBeenCalled();
  });

  it('rethrows persistence failures, reports an error, and leaves state unchanged', async () => {
    const initialPayload = {
      catalog: [],
      lists: [makeList({ id: 'listA', name: 'A' })],
    };
    const result = await setup(initialPayload);
    const saveError = new Error('vault is locked');
    mockSaveEncryptedData.mockRejectedValue(saveError);

    let thrownError: unknown;
    await act(async () => {
      try {
        await result.current.persistPayload({
          catalog: [],
          lists: [makeList({ id: 'listB', name: 'B' })],
        });
      } catch (error) {
        thrownError = error;
      }
    });

    expect(thrownError).toBe(saveError);
    await waitFor(() =>
      expect(result.current.error).toBe(
        'Failed to save your changes. Please try again.',
      ),
    );
    await waitFor(() => {
      expect(result.current.catalog).toEqual(initialPayload.catalog);
      expect(result.current.lists).toEqual(initialPayload.lists);
    });
  });

  describe('convergence reloads', () => {
    /**
     * Holds the first two loads open so the test controls their order. Any later
     * load (e.g. the read saveGroceriesPayload makes before writing) resolves
     * straight away with `newerRaw`, so a stale write-back can reach the Vault.
     */
    function holdFirstTwoReads(newerRaw: unknown) {
      const reads: Array<{
        resolve: (value: unknown) => void;
        reject: (reason: unknown) => void;
      }> = [];
      mockLoadDecryptedData.mockImplementation(() => {
        if (reads.length >= 2) return Promise.resolve(newerRaw);
        return new Promise((resolve, reject) => {
          reads.push({ resolve, reject });
        });
      });
      return reads;
    }

    it('reloads when the Local Vault revision moves and shows the newer lists', async () => {
      const listA = makeList({ id: 'listA', name: 'A' });
      const listB = makeList({ id: 'listB', name: 'B' });
      const storedPayloads = [
        { catalog: [], lists: [listA] },
        { catalog: [], lists: [listB] },
      ];
      mockLoadDecryptedData.mockImplementation(async () => {
        const next =
          storedPayloads[mockLoadDecryptedData.mock.calls.length - 1];
        return next;
      });
      mockNormalizeGroceries.mockImplementation((raw: unknown) => ({
        value: raw as GroceriesVaultPayload,
        changed: false,
      }));

      const { result, rerender } = renderHook(() =>
        useGroceriesVault({ handle }),
      );
      await waitFor(() => expect(result.current.lists).toEqual([listA]));

      jest.mocked(useLocalVaultRevision).mockReturnValue(1);
      rerender();

      await waitFor(() => expect(result.current.lists).toEqual([listB]));
      expect(mockLoadDecryptedData).toHaveBeenCalledTimes(2);
      expect(mockSaveEncryptedData).not.toHaveBeenCalled();
    });

    it('ignores a read that resolves after a newer revision has applied, on screen and in the Vault', async () => {
      const staleItem = makeCatalogItem({ id: 'cat-old', name: 'Milk' });
      const staleList = makeList({ id: 'stale', name: 'Stale' });
      const newerItem = makeCatalogItem({ id: 'cat-new', name: 'Eggs' });
      const newerList = makeList({ id: 'newer', name: 'Newer' });
      const staleRaw = { catalog: [staleItem], lists: [staleList] };
      const newerRaw = { catalog: [newerItem], lists: [newerList] };
      const reads = holdFirstTwoReads(newerRaw);
      mockNormalizeGroceries.mockImplementation((raw: unknown) =>
        raw === staleRaw
          ? {
              value: { catalog: [staleItem], lists: [staleList] },
              changed: true,
            }
          : { value: raw as GroceriesVaultPayload, changed: false },
      );

      const { result, rerender } = renderHook(() =>
        useGroceriesVault({ handle }),
      );
      await waitFor(() => expect(reads).toHaveLength(1));

      jest.mocked(useLocalVaultRevision).mockReturnValue(1);
      rerender();
      await waitFor(() => expect(reads).toHaveLength(2));

      await act(async () => {
        reads[1].resolve(newerRaw);
      });
      await waitFor(() => expect(result.current.lists).toEqual([newerList]));

      await act(async () => {
        reads[0].resolve(staleRaw);
        await new Promise((settle) => setTimeout(settle, 0));
      });

      // Vault half first: a stale write-back is the harm this guards against.
      expect(mockSaveEncryptedData).not.toHaveBeenCalled();
      expect(mockLoadDecryptedData).toHaveBeenCalledTimes(2);
      expect(result.current.lists).toEqual([newerList]);
      expect(result.current.catalog).toEqual([newerItem]);
      expect(result.current.selectedListId).toBe('newer');
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('stays quiet when an older read rejects after a newer read has applied', async () => {
      const newerList = makeList({ id: 'newer', name: 'Newer' });
      const newerRaw = { catalog: [], lists: [newerList] };
      const reads = holdFirstTwoReads(newerRaw);
      mockNormalizeGroceries.mockImplementation((raw: unknown) => ({
        value: raw as GroceriesVaultPayload,
        changed: false,
      }));

      const { result, rerender } = renderHook(() =>
        useGroceriesVault({ handle }),
      );
      await waitFor(() => expect(reads).toHaveLength(1));

      jest.mocked(useLocalVaultRevision).mockReturnValue(1);
      rerender();
      await waitFor(() => expect(reads).toHaveLength(2));

      await act(async () => {
        reads[1].resolve(newerRaw);
      });
      await waitFor(() => expect(result.current.lists).toEqual([newerList]));

      await act(async () => {
        reads[0].reject(new Error('bad key'));
        await new Promise((settle) => setTimeout(settle, 0));
      });

      expect(result.current.lists).toEqual([newerList]);
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it('writes a normalized payload back to the Vault exactly once', async () => {
      const repairedList = makeList({ id: 'listA', name: 'A' });
      const repaired: GroceriesVaultPayload = {
        catalog: [],
        lists: [repairedList],
      };
      mockLoadDecryptedData.mockResolvedValue(null);
      mockNormalizeGroceries.mockImplementation(() => ({
        value: repaired,
        changed: true,
      }));
      mockSaveEncryptedData.mockResolvedValue(undefined);

      const { result } = renderHook(() => useGroceriesVault({ handle }));

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.lists).toEqual([repairedList]);
      expect(mockSaveEncryptedData).toHaveBeenCalledTimes(1);
      expect(mockSaveEncryptedData).toHaveBeenLastCalledWith(
        groceriesEncryptedSave(repaired),
      );
    });
  });

  describe('addItemToLists', () => {
    it('creates a new Catalog Item and adds a new List Line to every target list', async () => {
      const listA = makeList({ id: 'listA', name: 'A' });
      const listB = makeList({ id: 'listB', name: 'B' });
      const result = await setup({ catalog: [], lists: [listA, listB] });

      await act(async () => {
        await result.current.addItemToLists(['listA', 'listB'], {
          name: 'Milk',
          category: 'dairy',
        });
      });

      await waitFor(() => {
        expect(result.current.catalog).toHaveLength(1);
        expect(result.current.catalog[0].name).toBe('Milk');
        expect(result.current.catalog[0].category).toBe('dairy');

        const catalogItemId = result.current.catalog[0].id;
        const listAResult = result.current.lists.find((l) => l.id === 'listA');
        const listBResult = result.current.lists.find((l) => l.id === 'listB');
        expect(listAResult?.lines).toHaveLength(1);
        expect(listAResult?.lines[0].catalogItemId).toBe(catalogItemId);
        expect(listBResult?.lines).toHaveLength(1);
        expect(listBResult?.lines[0].catalogItemId).toBe(catalogItemId);
        expect(mockSaveEncryptedData).toHaveBeenLastCalledWith(
          groceriesEncryptedSave({
            catalog: result.current.catalog,
            lists: result.current.lists,
          }),
        );
      });
    });

    it('reuses an existing Catalog Item case-insensitively and updates its durable fields', async () => {
      const existing = makeCatalogItem({
        id: 'cat-1',
        name: 'milk',
        category: 'other',
      });
      const listA = makeList({ id: 'listA', name: 'A' });
      const result = await setup({ catalog: [existing], lists: [listA] });

      await act(async () => {
        await result.current.addItemToLists(['listA'], {
          name: 'MILK',
          category: 'dairy',
          price: 2.5,
        });
      });

      await waitFor(() => {
        // Reused, not duplicated
        expect(result.current.catalog).toHaveLength(1);
        expect(result.current.catalog[0].id).toBe('cat-1');
        expect(result.current.catalog[0].name).toBe('MILK');
        expect(result.current.catalog[0].category).toBe('dairy');
        expect(result.current.catalog[0].price).toBe(2.5);

        const listAResult = result.current.lists.find((l) => l.id === 'listA');
        expect(listAResult?.lines).toHaveLength(1);
        expect(listAResult?.lines[0].catalogItemId).toBe('cat-1');
      });
    });

    it('skips lists that already have a line for the Catalog Item, but still adds to others', async () => {
      const existing = makeCatalogItem({ id: 'cat-1', name: 'Milk' });
      const listA = makeList({
        id: 'listA',
        name: 'A',
        lines: [makeLine({ id: 'ln-existing', catalogItemId: 'cat-1' })],
      });
      const listB = makeList({ id: 'listB', name: 'B' });
      const result = await setup({
        catalog: [existing],
        lists: [listA, listB],
      });

      await act(async () => {
        await result.current.addItemToLists(['listA', 'listB'], {
          name: 'Milk',
          category: 'dairy',
        });
      });

      await waitFor(() => {
        const listAResult = result.current.lists.find((l) => l.id === 'listA');
        const listBResult = result.current.lists.find((l) => l.id === 'listB');
        // listA already had a line for cat-1 - no duplicate added
        expect(listAResult?.lines).toHaveLength(1);
        expect(listAResult?.lines[0].id).toBe('ln-existing');
        // listB did not have a line - one was added
        expect(listBResult?.lines).toHaveLength(1);
      });
    });

    it('creates/reuses the Catalog Item but mutates no list when listIds is empty', async () => {
      const listA = makeList({ id: 'listA', name: 'A' });
      const result = await setup({ catalog: [], lists: [listA] });

      await act(async () => {
        await result.current.addItemToLists([], {
          name: 'Milk',
          category: 'dairy',
        });
      });

      await waitFor(() => {
        expect(result.current.catalog).toHaveLength(1);
        const listAResult = result.current.lists.find((l) => l.id === 'listA');
        expect(listAResult?.lines).toHaveLength(0);
      });
    });

    it('carries an unknown payload key through the save when adding to several lists', async () => {
      const mockRandomId = randomId as jest.Mock;
      let generated = 0;
      mockRandomId.mockImplementation(() => `gen-${++generated}`);

      const listA = makeList({ id: 'listA', name: 'A' });
      const listB = makeList({ id: 'listB', name: 'B' });
      const initialPayload = {
        futurePayloadKey: { v: 2 },
        catalog: [],
        lists: [listA, listB],
      };
      const result = await setup(initialPayload);

      await act(async () => {
        await result.current.addItemToLists(['listA', 'listB'], {
          name: 'Bread',
          category: 'bakery',
        });
      });

      const expectedRecords = {
        futurePayloadKey: { v: 2 },
        catalog: [
          {
            id: 'gen-1',
            name: 'Bread',
            category: 'bakery' as const,
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
          },
        ],
        lists: [
          {
            ...listA,
            lines: [
              {
                id: 'gen-2',
                catalogItemId: 'gen-1',
                checked: false,
                createdAt: expect.any(String),
                updatedAt: expect.any(String),
              },
            ],
          },
          {
            ...listB,
            lines: [
              {
                id: 'gen-3',
                catalogItemId: 'gen-1',
                checked: false,
                createdAt: expect.any(String),
                updatedAt: expect.any(String),
              },
            ],
          },
        ],
      };
      await waitFor(() => {
        expect(mockSaveEncryptedData).toHaveBeenCalledTimes(1);
        expect(mockSaveEncryptedData).toHaveBeenLastCalledWith(
          groceriesEncryptedSave(expectedRecords),
        );
      });
    });
  });

  describe('addCatalogItemAndLine', () => {
    it('creates one catalog identity and attaches one line to the requested list', async () => {
      const result = await setup({
        catalog: [],
        lists: [makeList({ id: 'listA', name: 'A' })],
      });

      await act(async () => {
        await result.current.addCatalogItemAndLine('listA', {
          name: '  Apples  ',
          category: 'produce',
          price: 3.25,
          amount: '500g',
        });
      });

      await waitFor(() => {
        expect(result.current.catalog).toHaveLength(1);
        expect(result.current.catalog[0]).toMatchObject({
          name: 'Apples',
          category: 'produce',
          price: 3.25,
        });
        expect(result.current.lists[0].lines).toHaveLength(1);
        expect(result.current.lists[0].lines[0]).toMatchObject({
          catalogItemId: result.current.catalog[0].id,
          amount: '500g',
          checked: false,
        });
        expect(mockSaveEncryptedData).toHaveBeenCalledTimes(1);
        expect(mockSaveEncryptedData).toHaveBeenLastCalledWith(
          groceriesEncryptedSave({
            catalog: result.current.catalog,
            lists: result.current.lists,
          }),
        );
      });
    });

    it('reuses the exact selected catalog identity without changing its durable fields', async () => {
      const existing = makeCatalogItem({
        id: 'cat-1',
        name: 'Milk',
        category: 'dairy',
        price: 3,
      });
      const result = await setup({
        catalog: [existing],
        lists: [makeList({ id: 'listA', name: 'A' })],
      });

      await act(async () => {
        await result.current.addCatalogItemAndLine('listA', {
          name: 'Different label',
          category: 'other',
          catalogItemId: 'cat-1',
          price: 99,
        });
      });

      await waitFor(() => {
        expect(result.current.catalog).toEqual([existing]);
        expect(result.current.lists[0].lines[0].catalogItemId).toBe('cat-1');
      });
    });

    it('rejects an invalid catalog identity and does not persist', async () => {
      const result = await setup({
        catalog: [],
        lists: [makeList({ id: 'listA', name: 'A' })],
      });

      await expect(
        act(async () => {
          await result.current.addCatalogItemAndLine('listA', {
            name: 'Milk',
            category: 'dairy',
            catalogItemId: 'missing',
          });
        }),
      ).rejects.toThrow('Catalog Item not found');

      await waitFor(() => {
        expect(mockSaveEncryptedData).not.toHaveBeenCalled();
        expect(result.current.catalog).toEqual([]);
        expect(result.current.lists[0].lines).toEqual([]);
      });
    });

    it('rejects invalid input before persistence', async () => {
      const result = await setup({
        catalog: [],
        lists: [makeList({ id: 'listA', name: 'A' })],
      });

      await expect(
        act(async () => {
          await result.current.addCatalogItemAndLine('listA', {
            name: 'Milk',
            category: 'dairy',
            amount: '-1kg',
          });
        }),
      ).rejects.toThrow('Quantity');

      await waitFor(() => expect(mockSaveEncryptedData).not.toHaveBeenCalled());
    });
  });

  describe('addExistingCatalogItemToLists', () => {
    it('adds a new List Line (with amount) to every target list lacking one, skipping ones that already have it', async () => {
      const catalogItem = makeCatalogItem({ id: 'cat-1', name: 'Milk' });
      const listA = makeList({
        id: 'listA',
        name: 'A',
        lines: [makeLine({ id: 'ln-existing', catalogItemId: 'cat-1' })],
      });
      const listB = makeList({ id: 'listB', name: 'B' });
      const result = await setup({
        catalog: [catalogItem],
        lists: [listA, listB],
      });

      let addedListIds: string[] = [];
      await act(async () => {
        addedListIds = await result.current.addExistingCatalogItemToLists(
          'cat-1',
          ['listA', 'listB'],
          '2 gallons',
        );
      });

      await waitFor(() => {
        // Resolves with only the list ids that actually received a new line
        expect(addedListIds).toEqual(['listB']);

        const listAResult = result.current.lists.find((l) => l.id === 'listA');
        const listBResult = result.current.lists.find((l) => l.id === 'listB');
        // listA already had a line - untouched
        expect(listAResult?.lines).toHaveLength(1);
        expect(listAResult?.lines[0].id).toBe('ln-existing');
        // listB gets a new line with the given amount
        expect(listBResult?.lines).toHaveLength(1);
        expect(listBResult?.lines[0].catalogItemId).toBe('cat-1');
        expect(listBResult?.lines[0].amount).toBe('2 gallons');
      });
    });

    it('rejects when the Catalog Item does not exist and does not persist any change', async () => {
      const listA = makeList({ id: 'listA', name: 'A' });
      const result = await setup({ catalog: [], lists: [listA] });

      await expect(
        act(async () => {
          await result.current.addExistingCatalogItemToLists('missing', [
            'listA',
          ]);
        }),
      ).rejects.toThrow('Catalog Item not found');

      await waitFor(() => {
        expect(mockSaveEncryptedData).not.toHaveBeenCalled();
        expect(
          result.current.lists.find((l) => l.id === 'listA')?.lines,
        ).toHaveLength(0);
      });
    });

    it('does not mutate the Catalog Item durable fields', async () => {
      const catalogItem = makeCatalogItem({
        id: 'cat-1',
        name: 'Milk',
        category: 'dairy',
        price: 3,
      });
      const listA = makeList({ id: 'listA', name: 'A' });
      const result = await setup({ catalog: [catalogItem], lists: [listA] });

      await act(async () => {
        await result.current.addExistingCatalogItemToLists('cat-1', ['listA']);
      });

      await waitFor(() =>
        expect(result.current.catalog[0]).toMatchObject({
          id: 'cat-1',
          name: 'Milk',
          category: 'dairy',
          price: 3,
        }),
      );
    });
  });

  describe('deleteCatalogItem', () => {
    it('removes the Catalog Item and cascades line removal only on referencing lists', async () => {
      const catalogItem = makeCatalogItem({ id: 'cat-1', name: 'Milk' });
      const listA = makeList({
        id: 'listA',
        name: 'A',
        lines: [makeLine({ id: 'lnA', catalogItemId: 'cat-1' })],
      });
      const listB = makeList({
        id: 'listB',
        name: 'B',
        lines: [makeLine({ id: 'lnB', catalogItemId: 'cat-1' })],
      });
      const otherLine = makeLine({ id: 'lnC', catalogItemId: 'cat-other' });
      const listC = makeList({
        id: 'listC',
        name: 'C',
        lines: [otherLine],
      });
      const result = await setup({
        catalog: [catalogItem],
        lists: [listA, listB, listC],
      });

      await act(async () => {
        await result.current.deleteCatalogItem('cat-1');
      });

      await waitFor(() => {
        expect(result.current.catalog).toHaveLength(0);
        expect(
          result.current.lists.find((l) => l.id === 'listA')?.lines,
        ).toEqual([]);
        expect(
          result.current.lists.find((l) => l.id === 'listB')?.lines,
        ).toEqual([]);
        // listC never referenced the deleted item - untouched
        expect(
          result.current.lists.find((l) => l.id === 'listC')?.lines,
        ).toEqual([otherLine]);
        expect(mockSaveEncryptedData).toHaveBeenLastCalledWith(
          expect.objectContaining({
            type: 'groceries',
            value: expect.objectContaining({
              deletions: expect.objectContaining({
                'cat-1': expect.any(String),
              }),
            }),
          }),
        );
      });
    });

    it('removes a Catalog Item with no referencing lines cleanly', async () => {
      const catalogItem = makeCatalogItem({ id: 'cat-1', name: 'Milk' });
      const listA = makeList({ id: 'listA', name: 'A' });
      const result = await setup({ catalog: [catalogItem], lists: [listA] });

      await act(async () => {
        await result.current.deleteCatalogItem('cat-1');
      });

      await waitFor(() => {
        expect(result.current.catalog).toHaveLength(0);
        expect(
          result.current.lists.find((l) => l.id === 'listA')?.lines,
        ).toEqual([]);
        expect(mockSaveEncryptedData).toHaveBeenLastCalledWith(
          expect.objectContaining({
            type: 'groceries',
            value: expect.objectContaining({
              deletions: expect.objectContaining({
                'cat-1': expect.any(String),
              }),
            }),
          }),
        );
      });
    });
  });

  describe('updateCatalogItem', () => {
    it('updates only durable Catalog Item fields and persists the complete payload', async () => {
      const catalogItem = makeCatalogItem({
        id: 'cat-1',
        name: 'Milk',
        category: 'dairy',
        price: 3,
        notes: 'Keep chilled',
        imageUrl: 'https://old.example/milk',
        links: ['https://old.example'],
      });
      const otherCatalogItem = makeCatalogItem({
        id: 'cat-2',
        name: 'Bread',
        category: 'bakery',
      });
      const firstLine = makeLine({
        id: 'line-1',
        catalogItemId: 'cat-1',
        checked: true,
        amount: '2 cartons',
      });
      const secondLine = makeLine({
        id: 'line-2',
        catalogItemId: 'cat-2',
        checked: false,
        amount: '1 loaf',
      });
      const listA = makeList({ id: 'listA', name: 'A', lines: [firstLine] });
      const listB = makeList({ id: 'listB', name: 'B', lines: [secondLine] });
      const initialPayload = {
        catalog: [catalogItem, otherCatalogItem],
        lists: [listA, listB],
      };
      const result = await setup(initialPayload);

      await act(async () => {
        await result.current.updateCatalogItem({
          id: 'cat-1',
          name: 'Organic Milk',
          category: 'dairy',
          price: 4.5,
          notes: 'New note',
          imageUrl: 'https://new.example/milk',
          links: ['https://new.example'],
        });
      });

      await waitFor(() => {
        expect(result.current.catalog[0]).toMatchObject({
          id: catalogItem.id,
          name: 'Organic Milk',
          category: 'dairy',
          price: 4.5,
          notes: 'New note',
          imageUrl: 'https://new.example/milk',
          links: ['https://new.example'],
          createdAt: catalogItem.createdAt,
        });
        expect(result.current.catalog[0].createdAt).toBe(catalogItem.createdAt);
        expect(result.current.catalog[1]).toEqual(otherCatalogItem);
        expect(result.current.lists).toEqual(initialPayload.lists);

        expect(mockSaveEncryptedData).toHaveBeenCalledTimes(1);
        expect(mockSaveEncryptedData).toHaveBeenLastCalledWith(
          groceriesEncryptedSave({
            catalog: [
              {
                ...catalogItem,
                name: 'Organic Milk',
                price: 4.5,
                notes: 'New note',
                imageUrl: 'https://new.example/milk',
                links: ['https://new.example'],
                updatedAt: expect.any(String),
              },
              otherCatalogItem,
            ],
            lists: initialPayload.lists,
          }),
        );
      });
    });

    it('rejects an unknown Catalog Item without persistence or state changes', async () => {
      const initialPayload = {
        catalog: [makeCatalogItem({ id: 'cat-1', name: 'Milk' })],
        lists: [makeList({ id: 'listA', name: 'A' })],
      };
      const result = await setup(initialPayload);

      let thrownError: unknown;
      await act(async () => {
        try {
          await result.current.updateCatalogItem({
            id: 'missing',
            name: 'Unknown',
            category: 'other',
          });
        } catch (error) {
          thrownError = error;
        }
      });

      expect(thrownError).toEqual(new Error('Catalog Item not found'));
      expect(mockSaveEncryptedData).not.toHaveBeenCalled();
      expect(result.current.catalog).toEqual(initialPayload.catalog);
      expect(result.current.lists).toEqual(initialPayload.lists);
    });

    it('rethrows a persistence failure and leaves Catalog Item state unchanged', async () => {
      const initialPayload = {
        catalog: [makeCatalogItem({ id: 'cat-1', name: 'Milk' })],
        lists: [makeList({ id: 'listA', name: 'A' })],
      };
      const result = await setup(initialPayload);
      const saveError = new Error('save failed');
      mockSaveEncryptedData.mockRejectedValue(saveError);

      let thrownError: unknown;
      await act(async () => {
        try {
          await result.current.updateCatalogItem({
            id: 'cat-1',
            name: 'Updated Milk',
            category: 'dairy',
          });
        } catch (error) {
          thrownError = error;
        }
      });

      await waitFor(() => {
        expect(thrownError).toBe(saveError);
        expect(result.current.error).toBe(
          'Failed to save your changes. Please try again.',
        );
        expect(result.current.catalog).toEqual(initialPayload.catalog);
        expect(result.current.lists).toEqual(initialPayload.lists);
      });
    });

    it('carries an unknown payload key and an unknown Catalog Item field through the save', async () => {
      const catalogItem = {
        ...makeCatalogItem({
          id: 'cat-1',
          name: 'Milk',
          category: 'dairy',
        }),
        futureItemField: { source: 'v2' },
      };
      const initialPayload = {
        futurePayloadKey: { v: 2 },
        catalog: [catalogItem],
        lists: [],
      };
      const result = await setup(initialPayload);

      await act(async () => {
        await result.current.updateCatalogItem({
          id: 'cat-1',
          name: 'Organic Milk',
          category: 'dairy',
        });
      });

      const expectedRecords = {
        futurePayloadKey: { v: 2 },
        catalog: [
          {
            ...catalogItem,
            name: 'Organic Milk',
            updatedAt: expect.any(String),
          },
        ],
        lists: [],
      };
      await waitFor(() => {
        expect(mockSaveEncryptedData).toHaveBeenCalledTimes(1);
        expect(mockSaveEncryptedData).toHaveBeenLastCalledWith(
          groceriesEncryptedSave(expectedRecords),
        );
      });
    });
  });

  describe('updateListLine', () => {
    it('updates only the selected line amount and persists the complete payload', async () => {
      const catalogItem = makeCatalogItem({
        id: 'cat-1',
        name: 'Milk',
        category: 'dairy',
        price: 3,
        notes: 'Keep chilled',
        imageUrl: 'https://example.com/milk',
        links: ['https://example.com'],
      });
      const otherCatalogItem = makeCatalogItem({
        id: 'cat-2',
        name: 'Bread',
        category: 'bakery',
      });
      const selectedLine = makeLine({
        id: 'line-1',
        catalogItemId: 'cat-1',
        checked: true,
        amount: '1 carton',
      });
      const otherLine = makeLine({
        id: 'line-2',
        catalogItemId: 'cat-2',
        checked: false,
        amount: '2 loaves',
      });
      const listA = makeList({
        id: 'listA',
        name: 'A',
        lines: [selectedLine, otherLine],
      });
      const listB = makeList({
        id: 'listB',
        name: 'B',
        lines: [makeLine({ id: 'line-3', catalogItemId: 'cat-1' })],
      });
      const initialPayload = {
        catalog: [catalogItem, otherCatalogItem],
        lists: [listA, listB],
      };
      const result = await setup(initialPayload);

      await act(async () => {
        await result.current.updateListLine('listA', {
          id: 'line-1',
          amount: '3 cartons',
        });
      });

      await waitFor(() => {
        expect(result.current.catalog).toEqual(initialPayload.catalog);
        expect(result.current.lists[0].lines[0]).toMatchObject({
          id: selectedLine.id,
          catalogItemId: selectedLine.catalogItemId,
          amount: '3 cartons',
          checked: true,
          createdAt: selectedLine.createdAt,
        });
        expect(result.current.lists[0].lines[1]).toEqual(otherLine);
        expect(result.current.lists[1]).toEqual(listB);
        expect(mockSaveEncryptedData).toHaveBeenCalledTimes(1);
        expect(mockSaveEncryptedData).toHaveBeenLastCalledWith(
          groceriesEncryptedSave({
            catalog: initialPayload.catalog,
            lists: [
              {
                ...listA,
                lines: [
                  {
                    ...selectedLine,
                    amount: '3 cartons',
                    updatedAt: expect.any(String),
                  },
                  otherLine,
                ],
                updatedAt: listA.updatedAt,
              },
              listB,
            ],
          }),
        );
        expect(result.current.lists[0].updatedAt).toBe(listA.updatedAt);
      });
    });

    it('rejects an unknown list or line without persistence or state changes', async () => {
      const initialPayload = {
        catalog: [makeCatalogItem({ id: 'cat-1', name: 'Milk' })],
        lists: [
          makeList({
            id: 'listA',
            name: 'A',
            lines: [makeLine({ id: 'line-1', catalogItemId: 'cat-1' })],
          }),
        ],
      };
      const result = await setup(initialPayload);

      const thrownErrors: unknown[] = [];
      await act(async () => {
        try {
          await result.current.updateListLine('missing-list', {
            id: 'line-1',
            amount: '2',
          });
        } catch (error) {
          thrownErrors.push(error);
        }
        try {
          await result.current.updateListLine('listA', {
            id: 'missing-line',
            amount: '2',
          });
        } catch (error) {
          thrownErrors.push(error);
        }
      });

      expect(thrownErrors).toEqual([
        new Error('List Line not found'),
        new Error('List Line not found'),
      ]);
      expect(mockSaveEncryptedData).not.toHaveBeenCalled();
      expect(result.current.catalog).toEqual(initialPayload.catalog);
      expect(result.current.lists).toEqual(initialPayload.lists);
    });

    it('rethrows a persistence failure and leaves List Line state unchanged', async () => {
      const line = makeLine({
        id: 'line-1',
        catalogItemId: 'cat-1',
        checked: true,
        amount: '1 carton',
      });
      const initialPayload = {
        catalog: [makeCatalogItem({ id: 'cat-1', name: 'Milk' })],
        lists: [makeList({ id: 'listA', name: 'A', lines: [line] })],
      };
      const result = await setup(initialPayload);
      const saveError = new Error('save failed');
      mockSaveEncryptedData.mockRejectedValue(saveError);

      let thrownError: unknown;
      await act(async () => {
        try {
          await result.current.updateListLine('listA', {
            id: 'line-1',
            amount: '2 cartons',
          });
        } catch (error) {
          thrownError = error;
        }
      });

      await waitFor(() => {
        expect(thrownError).toBe(saveError);
        expect(result.current.error).toBe(
          'Failed to save your changes. Please try again.',
        );
        expect(result.current.catalog).toEqual(initialPayload.catalog);
        expect(result.current.lists).toEqual(initialPayload.lists);
      });
    });

    it('carries an unknown payload key and an unknown List Line field through the save', async () => {
      const catalogItem = makeCatalogItem({
        id: 'cat-1',
        name: 'Milk',
        category: 'dairy',
      });
      const line = {
        ...makeLine({
          id: 'line-1',
          catalogItemId: 'cat-1',
          checked: true,
          amount: '1 carton',
        }),
        futureLineField: 'kept',
      };
      const listA = makeList({ id: 'listA', name: 'A', lines: [line] });
      const initialPayload = {
        futurePayloadKey: { v: 2 },
        catalog: [catalogItem],
        lists: [listA],
      };
      const result = await setup(initialPayload);

      await act(async () => {
        await result.current.updateListLine('listA', {
          id: 'line-1',
          amount: '3 cartons',
        });
      });

      const expectedRecords = {
        futurePayloadKey: { v: 2 },
        catalog: [catalogItem],
        lists: [
          {
            ...listA,
            lines: [
              {
                ...line,
                amount: '3 cartons',
                updatedAt: expect.any(String),
              },
            ],
          },
        ],
      };
      await waitFor(() => {
        expect(mockSaveEncryptedData).toHaveBeenCalledTimes(1);
        expect(mockSaveEncryptedData).toHaveBeenLastCalledWith(
          groceriesEncryptedSave(expectedRecords),
        );
      });
    });
  });

  describe('renameList', () => {
    it('renames the list, bumps its updatedAt, and persists an empty Deletion Log', async () => {
      const listA = makeList({
        id: 'listA',
        name: 'Old',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      const listB = makeList({ id: 'listB', name: 'B' });
      const result = await setup({ catalog: [], lists: [listA, listB] });

      await act(async () => {
        await result.current.renameList('listA', 'New');
      });

      await waitFor(() => {
        const renamed = result.current.lists.find((l) => l.id === 'listA');
        expect(renamed?.name).toBe('New');
        expect(renamed?.updatedAt).not.toBe(listA.updatedAt);
        expect(result.current.lists.find((l) => l.id === 'listB')).toEqual(
          listB,
        );
        expect(mockSaveEncryptedData).toHaveBeenLastCalledWith(
          groceriesEncryptedSave({
            catalog: [],
            lists: result.current.lists,
          }),
        );
      });
    });
  });

  describe('deleteList', () => {
    it('removes the list from records and records the list id in deletions', async () => {
      const listA = makeList({ id: 'listA', name: 'A' });
      const listB = makeList({ id: 'listB', name: 'B' });
      const result = await setup({ catalog: [], lists: [listA, listB] });

      await act(async () => {
        await result.current.deleteList('listA');
      });

      await waitFor(() => {
        expect(result.current.lists.map((l) => l.id)).toEqual(['listB']);
        expect(mockSaveEncryptedData).toHaveBeenLastCalledWith(
          expect.objectContaining({
            type: 'groceries',
            value: expect.objectContaining({
              deletions: expect.objectContaining({
                listA: expect.any(String),
              }),
              records: expect.objectContaining({
                lists: [listB],
              }),
            }),
          }),
        );
      });
    });
  });

  describe('regression: pre-existing trip lifecycle actions never destroy Catalog Items', () => {
    it('toggleLineChecked flips only the target line, catalog and other lines untouched', async () => {
      const catalogItem = makeCatalogItem({ id: 'cat-1', name: 'Milk' });
      const line = makeLine({ id: 'ln-1', catalogItemId: 'cat-1' });
      const listA = makeList({ id: 'listA', name: 'A', lines: [line] });
      const result = await setup({ catalog: [catalogItem], lists: [listA] });
      const listUpdatedAtBefore = listA.updatedAt;

      await act(async () => {
        await result.current.toggleLineChecked('listA', 'ln-1');
      });

      await waitFor(() => {
        expect(result.current.catalog).toEqual([catalogItem]);
        const resultList = result.current.lists.find((l) => l.id === 'listA');
        expect(resultList?.lines[0].checked).toBe(true);
        expect(resultList?.updatedAt).toBe(listUpdatedAtBefore);
        expect(resultList?.lines[0].updatedAt).not.toBe(line.updatedAt);
      });
    });

    it('uncheckAllLines unchecks every line without removing any line or Catalog Item', async () => {
      const catalogItem = makeCatalogItem({ id: 'cat-1', name: 'Milk' });
      const line = makeLine({
        id: 'ln-1',
        catalogItemId: 'cat-1',
        checked: true,
      });
      const listA = makeList({ id: 'listA', name: 'A', lines: [line] });
      const result = await setup({ catalog: [catalogItem], lists: [listA] });

      await act(async () => {
        await result.current.uncheckAllLines('listA');
      });

      await waitFor(() => {
        expect(result.current.catalog).toEqual([catalogItem]);
        const resultList = result.current.lists.find((l) => l.id === 'listA');
        expect(resultList?.lines).toHaveLength(1);
        expect(resultList?.lines[0].checked).toBe(false);
      });
    });

    it('removeCheckedLines + restoreLines round-trips without touching the Catalog Item', async () => {
      const catalogItem = makeCatalogItem({ id: 'cat-1', name: 'Milk' });
      const line = makeLine({
        id: 'ln-1',
        catalogItemId: 'cat-1',
        checked: true,
      });
      const listA = makeList({ id: 'listA', name: 'A', lines: [line] });
      const result = await setup({ catalog: [catalogItem], lists: [listA] });

      let removed: ListLine[] = [];
      await act(async () => {
        removed = await result.current.removeCheckedLines('listA');
      });

      const listUpdatedAtBefore = listA.updatedAt;

      await waitFor(() => {
        expect(removed).toHaveLength(1);
        expect(
          result.current.lists.find((l) => l.id === 'listA')?.lines,
        ).toEqual([]);
        expect(result.current.catalog).toEqual([catalogItem]);
        expect(mockSaveEncryptedData).toHaveBeenLastCalledWith(
          expect.objectContaining({
            value: expect.objectContaining({
              deletions: expect.objectContaining({
                'ln-1': expect.any(String),
              }),
            }),
          }),
        );
      });

      await act(async () => {
        await result.current.restoreLines('listA', removed);
      });

      await waitFor(() => {
        const restored = result.current.lists.find((l) => l.id === 'listA');
        expect(restored?.lines).toHaveLength(1);
        expect(restored?.lines[0]).toMatchObject({
          id: line.id,
          catalogItemId: line.catalogItemId,
          checked: line.checked,
          createdAt: line.createdAt,
          updatedAt: expect.any(String),
        });
        expect(restored?.lines[0].updatedAt).not.toBe(line.updatedAt);
        expect(restored?.updatedAt).toBe(listUpdatedAtBefore);
        expect(result.current.catalog).toEqual([catalogItem]);
      });
    });

    it('deleteListLine removes only that line, leaving the Catalog Item intact', async () => {
      const catalogItem = makeCatalogItem({ id: 'cat-1', name: 'Milk' });
      const line = makeLine({ id: 'ln-1', catalogItemId: 'cat-1' });
      const listA = makeList({ id: 'listA', name: 'A', lines: [line] });
      const result = await setup({ catalog: [catalogItem], lists: [listA] });
      const listUpdatedAtBefore = listA.updatedAt;

      await act(async () => {
        await result.current.deleteListLine('listA', 'ln-1');
      });

      await waitFor(() => {
        const resultList = result.current.lists.find((l) => l.id === 'listA');
        expect(resultList?.lines).toEqual([]);
        expect(resultList?.updatedAt).toBe(listUpdatedAtBefore);
        expect(result.current.catalog).toEqual([catalogItem]);
        expect(mockSaveEncryptedData).toHaveBeenLastCalledWith(
          expect.objectContaining({
            type: 'groceries',
            value: expect.objectContaining({
              records: expect.objectContaining({
                lists: [
                  expect.objectContaining({
                    id: 'listA',
                    lines: [],
                    updatedAt: listUpdatedAtBefore,
                  }),
                ],
              }),
              deletions: expect.objectContaining({
                'ln-1': expect.any(String),
              }),
            }),
          }),
        );
      });
    });
  });
});
