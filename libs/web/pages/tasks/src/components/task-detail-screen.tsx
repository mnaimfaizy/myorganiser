'use client';

import type { Task, TaskStatus } from '@myorganiser/vault-core';
import { Input, SegmentedControl, Textarea } from '@myorganiser/web-ui';
import { ChevronRight } from 'lucide-react';
import { useCallback, useId } from 'react';
import type { ChangeEvent } from 'react';
import {
  ESTIMATE_INVALID_MESSAGE,
  useTaskDetailDraft,
} from '../hooks/use-task-detail-draft';
import {
  TASK_CONTEXT_OPTIONS,
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
  formatDueDetail,
} from '../utils/task-detail-copy';
import type { TaskDetailPatch } from '../hooks/use-task-detail-draft';
import { blurOnEnter } from '../utils/blur-on-enter';
import { TaskDetailFooter } from './task-detail-footer';
import { TaskDetailTitleBlock } from './task-detail-title-block';
import { TaskSaveIndicator } from './task-save-indicator';

export interface TaskDetailScreenProps {
  task: Task;
  /** The local calendar date as `YYYY-MM-DD`, used for the due labels. */
  today: string;
  /** Merges the patch into the full update and saves. Resolves false on failure. */
  onUpdate: (patch: TaskDetailPatch) => Promise<boolean>;
  onMarkDone: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}

/**
 * The phone Task detail, pushed over the Tasks list. The shell draws the back
 * bar and the sync state; this screen draws the title block, the grouped
 * settings card, the description and the footer actions.
 */
export function TaskDetailScreen({
  task,
  today,
  onUpdate,
  onMarkDone,
  onArchive,
  onUnarchive,
  onDelete,
}: TaskDetailScreenProps) {
  const ids = useId();
  const estimateId = `${ids}-estimate`;
  const estimateErrorId = `${ids}-estimate-error`;
  const descriptionId = `${ids}-description`;
  const priorityName = `${ids}-priority`;
  const contextName = `${ids}-context`;

  const {
    draft,
    errors,
    saveState,
    changePriority,
    changeContext,
    changeDueDate,
    changeStatus,
    changeEstimate,
    commitEstimate,
    changeDescription,
    commitDescription,
  } = useTaskDetailDraft({ task, onUpdate });

  const handleStatusSelect = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      changeStatus(event.target.value as TaskStatus);
    },
    [changeStatus],
  );

  const statusLabel =
    TASK_STATUS_OPTIONS.find((option) => option.value === draft.status)
      ?.label ?? draft.status;

  return (
    <div className="flex min-h-full flex-1 flex-col gap-4 pt-1 pb-[calc(1rem_+_env(safe-area-inset-bottom))]">
      <TaskDetailTitleBlock task={task} today={today} onMarkDone={onMarkDone} />

      <div className="mx-4 flex flex-col overflow-hidden rounded-xl border border-border bg-raised-surface">
        <div className="relative flex min-h-14 items-center gap-3 border-b border-subtle pr-3.5 pl-4">
          <span className="flex-1 text-body text-foreground">Status</span>
          <span className="text-body-sm text-muted-foreground">
            {statusLabel}
          </span>
          <ChevronRight
            aria-hidden="true"
            className="size-3.5 text-muted-foreground"
          />
          <select
            aria-label="Status"
            value={draft.status}
            onChange={handleStatusSelect}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          >
            {TASK_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="border-b border-subtle px-4 py-3">
          <SegmentedControl
            name={priorityName}
            legend="Priority"
            value={draft.priority}
            onValueChange={changePriority}
            options={TASK_PRIORITY_OPTIONS.phone}
          />
        </div>

        <div className="border-b border-subtle px-4 py-3">
          <SegmentedControl
            name={contextName}
            legend="Context"
            value={draft.context}
            onValueChange={changeContext}
            options={TASK_CONTEXT_OPTIONS.phone}
          />
        </div>

        <div className="relative flex min-h-14 items-center gap-3 border-b border-subtle pr-3.5 pl-4">
          <span className="flex-1 text-body text-foreground">Due date</span>
          <span className="text-body-sm text-muted-foreground">
            {formatDueDetail(draft.dueDate || undefined, today)}
          </span>
          <ChevronRight
            aria-hidden="true"
            className="size-3.5 text-muted-foreground"
          />
          <input
            type="date"
            aria-label="Due date"
            value={draft.dueDate}
            onChange={changeDueDate}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>

        <div className="flex flex-col">
          <div className="flex min-h-14 items-center gap-3 pr-3.5 pl-4">
            <label
              htmlFor={estimateId}
              className="flex-1 text-body text-foreground"
            >
              Estimate
            </label>
            <Input
              id={estimateId}
              value={draft.estimate}
              placeholder="e.g. 30 min"
              onChange={changeEstimate}
              onBlur={commitEstimate}
              onKeyDown={blurOnEnter}
              aria-invalid={errors.estimate ? true : undefined}
              aria-describedby={errors.estimate ? estimateErrorId : undefined}
              className="h-11 w-36 border-transparent bg-transparent px-2 text-right text-body text-foreground-secondary md:text-body"
            />
          </div>
          {errors.estimate ? (
            <p
              id={estimateErrorId}
              className="px-4 pb-3 text-body-sm text-destructive-text"
            >
              {ESTIMATE_INVALID_MESSAGE}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mx-4 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor={descriptionId}
            className="text-label-caps uppercase text-muted-foreground"
          >
            Description
          </label>
          <TaskSaveIndicator
            saveState={saveState}
            createdAt={task.createdAt}
            variant="phone"
          />
        </div>
        <Textarea
          id={descriptionId}
          rows={3}
          value={draft.description}
          onChange={changeDescription}
          onBlur={commitDescription}
          className="resize-none text-body md:text-body"
        />
      </div>

      <TaskDetailFooter
        variant="phone"
        archived={task.archived}
        onArchive={onArchive}
        onUnarchive={onUnarchive}
        onDelete={onDelete}
      />
    </div>
  );
}
