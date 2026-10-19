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
  Input,
} from '@myorganiser/web-ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useReportScoped } from '../hooks/use-report-scoped';
import { createPlatformAdminApi } from '../lib/apiClient';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import {
  deliveredStatusForKind,
  formatFeedbackReportStatus,
} from '../lib/formatFeedbackReport';

interface MarkDeliveredFormProps {
  report: AdminFeedbackReportDetailDto;
  onUpdated: (report: AdminFeedbackReportDetailDto) => void;
}

const markDeliveredSchema = z.object({
  releaseTag: z
    .string()
    .min(
      1,
      'Name the release this shipped in, such as v1.4.0 or mobile-v1.4.0.',
    ),
});

type MarkDeliveredFormValues = z.infer<typeof markDeliveredSchema>;

export function MarkDeliveredForm({
  report,
  onUpdated,
}: MarkDeliveredFormProps) {
  const {
    value: error,
    set: setError,
    clear: clearError,
  } = useReportScoped<string>(report);

  const form = useForm<MarkDeliveredFormValues>({
    resolver: zodResolver(markDeliveredSchema),
    defaultValues: {
      releaseTag: '',
    },
  });

  // Any report update drops stale validation messages. A successful submit
  // leaves the report Fixed or Shipped, and the parent then replaces this form
  // with the final-report note, so no success message is needed here.
  useEffect(() => {
    form.clearErrors();
  }, [report, form]);

  const onSubmit = useCallback(
    async (values: MarkDeliveredFormValues) => {
      clearError();

      try {
        const api = createPlatformAdminApi();
        const response = await api.markFeedbackReportDelivered({
          reportId: report.id,
          markFeedbackReportDeliveredRequest: {
            releaseTag: values.releaseTag,
          },
        });
        onUpdated(response.data);
        form.reset();
      } catch (err) {
        setError(getApiErrorMessage(err));
      }
    },
    [report, onUpdated, form, clearError, setError],
  );

  // Get the button label based on report kind
  const buttonLabel = `Mark ${formatFeedbackReportStatus(deliveredStatusForKind(report.kind)).toLowerCase()}`;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="releaseTag"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Release</FormLabel>
              <FormControl>
                <Input placeholder="Release tag" {...field} />
              </FormControl>
              <FormDescription>
                A Release tag such as v1.4.0. Use this for a fix with no
                tracking issue, and for a Mobile Release.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Processing…' : buttonLabel}
        </Button>
      </form>
    </Form>
  );
}
