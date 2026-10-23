'use client';

import type { Task } from '@myorganiser/vault-core';
import {
  IconButton,
  Input,
  SegmentedControl,
  Textarea,
} from '@myorganiser/web-ui';
import { X } from 'lucide-react';
import { useId } from 'react';
import {
  ESTIMATE_INVALID_MESSAGE,
  TITLE_REQUIRED_MESSAGE,
  useTaskDetailDraft,
} from '../hooks/use-task-detail-draft';
import {
  TASK_CONTEXT_OPTIONS,
  TASK_PRIORITY_OPTIONS,
} from '../utils/task-detail-copy';
import type { TaskDetailPatch } from '../hooks/use-task-detail-draft';
import { blurOnEnter } from '../utils/blur-on-enter';
import { TaskDetailFooter } from './task-detail-footer';
import { TaskDetailStatusChips } from './task-detail-status-chips';
import { TaskSaveIndicator } from './task-save-indicator';

export interface TaskDetailPanelProps {
  task: Task;
  /** Merges the patch into the full update and saves. Resolves false on failure. */
  onUpdate: (patch: TaskDetailPatch) => Promise<boolean>;
  onClose: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}

/** The desktop Task detail: a card beside the list, edits flow out through `onUpdate`. */
export function TaskDetailPanel({
  task,
  onUpdate,
  onClose,
  onArchive,
  onUnarchive,
  onDelete,
}: TaskDetailPanelProps) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const titleErrorId = `${ids}-title-error`;
  const dueId = `${ids}-due`;
  const estimateId = `${ids}-estimate`;
  const estimateErrorId = `${ids}-estimate-error`;
  const descriptionId = `${ids}-description`;
  const priorityName = `${ids}-priority`;
  const contextName = `${ids}-context`;

  const {
    draft,
    errors,
    saveState,
    changeStatus,
    changePriority,
    changeContext,
    changeDueDate,
    changeTitle,
    commitTitle,
    changeEstimate,
    commitEstimate,
    changeDescription,
    commitDescription,
  } = useTaskDetailDraft({ task, onUpdate });

  return (
    <aside
      aria-label="Task detail"
      className="flex grow shrink basis-85 flex-col gap-4 rounded-panel border border-border bg-raised-surface p-5 shadow-card"
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label
            htmlFor={titleId}
            className="text-label-caps uppercase text-muted-foreground"
          >
            Task
          </label>
          <Input
            id={titleId}
            value={draft.title}
            onChange={changeTitle}
            onBlur={commitTitle}
            onKeyDown={blurOnEnter}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={errors.title ? titleErrorId : undefined}
            className="h-11 font-semibold text-body md:text-body"
          />
          {errors.title ? (
            <p id={titleErrorId} className="text-body-sm text-destructive-text">
              {TITLE_REQUIRED_MESSAGE}
            </p>
          ) : null}
        </div>
        <IconButton
          variant="ghost"
          label="Close detail"
          icon={<X aria-hidden="true" className="size-3.5" />}
          onClick={onClose}
          className="mt-5"
        />
      </div>

      <TaskDetailStatusChips
        value={draft.status}
        onValueChange={changeStatus}
      />

      <div className="grid grid-cols-2 gap-3">
        <SegmentedControl
          name={priorityName}
          legend="Priority"
          value={draft.priority}
          onValueChange={changePriority}
          options={TASK_PRIORITY_OPTIONS.desktop}
        />
        <SegmentedControl
          name={contextName}
          legend="Context"
          value={draft.context}
          onValueChange={changeContext}
          options={TASK_CONTEXT_OPTIONS.desktop}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={dueId}
            className="text-body-sm font-semibold text-foreground"
          >
            Due date
          </label>
          <Input
            id={dueId}
            type="date"
            value={draft.dueDate}
            onChange={changeDueDate}
            className="h-11 text-body md:text-body"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={estimateId}
            className="text-body-sm font-semibold text-foreground"
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
            className="h-11 text-body md:text-body"
          />
          {errors.estimate ? (
            <p
              id={estimateErrorId}
              className="text-body-sm text-destructive-text"
            >
              {ESTIMATE_INVALID_MESSAGE}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={descriptionId}
          className="text-body-sm font-semibold text-foreground"
        >
          Description
        </label>
        <Textarea
          id={descriptionId}
          rows={3}
          value={draft.description}
          onChange={changeDescription}
          onBlur={commitDescription}
          className="text-body md:text-body"
        />
      </div>

      <TaskSaveIndicator
        saveState={saveState}
        createdAt={task.createdAt}
        variant="desktop"
      />

      <TaskDetailFooter
        variant="desktop"
        archived={task.archived}
        onArchive={onArchive}
        onUnarchive={onUnarchive}
        onDelete={onDelete}
      />
    </aside>
  );
}
