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
import { ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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

type TrackingIssueMessage =
  | { kind: 'linked'; issueNumber: number }
  | { kind: 'unlinked' };

// Each message and error is scoped to the report it was produced against.
// Once the parent passes a different report (a sibling form updated it), the
// scoped value no longer matches and stops rendering, with no effect needed.
interface ScopedMessage<T> {
  report: AdminFeedbackReportDetailDto;
  value: T;
}

export function TrackingIssueForm({
  report,
  onUpdated,
}: TrackingIssueFormProps) {
  const [errorResult, setErrorResult] = useState<ScopedMessage<string> | null>(
    null,
  );
  const [messageResult, setMessageResult] =
    useState<ScopedMessage<TrackingIssueMessage> | null>(null);
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

  const error = errorResult?.report === report ? errorResult.value : null;
  const message = messageResult?.report === report ? messageResult.value : null;

  const handleUnlink = useCallback(async () => {
    setErrorResult(null);
    setIsUnlinking(true);

    try {
      const api = createPlatformAdminApi();
      const response = await api.unlinkFeedbackReportTrackingIssue({
        reportId: report.id,
      });
      setMessageResult({
        report: response.data,
        value: { kind: 'unlinked' },
      });
      onUpdated(response.data);
    } catch (err) {
      setErrorResult({ report, value: getApiErrorMessage(err) });
    } finally {
      setIsUnlinking(false);
    }
  }, [report, onUpdated]);

  const onSubmit = useCallback(
    async (values: LinkIssueFormValues) => {
      setErrorResult(null);

      try {
        const issueNumber = Number(values.trackingIssueNumber);
        const api = createPlatformAdminApi();
        const response = await api.linkFeedbackReportTrackingIssue({
          reportId: report.id,
          linkFeedbackReportTrackingIssueRequest: {
            trackingIssueNumber: issueNumber,
          },
        });
        setMessageResult({
          report: response.data,
          value: { kind: 'linked', issueNumber },
        });
        onUpdated(response.data);
        form.reset();
      } catch (err) {
        setErrorResult({ report, value: getApiErrorMessage(err) });
      }
    },
    [report, onUpdated, form],
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
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            #{report.trackingIssueNumber}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />{' '}
            <span className="sr-only">(opens in a new tab)</span>
          </a>
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
