'use client';

import { useCallback } from 'react';
import type { Control } from 'react-hook-form';

import type { FeedbackReportKind } from '@myorganiser/app-api-client';
import { FormField, FormItem, RadioCard, cn } from '@myorganiser/web-ui';

import {
  FEEDBACK_KIND_CHOICES,
  type FeedbackFormValues,
  type FeedbackReportFormVariant,
} from '../schemas/feedback-report';

interface KindChoiceFieldsetProps {
  kind: FeedbackReportKind;
  onKindChange: (kind: FeedbackReportKind) => void;
  variant: FeedbackReportFormVariant;
}

/**
 * Render the kind choice as a native radio group of selectable cards.
 */
function KindChoiceFieldset({
  kind,
  onKindChange,
  variant,
}: KindChoiceFieldsetProps) {
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onKindChange(event.target.value as FeedbackReportKind);
    },
    [onKindChange],
  );

  return (
    <fieldset className="m-0 flex flex-col p-0">
      <legend className="mb-2 p-0 text-field font-semibold">
        What kind of feedback is this?
      </legend>
      <div
        className={cn('grid gap-2.5', variant === 'desktop' && 'grid-cols-2')}
      >
        {Object.entries(FEEDBACK_KIND_CHOICES).map(([kindValue, choice]) => (
          <RadioCard
            key={kindValue}
            name="kind"
            value={kindValue}
            checked={kind === kindValue}
            onChange={handleChange}
            title={choice.label}
            description={choice.hint}
          />
        ))}
      </div>
    </fieldset>
  );
}

export interface FeedbackKindFieldProps {
  control: Control<FeedbackFormValues>;
  variant: FeedbackReportFormVariant;
}

/**
 * The "What kind of feedback is this?" choice, bound to the form's `kind` field.
 */
export function FeedbackKindField({
  control,
  variant,
}: FeedbackKindFieldProps) {
  return (
    <FormField
      control={control}
      name="kind"
      render={({ field }) => (
        <FormItem>
          <KindChoiceFieldset
            kind={field.value}
            onKindChange={field.onChange}
            variant={variant}
          />
        </FormItem>
      )}
    />
  );
}
