'use client';

import { useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  SegmentedControl,
  type SegmentedControlOption,
  Textarea,
} from '@myorganiser/web-ui';
import type { TaskPriority } from '@myorganiser/vault-core';
import type { TaskFormInput } from '../workflow';
import { parseEstimate } from '../workflow/task-grouping';
import { TaskFormFields } from './task-form-fields';

export interface TaskFormProps {
  /** Receives the mapped payload. A rejection keeps the values for retry. */
  onSubmit: (values: TaskFormInput) => void | Promise<void>;
  onCancel: () => void;
  /** Blocks the submit and cancel controls while a save is in flight. */
  submitting?: boolean;
}

const taskFormSchema = z.object({
  title: z.string().trim().min(1, 'Give the task a title.'),
  description: z.string().optional(),
  priority: z.enum(['high', 'medium', 'low']),
  context: z.enum(['none', 'personal', 'work']),
  status: z.enum(['pending', 'in_progress', 'blocked', 'done', 'cancelled']),
  dueDate: z.string().optional(),
  estimate: z
    .string()
    .optional()
    .refine((value) => value === undefined || parseEstimate(value) !== null, {
      message: 'Enter minutes, for example 30.',
    }),
});

export type TaskFormValues = z.infer<typeof taskFormSchema>;

const EMPTY_VALUES: TaskFormValues = {
  title: '',
  description: '',
  priority: 'medium',
  context: 'none',
  status: 'pending',
  dueDate: '',
  estimate: '',
};

const PRIORITY_OPTIONS: readonly SegmentedControlOption<TaskPriority>[] = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const CONTEXT_OPTIONS: readonly SegmentedControlOption<
  TaskFormValues['context']
>[] = [
  { value: 'none', label: 'None' },
  { value: 'personal', label: 'Personal' },
  { value: 'work', label: 'Work' },
];

/**
 * The add and detail form for a task. It owns field state and validation;
 * the caller owns persistence and the submitting flag.
 */
export function TaskForm({
  onSubmit,
  onCancel,
  submitting = false,
}: TaskFormProps) {
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  const handleSubmit = useCallback(
    async (values: TaskFormValues) => {
      const payload: TaskFormInput = {
        title: values.title,
        description: values.description || undefined,
        priority: values.priority,
        status: values.status,
        context: values.context === 'none' ? undefined : values.context,
        dueDate: values.dueDate || undefined,
        estimatedMinutes: parseEstimate(values.estimate ?? '') ?? undefined,
      };
      try {
        await onSubmit(payload);
        form.reset(EMPTY_VALUES);
      } catch {
        // The caller reports the failure and stays open; keep the values for retry.
      }
    },
    [onSubmit, form],
  );

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="flex flex-col"
      >
        <div className="flex flex-col gap-4 px-6 py-5">
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title</FormLabel>
                <FormControl>
                  <Input placeholder="What needs doing?" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Description{' '}
                  <span className="font-normal text-muted-foreground">
                    · optional
                  </span>
                </FormLabel>
                <FormControl>
                  <Textarea
                    rows={3}
                    placeholder="Details, links, who to ask"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="priority"
              render={({ field }) => (
                <SegmentedControl
                  name="task-priority"
                  legend="Priority"
                  options={PRIORITY_OPTIONS}
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={submitting}
                />
              )}
            />
            <FormField
              control={form.control}
              name="context"
              render={({ field }) => (
                <SegmentedControl
                  name="task-context"
                  legend="Context"
                  options={CONTEXT_OPTIONS}
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={submitting}
                />
              )}
            />
          </div>

          <TaskFormFields control={form.control} />
        </div>

        <div className="flex items-center gap-2.5 border-t border-border px-6 pt-4 pb-6">
          <p className="grow text-caption text-muted-foreground">
            Tip: the quick-add bar is faster for one-liners.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" loading={submitting} disabled={submitting}>
            Add task
          </Button>
        </div>
      </form>
    </Form>
  );
}
