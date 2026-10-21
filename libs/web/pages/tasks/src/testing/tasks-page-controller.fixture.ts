import type { Task } from '@myorganiser/vault-core';
// Imported explicitly: this file is type-checked by the lib tsconfig too,
// which carries no jest globals.
import { jest } from '@jest/globals';
import type { TasksPageController } from '../hooks/use-tasks-page';

/**
 * A complete `TasksPageController` for component tests. Every action is a
 * `jest.fn` that resolves its success value, so a test overrides only the
 * action it asserts on, with `mockResolvedValue(false)` for example.
 */
export function makeTasksPageController(
  tasks: Task[] = [],
  loading = false,
): TasksPageController {
  return {
    tasks,
    loading,
    busy: false,
    addTask: jest.fn(async () => undefined),
    quickAdd: jest.fn(async () => true),
    capture: jest.fn(async () => true),
    toggleDone: jest.fn(async () => true),
    updateFields: jest.fn(async () => true),
    archive: jest.fn(async () => true),
    unarchive: jest.fn(async () => true),
    deleteTask: jest.fn(async () => true),
  };
}
