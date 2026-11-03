/* eslint-disable import/first */
jest.mock('@myorganiser/web-vault-ui', () => ({
  useLocalVaultRevision: jest.fn(),
}));

import { act, renderHook, waitFor } from '@testing-library/react';
import { localDateKey } from '@myorganiser/core';
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
    dueDate: localDateKey(new Date()),
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

  describe('across local midnight', () => {
    const MS_PER_HOUR = 60 * 60 * 1000;

    function setVisibility(state: 'visible' | 'hidden') {
      Object.defineProperty(document, 'visibilityState', {
        value: state,
        configurable: true,
      });
    }

    beforeEach(() => {
      jest.useFakeTimers();
      // Noon, so the next local midnight is twelve hours away and the
      // scheduled timeout is the only thing that can roll the day over.
      jest.setSystemTime(new Date(2026, 10, 3, 12, 0, 0));
      // Reset after setSystemTime so openTask's dueDate is computed under the
      // fake clock, not the real one.
      tasks = [openTask('t1', 'Pay rent')];
    });

    afterEach(() => {
      Reflect.deleteProperty(document, 'visibilityState');
      jest.useRealTimers();
    });

    it('rolls now and the summary over at each midnight, re-arming the timer', async () => {
      // An active subscription billing today: in Renewing soon at mount
      // (0 days away), and gone once midnight makes it -1 days away.
      const billingToday = {
        id: 's1',
        name: 'Streaming',
        status: 'active',
        nextBillingDate: localDateKey(new Date()),
      };
      const handle = makeHandle((type) =>
        type === 'subscriptions' ? [billingToday] : blobsFor(type),
      );
      const { result } = renderHook(() => useHomeSummary(asHandle(handle)));

      await waitFor(() => {
        expect(result.current.summary).not.toBeNull();
      });
      expect(localDateKey(result.current.now)).toBe('2026-11-03');
      expect(result.current.summary?.tasks.dueOpen[0]).toMatchObject({
        dueDate: '2026-11-03',
        overdue: false,
      });
      expect(
        result.current.summary?.subscriptions.renewingSoon.map((r) => r.id),
      ).toEqual(['s1']);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(12 * MS_PER_HOUR + 1000);
      });

      expect(localDateKey(result.current.now)).toBe('2026-11-04');
      // The mount-day task is now before today: it is overdue, and it still
      // counts toward today's total because overdue tasks do.
      await waitFor(() => {
        expect(result.current.summary?.tasks.dueOpen[0]).toMatchObject({
          dueDate: '2026-11-03',
          overdue: true,
        });
      });
      expect(result.current.summary?.tasks.todayTotal).toBe(1);
      // Yesterday's billing day is -1 days away, so it leaves Renewing soon.
      expect(result.current.summary?.subscriptions.renewingSoon).toEqual([]);

      // The first fire re-schedules for the following midnight. A second
      // day rollover proves the timer re-armed rather than firing once.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(24 * MS_PER_HOUR + 1000);
      });
      expect(localDateKey(result.current.now)).toBe('2026-11-05');
    });

    it('catches up at once when the tab is visible again on a later day', async () => {
      const handle = makeHandle(blobsFor);
      const { result } = renderHook(() => useHomeSummary(asHandle(handle)));

      await waitFor(() => {
        expect(result.current.summary).not.toBeNull();
      });

      // The tab is hidden while the clock crosses midnight. The timer is never
      // advanced, so only the visibility listener can move `now`.
      setVisibility('hidden');
      jest.setSystemTime(new Date(2026, 10, 4, 9, 0, 0));
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(localDateKey(result.current.now)).toBe('2026-11-03');

      setVisibility('visible');
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(localDateKey(result.current.now)).toBe('2026-11-04');
      await waitFor(() => {
        expect(handle.loadDecryptedData).toHaveBeenCalledTimes(10);
      });
    });

    it('leaves now and the vault reads unchanged when visible again on the same day', async () => {
      const handle = makeHandle(blobsFor);
      const { result } = renderHook(() => useHomeSummary(asHandle(handle)));

      await waitFor(() => {
        expect(result.current.summary).not.toBeNull();
      });
      const before = result.current.now;
      const readsBefore = handle.loadDecryptedData.mock.calls.length;

      // Later the same day: the time differs, the local date does not.
      jest.setSystemTime(new Date(2026, 10, 3, 15, 30, 0));
      setVisibility('visible');
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      expect(result.current.now).toBe(before);
      expect(handle.loadDecryptedData).toHaveBeenCalledTimes(readsBefore);
    });

    it('clears the midnight timer and the visibility listener on unmount', async () => {
      const addSpy = jest.spyOn(document, 'addEventListener');
      const removeSpy = jest.spyOn(document, 'removeEventListener');
      const handle = makeHandle(blobsFor);
      const { result, unmount } = renderHook(() =>
        useHomeSummary(asHandle(handle)),
      );

      await waitFor(() => {
        expect(result.current.summary).not.toBeNull();
      });
      expect(jest.getTimerCount()).toBeGreaterThan(0);

      const added = addSpy.mock.calls.find(
        ([type]) => type === 'visibilitychange',
      )?.[1];
      expect(added).toEqual(expect.any(Function));

      unmount();

      // The exact handler that was added must be the one removed.
      expect(removeSpy).toHaveBeenCalledWith('visibilitychange', added);
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
