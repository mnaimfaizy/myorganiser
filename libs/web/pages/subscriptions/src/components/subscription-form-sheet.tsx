'use client';

import { useCallback, useState, type FormEvent } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetTitle,
  Button,
  ChoiceChip,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  ListGroup,
  ListGroupRow,
  cn,
} from '@myorganiser/web-ui';
import {
  SubscriptionBillingCycleEnum,
  type SubscriptionBillingCycle,
} from '@myorganiser/vault-core';

import type { SubscriptionFormValues } from '../schemas/subscription';
import {
  SUBSCRIPTION_CHOICE_OPTIONS,
  currencyCodeText,
  currencyPrefix,
  type SubscriptionChoiceFieldName,
} from '../utils/subscription-form-options';
import { getSubscriptionBillingCycleLabel } from '../utils/presentation';
import {
  useSubscriptionForm,
  type SubscriptionFormSurfaceProps,
} from '../hooks/use-subscription-form';
import { SubscriptionField } from './subscription-field';
import { SubscriptionSelectField } from './subscription-select-field';

/**
 * Which billing cycles sit in the first chip row. The rest sit behind "More…".
 * One table pinned to the enum (ADR 0053): a cycle added to the enum and not
 * here fails to compile.
 */
const BILLING_CYCLE_CHIP_GROUP = {
  [SubscriptionBillingCycleEnum.Weekly]: 'primary',
  [SubscriptionBillingCycleEnum.Fortnightly]: 'primary',
  [SubscriptionBillingCycleEnum.Monthly]: 'primary',
  [SubscriptionBillingCycleEnum.Quarterly]: 'more',
  [SubscriptionBillingCycleEnum.Yearly]: 'primary',
  [SubscriptionBillingCycleEnum.TwoYears]: 'more',
  [SubscriptionBillingCycleEnum.ThreeYears]: 'more',
} as const satisfies Record<SubscriptionBillingCycle, 'primary' | 'more'>;

const PRIMARY_BILLING_CYCLES = Object.values(
  SubscriptionBillingCycleEnum,
).filter((cycle) => BILLING_CYCLE_CHIP_GROUP[cycle] === 'primary');

const MORE_BILLING_CYCLES = Object.values(SubscriptionBillingCycleEnum).filter(
  (cycle) => BILLING_CYCLE_CHIP_GROUP[cycle] === 'more',
);

/** The fields behind "More details". An error in one of them opens the disclosure. */
const DETAIL_FIELDS = [
  'status',
  'renewalType',
  'tier',
  'endDate',
  'link',
] as const satisfies readonly (keyof SubscriptionFormValues)[];

const COPY: Record<SubscriptionFormSurfaceProps['mode'], { title: string }> = {
  add: { title: 'New subscription' },
  edit: { title: 'Edit subscription' },
};

interface PhoneSelectRowProps {
  name: Exclude<SubscriptionChoiceFieldName, 'currency' | 'billingCycle'>;
  label: string;
}

/**
 * A list row whose value is a native select. The select covers the row
 * invisibly, as the Tasks phone detail does, and the visible value is
 * drawn beside the label.
 */
function PhoneSelectRow({ name, label }: PhoneSelectRowProps) {
  const { control } = useFormContext<SubscriptionFormValues>();
  const options = SUBSCRIPTION_CHOICE_OPTIONS[name];

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const shown =
          options.find((option) => option.value === field.value)?.label ?? '';

        return (
          <FormItem className="space-y-0">
            <ListGroupRow className="relative min-h-13">
              <FormLabel className="min-w-0 flex-1 font-normal text-body text-foreground">
                {label}
              </FormLabel>
              <span
                aria-hidden="true"
                className="min-w-0 truncate text-body-sm text-muted-foreground"
              >
                {shown}
              </span>
              <ChevronRight
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <FormControl>
                <select
                  name={field.name}
                  ref={field.ref}
                  value={field.value}
                  onBlur={field.onBlur}
                  onChange={field.onChange}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                >
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormControl>
            </ListGroupRow>
            <FormMessage className="px-4 pb-3" />
          </FormItem>
        );
      }}
    />
  );
}

interface PhoneDateRowProps {
  name: 'startDate' | 'nextBillingDate' | 'endDate';
  label: string;
}

/** A list row whose value is a native date input, styled as the muted right-hand value. */
function PhoneDateRow({ name, label }: PhoneDateRowProps) {
  const { control, register } = useFormContext<SubscriptionFormValues>();

  return (
    <FormField
      control={control}
      name={name}
      render={() => (
        <FormItem className="space-y-0">
          <ListGroupRow className="min-h-13">
            <FormLabel className="min-w-0 flex-1 font-normal text-body text-foreground">
              {label}
              {name === 'endDate' ? (
                <span className="font-normal text-muted-foreground">
                  {' '}
                  · optional
                </span>
              ) : null}
            </FormLabel>
            <FormControl>
              <input
                type="date"
                className="h-11 min-w-0 bg-transparent text-right text-body-sm text-muted-foreground"
                {...register(name)}
              />
            </FormControl>
          </ListGroupRow>
          <FormMessage className="px-4 pb-3" />
        </FormItem>
      )}
    />
  );
}

/**
 * The billing cycle as horizontally scrolling single-select chips. "More…"
 * reveals the long cycles, and they start revealed when the current value is
 * one of them.
 */
function PhoneBillingCycleChips() {
  const { control, setValue } = useFormContext<SubscriptionFormValues>();
  const billingCycle = useWatch({ control, name: 'billingCycle' });
  const [moreRevealed, setMoreRevealed] = useState(false);
  const showMore =
    moreRevealed || BILLING_CYCLE_CHIP_GROUP[billingCycle] === 'more';

  const chooseBillingCycle = useCallback(
    (cycle: SubscriptionBillingCycle) => {
      setValue('billingCycle', cycle, { shouldValidate: true });
    },
    [setValue],
  );

  const handleRevealMore = useCallback(() => {
    setMoreRevealed(true);
  }, []);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-body-sm font-semibold text-foreground">Billed</span>
      <div
        role="group"
        aria-label="Billed"
        className="flex min-w-0 gap-2 overflow-x-auto pb-1"
      >
        {PRIMARY_BILLING_CYCLES.map((cycle) => (
          <ChoiceChip
            key={cycle}
            pressed={billingCycle === cycle}
            onPressedChange={() => chooseBillingCycle(cycle)}
          >
            {getSubscriptionBillingCycleLabel(cycle)}
          </ChoiceChip>
        ))}
        <ChoiceChip pressed={showMore} onPressedChange={handleRevealMore}>
          More…
        </ChoiceChip>
        {showMore
          ? MORE_BILLING_CYCLES.map((cycle) => (
              <ChoiceChip
                key={cycle}
                pressed={billingCycle === cycle}
                onPressedChange={() => chooseBillingCycle(cycle)}
              >
                {getSubscriptionBillingCycleLabel(cycle)}
              </ChoiceChip>
            ))
          : null}
      </div>
    </div>
  );
}

/**
 * The rows behind "More details". Opened on demand, or forced open when a
 * field in here fails validation so the error is visible.
 */
function PhoneMoreDetails() {
  const { formState } = useFormContext<SubscriptionFormValues>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasDetailError = DETAIL_FIELDS.some((name) =>
    Boolean(formState.errors[name]),
  );

  // Forced open while a detail field is in error, derived rather than set in
  // an effect, so the error is always visible.
  const open = detailsOpen || hasDetailError;

  const handleDetailsOpenChange = useCallback((next: boolean) => {
    setDetailsOpen(next);
  }, []);

  return (
    <Collapsible
      open={open}
      onOpenChange={handleDetailsOpenChange}
      className="flex flex-col divide-y divide-border-subtle"
    >
      <CollapsibleTrigger asChild>
        <ListGroupRow asChild interactive className="min-h-13 text-left">
          <button type="button">
            <span className="min-w-0 flex-1 text-body text-foreground">
              More details
            </span>
            <span className="text-body-sm text-muted-foreground">
              Renewal, tier, website
            </span>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground motion-safe:transition-transform',
                open && 'rotate-180',
              )}
            />
          </button>
        </ListGroupRow>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col divide-y divide-border-subtle">
        <PhoneSelectRow name="status" label="Status" />
        <PhoneSelectRow name="renewalType" label="Renewal" />
        <PhoneSelectRow name="tier" label="Tier" />
        <PhoneDateRow name="endDate" label="Ends" />
        <PhoneWebsiteField />
      </CollapsibleContent>
    </Collapsible>
  );
}

function PhoneWebsiteField() {
  const { register } = useFormContext<SubscriptionFormValues>();

  return (
    <div className="px-4 py-3">
      <SubscriptionField name="link" label="Website" optional>
        <FormControl>
          <Input type="url" placeholder="https://..." {...register('link')} />
        </FormControl>
      </SubscriptionField>
    </div>
  );
}

/** The sheet body: the fields, the grouped rows, and the disclosure. */
function PhoneFormBody() {
  const { control, register } = useFormContext<SubscriptionFormValues>();
  const currency = useWatch({ control, name: 'currency' });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-2">
      <SubscriptionField name="name" label="Name">
        <FormControl>
          <Input {...register('name')} />
        </FormControl>
      </SubscriptionField>

      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-2.5">
        <SubscriptionField name="amount" label="Amount">
          <div className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-body text-muted-foreground"
            >
              {currencyPrefix(currency)}
            </span>
            <FormControl>
              <Input
                type="number"
                step="0.01"
                inputMode="decimal"
                className="pl-10"
                {...register('amount', { valueAsNumber: true })}
              />
            </FormControl>
          </div>
        </SubscriptionField>
        <SubscriptionSelectField
          name="currency"
          label="Currency"
          triggerText={currencyCodeText}
        />
      </div>

      <PhoneBillingCycleChips />

      <ListGroup>
        <PhoneDateRow name="startDate" label="Started" />
        <PhoneDateRow name="nextBillingDate" label="Next billing" />
        <PhoneSelectRow name="paymentMethod" label="Pays with" />
        <PhoneMoreDetails />
      </ListGroup>
    </div>
  );
}

/**
 * The add/edit form as a phone bottom sheet (SubscriptionFormPhone artboard).
 * The sheet cannot be dismissed while a save is pending, and Cancel is
 * disabled then too.
 */
export function SubscriptionFormSheet({
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
        // The save failed: the sheet stays open with the values intact.
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

  const handleSheetOpenChange = useCallback(
    (next: boolean) => {
      if (!next && isSubmitting) return;
      onOpenChange(next);
    },
    [isSubmitting, onOpenChange],
  );

  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const title = COPY[mode].title;

  return (
    <BottomSheet open={open} onOpenChange={handleSheetOpenChange}>
      <BottomSheetContent className="h-[calc(100dvh_-_2.5rem)] max-h-[calc(100dvh_-_2.5rem)] gap-0 overflow-hidden px-0">
        <Form {...form}>
          <form
            noValidate
            onSubmit={handleFormSubmit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="grid grid-cols-[72px_1fr_72px] items-center px-2">
              <Button
                type="button"
                variant="ghost"
                onClick={handleCancel}
                disabled={isSubmitting}
                className="h-11 justify-self-start px-2"
              >
                Cancel
              </Button>
              <BottomSheetTitle className="text-center text-body font-semibold">
                {title}
              </BottomSheetTitle>
              <Button
                type="submit"
                variant="link"
                loading={isSubmitting}
                className="h-11 justify-self-end px-2 font-bold"
              >
                Save
              </Button>
            </div>
            <BottomSheetDescription className="sr-only">
              Encrypted on this phone
            </BottomSheetDescription>
            <PhoneFormBody />
          </form>
        </Form>
      </BottomSheetContent>
    </BottomSheet>
  );
}
