'use client';

import { useCallback, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { isAxiosError } from 'axios';

import { type FeedbackReportListItemDto } from '@myorganiser/app-api-client';
import {
  FEEDBACK_REPORT_FOLLOW_UP_MAX_LENGTH,
  FEEDBACK_REPORT_CAP_MESSAGES,
  FEEDBACK_REPORT_REQUIRED_MESSAGES,
} from '@myorganiser/core';
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Textarea,
  useToast,
} from '@myorganiser/web-ui';

import { createFeedbackApi } from '../lib/apiClient';

const followUpFormSchema = z.object({
  followUp: z
    .string()
    .trim()
    .min(1, FEEDBACK_REPORT_REQUIRED_MESSAGES.followUp)
    .max(
      FEEDBACK_REPORT_FOLLOW_UP_MAX_LENGTH,
      FEEDBACK_REPORT_CAP_MESSAGES.followUp,
    ),
});

type FollowUpFormValues = z.infer<typeof followUpFormSchema>;

export interface FollowUpFormProps {
  reportId: string;
  onSent: (updated: FeedbackReportListItemDto) => void;
}

export function FollowUpForm({ reportId, onSent }: FollowUpFormProps) {
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FollowUpFormValues>({
    resolver: zodResolver(followUpFormSchema),
    defaultValues: {
      followUp: '',
    },
  });

  const { isSubmitting } = form.formState;

  const handleSubmit = useCallback(
    async (values: FollowUpFormValues) => {
      setServerError(null);

      try {
        const response = await createFeedbackApi().addFollowUp({
          reportId,
          addFollowUpRequest: { followUp: values.followUp },
        });

        // Success: show toast and call onSent
        toast({
          title: 'Follow-up sent',
          description: 'Your report is back under review.',
        });
        onSent(response.data);
      } catch (error) {
        // Narrow server error: 4xx answers carry a user-facing message.
        let message: string | undefined;
        if (isAxiosError(error)) {
          const status = error.response?.status;
          if (status !== undefined && status >= 400 && status < 500) {
            const data = error.response?.data;
            if (
              data &&
              typeof data === 'object' &&
              'message' in data &&
              typeof data.message === 'string'
            ) {
              message = data.message;
            }
          }
        }
        setServerError(
          message ?? 'Your follow-up could not be sent. Please try again.',
        );
      }
    },
    [reportId, onSent, toast],
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        {/* Follow-up field */}
        <FormField
          control={form.control}
          name="followUp"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Follow-up</FormLabel>
              <FormControl>
                <Textarea placeholder="Add more detail…" rows={3} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Server error message */}
        {serverError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {serverError}
          </div>
        )}

        {/* Submit button */}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Sending...' : 'Send follow-up'}
        </Button>
      </form>
    </Form>
  );
}
