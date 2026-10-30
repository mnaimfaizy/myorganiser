'use client';

import type { Task, TaskStatus } from '@myorganiser/vault-core';
import { ToastAction, useToast } from '@myorganiser/web-ui';
import type { VaultHandle } from '@myorganiser/web-vault';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useTasksWorkflow } from '../workflow';
import type { TaskFormInput, TaskUpdateInput } from '../workflow';
import { localDateKey } from '../workflow/task-grouping';
import type { TaskDetailPatch } from './use-task-detail-draft';

export interface TaskQuickAddValues {
  title: string;
  dueToday: boolean;
  high: boolean;
}

export interface TaskCaptureValues {
  title: string;
  dueDate?: string;
  high: boolean;
  personal: boolean;
}

/** Full update payload built from every field a Task carries, so none is dropped. */
function toUpdateInput(task: Task): TaskUpdateInput {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    context: task.context,
    dueDate: task.dueDate,
    estimatedMinutes: task.estimatedMinutes,
  };
}

/**
 * The Tasks page behaviour: loads through `useTasksWorkflow`, runs every
 * mutation, and reports each outcome with a toast. Plaintext stays in browser
 * memory; this hook only decides what to save and what to say about it.
 *
 * Mutations are serialised here. The workflow no longer loses a write when two
 * overlap (#1277); the page keeps one write at a time so the save indicator
 * speaks for a single outcome and a refused dialog can keep its values. While
 * a write is in flight every mutating action resolves `false` without running
 * (`addTask` throws). The one exception is Undo, which waits for the write in
 * flight and then runs.
 */
export function useTasksPage(handle: VaultHandle) {
  const { toast } = useToast();
  const workflow = useTasksWorkflow({ handle });
  const {
    tasks,
    loading,
    loadError,
    addTask: addTaskWorkflow,
    deleteTask: deleteTaskWorkflow,
    archiveTask: archiveTaskWorkflow,
    unarchiveTask: unarchiveTaskWorkflow,
  } = workflow;

  // Toasts that outlive a render (the Undo action) must read the workflow as
  // it is when they fire, not as it was when they were created.
  const workflowRef = useRef(workflow);
  // Write settlement, tracked against render commits. `settledSeq` counts writes
  // that have settled; `committedSeq` is the count the latest commit reflects.
  const settledSeqRef = useRef(0);
  const committedSeqRef = useRef(0);
  const commitWaitersRef = useRef<{ target: number; resolve: () => void }[]>(
    [],
  );
  // Settling a write always bumps `settleTick`, so a render commit follows every
  // settle even when the write left `workflow` unchanged (a refused write can
  // return the same array). Bailing on `busy` alone is not enough: a true->false
  // flip batched with the same tick is a no-op and commits nothing.
  // No dependency list, so the effect runs on every commit.
  useEffect(() => {
    workflowRef.current = workflow;
    committedSeqRef.current = settledSeqRef.current;
    const ready = commitWaitersRef.current.filter(
      (waiter) => waiter.target <= committedSeqRef.current,
    );
    commitWaitersRef.current = commitWaitersRef.current.filter(
      (waiter) => waiter.target > committedSeqRef.current,
    );
    for (const waiter of ready) waiter.resolve();
  });

  /** Resolves once a render commit reflects every write settled up to `target`. */
  const afterCommit = useCallback(
    (target: number): Promise<void> =>
      new Promise<void>((resolve) => {
        if (committedSeqRef.current >= target) {
          resolve();
          return;
        }
        commitWaitersRef.current.push({ target, resolve });
      }),
    [],
  );

  const inFlightRef = useRef(0);
  // The write in flight, settled only after its in-flight count is released.
  const pendingRef = useRef<Promise<unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setSettleTick] = useState(0);

  /** Starts one mutation and tracks it as in flight until it settles. */
  const start = useCallback(<T,>(run: () => Promise<T>): Promise<T> => {
    inFlightRef.current += 1;
    setBusy(true);
    const running = run().finally(() => {
      settledSeqRef.current += 1;
      setSettleTick((tick) => tick + 1);
      inFlightRef.current -= 1;
      if (inFlightRef.current === 0) setBusy(false);
    });
    pendingRef.current = running;
    return running;
  }, []);

  /** Runs one mutation at a time; returns `idle` without running when another is in flight. */
  const runExclusive = useCallback(
    async <T,>(run: () => Promise<T>, idle: T): Promise<T> => {
      if (inFlightRef.current > 0) return idle;
      return start(run);
    },
    [start],
  );

  /**
   * Runs a mutation that must not be dropped (the Undo action): waits for the
   * write in flight to settle and for a render commit to carry its result, so
   * the mutation reads the saved workflow, not the one before the write. The
   * loop re-checks in case another write started while it waited.
   */
  const runQueued = useCallback(
    async <T,>(run: () => Promise<T>): Promise<T> => {
      for (;;) {
        while (inFlightRef.current > 0) {
          await pendingRef.current?.catch(() => undefined);
        }
        await afterCommit(settledSeqRef.current);
        if (inFlightRef.current === 0) break;
      }
      return start(run);
    },
    [afterCommit, start],
  );

  useEffect(() => {
    if (loadError) {
      toast({
        title: 'Failed to load tasks',
        description: 'Could not decrypt saved data.',
        variant: 'destructive',
      });
    }
  }, [loadError, toast]);

  const reportSaveFailure = useCallback(
    (message: string) => {
      toast({
        title: 'Failed to save',
        description: message,
        variant: 'destructive',
      });
    },
    [toast],
  );

  /** The newest copy of a Task, falling back to the one the caller holds. */
  const latestTask = useCallback((task: Task): Task => {
    return workflowRef.current.tasks.find((t) => t.id === task.id) ?? task;
  }, []);

  // Internal writes. They do not take the busy gate, so a gated action can
  // call them without blocking itself.
  const writeTask = useCallback(
    async (taskId: string, values: TaskUpdateInput): Promise<boolean> => {
      const result = await workflowRef.current.updateTask(taskId, values);
      if (!result.ok) {
        reportSaveFailure(result.error.message);
        return false;
      }
      return true;
    },
    [reportSaveFailure],
  );

  const addTaskNow = useCallback(
    async (values: TaskFormInput): Promise<void> => {
      const result = await addTaskWorkflow(values);
      if (!result.ok) {
        reportSaveFailure(result.error.message);
        throw new Error(result.error.message);
      }
      toast({
        title: 'Task created',
        description: 'Your task has been saved (encrypted).',
      });
    },
    [addTaskWorkflow, reportSaveFailure, toast],
  );

  /** Adds a Task and resolves false instead of throwing, for the quick bars. */
  const saveNewTask = useCallback(
    async (values: TaskFormInput): Promise<boolean> => {
      try {
        await addTaskNow(values);
        return true;
      } catch {
        return false;
      }
    },
    [addTaskNow],
  );

  const undoDoneNow = useCallback(
    async (taskId: string, previousStatus: TaskStatus): Promise<void> => {
      const current = workflowRef.current.tasks.find((t) => t.id === taskId);
      if (!current) return;
      await writeTask(taskId, {
        ...toUpdateInput(current),
        status: previousStatus,
      });
    },
    [writeTask],
  );

  // Undo is never silently dropped: it queues behind a write in flight.
  const undoDone = useCallback(
    (taskId: string, previousStatus: TaskStatus): Promise<void> =>
      runQueued(() => undoDoneNow(taskId, previousStatus)),
    [runQueued, undoDoneNow],
  );

  const toggleDoneNow = useCallback(
    async (task: Task, done: boolean): Promise<boolean> => {
      const current = latestTask(task);
      if (!done) {
        return writeTask(task.id, {
          ...toUpdateInput(current),
          status: 'pending',
        });
      }

      const previousStatus = current.status;
      const saved = await writeTask(task.id, {
        ...toUpdateInput(current),
        status: 'done',
      });
      if (!saved) return false;

      toast({
        title: 'Task done',
        action: (
          <ToastAction
            altText="Undo"
            onClick={() => undoDone(task.id, previousStatus)}
          >
            Undo
          </ToastAction>
        ),
      });
      return true;
    },
    [latestTask, toast, undoDone, writeTask],
  );

  const addTask = useCallback(
    async (values: TaskFormInput): Promise<void> => {
      const added = await runExclusive(
        () => addTaskNow(values).then(() => true),
        false,
      );
      if (!added) {
        // Busy: the dialog stays open and keeps its values for a retry.
        throw new Error('Another change is still saving. Try again.');
      }
    },
    [addTaskNow, runExclusive],
  );

  const quickAdd = useCallback(
    ({ title, dueToday, high }: TaskQuickAddValues): Promise<boolean> =>
      runExclusive(
        () =>
          saveNewTask({
            title,
            priority: high ? 'high' : 'medium',
            status: 'pending',
            dueDate: dueToday ? localDateKey(new Date()) : undefined,
          }),
        false,
      ),
    [runExclusive, saveNewTask],
  );

  const capture = useCallback(
    ({ title, dueDate, high, personal }: TaskCaptureValues): Promise<boolean> =>
      runExclusive(
        () =>
          saveNewTask({
            title,
            priority: high ? 'high' : 'medium',
            status: 'pending',
            context: personal ? 'personal' : undefined,
            dueDate,
          }),
        false,
      ),
    [runExclusive, saveNewTask],
  );

  const toggleDone = useCallback(
    (task: Task, done: boolean): Promise<boolean> =>
      runExclusive(() => toggleDoneNow(task, done), false),
    [runExclusive, toggleDoneNow],
  );

  const updateFields = useCallback(
    (task: Task, patch: TaskDetailPatch): Promise<boolean> =>
      runExclusive(
        () =>
          writeTask(task.id, { ...toUpdateInput(latestTask(task)), ...patch }),
        false,
      ),
    [latestTask, runExclusive, writeTask],
  );

  const archive = useCallback(
    (id: string): Promise<boolean> =>
      runExclusive(async () => {
        const result = await archiveTaskWorkflow(id);
        if (!result.ok) {
          reportSaveFailure(result.error.message);
          return false;
        }
        toast({
          title: 'Task archived',
          description: 'Task moved to archive.',
        });
        return true;
      }, false),
    [archiveTaskWorkflow, reportSaveFailure, runExclusive, toast],
  );

  const unarchive = useCallback(
    (id: string): Promise<boolean> =>
      runExclusive(async () => {
        const result = await unarchiveTaskWorkflow(id);
        if (!result.ok) {
          reportSaveFailure(result.error.message);
          return false;
        }
        toast({
          title: 'Task restored',
          description: 'Task moved back to active.',
        });
        return true;
      }, false),
    [reportSaveFailure, runExclusive, toast, unarchiveTaskWorkflow],
  );

  const deleteTask = useCallback(
    (id: string): Promise<boolean> =>
      runExclusive(async () => {
        const result = await deleteTaskWorkflow(id);
        if (!result.ok) {
          reportSaveFailure(result.error.message);
          return false;
        }
        toast({
          title: 'Task deleted',
          description: 'Your task has been deleted.',
        });
        return true;
      }, false),
    [deleteTaskWorkflow, reportSaveFailure, runExclusive, toast],
  );

  return {
    tasks,
    loading,
    busy,
    addTask,
    quickAdd,
    capture,
    toggleDone,
    updateFields,
    archive,
    unarchive,
    deleteTask,
  };
}

export type TasksPageController = ReturnType<typeof useTasksPage>;
