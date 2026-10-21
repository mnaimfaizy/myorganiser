'use client';

import { Controller, useFormContext } from 'react-hook-form';
import {
  FormControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@myorganiser/web-ui';

import type { SubscriptionFormValues } from '../schemas/subscription';
import {
  SUBSCRIPTION_CHOICE_OPTIONS,
  type SubscriptionChoiceFieldName,
} from '../utils/subscription-form-options';
import { SubscriptionField } from './subscription-field';

export interface SubscriptionSelectFieldProps {
  name: SubscriptionChoiceFieldName;
  label: string;
  /** The text the trigger shows for a value. Omitted: the selected option's label. */
  triggerText?: (value: string) => string;
}

/** A single-choice Select bound to one choice field, with its label and error. */
export function SubscriptionSelectField({
  name,
  label,
  triggerText,
}: SubscriptionSelectFieldProps) {
  const { control } = useFormContext<SubscriptionFormValues>();
  const options = SUBSCRIPTION_CHOICE_OPTIONS[name];

  return (
    <SubscriptionField name={name} label={label}>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger>
                <SelectValue>{triggerText?.(field.value)}</SelectValue>
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </SubscriptionField>
  );
}
