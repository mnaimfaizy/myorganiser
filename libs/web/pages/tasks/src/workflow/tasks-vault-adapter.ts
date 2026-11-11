import {
  deleteVaultRecord,
  type DeletionLog,
  type Task,
} from '@myorganiser/vault-core';
import {
  deleteVaultRecordAndSave,
  saveVaultRecords,
  type VaultHandle,
} from '@myorganiser/web-vault';

export interface TasksVaultAdapter {
  loadTasks(): Promise<Task[] | null>;
  /**
   * Saves `tasks` as the whole list, keeping the stored Deletion Log. Returns
   * the tasks written, which after a contended save include what another
   * writer stored meanwhile (ADR 0143).
   */
  saveTasks(tasks: Task[]): Promise<Task[]>;
  /**
   * Saves `tasks` without `taskId` and records its deletion at `deletedAt`,
   * so a merge with a copy that still holds it does not bring it back
   * (ADR 0054). Returns the tasks written.
   */
  deleteTask(tasks: Task[], taskId: string, deletedAt: string): Promise<Task[]>;
}

export function createProductionTasksVaultAdapter(
  handle: VaultHandle,
): TasksVaultAdapter {
  return {
    async loadTasks() {
      return handle.loadDecryptedData<Task[] | null>({
        type: 'tasks',
        defaultValue: null,
      });
    },
    async saveTasks(tasks) {
      return saveVaultRecords(handle, 'tasks', tasks);
    },
    async deleteTask(tasks, taskId, deletedAt) {
      return deleteVaultRecordAndSave(
        handle,
        'tasks',
        tasks,
        taskId,
        deletedAt,
      );
    },
  };
}

export class InMemoryTasksVaultAdapter implements TasksVaultAdapter {
  private tasks: Task[] | null = null;
  private deletions: DeletionLog = {};

  constructor(initial?: { tasks?: Task[] | null; deletions?: DeletionLog }) {
    if (initial?.tasks !== undefined) {
      this.tasks = initial.tasks;
    }
    if (initial?.deletions !== undefined) {
      this.deletions = initial.deletions;
    }
  }

  async loadTasks(): Promise<Task[] | null> {
    return this.tasks;
  }

  async saveTasks(tasks: Task[]): Promise<Task[]> {
    this.tasks = tasks;
    return tasks;
  }

  async deleteTask(
    tasks: Task[],
    taskId: string,
    deletedAt: string,
  ): Promise<Task[]> {
    const next = deleteVaultRecord(
      { records: tasks, deletions: this.deletions },
      taskId,
      deletedAt,
    );
    this.tasks = next.records as Task[];
    this.deletions = next.deletions;
    return this.tasks;
  }

  getSavedTasks(): Task[] | null {
    return this.tasks;
  }

  getSavedDeletions(): DeletionLog {
    return this.deletions;
  }
}
