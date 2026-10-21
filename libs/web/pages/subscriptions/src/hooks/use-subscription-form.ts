'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';

import {
  subscriptionFormSchema,
  type SubscriptionFormValues,
} from '../schemas/subscription';

/** The props every add/edit surface takes, desktop dialog and phone sheet alike. */
export interface SubscriptionFormSurfaceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'add' | 'edit';
  /** emptySubscriptionFormValues(preferredCurrency) for add; subscriptionToFormValues(record) for edit. */
  initialValues: SubscriptionFormValues;
  /** Resolves on success (the surface then closes via onOpenChange(false)); rejects on failure (stay open, values intact). */
  onSubmit: (values: SubscriptionFormValues) => Promise<void>;
}

export interface UseSubscriptionFormOptions {
  open: boolean;
  initialValues: SubscriptionFormValues;
}

/**
 * The add/edit form state. Errors show once a field has been left or the form
 * is submitted (`onTouched`). Each time `open` turns true the form resets to
 * `initialValues`, so reopening Add starts clean and Edit picks up the current
 * record. Changes to `initialValues` while the form is open do not reset it,
 * so a parent re-render cannot wipe what the user has typed.
 */
export function useSubscriptionForm({
  open,
  initialValues,
}: UseSubscriptionFormOptions) {
  const form = useForm<SubscriptionFormValues>({
    resolver: zodResolver(subscriptionFormSchema),
    mode: 'onTouched',
    defaultValues: initialValues,
  });

  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      form.reset(initialValues);
    }
    wasOpenRef.current = open;
  }, [open, initialValues, form]);

  return {
    form,
    isSubmitting: form.formState.isSubmitting,
  };
}
