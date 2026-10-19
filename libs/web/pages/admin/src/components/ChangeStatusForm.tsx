'use client';

import type {
  AdminFeedbackReportDetailDto,
  FeedbackReportStatus,
} from '@myorganiser/app-api-client';
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@myorganiser/web-ui';
import { FEEDBACK_REPORT_TEXT_MAX_LENGTH } from '@myorganiser/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useReportScoped } from '../hooks/use-report-scoped';
import { createPlatformAdminApi } from '../lib/apiClient';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import {
  adminSettableStatusesForKind,
  formatFeedbackReportStatus,
  statusRequiresNote,
  FEEDBACK_REPORT_STATUS_VALUES,
} from '../lib/formatFeedbackReport';
import {
  STATUS_NOTE_REQUIRED_MESSAGE,
  STATUS_NOTE_TOO_LONG_MESSAGE,
} from '../lib/statusNoteSchema';

interface ChangeStatusFormProps {
  report: AdminFeedbackReportDetailDto;
  onUpdated: (report: AdminFeedbackReportDetailDto) => void;
}

type ChangeStatusFormValues = {
  status: FeedbackReportStatus;
  statusNote?: string;
};

const changeStatusSchema = z
  .object({
    status: z.enum(FEEDBACK_REPORT_STATUS_VALUES),
    statusNote: z
      .string()
      .max(FEEDBACK_REPORT_TEXT_MAX_LENGTH, STATUS_NOTE_TOO_LONG_MESSAGE)
      .optional(),
  })
  .refine(
    (data) => {
      if (statusRequiresNote(data.status)) {
        return data.statusNote && data.statusNote.trim().length > 0;
      }
      return true;
    },
    {
      message: STATUS_NOTE_REQUIRED_MESSAGE,
      path: ['statusNote'],
    },
  );

export function ChangeStatusForm({ report, onUpdated }: ChangeStatusFormProps) {
  const {
    value: error,
    set: setError,
    clear: clearError,
  } = useReportScoped<string>(report);
  // Keyed to the report this form's own submit returned. The success message
  // shows only while the parent still holds that report.
  const { value: saved, set: setSaved } = useReportScoped<true>(report);

  const settableStatuses = useMemo(
    () => adminSettableStatusesForKind(report.kind),
    [report.kind],
  );

  const defaultStatus = useMemo(
    () => settableStatuses[0] || 'under_review',
    [settableStatuses],
  );

  const form = useForm<z.input<typeof changeStatusSchema>>({
    resolver: zodResolver(changeStatusSchema),
    defaultValues: {
      status: defaultStatus,
      statusNote: '',
    },
  });

  // Any report update, own or sibling, returns the form to its defaults and
  // drops stale errors. The own success message is report-scoped, so it survives.
  useEffect(() => {
    form.reset({
      status: defaultStatus,
      statusNote: '',
    });
  }, [report, form, defaultStatus]);

  const onSubmit = useCallback(
    async (values: ChangeStatusFormValues) => {
      clearError();

      try {
        const api = createPlatformAdminApi();
        const response = await api.changeFeedbackReportStatus({
          reportId: report.id,
          changeFeedbackReportStatusRequest: {
            status: values.status,
            statusNote: values.statusNote || undefined,
          },
        });
        setSaved(true, response.data);
        onUpdated(response.data);
        form.reset({
          status: defaultStatus,
          statusNote: '',
        });
      } catch (err) {
        setError(getApiErrorMessage(err));
      }
    },
    [report, clearError, setError, setSaved, onUpdated, form, defaultStatus],
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {settableStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {formatFeedbackReportStatus(status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="statusNote"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status note</FormLabel>
              <FormControl>
                <Textarea placeholder="Explain the decision..." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}
        {saved && (
          <p className="text-sm text-muted-foreground">Status updated.</p>
        )}

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Updating…' : 'Update status'}
        </Button>
      </form>
    </Form>
  );
}
