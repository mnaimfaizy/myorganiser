/* eslint-disable import/first */
jest.mock('@myorganiser/web-vault-ui', () => ({
  useLocalVaultRevision: jest.fn(),
}));

import { act, renderHook, waitFor } from '@testing-library/react';
import type { VaultHandle } from '@myorganiser/web-vault';
import { useLocalVaultRevision } from '@myorganiser/web-vault-ui';
import * as homeSummary from '../home-summary';
import { useHomeSummary } from './use-home-summary';

type BlobType =
  | 'tasks'
  | 'subscriptions'
  | 'groceries'
  | 'addresses'
  | 'mobileNumbers';

interface FakeHandle {
  isUnlocked: boolean;
  loadDecryptedData: jest.Mock;
}

const BLOB_TYPES: BlobType[] = [
  'tasks',
  'subscriptions',
  'groceries',
  'addresses',
  'mobileNumbers',
];

function openTask(id: string, title: string) {
  return {
    id,
    title,
    status: 'pending',
    priority: 'medium',
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    dueDate: homeSummary.localDateKey(new Date()),
  };
}

function makeHandle(
  readBlob: (type: BlobType) => unknown,
  isUnlocked = true,
): FakeHandle {
  return {
    isUnlocked,
    loadDecryptedData: jest.fn(async ({ type }: { type: BlobType }) =>
      readBlob(type),
    ),
  };
}

function asHandle(fake: FakeHandle): VaultHandle {
  return fake as unknown as VaultHandle;
}

function readsOf(fake: FakeHandle): BlobType[] {
  return fake.loadDecryptedData.mock.calls.map(
    ([opts]: [{ type: BlobType }]) => opts.type,
  );
}

describe('useHomeSummary', () => {
  let tasks: unknown[];

  beforeEach(() => {
    jest.clearAllMocks();
    (useLocalVaultRevision as jest.Mock).mockReturnValue(0);
    tasks = [openTask('t1', 'Pay rent')];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const blobsFor = (type: BlobType): unknown => {
    switch (type) {
      case 'tasks':
        return tasks;
      case 'groceries':
        return null;
      default:
        return [];
    }
  };

  it('returns a null summary and reads nothing for a missing or locked handle', () => {
    const { result: noHandle } = renderHook(() => useHomeSummary(null));
    expect(noHandle.current.summary).toBeNull();

    const locked = makeHandle(blobsFor, false);
    const { result: lockedResult } = renderHook(() =>
      useHomeSummary(asHandle(locked)),
    );
    expect(lockedResult.current.summary).toBeNull();
    expect(locked.loadDecryptedData).not.toHaveBeenCalled();
  });

  it('reads each Home blob once while unlocked and derives the summary', async () => {
    const handle = makeHandle(blobsFor);

    const { result } = renderHook(() => useHomeSummary(asHandle(handle)));

    await waitFor(() => {
      expect(result.current.summary).not.toBeNull();
    });

    expect(readsOf(handle).sort()).toEqual([...BLOB_TYPES].sort());
    expect(handle.loadDecryptedData).toHaveBeenCalledTimes(5);
    expect(result.current.summary?.tasks.open).toBe(1);
    expect(result.current.summary?.tasks.todayTotal).toBe(1);
    expect(result.current.summary?.groceries.listCount).toBe(0);
  });

  it('counts a rejected blob as empty and keeps the other parts intact', async () => {
    // The tasks blob holds one open task, so a 0 here can only come from the
    // rejection being swallowed. Addresses are intact and must still count.
    const handle = makeHandle((type) => {
      if (type === 'tasks') throw new Error('decrypt failed');
      if (type === 'addresses') return ['10 Downing Street'];
      return blobsFor(type);
    });

    const { result } = renderHook(() => useHomeSummary(asHandle(handle)));

    await waitFor(() => {
      expect(result.current.summary).not.toBeNull();
    });

    expect(result.current.summary?.tasks.open).toBe(0);
    expect(result.current.summary?.tasks.todayTotal).toBe(0);
    expect(result.current.summary?.addresses.count).toBe(1);
  });

  it('falls back to the empty summary when a summariser throws', async () => {
    jest.spyOn(homeSummary, 'summarizeTasks').mockImplementationOnce(() => {
      throw new Error('summary failed');
    });
    const handle = makeHandle(blobsFor);

    const { result } = renderHook(() => useHomeSummary(asHandle(handle)));

    await waitFor(() => {
      expect(result.current.summary).not.toBeNull();
    });

    // Without the throw the tasks part is 1 open, so 0 proves the fallback ran.
    expect(result.current.summary?.tasks.open).toBe(0);
    expect(result.current.summary?.groceries).toEqual({
      listCount: 0,
      itemsLeft: 0,
      knownSpend: 0,
    });
  });

  it('reads the blobs again when the Local Vault Revision changes', async () => {
    const handle = makeHandle(blobsFor);
    const { result, rerender } = renderHook(() =>
      useHomeSummary(asHandle(handle)),
    );

    await waitFor(() => {
      expect(result.current.summary?.tasks.open).toBe(1);
    });

    tasks = [openTask('t1', 'Pay rent'), openTask('t2', 'Water plants')];
    (useLocalVaultRevision as jest.Mock).mockReturnValue(1);
    rerender();

    await waitFor(() => {
      expect(result.current.summary?.tasks.open).toBe(2);
    });
    expect(handle.loadDecryptedData).toHaveBeenCalledTimes(10);
  });

  it('ignores a late first read once a later read has applied its summary', async () => {
    let resolveStaleTasks: (value: unknown) => void = () => undefined;
    let tasksCall = 0;
    const handle = makeHandle(async (type) => {
      if (type !== 'tasks') return blobsFor(type);
      tasksCall += 1;
      if (tasksCall === 1) {
        return new Promise((resolve) => {
          resolveStaleTasks = resolve;
        });
      }
      return [openTask('t1', 'Pay rent'), openTask('t2', 'Water plants')];
    });

    (useLocalVaultRevision as jest.Mock).mockReturnValue(0);
    const { result, rerender } = renderHook(() =>
      useHomeSummary(asHandle(handle)),
    );

    (useLocalVaultRevision as jest.Mock).mockReturnValue(1);
    rerender();

    await waitFor(() => {
      expect(result.current.summary?.tasks.open).toBe(2);
    });

    await act(async () => {
      resolveStaleTasks([openTask('t1', 'Pay rent')]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.summary?.tasks.open).toBe(2);
  });

  it('clears the summary on lock and reads again on the next unlock', async () => {
    const handle = makeHandle(blobsFor);
    const { result, rerender } = renderHook(() =>
      useHomeSummary(asHandle(handle)),
    );

    await waitFor(() => {
      expect(result.current.summary).not.toBeNull();
    });

    handle.isUnlocked = false;
    rerender();
    expect(result.current.summary).toBeNull();

    handle.isUnlocked = true;
    rerender();

    await waitFor(() => {
      expect(result.current.summary).not.toBeNull();
    });
    expect(handle.loadDecryptedData).toHaveBeenCalledTimes(10);
  });
});
