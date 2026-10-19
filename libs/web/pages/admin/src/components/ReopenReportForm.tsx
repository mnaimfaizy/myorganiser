'use client';

import type { AdminFeedbackReportDetailDto } from '@myorganiser/app-api-client';
import {
  Button,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Textarea,
} from '@myorganiser/web-ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { createPlatformAdminApi } from '../lib/apiClient';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { requiredStatusNoteSchema } from '../lib/statusNoteSchema';

interface ReopenReportFormProps {
  report: AdminFeedbackReportDetailDto;
  onReopened: (report: AdminFeedbackReportDetailDto) => void;
}

const reopenReportSchema = z.object({
  statusNote: requiredStatusNoteSchema,
});

type ReopenReportFormValues = z.infer<typeof reopenReportSchema>;

export function ReopenReportForm({
  report,
  onReopened,
}: ReopenReportFormProps) {
  // Scoped to the report it was produced against, so a sibling update hides it.
  const [errorResult, setErrorResult] = useState<{
    report: AdminFeedbackReportDetailDto;
    value: string;
  } | null>(null);
  const error = errorResult?.report === report ? errorResult.value : null;

  const form = useForm<ReopenReportFormValues>({
    resolver: zodResolver(reopenReportSchema),
    defaultValues: {
      statusNote: '',
    },
  });

  // Any report update drops stale validation messages.
  useEffect(() => {
    form.clearErrors();
  }, [report, form]);

  const onSubmit = useCallback(
    async (values: ReopenReportFormValues) => {
      setErrorResult(null);

      try {
        const api = createPlatformAdminApi();
        const response = await api.reopenFeedbackReport({
          reportId: report.id,
          reopenFeedbackReportRequest: {
            statusNote: values.statusNote,
          },
        });
        onReopened(response.data);
        form.reset();
      } catch (err) {
        setErrorResult({ report, value: getApiErrorMessage(err) });
      }
    },
    [report, onReopened, form],
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="statusNote"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status note</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Explain why this report is being reopened..."
                  {...field}
                />
              </FormControl>
              <FormDescription>
                The reporter reads this note on Your reports.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Processing…' : 'Reopen report'}
        </Button>
      </form>
    </Form>
  );
}
