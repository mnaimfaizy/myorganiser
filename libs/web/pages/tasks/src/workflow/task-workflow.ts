import type { Task } from '@myorganiser/vault-core';
import { transitionTaskStatus } from '@myorganiser/vault-core';
import { randomId } from '@myorganiser/core';
import { normalizeTasks } from '@myorganiser/web-vault';

import { sortTasks } from './task-sorting';
import type {
  TaskFormInput,
  TaskUpdateInput,
  TaskWorkflowError,
  TaskWorkflowMutationResult,
} from './task-workflow-types';
import type { TasksVaultAdapter } from './tasks-vault-adapter';

function saveFailedError(message: string): TaskWorkflowError {
  return { code: 'save_failed', message };
}

function loadFailedError(): TaskWorkflowError {
  return {
    code: 'load_failed',
    message: 'Could not decrypt saved data.',
  };
}

export interface LoadTasksOptions {
  /**
   * Answers whether this load is still the one its caller wants. It is asked
   * once the read has resolved, because a load superseded by then must not
   * write its normalisation back over whatever replaced it (#1277).
   */
  isCurrent?: () => boolean;
}

/**
 * What one load produced. The superseded variant carries no tasks at all, so
 * a caller cannot read an empty list off a load it was supposed to discard
 * and save that list back over a populated Vault (#1277).
 */
export type TasksLoadOutcome =
  /** `isCurrent` turned false while the read was in flight: nothing was written back. */
  | { superseded: true }
  | { superseded: false; tasks: Task[]; loadError: TaskWorkflowError | null };

export async function loadTasksFromVault(
  adapter: TasksVaultAdapter,
  { isCurrent = () => true }: LoadTasksOptions = {},
): Promise<TasksLoadOutcome> {
  try {
    const raw = await adapter.loadTasks();

    if (!isCurrent()) {
      return { superseded: true };
    }

    if (raw === null) {
      return { superseded: false, tasks: [], loadError: null };
    }

    const normalized = normalizeTasks(raw);
    if (normalized.changed) {
      await adapter.saveTasks(normalized.value);
    }
    return {
      superseded: false,
      tasks: sortTasks(normalized.value),
      loadError: null,
    };
  } catch {
    return { superseded: false, tasks: [], loadError: loadFailedError() };
  }
}

async function persistTasks(
  adapter: TasksVaultAdapter,
  next: Task[],
): Promise<{ tasks: Task[]; error: TaskWorkflowError | null }> {
  const sorted = sortTasks(next);
  try {
    await adapter.saveTasks(sorted);
    return { tasks: sorted, error: null };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { tasks: sorted, error: saveFailedError(message) };
  }
}

export async function addTaskToWorkflow(
  adapter: TasksVaultAdapter,
  tasks: Task[],
  formData: TaskFormInput,
): Promise<{ tasks: Task[]; result: TaskWorkflowMutationResult }> {
  const now = new Date().toISOString();
  // A new Task starts open and moves to the form's status through
  // `transitionTaskStatus`, so one created already `done` or `cancelled`
  // gets its `closedAt` from the same place every other status change does.
  const newTask = transitionTaskStatus(
    {
      id: randomId(),
      title: formData.title,
      description: formData.description,
      priority: formData.priority,
      status: 'pending',
      context: formData.context,
      dueDate: formData.dueDate,
      estimatedMinutes: formData.estimatedMinutes,
      archived: false,
      createdAt: now,
    },
    formData.status,
    now,
  );

  const persisted = await persistTasks(adapter, [newTask, ...tasks]);
  if (persisted.error) {
    return {
      tasks: persisted.tasks,
      result: { ok: false, error: persisted.error },
    };
  }
  return { tasks: persisted.tasks, result: { ok: true, kind: 'created' } };
}

export async function updateTaskInWorkflow(
  adapter: TasksVaultAdapter,
  tasks: Task[],
  taskId: string,
  values: TaskUpdateInput,
): Promise<{ tasks: Task[]; result: TaskWorkflowMutationResult }> {
  const now = new Date().toISOString();
  // `transitionTaskStatus` reads `status` as the *previous* status, so the
  // other fields from `values` are applied first and the task's own status
  // is carried over until the transition itself decides `closedAt`
  // (CONTEXT.md) — the same shared function mobile's status changes use.
  const next = tasks.map((t) =>
    t.id === taskId
      ? transitionTaskStatus(
          { ...t, ...values, status: t.status },
          values.status,
          now,
        )
      : t,
  );

  const persisted = await persistTasks(adapter, next);
  if (persisted.error) {
    return {
      tasks: persisted.tasks,
      result: { ok: false, error: persisted.error },
    };
  }
  return { tasks: persisted.tasks, result: { ok: true, kind: 'updated' } };
}

export async function deleteTaskFromWorkflow(
  adapter: TasksVaultAdapter,
  tasks: Task[],
  taskId: string,
): Promise<{ tasks: Task[]; result: TaskWorkflowMutationResult }> {
  // Filtering the Task out is not a deletion: a merge unions by id, so the
  // Task would come straight back from any copy that still holds it. The
  // adapter writes the deletion into the Deletion Log (ADR 0054).
  try {
    const remaining = await adapter.deleteTask(
      tasks,
      taskId,
      new Date().toISOString(),
    );
    return {
      tasks: sortTasks(remaining),
      result: { ok: true, kind: 'deleted' },
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      tasks: sortTasks(tasks.filter((t) => t.id !== taskId)),
      result: { ok: false, error: saveFailedError(message) },
    };
  }
}

export async function archiveTaskInWorkflow(
  adapter: TasksVaultAdapter,
  tasks: Task[],
  taskId: string,
): Promise<{ tasks: Task[]; result: TaskWorkflowMutationResult }> {
  const next = tasks.map((t) =>
    t.id === taskId
      ? { ...t, archived: true, updatedAt: new Date().toISOString() }
      : t,
  );

  const persisted = await persistTasks(adapter, next);
  if (persisted.error) {
    return {
      tasks: persisted.tasks,
      result: { ok: false, error: persisted.error },
    };
  }
  return { tasks: persisted.tasks, result: { ok: true, kind: 'archived' } };
}

export async function unarchiveTaskInWorkflow(
  adapter: TasksVaultAdapter,
  tasks: Task[],
  taskId: string,
): Promise<{ tasks: Task[]; result: TaskWorkflowMutationResult }> {
  const next = tasks.map((t) =>
    t.id === taskId
      ? { ...t, archived: false, updatedAt: new Date().toISOString() }
      : t,
  );

  const persisted = await persistTasks(adapter, next);
  if (persisted.error) {
    return {
      tasks: persisted.tasks,
      result: { ok: false, error: persisted.error },
    };
  }
  return { tasks: persisted.tasks, result: { ok: true, kind: 'unarchived' } };
}
