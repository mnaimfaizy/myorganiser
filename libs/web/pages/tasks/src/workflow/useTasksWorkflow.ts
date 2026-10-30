'use client';

import type { Task } from '@myorganiser/vault-core';
import type { VaultHandle } from '@myorganiser/web-vault';
import { useLocalVaultRevision } from '@myorganiser/web-vault-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  addTaskToWorkflow,
  archiveTaskInWorkflow,
  deleteTaskFromWorkflow,
  loadTasksFromVault,
  unarchiveTaskInWorkflow,
  updateTaskInWorkflow,
} from './task-workflow';
import type {
  TaskFormInput,
  TaskUpdateInput,
  TaskWorkflowError,
  TaskWorkflowMutationResult,
} from './task-workflow-types';
import {
  createProductionTasksVaultAdapter,
  type TasksVaultAdapter,
} from './tasks-vault-adapter';

export interface UseTasksWorkflowOptions {
  handle: VaultHandle;
  adapter?: TasksVaultAdapter;
}

export interface UseTasksWorkflowResult {
  tasks: Task[];
  loading: boolean;
  loadError: TaskWorkflowError | null;
  addTask: (formData: TaskFormInput) => Promise<TaskWorkflowMutationResult>;
  updateTask: (
    taskId: string,
    values: TaskUpdateInput,
  ) => Promise<TaskWorkflowMutationResult>;
  deleteTask: (taskId: string) => Promise<TaskWorkflowMutationResult>;
  archiveTask: (taskId: string) => Promise<TaskWorkflowMutationResult>;
  unarchiveTask: (taskId: string) => Promise<TaskWorkflowMutationResult>;
}

/** What a mutation does to the tasks it is handed, and what it reports back. */
type TasksMutation = (
  current: Task[],
) => Promise<{ tasks: Task[]; result: TaskWorkflowMutationResult }>;

export function useTasksWorkflow({
  handle,
  adapter,
}: UseTasksWorkflowOptions): UseTasksWorkflowResult {
  const vaultAdapter = useMemo(
    () => adapter ?? createProductionTasksVaultAdapter(handle),
    [adapter, handle],
  );

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<TaskWorkflowError | null>(null);

  // The tasks the next write starts from, read when that write runs rather
  // than when its callback was created. Every mutation saves the whole array,
  // so two mutations started from one render would both save that render's
  // array and the second would drop the first one's change (#1277).
  const latestTasksRef = useRef<Task[]>([]);

  const applyTasks = useCallback((next: Task[]) => {
    latestTasksRef.current = next;
    setTasks(next);
  }, []);

  // One chain for every Vault write this hook makes — the five mutations and
  // the load's normalisation write-back alike. Nothing here overlaps, so each
  // write starts from what the write before it saved.
  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const enqueue = useCallback(<T>(run: () => Promise<T>): Promise<T> => {
    const queued = writeQueueRef.current.then(run);
    // The chain itself must stay fulfilled, or one rejection would strand
    // every write queued behind it for the life of the page. Nothing reaches
    // this today — the workflow helpers convert an adapter failure into a
    // `save_failed` result rather than rejecting — so it guards a future
    // `run` that throws, and the caller still sees its own rejection.
    writeQueueRef.current = queued.catch(() => undefined);
    return queued;
  }, []);

  const runMutation = useCallback(
    (mutate: TasksMutation): Promise<TaskWorkflowMutationResult> =>
      enqueue(async () => {
        const { tasks: next, result } = await mutate(latestTasksRef.current);
        applyTasks(next);
        return result;
      }),
    [applyTasks, enqueue],
  );

  // Convergence replaces the Local Vault without passing through this hook, so
  // the revision is the only thing that says the Ciphertext behind `tasks`
  // moved. Reloading matters more for the write path than the read one: every
  // mutation below saves the whole array, so a stale `tasks` does not just
  // render out of date — it is what gets written back over the record that
  // arrived (#587).
  const revision = useLocalVaultRevision();

  useEffect(() => {
    let current = true;
    const isCurrent = () => current;

    // The load joins the write queue because its normalisation write-back is
    // a whole-array save like any other. A load the revision has superseded
    // neither writes back nor is applied.
    enqueue(async () => {
      if (!isCurrent()) return;

      const loaded = await loadTasksFromVault(vaultAdapter, { isCurrent });
      if (loaded.superseded) return;
      if (!isCurrent()) return;

      applyTasks(loaded.tasks);
      setLoadError(loaded.loadError);
      setLoading(false);
    });

    return () => {
      current = false;
    };
  }, [applyTasks, enqueue, vaultAdapter, revision]);

  const addTask = useCallback(
    (formData: TaskFormInput) =>
      runMutation((current) =>
        addTaskToWorkflow(vaultAdapter, current, formData),
      ),
    [runMutation, vaultAdapter],
  );

  const updateTask = useCallback(
    (taskId: string, values: TaskUpdateInput) =>
      runMutation((current) =>
        updateTaskInWorkflow(vaultAdapter, current, taskId, values),
      ),
    [runMutation, vaultAdapter],
  );

  const deleteTask = useCallback(
    (taskId: string) =>
      runMutation((current) =>
        deleteTaskFromWorkflow(vaultAdapter, current, taskId),
      ),
    [runMutation, vaultAdapter],
  );

  const archiveTask = useCallback(
    (taskId: string) =>
      runMutation((current) =>
        archiveTaskInWorkflow(vaultAdapter, current, taskId),
      ),
    [runMutation, vaultAdapter],
  );

  const unarchiveTask = useCallback(
    (taskId: string) =>
      runMutation((current) =>
        unarchiveTaskInWorkflow(vaultAdapter, current, taskId),
      ),
    [runMutation, vaultAdapter],
  );

  return {
    tasks,
    loading,
    loadError,
    addTask,
    updateTask,
    deleteTask,
    archiveTask,
    unarchiveTask,
  };
}
