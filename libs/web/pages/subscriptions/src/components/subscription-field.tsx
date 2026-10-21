'use client';

import type { ReactNode } from 'react';
import type { FieldPath } from 'react-hook-form';
import { useFormContext } from 'react-hook-form';
import {
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@myorganiser/web-ui';

import type { SubscriptionFormValues } from '../schemas/subscription';

export interface SubscriptionFieldProps {
  name: FieldPath<SubscriptionFormValues>;
  label: string;
  /** Adds a muted "· optional" after the label. */
  optional?: boolean;
  /** The control. Wrap it in FormControl so the label, aria-invalid and aria-describedby reach it. */
  children: ReactNode;
  className?: string;
}

/**
 * A label, its control, and the inline error for one form field. The error
 * sits under the control in destructive text; FormControl (in the children)
 * supplies the id, aria-invalid and aria-describedby.
 */
export function SubscriptionField({
  name,
  label,
  optional = false,
  children,
  className,
}: SubscriptionFieldProps) {
  const { control } = useFormContext<SubscriptionFormValues>();

  return (
    <FormField
      control={control}
      name={name}
      render={() => (
        <FormItem className={className}>
          <FormLabel>
            {label}
            {optional ? (
              <span className="font-normal text-muted-foreground">
                {' '}
                · optional
              </span>
            ) : null}
          </FormLabel>
          {children}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
