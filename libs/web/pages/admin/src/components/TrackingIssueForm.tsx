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
import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

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

export function TrackingIssueForm({
  report,
  onUpdated,
}: TrackingIssueFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);

  const form = useForm<LinkIssueFormValues>({
    resolver: zodResolver(linkIssueSchema),
    defaultValues: {
      trackingIssueNumber: '',
    },
  });

  const handleUnlink = useCallback(async () => {
    setError(null);
    setSuccess(false);
    setIsUnlinking(true);

    try {
      const api = createPlatformAdminApi();
      const response = await api.unlinkFeedbackReportTrackingIssue({
        reportId: report.id,
      });
      onUpdated(response.data);
      setSuccess(true);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsUnlinking(false);
    }
  }, [report.id, onUpdated]);

  const onSubmit = useCallback(
    async (values: LinkIssueFormValues) => {
      setError(null);
      setSuccess(false);

      try {
        const api = createPlatformAdminApi();
        const response = await api.linkFeedbackReportTrackingIssue({
          reportId: report.id,
          linkFeedbackReportTrackingIssueRequest: {
            trackingIssueNumber: Number(values.trackingIssueNumber),
          },
        });
        onUpdated(response.data);
        setSuccess(true);
        form.reset();
      } catch (err) {
        setError(getApiErrorMessage(err));
      }
    },
    [report.id, onUpdated, form],
  );

  if (report.trackingIssueNumber) {
    return (
      <div className="space-y-3">
        <div className="text-sm">
          <p className="font-medium">Tracking Issue:</p>
          <a
            href={trackingIssueUrl(report.trackingIssueNumber)}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            #{report.trackingIssueNumber}
          </a>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && (
          <p className="text-sm text-muted-foreground">Issue unlinked.</p>
        )}

        <Button
          variant="outline"
          onClick={handleUnlink}
          disabled={isUnlinking}
          className="w-full"
        >
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
        {success && (
          <p className="text-sm text-muted-foreground">Issue linked.</p>
        )}

        <Button
          type="submit"
          disabled={form.formState.isSubmitting}
          className="w-full"
        >
          {form.formState.isSubmitting ? 'Linking…' : 'Link issue'}
        </Button>
      </form>
    </Form>
  );
}
