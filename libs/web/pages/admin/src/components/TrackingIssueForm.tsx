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
  NewTabLink,
} from '@myorganiser/web-ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useReportScoped } from '../hooks/use-report-scoped';
import { createPlatformAdminApi } from '../lib/apiClient';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { trackingIssueUrl } from '../lib/formatFeedbackReport';

interface TrackingIssueFormProps {
  report: AdminFeedbackReportDetailDto;
  onUpdated: (report: AdminFeedbackReportDetailDto) => void;
}

const linkIssueSchema = z.object({
  trackingIssueNumber: z
    .string()
    .trim()
    .refine(
      (val) => val !== '' && /^\d+$/.test(val) && parseInt(val, 10) > 0,
      'Enter the tracking issue number.',
    ),
});

type LinkIssueFormValues = z.infer<typeof linkIssueSchema>;

type TrackingIssueMessage =
  | { kind: 'linked'; issueNumber: number }
  | { kind: 'unlinked' };

export function TrackingIssueForm({
  report,
  onUpdated,
}: TrackingIssueFormProps) {
  const {
    value: error,
    set: setError,
    clear: clearError,
  } = useReportScoped<string>(report);
  const { value: message, set: setMessage } =
    useReportScoped<TrackingIssueMessage>(report);
  const [isUnlinking, setIsUnlinking] = useState(false);

  const form = useForm<LinkIssueFormValues>({
    resolver: zodResolver(linkIssueSchema),
    defaultValues: {
      trackingIssueNumber: '',
    },
  });

  // Validation errors are react-hook-form state, so they are cleared here
  // when the report changes, own or sibling.
  useEffect(() => {
    form.clearErrors();
  }, [report, form]);

  const handleUnlink = useCallback(async () => {
    clearError();
    setIsUnlinking(true);

    try {
      const api = createPlatformAdminApi();
      const response = await api.unlinkFeedbackReportTrackingIssue({
        reportId: report.id,
      });
      setMessage({ kind: 'unlinked' }, response.data);
      onUpdated(response.data);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsUnlinking(false);
    }
  }, [report, onUpdated, clearError, setError, setMessage]);

  const onSubmit = useCallback(
    async (values: LinkIssueFormValues) => {
      clearError();

      try {
        const issueNumber = Number(values.trackingIssueNumber);
        const api = createPlatformAdminApi();
        const response = await api.linkFeedbackReportTrackingIssue({
          reportId: report.id,
          linkFeedbackReportTrackingIssueRequest: {
            trackingIssueNumber: issueNumber,
          },
        });
        setMessage({ kind: 'linked', issueNumber }, response.data);
        onUpdated(response.data);
        form.reset();
      } catch (err) {
        setError(getApiErrorMessage(err));
      }
    },
    [report, onUpdated, form, clearError, setError, setMessage],
  );

  if (report.trackingIssueNumber) {
    return (
      <div className="space-y-3">
        <div className="text-sm">
          <p className="font-medium">Tracking Issue:</p>
          <NewTabLink
            href={trackingIssueUrl(report.trackingIssueNumber)}
            className="text-primary hover:underline"
          >
            #{report.trackingIssueNumber}
          </NewTabLink>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {message?.kind === 'linked' && (
          <p className="text-sm text-muted-foreground">
            Issue #{message.issueNumber} linked. The report is now Planned.
          </p>
        )}

        <Button variant="outline" onClick={handleUnlink} disabled={isUnlinking}>
          {isUnlinking ? 'Unlinking…' : 'Unlink'}
        </Button>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="trackingIssueNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Issue number</FormLabel>
              <FormControl>
                <Input type="number" placeholder="Issue number" {...field} />
              </FormControl>
              <FormDescription>
                Linking a tracking issue sets the report to Planned.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}
        {message?.kind === 'unlinked' && (
          <p className="text-sm text-muted-foreground">Issue unlinked.</p>
        )}

        <Button
          type="submit"
          variant="outline"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? 'Linking…' : 'Link issue'}
        </Button>
      </form>
    </Form>
  );
}
