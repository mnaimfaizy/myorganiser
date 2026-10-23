import type { Task, TaskPriority } from '@myorganiser/vault-core';

export type TaskWorkflowErrorCode = 'load_failed' | 'save_failed';

export interface TaskWorkflowError {
  code: TaskWorkflowErrorCode;
  message: string;
}

export type TaskWorkflowMutationKind =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'archived'
  | 'unarchived';

export type TaskWorkflowMutationResult =
  | { ok: true; kind: TaskWorkflowMutationKind }
  | { ok: false; error: TaskWorkflowError };

export interface TaskFormInput {
  title: string;
  description?: string;
  priority: TaskPriority;
  status: Task['status'];
  context?: Task['context'];
  dueDate?: string;
  estimatedMinutes?: number;
}

export interface TaskUpdateInput {
  title: string;
  description?: string;
  priority: Task['priority'];
  status: Task['status'];
  context?: Task['context'];
  dueDate?: string;
  estimatedMinutes?: number;
}
