'use client';

import * as React from 'react';
import { useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from '@myorganiser/web-ui';
import { ChoiceChip } from './choice-chip';

const quickAddSchema = z.object({
  title: z.string().trim().min(1),
  dueToday: z.boolean(),
  high: z.boolean(),
});

type QuickAddValues = z.infer<typeof quickAddSchema>;

export interface TaskQuickAddInput {
  title: string;
  dueToday: boolean;
  high: boolean;
}

interface TaskQuickAddProps {
  /** Resolves true when the task was saved; the bar then clears. */
  onQuickAdd: (input: TaskQuickAddInput) => Promise<boolean>;
}

const EMPTY_VALUES: QuickAddValues = {
  title: '',
  dueToday: false,
  high: false,
};

/**
 * The desktop quick-capture bar. Enter with a non-blank title saves through
 * `onQuickAdd`; a blank title submits nothing. The form is React Hook Form
 * with a Zod resolver, as GUIDELINES §5.2 requires for every form.
 */
const TaskQuickAdd = ({ onQuickAdd }: TaskQuickAddProps) => {
  const form = useForm<QuickAddValues>({
    resolver: zodResolver(quickAddSchema),
    defaultValues: EMPTY_VALUES,
  });
  const { isSubmitting } = form.formState;

  const handleValid = useCallback(
    async (values: QuickAddValues) => {
      const saved = await onQuickAdd({
        title: values.title,
        dueToday: values.dueToday,
        high: values.high,
      });
      if (saved) {
        form.reset(EMPTY_VALUES);
      }
    },
    [form, onQuickAdd],
  );

  const handleFormSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      if (form.getValues('title').trim() === '') {
        event.preventDefault();
        return;
      }
      void form.handleSubmit(handleValid)(event);
    },
    [form, handleValid],
  );

  return (
    <Form {...form}>
      <form
        onSubmit={handleFormSubmit}
        className="flex h-13 items-center gap-2.5 rounded-menu border border-border bg-raised-surface pr-2 pl-3.5"
      >
        <Plus aria-hidden="true" className="size-icon shrink-0 text-brand" />
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem className="flex min-w-0 flex-1 space-y-0">
              <FormLabel className="sr-only">Quick add a task</FormLabel>
              <FormControl>
                <input
                  {...field}
                  type="text"
                  autoComplete="off"
                  disabled={isSubmitting}
                  placeholder="Quick add — type a task and press Enter"
                  className="min-w-0 flex-1 bg-transparent text-body text-foreground placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed"
                />
              </FormControl>
            </FormItem>
          )}
        />
        <div className="flex shrink-0 gap-1.5">
          <FormField
            control={form.control}
            name="dueToday"
            render={({ field }) => (
              <ChoiceChip
                pressed={field.value}
                onPressedChange={field.onChange}
                disabled={isSubmitting}
              >
                Today
              </ChoiceChip>
            )}
          />
          <FormField
            control={form.control}
            name="high"
            render={({ field }) => (
              <ChoiceChip
                pressed={field.value}
                onPressedChange={field.onChange}
                disabled={isSubmitting}
              >
                High
              </ChoiceChip>
            )}
          />
        </div>
      </form>
    </Form>
  );
};

export { TaskQuickAdd };
export type { TaskQuickAddProps };
