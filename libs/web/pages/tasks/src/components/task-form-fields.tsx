'use client';

import type { Control } from 'react-hook-form';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  type SegmentedControlOption,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@myorganiser/web-ui';
import type { TaskFormValues } from './task-form';

export interface TaskFormFieldsProps {
  control: Control<TaskFormValues>;
}

const STATUS_OPTIONS: readonly SegmentedControlOption<
  TaskFormValues['status']
>[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

/**
 * The Status, Due date and Estimate row of the task form. Three columns from
 * sm up; stacked below sm so the 390px phone width never overflows.
 */
export function TaskFormFields({ control }: TaskFormFieldsProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <FormField
        control={control}
        name="status"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Status</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="dueDate"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Due date</FormLabel>
            <FormControl>
              <Input type="date" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="estimate"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Estimate</FormLabel>
            <FormControl>
              <Input placeholder="e.g. 30 min" inputMode="text" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
