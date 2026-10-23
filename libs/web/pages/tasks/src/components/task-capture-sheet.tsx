'use client';

import { ArrowUp } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useRef, type ChangeEvent, type FormEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetTitle,
  ChoiceChip,
  Form,
  FormField,
  IconButton,
  Input,
} from '@myorganiser/web-ui';
import { formatDueLabel } from '../workflow/task-grouping';

/** What a capture sends to `onCapture`: the trimmed title and the chosen flags. */
export interface TaskCaptureInput {
  title: string;
  dueDate?: string;
  high: boolean;
  personal: boolean;
}

export interface TaskCaptureSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The local calendar day as YYYY-MM-DD, used for "Today" and due labels. */
  today: string;
  /** Resolves true when the task is saved; false keeps the title for retry. */
  onCapture: (input: TaskCaptureInput) => Promise<boolean>;
}

/** At most one due choice: "Today", a picked date, or none. */
const dueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('today') }),
  z.object({ kind: z.literal('picked'), date: z.string() }),
]);

type CaptureDue = z.infer<typeof dueSchema>;

const captureSchema = z.object({
  title: z.string().trim().min(1),
  due: dueSchema,
  high: z.boolean(),
  personal: z.boolean(),
});

type CaptureFormValues = z.infer<typeof captureSchema>;

const NO_DUE: CaptureDue = { kind: 'none' };

const EMPTY_VALUES: CaptureFormValues = {
  title: '',
  due: NO_DUE,
  high: false,
  personal: false,
};

function dueDateOf(due: CaptureDue, today: string): string | undefined {
  if (due.kind === 'today') {
    return today;
  }
  return due.kind === 'picked' ? due.date : undefined;
}

/**
 * The phone quick capture. A sheet docked to the bottom: one line of input,
 * the due and priority chips, and Return or the Save button to capture. The
 * chips reset after each save so the next task starts clean. The form is React
 * Hook Form with a Zod resolver (GUIDELINES §5.2); a blank title submits
 * nothing and shows no error.
 */
export function TaskCaptureSheet({
  open,
  onOpenChange,
  today,
  onCapture,
}: TaskCaptureSheetProps) {
  const form = useForm<CaptureFormValues>({
    resolver: zodResolver(captureSchema),
    defaultValues: EMPTY_VALUES,
    shouldFocusError: false,
  });
  const { isSubmitting } = form.formState;
  const due = useWatch({ control: form.control, name: 'due' });
  const dateInputRef = useRef<HTMLInputElement>(null);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!isSubmitting) {
        onOpenChange(next);
      }
    },
    [isSubmitting, onOpenChange],
  );

  const handleTodayChange = useCallback(
    (next: boolean) => {
      form.setValue('due', next ? { kind: 'today' } : NO_DUE);
    },
    [form],
  );

  const handlePickedChange = useCallback(
    (next: boolean) => {
      if (!next) {
        form.setValue('due', NO_DUE);
      }
    },
    [form],
  );

  // The Pick date chip is never pressed; a press opens the native picker.
  const handlePickDateRequest = useCallback(() => {
    const input = dateInputRef.current;
    if (!input) {
      return;
    }
    if (typeof input.showPicker === 'function') {
      input.showPicker();
    } else {
      input.focus();
      input.click();
    }
  }, []);

  const handleDateChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      form.setValue('due', value ? { kind: 'picked', date: value } : NO_DUE);
    },
    [form],
  );

  const handleValid = useCallback(
    async (values: CaptureFormValues) => {
      try {
        const saved = await onCapture({
          title: values.title,
          dueDate: dueDateOf(values.due, today),
          high: values.high,
          personal: values.personal,
        });
        if (saved) {
          form.reset(EMPTY_VALUES);
          form.setFocus('title');
        }
      } catch {
        // The caller reports the failure; the title stays for retry.
      }
    },
    [form, today, onCapture],
  );

  const handleFormSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      if (isSubmitting) {
        event.preventDefault();
        return;
      }
      void form.handleSubmit(handleValid)(event);
    },
    [form, handleValid, isSubmitting],
  );

  return (
    <BottomSheet open={open} onOpenChange={handleOpenChange}>
      <BottomSheetContent className="gap-2.5 border-t border-border bg-card px-4 pt-3">
        <BottomSheetTitle className="sr-only">Add task</BottomSheetTitle>
        <Form {...form}>
          <form onSubmit={handleFormSubmit} className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <label className="flex min-w-0 grow">
                    <span className="sr-only">New task</span>
                    <Input
                      {...field}
                      autoComplete="off"
                      placeholder="Add a task"
                      readOnly={isSubmitting}
                      aria-busy={isSubmitting}
                      className="h-12 text-body focus:border-2 focus:border-foreground focus:ring-0"
                    />
                  </label>
                )}
              />
              <IconButton
                type="submit"
                variant="brand"
                label="Save task"
                icon={<ArrowUp />}
                loading={isSubmitting}
                disabled={isSubmitting}
                className="size-12 rounded-full"
              />
            </div>

            <div className="flex min-w-0 gap-2 overflow-x-auto">
              <ChoiceChip
                pressed={due.kind === 'today'}
                onPressedChange={handleTodayChange}
                disabled={isSubmitting}
              >
                Today
              </ChoiceChip>
              {due.kind === 'picked' ? (
                <ChoiceChip
                  pressed
                  onPressedChange={handlePickedChange}
                  disabled={isSubmitting}
                >
                  {formatDueLabel(due.date, today)}
                </ChoiceChip>
              ) : null}
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
              <FormField
                control={form.control}
                name="personal"
                render={({ field }) => (
                  <ChoiceChip
                    pressed={field.value}
                    onPressedChange={field.onChange}
                    disabled={isSubmitting}
                  >
                    Personal
                  </ChoiceChip>
                )}
              />
              <ChoiceChip
                pressed={false}
                onPressedChange={handlePickDateRequest}
                disabled={isSubmitting}
              >
                Pick date
              </ChoiceChip>
            </div>

            <input
              ref={dateInputRef}
              type="date"
              aria-label="Pick date"
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
              value={due.kind === 'picked' ? due.date : ''}
              onChange={handleDateChange}
              disabled={isSubmitting}
            />

            <BottomSheetDescription className="text-caption text-muted-foreground">
              Return saves. The chips reset for the next one.
            </BottomSheetDescription>
          </form>
        </Form>
      </BottomSheetContent>
    </BottomSheet>
  );
}
