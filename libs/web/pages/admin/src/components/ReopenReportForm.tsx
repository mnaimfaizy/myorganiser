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
import { useCallback, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useReportScoped } from '../hooks/use-report-scoped';
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
  const {
    value: error,
    set: setError,
    clear: clearError,
  } = useReportScoped<string>(report);

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
      clearError();

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
        setError(getApiErrorMessage(err));
      }
    },
    [report, onReopened, form, clearError, setError],
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
                  rows={3}
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

        {error && <p className="text-body-sm text-destructive">{error}</p>}

        <Button
          type="submit"
          variant="outline"
          className="w-full border-destructive text-destructive-text hover:bg-destructive-faint md:w-auto"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? 'Processing…' : 'Reopen report'}
        </Button>
      </form>
    </Form>
  );
}
