'use client';

import type { Control } from 'react-hook-form';
import { useWatch } from 'react-hook-form';

import type { FeedbackReportKind } from '@myorganiser/app-api-client';
import { FEEDBACK_REPORT_TITLE_MAX_LENGTH } from '@myorganiser/core';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
} from '@myorganiser/web-ui';

import {
  FEEDBACK_KIND_CHOICES,
  type FeedbackFormValues,
  type FeedbackReportFormVariant,
} from '../schemas/feedback-report';

export interface FeedbackDetailsFieldsProps {
  control: Control<FeedbackFormValues>;
  kind: FeedbackReportKind;
  variant: FeedbackReportFormVariant;
}

/**
 * The Title, the description (labelled by the kind), and — for a Bug Report
 * only — the expected outcome.
 */
export function FeedbackDetailsFields({
  control,
  kind,
  variant,
}: FeedbackDetailsFieldsProps) {
  const title = useWatch({ control, name: 'title' });
  const kindChoice = FEEDBACK_KIND_CHOICES[kind];
  const isDesktop = variant === 'desktop';

  return (
    <>
      {/* Title field */}
      <FormField
        control={control}
        name="title"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-baseline justify-between gap-3">
              <FormLabel className="text-field font-semibold">Title</FormLabel>
              {isDesktop && (
                <span
                  aria-hidden="true"
                  className="text-caption text-muted-foreground"
                >
                  {title.length} / {FEEDBACK_REPORT_TITLE_MAX_LENGTH}
                </span>
              )}
            </div>
            <FormControl>
              <Input placeholder="Brief summary of your feedback" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Description field */}
      <FormField
        control={control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-field font-semibold">
              {kindChoice.descriptionLabel}
            </FormLabel>
            <FormControl>
              <Textarea
                placeholder="Please provide details..."
                rows={4}
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Expected outcome field — only for bug reports */}
      {kindChoice.asksExpectedOutcome && (
        <FormField
          control={control}
          name="expectedOutcome"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-field font-semibold">
                What did you expect to happen?{' '}
                <span className="text-caption font-normal text-muted-foreground">
                  (optional)
                </span>
              </FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Describe what should have happened instead..."
                  rows={3}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </>
  );
}
