'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import type { Task, TaskPriority, TaskStatus } from '@myorganiser/vault-core';
import {
  Checkbox,
  cn,
  StatusPill,
  type StatusPillTone,
} from '@myorganiser/web-ui';
import {
  CONTEXT_LABELS,
  formatDueLabel,
  taskMetaLine,
  type TaskDueGroup,
} from '../workflow/task-grouping';

export type TaskRowGroup = TaskDueGroup | 'closed' | 'archived';

interface TaskRowProps {
  task: Task;
  /** Today as `YYYY-MM-DD`, the same value the page groups by. */
  today: string;
  group: TaskRowGroup;
  variant: 'desktop' | 'phone';
  selected?: boolean;
  onToggleDone: (task: Task, done: boolean) => void;
  onSelect?: (task: Task) => void;
  /** Phone only: the detail route the row links to. Without it the row selects instead. */
  detailHref?: string;
}

interface PillSpec {
  label: string;
  tone: StatusPillTone;
  className?: string;
}

const PRIORITY_PILL = {
  high: { label: 'High', tone: 'danger', className: '' },
  medium: { label: 'Med', tone: 'neutral', className: '' },
  low: {
    label: 'Low',
    tone: 'neutral',
    className:
      'bg-transparent text-muted-foreground ring-1 ring-inset ring-border',
  },
} as const satisfies Record<TaskPriority, PillSpec>;

// Only the two states worth a word on the row. Pending and done have none.
const STATUS_PILL: Partial<Record<TaskStatus, PillSpec>> = {
  in_progress: { label: 'In progress', tone: 'brand', className: '' },
  blocked: { label: 'Blocked', tone: 'warning', className: '' },
};

const DUE_TONE = {
  overdue: 'font-semibold text-destructive-text',
  today: 'font-semibold text-warning-text',
  upcoming: 'text-muted-foreground',
  no_date: 'text-muted-foreground',
  closed: 'text-muted-foreground',
  archived: 'text-muted-foreground',
} as const satisfies Record<TaskRowGroup, string>;

/**
 * One Task as a row. Desktop is a dense table line: title and description,
 * then status, priority, context, and due. Phone is a 64px tappable line: the
 * checkbox, then a link to the detail route with the title, meta, and one pill.
 */
const TaskRow = ({
  task,
  today,
  group,
  variant,
  selected = false,
  onToggleDone,
  onSelect,
  detailHref,
}: TaskRowProps) => {
  const isDone = task.status === 'done' || task.status === 'cancelled';
  const statusPill = STATUS_PILL[task.status];
  const priorityPill = PRIORITY_PILL[task.priority];
  const contextLabel = task.context ? CONTEXT_LABELS[task.context] : '';
  const dueLabel = formatDueLabel(task.dueDate, today);
  const isArchived = group === 'archived';

  const handleCheckedChange = useCallback(
    (checked: boolean | 'indeterminate') => {
      onToggleDone(task, checked === true);
    },
    [onToggleDone, task],
  );

  const handleSelect = useCallback(() => {
    onSelect?.(task);
  }, [onSelect, task]);

  const checkbox = (
    <Checkbox
      aria-label={`Done: ${task.title}`}
      checked={isDone}
      onCheckedChange={handleCheckedChange}
    />
  );

  if (variant === 'phone') {
    const meta = taskMetaLine(task, today);
    const pill: PillSpec | undefined =
      statusPill ?? (task.priority === 'high' ? PRIORITY_PILL.high : undefined);

    const body = (
      <>
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              'truncate text-body',
              isArchived ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {task.title}
          </span>
          {meta ? (
            <span className="truncate text-caption text-muted-foreground">
              {meta}
            </span>
          ) : null}
        </span>
        {pill ? (
          <StatusPill
            tone={pill.tone}
            className={cn('shrink-0', pill.className)}
          >
            {pill.label}
          </StatusPill>
        ) : null}
      </>
    );

    const linkClasses =
      'flex min-h-16 min-w-0 flex-1 items-center gap-2 text-left text-foreground no-underline';
    const ariaCurrent = selected ? 'true' : undefined;

    return (
      <div
        className={cn(
          'flex min-h-16 items-center gap-1 border-b border-border-subtle pr-2 pl-1.5 last:border-b-0',
          selected && 'bg-brand-soft ring-2 ring-inset ring-brand',
        )}
      >
        <span className="flex size-11 shrink-0 items-center justify-center">
          {checkbox}
        </span>
        {detailHref ? (
          <Link
            href={detailHref}
            aria-current={ariaCurrent}
            className={linkClasses}
          >
            {body}
          </Link>
        ) : (
          <button
            type="button"
            onClick={handleSelect}
            aria-current={ariaCurrent}
            className={linkClasses}
          >
            {body}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex min-h-16 items-center gap-3 border-b border-border-subtle px-4 last:border-b-0',
        selected && 'bg-brand-soft ring-2 ring-inset ring-brand',
      )}
    >
      {checkbox}
      <div className="flex min-w-0 flex-1 flex-col">
        <button
          type="button"
          onClick={handleSelect}
          aria-current={selected ? 'true' : undefined}
          className={cn(
            'w-full text-left text-body',
            isArchived ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {task.title}
        </button>
        {task.description ? (
          <span className="truncate text-caption text-muted-foreground">
            {task.description}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {statusPill ? (
          <StatusPill tone={statusPill.tone} size="sm">
            {statusPill.label}
          </StatusPill>
        ) : null}
        <StatusPill
          tone={priorityPill.tone}
          size="sm"
          className={priorityPill.className}
        >
          {priorityPill.label}
        </StatusPill>
        <span className="w-16 shrink-0 text-caption text-muted-foreground">
          {contextLabel}
        </span>
        <span
          className={cn(
            'w-21 shrink-0 text-right text-caption',
            DUE_TONE[group],
          )}
        >
          {dueLabel}
        </span>
      </div>
    </div>
  );
};

export { TaskRow };
export type { TaskRowProps };
