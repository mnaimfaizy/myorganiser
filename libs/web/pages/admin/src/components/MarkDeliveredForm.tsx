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
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

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
  // Scoped to the report it was produced against, so a sibling update hides it.
  const [errorResult, setErrorResult] = useState<{
    report: AdminFeedbackReportDetailDto;
    value: string;
  } | null>(null);
  const error = errorResult?.report === report ? errorResult.value : null;
  // The report this form's own submit produced. The success message shows only
  // while the parent still holds that report; a sibling update hides it.
  const [savedReport, setSavedReport] =
    useState<AdminFeedbackReportDetailDto | null>(null);

  const form = useForm<MarkDeliveredFormValues>({
    resolver: zodResolver(markDeliveredSchema),
    defaultValues: {
      releaseTag: '',
    },
  });

  // Any report update, own or sibling, drops stale errors and validation
  // messages. The own success message is report-scoped, so it survives.
  useEffect(() => {
    form.clearErrors();
  }, [report, form]);

  const onSubmit = useCallback(
    async (values: MarkDeliveredFormValues) => {
      setErrorResult(null);

      try {
        const api = createPlatformAdminApi();
        const response = await api.markFeedbackReportDelivered({
          reportId: report.id,
          markFeedbackReportDeliveredRequest: {
            releaseTag: values.releaseTag,
          },
        });
        setSavedReport(response.data);
        onUpdated(response.data);
        form.reset();
      } catch (err) {
        setErrorResult({ report, value: getApiErrorMessage(err) });
      }
    },
    [report, onUpdated, form],
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
        {savedReport === report && (
          <p className="text-sm text-muted-foreground">Release recorded.</p>
        )}

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Processing…' : buttonLabel}
        </Button>
      </form>
    </Form>
  );
}
