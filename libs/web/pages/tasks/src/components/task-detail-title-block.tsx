'use client';

import type { Task } from '@myorganiser/vault-core';
import { Button, StatusPill } from '@myorganiser/web-ui';
import { Check } from 'lucide-react';
import { formatCreatedDate } from '../utils/task-detail-copy';
import { dueGroupOf, isOpenTask } from '../workflow/task-grouping';

export interface TaskDetailTitleBlockProps {
  task: Task;
  /** The local calendar date as `YYYY-MM-DD`, used for the due pill. */
  today: string;
  onMarkDone: () => void;
}

/**
 * The phone Task detail heading: the saved title, the due pill (open Tasks
 * only), the created date, and the Mark done action while the Task is open.
 */
export function TaskDetailTitleBlock({
  task,
  today,
  onMarkDone,
}: TaskDetailTitleBlockProps) {
  const isOpen = isOpenTask(task);
  const dueGroup = dueGroupOf(task, today);
  const createdLabel = formatCreatedDate(task.createdAt);

  return (
    <div className="flex flex-col gap-1.5 border-b border-border bg-raised-surface px-4 pb-4">
      <h1 className="font-display text-title-lg text-foreground">
        {task.title}
      </h1>
      <div className="flex flex-wrap items-center gap-1.5">
        {isOpen && dueGroup === 'overdue' ? (
          <StatusPill tone="danger">Overdue</StatusPill>
        ) : null}
        {isOpen && dueGroup === 'today' ? (
          <StatusPill tone="warning">Due today</StatusPill>
        ) : null}
        {createdLabel ? (
          <span className="text-caption text-muted-foreground">
            Created {createdLabel}
          </span>
        ) : null}
      </div>
      {isOpen ? (
        <Button className="mt-2 w-full" onClick={onMarkDone}>
          <Check aria-hidden="true" />
          Mark done
        </Button>
      ) : null}
    </div>
  );
}
