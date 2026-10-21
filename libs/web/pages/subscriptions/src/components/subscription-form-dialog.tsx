'use client';

import { useCallback, type FormEvent } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DatePicker,
  Form,
  FormControl,
  Input,
  SegmentedControl,
} from '@myorganiser/web-ui';

import type { SubscriptionFormValues } from '../schemas/subscription';
import {
  SUBSCRIPTION_CHOICE_OPTIONS,
  currencyCodeText,
} from '../utils/subscription-form-options';
import {
  useSubscriptionForm,
  type SubscriptionFormSurfaceProps,
} from '../hooks/use-subscription-form';
import { SubscriptionField } from './subscription-field';
import { SubscriptionSelectField } from './subscription-select-field';

const SECTION_LEGEND_CLASS = 'text-label-caps uppercase text-muted-foreground';

const COPY: Record<
  SubscriptionFormSurfaceProps['mode'],
  { title: string; submit: string }
> = {
  add: { title: 'Add subscription', submit: 'Add subscription' },
  edit: { title: 'Edit subscription', submit: 'Save changes' },
};

function DialogBasicsFields() {
  const { register } = useFormContext<SubscriptionFormValues>();

  return (
    <fieldset className="flex min-w-0 flex-col gap-2.5">
      <legend className={SECTION_LEGEND_CLASS}>Basics</legend>
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-3">
        <SubscriptionField name="name" label="Name">
          <FormControl>
            <Input {...register('name')} placeholder="Netflix" />
          </FormControl>
        </SubscriptionField>
        <SubscriptionField name="link" label="Website" optional>
          <FormControl>
            <Input type="url" placeholder="https://..." {...register('link')} />
          </FormControl>
        </SubscriptionField>
      </div>
    </fieldset>
  );
}

function DialogBillingFields() {
  const { register } = useFormContext<SubscriptionFormValues>();

  return (
    <fieldset className="flex min-w-0 flex-col gap-2.5">
      <legend className={SECTION_LEGEND_CLASS}>Billing</legend>
      <div className="grid grid-cols-3 gap-3">
        <SubscriptionField name="amount" label="Amount">
          <FormControl>
            <Input
              type="number"
              step="0.01"
              inputMode="decimal"
              {...register('amount', { valueAsNumber: true })}
            />
          </FormControl>
        </SubscriptionField>
        <SubscriptionSelectField
          name="currency"
          label="Currency"
          triggerText={currencyCodeText}
        />
        <SubscriptionSelectField name="billingCycle" label="Billed" />
      </div>
    </fieldset>
  );
}

interface DialogDateFieldProps {
  name: 'startDate' | 'nextBillingDate' | 'endDate';
  label: string;
  optional?: boolean;
  placeholder: string;
}

function DialogDateField({
  name,
  label,
  optional,
  placeholder,
}: DialogDateFieldProps) {
  const { control } = useFormContext<SubscriptionFormValues>();

  return (
    <SubscriptionField name={name} label={label} optional={optional}>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <FormControl>
            <DatePicker
              value={field.value}
              onChange={field.onChange}
              placeholder={placeholder}
            />
          </FormControl>
        )}
      />
    </SubscriptionField>
  );
}

function DialogDatesFields() {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2.5">
      <legend className={SECTION_LEGEND_CLASS}>Dates</legend>
      <div className="grid grid-cols-3 gap-3">
        <DialogDateField
          name="startDate"
          label="Started"
          placeholder="Pick a date"
        />
        <DialogDateField
          name="nextBillingDate"
          label="Next billing"
          placeholder="Pick a date"
        />
        <DialogDateField
          name="endDate"
          label="Ends"
          optional
          placeholder="No end date"
        />
      </div>
    </fieldset>
  );
}

function DialogPlanFields() {
  const { control } = useFormContext<SubscriptionFormValues>();

  return (
    <fieldset className="flex min-w-0 flex-col gap-2.5">
      <legend className={SECTION_LEGEND_CLASS}>Plan</legend>
      <Controller
        control={control}
        name="status"
        render={({ field }) => (
          <SegmentedControl
            name="status"
            legend="Status"
            options={SUBSCRIPTION_CHOICE_OPTIONS.status}
            value={field.value}
            onValueChange={field.onChange}
          />
        )}
      />
      <div className="grid grid-cols-3 gap-3">
        <SubscriptionSelectField name="paymentMethod" label="Pays with" />
        <SubscriptionSelectField name="renewalType" label="Renewal" />
        <SubscriptionSelectField name="tier" label="Tier" />
      </div>
    </fieldset>
  );
}

/**
 * The add/edit form as a desktop dialog (SubscriptionForm artboard). The
 * dialog cannot be dismissed while a save is pending, and its close control is
 * hidden then too.
 */
export function SubscriptionFormDialog({
  open,
  onOpenChange,
  mode,
  initialValues,
  onSubmit,
}: SubscriptionFormSurfaceProps) {
  const { form, isSubmitting } = useSubscriptionForm({ open, initialValues });

  const handleValid = useCallback(
    async (values: SubscriptionFormValues) => {
      try {
        await onSubmit(values);
        onOpenChange(false);
      } catch {
        // The save failed: the dialog stays open with the values intact.
      }
    },
    [onSubmit, onOpenChange],
  );

  const handleFormSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      void form.handleSubmit(handleValid)(event);
    },
    [form, handleValid],
  );

  const handleDialogOpenChange = useCallback(
    (next: boolean) => {
      if (!next && isSubmitting) return;
      onOpenChange(next);
    },
    [isSubmitting, onOpenChange],
  );

  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const copy = COPY[mode];

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        showCloseButton={!isSubmitting}
        className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="shrink-0 gap-1 border-b border-border px-6 pt-6 pr-14 pb-4">
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5 text-trust-text">
            <span aria-hidden="true" className="size-2 rounded-full bg-trust" />
            Encrypted on this device before it syncs
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            noValidate
            onSubmit={handleFormSubmit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
              <DialogBasicsFields />
              <DialogBillingFields />
              <DialogDatesFields />
              <DialogPlanFields />
            </div>
            <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {copy.submit}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
