/**
 * Tests for useTasksWorkflow hook.
 *
 * Focus: integration with Local Vault Revision (#587).
 * Convergence replaces the Local Vault without passing through page effects,
 * so pages holding decrypted records see stale copies. The revision must
 * trigger re-reads, and mutations must save the full array including
 * converged records.
 */

/* eslint-disable import/first -- jest.mock must precede application imports */
jest.mock('@myorganiser/web-vault-ui', () => {
  const actual = jest.requireActual('@myorganiser/web-vault-ui');
  return {
    ...actual,
    useLocalVaultRevision: jest.fn(() => 0),
  };
});

jest.mock('@myorganiser/core', () => ({
  ...jest.requireActual('@myorganiser/core'),
  randomId: jest.fn(),
}));

import { renderHook, act, waitFor } from '@testing-library/react';
import type { Task } from '@myorganiser/vault-core';
import { randomId } from '@myorganiser/core';
import { useLocalVaultRevision } from '@myorganiser/web-vault-ui';

import {
  useTasksWorkflow,
  type UseTasksWorkflowResult,
} from './useTasksWorkflow';
import { InMemoryTasksVaultAdapter } from './tasks-vault-adapter';

const FIXED_NOW = '2024-06-15T12:00:00.000Z';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test task',
    status: 'pending',
    priority: 'medium',
    archived: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('useTasksWorkflow — Local Vault Revision integration', () => {
  let idCounter = 0;

  beforeEach(() => {
    idCounter = 0;
    (randomId as jest.Mock).mockReset();
    (randomId as jest.Mock).mockImplementation(
      () => `generated-id-${++idCounter}`,
    );
    jest.spyOn(Date.prototype, 'toISOString').mockReturnValue(FIXED_NOW);
    (useLocalVaultRevision as jest.Mock).mockReset();
    (useLocalVaultRevision as jest.Mock).mockReturnValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('#587 regression: convergence must trigger re-read and preserve converged data', () => {
    it('loads initial task on mount', async () => {
      const initialTask = makeTask({ id: 'task-1', title: 'Initial task' });
      const adapter = new InMemoryTasksVaultAdapter({ tasks: [initialTask] });

      const { result } = renderHook(() =>
        useTasksWorkflow({ handle: null as any, adapter }),
      );

      // Initially loading
      expect(result.current.loading).toBe(true);

      // Wait for load to complete
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should expose the initial task
      expect(result.current.tasks).toHaveLength(1);
      expect(result.current.tasks[0]).toEqual(initialTask);
    });

    it('re-reads tasks when revision bumps (simulating convergence)', async () => {
      const initialTask = makeTask({ id: 'task-1', title: 'Initial task' });
      const adapter = new InMemoryTasksVaultAdapter({ tasks: [initialTask] });

      // Start with revision 0
      (useLocalVaultRevision as jest.Mock).mockReturnValue(0);

      const { result, rerender } = renderHook(() =>
        useTasksWorkflow({ handle: null as any, adapter }),
      );

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.tasks).toHaveLength(1);
      expect(result.current.tasks[0].title).toBe('Initial task');

      // Simulate convergence: change adapter's stored tasks
      const convergedTask = makeTask({
        id: 'task-2',
        title: 'Task from server',
      });
      adapter['tasks'] = [initialTask, convergedTask];

      // Bump revision to trigger re-read
      (useLocalVaultRevision as jest.Mock).mockReturnValue(1);
      rerender();

      // Wait for re-read effect
      await waitFor(() => {
        expect(result.current.tasks).toHaveLength(2);
      });

      // Hook should now expose both tasks
      expect(result.current.tasks.map((t) => t.id).sort()).toEqual([
        'task-1',
        'task-2',
      ]);
    });

    it('mutation after convergence saves all tasks including converged ones', async () => {
      const initialTask = makeTask({ id: 'task-1', title: 'Initial task' });
      const adapter = new InMemoryTasksVaultAdapter({ tasks: [initialTask] });

      (useLocalVaultRevision as jest.Mock).mockReturnValue(0);

      const { result, rerender } = renderHook(() =>
        useTasksWorkflow({ handle: null as any, adapter }),
      );

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.tasks).toHaveLength(1);

      // Simulate convergence
      const convergedTask = makeTask({
        id: 'task-2',
        title: 'Task from server',
      });
      adapter['tasks'] = [initialTask, convergedTask];

      (useLocalVaultRevision as jest.Mock).mockReturnValue(1);
      rerender();

      // Wait for re-read
      await waitFor(() => {
        expect(result.current.tasks).toHaveLength(2);
      });

      // Now mutate the initial task via the hook
      await act(async () => {
        await result.current.updateTask('task-1', {
          title: 'Updated initial task',
          priority: 'medium',
          status: 'pending',
        });
      });

      // The adapter should have saved all tasks, including the converged one
      const savedTasks = adapter.getSavedTasks();
      expect(savedTasks).toHaveLength(2);

      // Both tasks should be in the saved array
      const savedIds = savedTasks!.map((t) => t.id).sort();
      expect(savedIds).toEqual(['task-1', 'task-2']);

      // Initial task should be updated
      const updatedInitial = savedTasks!.find((t) => t.id === 'task-1');
      expect(updatedInitial?.title).toBe('Updated initial task');

      // Converged task should be preserved (not lost)
      const preserved = savedTasks!.find((t) => t.id === 'task-2');
      expect(preserved?.title).toBe('Task from server');
    });

    it('multiple revisions trigger multiple re-reads', async () => {
      const task1 = makeTask({ id: 'task-1', title: 'Task 1' });
      const adapter = new InMemoryTasksVaultAdapter({ tasks: [task1] });

      (useLocalVaultRevision as jest.Mock).mockReturnValue(0);

      const { result, rerender } = renderHook(() =>
        useTasksWorkflow({ handle: null as any, adapter }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.tasks).toHaveLength(1);

      // First convergence
      const task2 = makeTask({ id: 'task-2', title: 'Task 2' });
      adapter['tasks'] = [task1, task2];

      (useLocalVaultRevision as jest.Mock).mockReturnValue(1);
      rerender();

      await waitFor(() => {
        expect(result.current.tasks).toHaveLength(2);
      });

      // Second convergence
      const task3 = makeTask({ id: 'task-3', title: 'Task 3' });
      adapter['tasks'] = [task1, task2, task3];

      (useLocalVaultRevision as jest.Mock).mockReturnValue(2);
      rerender();

      await waitFor(() => {
        expect(result.current.tasks).toHaveLength(3);
      });

      expect(result.current.tasks.map((t) => t.id)).toEqual([
        'task-1',
        'task-2',
        'task-3',
      ]);
    });

    it('deleteTask after convergence preserves undeleted converged tasks', async () => {
      const initialTask = makeTask({ id: 'task-1', title: 'Initial' });
      const adapter = new InMemoryTasksVaultAdapter({ tasks: [initialTask] });

      (useLocalVaultRevision as jest.Mock).mockReturnValue(0);

      const { result, rerender } = renderHook(() =>
        useTasksWorkflow({ handle: null as any, adapter }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Simulate convergence: server added a task
      const convergedTask = makeTask({ id: 'task-2', title: 'From server' });
      adapter['tasks'] = [initialTask, convergedTask];

      (useLocalVaultRevision as jest.Mock).mockReturnValue(1);
      rerender();

      await waitFor(() => {
        expect(result.current.tasks).toHaveLength(2);
      });

      // Delete the initial task
      await act(async () => {
        await result.current.deleteTask('task-1');
      });

      // The converged task should still be saved
      const savedTasks = adapter.getSavedTasks();
      expect(savedTasks).toHaveLength(1);
      expect(savedTasks![0].id).toBe('task-2');
    });
  });

  describe('#1277 overlapping writes: each write starts from what the last one saved', () => {
    /**
     * Holds every load and every Vault write open until the test releases it,
     * so a second call can be started while the first is still pending.
     */
    class HeldTasksVaultAdapter extends InMemoryTasksVaultAdapter {
      private readonly heldLoads: Array<(tasks: Task[] | null) => void> = [];
      private readonly heldWrites: Array<() => void> = [];

      loadTasks(): Promise<Task[] | null> {
        return new Promise((resolve) => {
          this.heldLoads.push(resolve);
        });
      }

      saveTasks(tasks: Task[]): Promise<void> {
        return this.hold().then(() => super.saveTasks(tasks));
      }

      deleteTask(
        tasks: Task[],
        taskId: string,
        deletedAt: string,
      ): Promise<Task[]> {
        return this.hold().then(() =>
          super.deleteTask(tasks, taskId, deletedAt),
        );
      }

      pendingLoadCount(): number {
        return this.heldLoads.length;
      }

      pendingWriteCount(): number {
        return this.heldWrites.length;
      }

      resolveNextLoad(tasks: Task[] | null): void {
        this.heldLoads.shift()?.(tasks);
      }

      releaseNextWrite(): void {
        this.heldWrites.shift()?.();
      }

      private hold(): Promise<void> {
        return new Promise((resolve) => {
          this.heldWrites.push(resolve);
        });
      }
    }

    async function settleLoad(
      adapter: HeldTasksVaultAdapter,
      tasks: Task[] | null,
    ): Promise<void> {
      await waitFor(() => expect(adapter.pendingLoadCount()).toBe(1));
      await act(async () => {
        adapter.resolveNextLoad(tasks);
      });
    }

    async function releaseWrite(adapter: HeldTasksVaultAdapter): Promise<void> {
      await act(async () => {
        adapter.releaseNextWrite();
      });
    }

    /** Mounts the hook on a held adapter and settles its initial load. */
    async function mountWithLoadedTasks(tasks: Task[]): Promise<{
      adapter: HeldTasksVaultAdapter;
      result: { current: UseTasksWorkflowResult };
      rerender: () => void;
    }> {
      const adapter = new HeldTasksVaultAdapter();
      const { result, rerender } = renderHook(() =>
        useTasksWorkflow({ handle: null as any, adapter }),
      );
      await settleLoad(adapter, tasks);
      await waitFor(() => expect(result.current.loading).toBe(false));
      return { adapter, result, rerender };
    }

    /** Releases the next `count` queued Vault writes, one at a time, in queue order. */
    async function drainQueuedWrites(
      adapter: HeldTasksVaultAdapter,
      count: number,
    ): Promise<void> {
      for (let i = 0; i < count; i++) {
        await waitFor(() => expect(adapter.pendingWriteCount()).toBe(1));
        await releaseWrite(adapter);
      }
    }

    it('two archives called before the first save settles both survive', async () => {
      const { adapter, result } = await mountWithLoadedTasks([
        makeTask({ id: 'a', title: 'A' }),
        makeTask({ id: 'b', title: 'B' }),
      ]);

      // Both calls come from the same render, and neither has saved yet.
      const archiveA = result.current.archiveTask('a');
      const archiveB = result.current.archiveTask('b');

      await drainQueuedWrites(adapter, 2);

      await expect(archiveA).resolves.toEqual({ ok: true, kind: 'archived' });
      await expect(archiveB).resolves.toEqual({ ok: true, kind: 'archived' });

      const saved = adapter.getSavedTasks() ?? [];
      expect(saved).toHaveLength(2);
      expect(saved).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'a', archived: true }),
          expect.objectContaining({ id: 'b', archived: true }),
        ]),
      );
      await waitFor(() => {
        expect(result.current.tasks).toHaveLength(2);
        expect(result.current.tasks.every((t) => t.archived)).toBe(true);
      });
    });

    it('add overlapping an update keeps the updated task and the new one', async () => {
      const { adapter, result } = await mountWithLoadedTasks([
        makeTask({ id: 'task-1', title: 'Existing' }),
      ]);

      const update = result.current.updateTask('task-1', {
        title: 'Renamed',
        priority: 'high',
        status: 'pending',
      });
      const add = result.current.addTask({
        title: 'New task',
        priority: 'low',
        status: 'pending',
      });

      await drainQueuedWrites(adapter, 2);

      await expect(update).resolves.toEqual({ ok: true, kind: 'updated' });
      await expect(add).resolves.toEqual({ ok: true, kind: 'created' });

      const saved = adapter.getSavedTasks() ?? [];
      expect(saved).toHaveLength(2);
      expect(saved).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'task-1',
            title: 'Renamed',
            priority: 'high',
          }),
          expect.objectContaining({ title: 'New task', priority: 'low' }),
        ]),
      );
    });

    it('delete overlapping an archive removes one task, archives the other, and logs the deletion', async () => {
      const { adapter, result } = await mountWithLoadedTasks([
        makeTask({ id: 'a', title: 'A' }),
        makeTask({ id: 'b', title: 'B' }),
      ]);

      const remove = result.current.deleteTask('a');
      const archive = result.current.archiveTask('b');

      await drainQueuedWrites(adapter, 2);

      await expect(remove).resolves.toEqual({ ok: true, kind: 'deleted' });
      await expect(archive).resolves.toEqual({ ok: true, kind: 'archived' });

      const saved = adapter.getSavedTasks() ?? [];
      expect(saved.map((t) => t.id)).toEqual(['b']);
      expect(saved[0].archived).toBe(true);
      expect(adapter.getSavedDeletions()).toEqual({ a: FIXED_NOW });
    });

    it('unarchive overlapping an update keeps both changes', async () => {
      const { adapter, result } = await mountWithLoadedTasks([
        makeTask({ id: 'task-1', title: 'Archived one', archived: true }),
        makeTask({ id: 'task-2', title: 'Pending one' }),
      ]);

      const unarchive = result.current.unarchiveTask('task-1');
      const update = result.current.updateTask('task-2', {
        title: 'Renamed',
        priority: 'medium',
        status: 'pending',
      });

      await drainQueuedWrites(adapter, 2);

      await expect(unarchive).resolves.toEqual({
        ok: true,
        kind: 'unarchived',
      });
      await expect(update).resolves.toEqual({ ok: true, kind: 'updated' });

      const saved = adapter.getSavedTasks() ?? [];
      expect(saved).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'task-1', archived: false }),
          expect.objectContaining({ id: 'task-2', title: 'Renamed' }),
        ]),
      );
    });

    it('a load superseded by a newer revision neither applies nor writes back', async () => {
      const staleTask = makeTask({
        id: 'task-1',
        title: 'Stale copy',
        priority: 'urgent' as Task['priority'],
      });
      const newerTask = makeTask({ id: 'task-2', title: 'Current copy' });
      const adapter = new HeldTasksVaultAdapter({ tasks: [newerTask] });
      const saveSpy = jest.spyOn(adapter, 'saveTasks');

      (useLocalVaultRevision as jest.Mock).mockReturnValue(0);
      const { result, rerender } = renderHook(() =>
        useTasksWorkflow({ handle: null as any, adapter }),
      );

      // The first load is in flight when the revision moves on.
      await waitFor(() => expect(adapter.pendingLoadCount()).toBe(1));
      (useLocalVaultRevision as jest.Mock).mockReturnValue(1);
      rerender();

      // The older read resolves with a copy that would need normalising.
      await settleLoad(adapter, [staleTask]);
      expect(result.current.loading).toBe(true);

      // Only the newer load's read is applied.
      await settleLoad(adapter, [newerTask]);
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.tasks).toEqual([newerTask]);

      expect(saveSpy).not.toHaveBeenCalled();
      expect(adapter.getSavedTasks()).toEqual([newerTask]);
    });

    it('a load write-back that finishes after a newer revision does not apply its stale copy', async () => {
      const newerTask = makeTask({ id: 'task-2', title: 'Current copy' });
      const adapter = new HeldTasksVaultAdapter();

      (useLocalVaultRevision as jest.Mock).mockReturnValue(0);
      const { result, rerender } = renderHook(() =>
        useTasksWorkflow({ handle: null as any, adapter }),
      );

      // The stored copy needs normalising, so the first load writes it back.
      await settleLoad(adapter, [
        makeTask({
          id: 'task-1',
          title: 'Stale copy',
          priority: 'urgent' as Task['priority'],
        }),
      ]);
      await waitFor(() => expect(adapter.pendingWriteCount()).toBe(1));

      // The revision moves on while that write-back is still held.
      (useLocalVaultRevision as jest.Mock).mockReturnValue(1);
      rerender();

      // Releasing the write lets the stale load finish. It must not apply.
      await releaseWrite(adapter);
      await waitFor(() => expect(adapter.pendingLoadCount()).toBe(1));
      expect(result.current.tasks).toEqual([]);
      expect(result.current.loading).toBe(true);

      // The newer load settles with its own copy, and that is what is shown.
      await settleLoad(adapter, [newerTask]);
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.tasks).toEqual([newerTask]);
    });

    it('a load write-back still pending holds a mutation behind it', async () => {
      const adapter = new HeldTasksVaultAdapter();
      const { result } = renderHook(() =>
        useTasksWorkflow({ handle: null as any, adapter }),
      );
      // The stored copy needs normalising, so the load writes it back.
      await settleLoad(adapter, [
        makeTask({
          id: 'task-1',
          title: 'Old copy',
          priority: 'urgent' as Task['priority'],
        }),
      ]);
      await waitFor(() => expect(adapter.pendingWriteCount()).toBe(1));

      const added = result.current.addTask({
        title: 'New task',
        priority: 'low',
        status: 'pending',
      });

      // Let any unqueued work run, then check that only the write-back is out.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(adapter.pendingWriteCount()).toBe(1);
      expect(result.current.tasks).toEqual([]);

      await drainQueuedWrites(adapter, 2);

      await expect(added).resolves.toEqual({ ok: true, kind: 'created' });
      const saved = adapter.getSavedTasks() ?? [];
      expect(saved).toHaveLength(2);
      expect(saved).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'task-1', priority: 'medium' }),
          expect.objectContaining({ title: 'New task' }),
        ]),
      );
    });

    it('mutation callbacks keep their identity across a re-render that changes tasks', async () => {
      const { adapter, result } = await mountWithLoadedTasks([
        makeTask({ id: 'task-1' }),
      ]);

      const before = result.current;
      const archived = result.current.archiveTask('task-1');
      await drainQueuedWrites(adapter, 1);
      await expect(archived).resolves.toEqual({ ok: true, kind: 'archived' });
      await waitFor(() => expect(result.current.tasks[0].archived).toBe(true));

      const mutations = [
        'addTask',
        'updateTask',
        'deleteTask',
        'archiveTask',
        'unarchiveTask',
      ] as const;
      for (const name of mutations) {
        expect(result.current[name]).toBe(before[name]);
      }
    });

    it('a write that rejects reaches its caller and does not strand the writes queued behind it', async () => {
      const { adapter, result } = await mountWithLoadedTasks([
        makeTask({ id: 'a', title: 'A' }),
        makeTask({ id: 'b', title: 'B' }),
      ]);

      // addTaskToWorkflow calls randomId before its own try/catch, so this
      // throw rejects the add itself rather than becoming a save_failed result.
      (randomId as jest.Mock).mockImplementationOnce(() => {
        throw new Error('id source unavailable');
      });

      const archiveA = result.current.archiveTask('a');
      const add = result.current.addTask({
        title: 'New task',
        priority: 'low',
        status: 'pending',
      });
      const archiveB = result.current.archiveTask('b');
      // Attached synchronously so the rejection is never unhandled.
      const addRejection = expect(add).rejects.toThrow('id source unavailable');

      await drainQueuedWrites(adapter, 2);

      await expect(archiveA).resolves.toEqual({ ok: true, kind: 'archived' });
      await addRejection;
      await expect(archiveB).resolves.toEqual({ ok: true, kind: 'archived' });

      // The later archive started from what the successful archive of 'a' saved:
      // no new task, and 'a' still archived when 'b' was written.
      const saved = adapter.getSavedTasks() ?? [];
      expect(saved).toHaveLength(2);
      expect(saved).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'a', archived: true }),
          expect.objectContaining({ id: 'b', archived: true }),
        ]),
      );
      await waitFor(() => {
        expect(result.current.tasks).toHaveLength(2);
        expect(result.current.tasks.every((t) => t.archived)).toBe(true);
      });
    });

    describe('a write re-reads the Vault when the array is not known to match it', () => {
      /** Makes the first `count` Vault reads throw, then reads normally. */
      function failFirstLoads(
        adapter: InMemoryTasksVaultAdapter,
        count: number,
      ): void {
        const read = adapter.loadTasks.bind(adapter);
        let failures = count;
        jest.spyOn(adapter, 'loadTasks').mockImplementation(async () => {
          if (failures > 0) {
            failures -= 1;
            throw new Error('decrypt failed');
          }
          return read();
        });
      }

      it('an add queued behind a superseded load re-reads the Vault and keeps the existing tasks', async () => {
        const existing = makeTask({ id: 'task-1', title: 'Existing' });
        const adapter = new HeldTasksVaultAdapter();
        const { result, rerender } = renderHook(() =>
          useTasksWorkflow({ handle: null as any, adapter }),
        );
        // The first load is still in flight when the add is queued and the revision moves on.
        await waitFor(() => expect(adapter.pendingLoadCount()).toBe(1));
        const added = result.current.addTask({
          title: 'New task',
          priority: 'low',
          status: 'pending',
        });
        (useLocalVaultRevision as jest.Mock).mockReturnValue(1);
        rerender();

        // The superseded load resolves empty, and that must not be applied.
        await settleLoad(adapter, null);
        // The add reads the Vault itself before it saves.
        await settleLoad(adapter, [existing]);
        await drainQueuedWrites(adapter, 1);
        await expect(added).resolves.toEqual({ ok: true, kind: 'created' });

        const saved = adapter.getSavedTasks() ?? [];
        expect(saved).toHaveLength(2);
        expect(saved).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: 'task-1', title: 'Existing' }),
            expect.objectContaining({ title: 'New task' }),
          ]),
        );

        // The revision's own load runs last and applies what is now stored.
        await settleLoad(adapter, saved);
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.tasks).toHaveLength(2);
      });

      it('a mutation queued before a revision bump re-reads and saves over the converged tasks', async () => {
        const first = makeTask({ id: 'task-1', title: 'First' });
        const converged = makeTask({ id: 'task-2', title: 'From server' });
        const { adapter, result, rerender } = await mountWithLoadedTasks([
          first,
        ]);

        const archived = result.current.archiveTask('task-1');
        await waitFor(() => expect(adapter.pendingWriteCount()).toBe(1));
        // Queued while the archive is still saving, so it runs after it.
        const added = result.current.addTask({
          title: 'New task',
          priority: 'low',
          status: 'pending',
        });
        (useLocalVaultRevision as jest.Mock).mockReturnValue(1);
        rerender();

        await releaseWrite(adapter);
        await expect(archived).resolves.toEqual({
          ok: true,
          kind: 'archived',
        });
        // Convergence has added a task to the Vault since the page last read it.
        await settleLoad(adapter, [
          ...(adapter.getSavedTasks() ?? []),
          converged,
        ]);
        await drainQueuedWrites(adapter, 1);
        await expect(added).resolves.toEqual({ ok: true, kind: 'created' });

        const saved = adapter.getSavedTasks() ?? [];
        expect(saved).toHaveLength(3);
        expect(saved).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: 'task-1', archived: true }),
            expect.objectContaining({ id: 'task-2', title: 'From server' }),
            expect.objectContaining({ title: 'New task' }),
          ]),
        );

        await settleLoad(adapter, saved);
        await waitFor(() => expect(result.current.tasks).toHaveLength(3));
      });

      it('an add after a failed load re-reads and saves the existing tasks with the new one', async () => {
        const existing = makeTask({ id: 'task-1', title: 'Existing' });
        const adapter = new InMemoryTasksVaultAdapter({ tasks: [existing] });
        failFirstLoads(adapter, 1);

        const { result } = renderHook(() =>
          useTasksWorkflow({ handle: null as any, adapter }),
        );
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.loadError).toEqual({
          code: 'load_failed',
          message: 'Could not decrypt saved data.',
        });
        expect(result.current.tasks).toEqual([]);

        const added = result.current.addTask({
          title: 'New task',
          priority: 'low',
          status: 'pending',
        });
        await act(async () => {
          await added;
        });
        await expect(added).resolves.toEqual({ ok: true, kind: 'created' });
        expect(result.current.loadError).toBeNull();

        const saved = adapter.getSavedTasks() ?? [];
        expect(saved).toHaveLength(2);
        expect(saved).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: 'task-1', title: 'Existing' }),
            expect.objectContaining({ title: 'New task' }),
          ]),
        );
      });

      it('an add whose re-read write-back also fails resolves load_failed, saves no new task, and leaves the stored copy unchanged', async () => {
        const stored = makeTask({
          id: 'task-1',
          title: 'Stored copy',
          priority: 'urgent' as Task['priority'],
        });
        const adapter = new InMemoryTasksVaultAdapter({ tasks: [stored] });
        // Every write-back fails: the mount's normalisation and the add's re-read alike.
        const saveSpy = jest
          .spyOn(adapter, 'saveTasks')
          .mockRejectedValue(new Error('disk full'));

        const { result } = renderHook(() =>
          useTasksWorkflow({ handle: null as any, adapter }),
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        const added = result.current.addTask({
          title: 'New task',
          priority: 'low',
          status: 'pending',
        });
        await act(async () => {
          await added;
        });
        await expect(added).resolves.toEqual({
          ok: false,
          error: {
            code: 'load_failed',
            message: 'Could not decrypt saved data.',
          },
        });

        const savedTitles = saveSpy.mock.calls.flatMap(([tasks]) =>
          tasks.map((t) => t.title),
        );
        expect(savedTitles).not.toContain('New task');
        expect(adapter.getSavedTasks()).toEqual([stored]);
      });

      it('a mutation whose re-read also fails resolves load_failed without saving, and a later mutation still runs', async () => {
        const existing = makeTask({ id: 'task-1', title: 'Existing' });
        const adapter = new InMemoryTasksVaultAdapter({ tasks: [existing] });
        // Fails the mount's load and the add's re-read; the Vault reads again after that.
        failFirstLoads(adapter, 2);
        const saveSpy = jest.spyOn(adapter, 'saveTasks');

        const { result } = renderHook(() =>
          useTasksWorkflow({ handle: null as any, adapter }),
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        const added = result.current.addTask({
          title: 'New task',
          priority: 'low',
          status: 'pending',
        });
        await act(async () => {
          await added;
        });
        await expect(added).resolves.toEqual({
          ok: false,
          error: {
            code: 'load_failed',
            message: 'Could not decrypt saved data.',
          },
        });
        expect(saveSpy).not.toHaveBeenCalled();

        const archived = result.current.archiveTask('task-1');
        await act(async () => {
          await archived;
        });
        await expect(archived).resolves.toEqual({
          ok: true,
          kind: 'archived',
        });
        expect(saveSpy).toHaveBeenCalledTimes(1);
        expect(adapter.getSavedTasks()).toEqual([
          expect.objectContaining({ id: 'task-1', archived: true }),
        ]);
      });

      it('mutations after a successful load do not read the Vault again', async () => {
        const adapter = new InMemoryTasksVaultAdapter({
          tasks: [makeTask({ id: 'task-1' })],
        });
        const loadSpy = jest.spyOn(adapter, 'loadTasks');

        const { result } = renderHook(() =>
          useTasksWorkflow({ handle: null as any, adapter }),
        );
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(loadSpy).toHaveBeenCalledTimes(1);

        const archived = result.current.archiveTask('task-1');
        await act(async () => {
          await archived;
        });
        const added = result.current.addTask({
          title: 'New task',
          priority: 'low',
          status: 'pending',
        });
        await act(async () => {
          await added;
        });

        expect(loadSpy).toHaveBeenCalledTimes(1);
        expect(adapter.getSavedTasks()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: 'task-1', archived: true }),
            expect.objectContaining({ title: 'New task' }),
          ]),
        );
      });

      it('a save that fails keeps the change on screen, and the next write saves it too', async () => {
        const adapter = new InMemoryTasksVaultAdapter({
          tasks: [makeTask({ id: 'a' }), makeTask({ id: 'b' })],
        });
        jest.spyOn(adapter, 'saveTasks').mockImplementationOnce(async () => {
          throw new Error('disk full');
        });

        const { result } = renderHook(() =>
          useTasksWorkflow({ handle: null as any, adapter }),
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        const failed = result.current.archiveTask('a');
        await act(async () => {
          await failed;
        });
        await expect(failed).resolves.toEqual({
          ok: false,
          error: { code: 'save_failed', message: 'disk full' },
        });
        // Optimistic: the change is still shown, though the Vault never took it.
        expect(result.current.tasks.find((t) => t.id === 'a')?.archived).toBe(
          true,
        );
        expect(
          adapter.getSavedTasks()?.find((t) => t.id === 'a')?.archived,
        ).toBe(false);

        const next = result.current.archiveTask('b');
        await act(async () => {
          await next;
        });
        await expect(next).resolves.toEqual({ ok: true, kind: 'archived' });

        expect(adapter.getSavedTasks()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: 'a', archived: true }),
            expect.objectContaining({ id: 'b', archived: true }),
          ]),
        );
      });
    });
  });
});
