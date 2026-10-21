'use client';

import type { ChangeEvent } from 'react';
import { useCallback, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import type {
  Task,
  TaskContext,
  TaskPriority,
  TaskStatus,
} from '@myorganiser/vault-core';
import { formatEstimate, parseEstimate } from '../workflow/task-grouping';

/** The fields a detail view can write, merged into the full update by the page. */
export type TaskDetailPatch = Partial<
  Pick<
    Task,
    | 'title'
    | 'description'
    | 'status'
    | 'priority'
    | 'context'
    | 'dueDate'
    | 'estimatedMinutes'
  >
>;

export type TaskSaveState = 'idle' | 'saving' | 'saved' | 'error';

/** The context segment value. `none` writes `undefined` to the Task. */
export type TaskContextChoice = TaskContext | 'none';

export interface TaskDetailDraft {
  title: string;
  description: string;
  estimate: string;
  dueDate: string;
  status: TaskStatus;
  priority: TaskPriority;
  context: TaskContextChoice;
}

type DraftKey = keyof TaskDetailDraft;

const DRAFT_KEYS: readonly DraftKey[] = [
  'title',
  'description',
  'estimate',
  'dueDate',
  'status',
  'priority',
  'context',
];

export interface TaskDetailErrors {
  title?: string;
  estimate?: string;
}

export interface TaskDetailDraftHandlers {
  changeStatus: (status: TaskStatus) => void;
  changePriority: (priority: TaskPriority) => void;
  changeContext: (context: TaskContextChoice) => void;
  changeDueDate: (event: ChangeEvent<HTMLInputElement>) => void;
  changeTitle: (event: ChangeEvent<HTMLInputElement>) => void;
  commitTitle: () => void;
  changeEstimate: (event: ChangeEvent<HTMLInputElement>) => void;
  commitEstimate: () => void;
  changeDescription: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  commitDescription: () => void;
}

export interface TaskDetailDraftState extends TaskDetailDraftHandlers {
  draft: TaskDetailDraft;
  errors: TaskDetailErrors;
  saveState: TaskSaveState;
}

export interface UseTaskDetailDraftOptions {
  task: Task;
  onUpdate: (patch: TaskDetailPatch) => Promise<boolean>;
}

export const TITLE_REQUIRED_MESSAGE = 'Give the task a title.';
export const ESTIMATE_INVALID_MESSAGE = 'Enter minutes, for example 30.';

/**
 * The draft schema. Only the two text fields carry rules; the choice fields
 * are typed by their segmented controls, so they accept any value of their type.
 */
const draftSchema = z.object({
  title: z
    .string()
    .refine((title) => title.trim() !== '', TITLE_REQUIRED_MESSAGE),
  description: z.string(),
  estimate: z
    .string()
    .refine(
      (estimate) => parseEstimate(estimate) !== null,
      ESTIMATE_INVALID_MESSAGE,
    ),
  dueDate: z.string(),
  status: z.custom<TaskStatus>(),
  priority: z.custom<TaskPriority>(),
  context: z.custom<TaskContextChoice>(),
});

/** The draft values a Task presents. Estimate is shown as "30 min" or ''. */
function draftFromTask(task: Task): TaskDetailDraft {
  return {
    title: task.title,
    description: task.description ?? '',
    estimate:
      task.estimatedMinutes === undefined
        ? ''
        : formatEstimate(task.estimatedMinutes),
    dueDate: task.dueDate ?? '',
    status: task.status,
    priority: task.priority,
    context: task.context ?? 'none',
  };
}

/**
 * Local drafts for a Task detail view, shared by the desktop panel and the
 * phone screen. Drafts are optimistic: a choice shows at once and is saved
 * through `onUpdate`. Text fields commit on blur, and a failed text save keeps
 * the typed value so it can be retried. A failed choice reverts to the saved
 * value.
 *
 * Drafts follow the `task` prop: a field whose saved value changed is
 * re-read, and every draft resets when the task id changes.
 */
export function useTaskDetailDraft({
  task,
  onUpdate,
}: UseTaskDetailDraftOptions): TaskDetailDraftState {
  const form = useForm<TaskDetailDraft>({
    resolver: zodResolver(draftSchema),
    defaultValues: draftFromTask(task),
  });
  const { control, getValues, setValue, trigger, clearErrors, reset } = form;
  const draft = useWatch({ control }) as TaskDetailDraft;
  const fieldErrors = form.formState.errors;
  const errors: TaskDetailErrors = {
    title: fieldErrors.title?.message,
    estimate: fieldErrors.estimate?.message,
  };

  const [synced, setSynced] = useState<Task>(task);
  const [saveState, setSaveState] = useState<TaskSaveState>('idle');

  // Adjust drafts while rendering when the task prop changes (React's
  // "adjusting state on prop change" pattern), so no stale frame is painted.
  if (synced !== task) {
    setSynced(task);
    const fresh = draftFromTask(task);
    if (task.id !== synced.id) {
      reset(fresh);
      setSaveState('idle');
    } else {
      const previous = draftFromTask(synced);
      const changed = DRAFT_KEYS.filter((key) => fresh[key] !== previous[key]);
      for (const key of changed) {
        setValue(key, fresh[key]);
      }
      if (changed.includes('title')) clearErrors('title');
      if (changed.includes('estimate')) clearErrors('estimate');
    }
  }

  const persist = useCallback(
    async (
      patch: TaskDetailPatch,
      revert?: Partial<TaskDetailDraft>,
    ): Promise<boolean> => {
      setSaveState('saving');
      let saved = false;
      try {
        saved = await onUpdate(patch);
      } catch {
        saved = false;
      }
      setSaveState(saved ? 'saved' : 'error');
      if (!saved && revert) {
        for (const key of Object.keys(revert) as DraftKey[]) {
          setValue(key, revert[key] as TaskDetailDraft[typeof key]);
        }
      }
      return saved;
    },
    [onUpdate, setValue],
  );

  const changeStatus = useCallback(
    (status: TaskStatus) => {
      setValue('status', status);
      if (status !== task.status) {
        void persist({ status }, { status: task.status });
      }
    },
    [persist, setValue, task.status],
  );

  const changePriority = useCallback(
    (priority: TaskPriority) => {
      setValue('priority', priority);
      if (priority !== task.priority) {
        void persist({ priority }, { priority: task.priority });
      }
    },
    [persist, setValue, task.priority],
  );

  const changeContext = useCallback(
    (context: TaskContextChoice) => {
      setValue('context', context);
      const saved = task.context ?? 'none';
      if (context !== saved) {
        void persist(
          { context: context === 'none' ? undefined : context },
          { context: saved },
        );
      }
    },
    [persist, setValue, task.context],
  );

  const changeDueDate = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const { value: dueDate, validity } = event.currentTarget;
      // Chrome reports a half-typed date as an empty value with badInput set.
      // That is not an intentional clear, so it is ignored.
      if (dueDate === '' && validity.badInput) return;
      setValue('dueDate', dueDate);
      const saved = task.dueDate ?? '';
      if (dueDate !== saved) {
        void persist(
          { dueDate: dueDate === '' ? undefined : dueDate },
          { dueDate: saved },
        );
      }
    },
    [persist, setValue, task.dueDate],
  );

  const changeTitle = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setValue('title', event.target.value);
      clearErrors('title');
    },
    [clearErrors, setValue],
  );

  const commitTitle = useCallback(async () => {
    if (!(await trigger('title'))) {
      // Blank: the saved title comes back and the error stays visible.
      setValue('title', task.title);
      return;
    }
    const title = getValues('title').trim();
    setValue('title', title);
    if (title !== task.title) {
      void persist({ title });
    }
  }, [getValues, persist, setValue, task.title, trigger]);

  const changeEstimate = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setValue('estimate', event.target.value);
      clearErrors('estimate');
    },
    [clearErrors, setValue],
  );

  const commitEstimate = useCallback(async () => {
    const valid = await trigger('estimate');
    const minutes = parseEstimate(getValues('estimate'));
    if (!valid || minutes === null) return;
    if (minutes === task.estimatedMinutes) {
      setValue(
        'estimate',
        minutes === undefined ? '' : formatEstimate(minutes),
      );
      return;
    }
    void persist({ estimatedMinutes: minutes });
  }, [getValues, persist, setValue, task.estimatedMinutes, trigger]);

  const changeDescription = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setValue('description', event.target.value);
    },
    [setValue],
  );

  const commitDescription = useCallback(() => {
    const description = getValues('description');
    if (description === (task.description ?? '')) return;
    void persist({ description: description === '' ? undefined : description });
  }, [getValues, persist, task.description]);

  return {
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
  };
}
