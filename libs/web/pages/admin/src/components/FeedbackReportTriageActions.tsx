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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@myorganiser/web-ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { isAxiosError } from 'axios';
import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { createPlatformAdminApi } from '../lib/apiClient';
import {
  formatFeedbackReportStatus,
  trackingIssueUrl,
} from '../lib/formatFeedbackReport';

interface FeedbackReportTriageActionsProps {
  report: AdminFeedbackReportDetailDto;
  onUpdated: (report: AdminFeedbackReportDetailDto) => void;
}

interface ChangeStatusFormProps {
  report: AdminFeedbackReportDetailDto;
  onUpdated: (report: AdminFeedbackReportDetailDto) => void;
}

interface TrackingIssueFormProps {
  report: AdminFeedbackReportDetailDto;
  onUpdated: (report: AdminFeedbackReportDetailDto) => void;
}

interface MarkDeliveredFormProps {
  report: AdminFeedbackReportDetailDto;
  onUpdated: (report: AdminFeedbackReportDetailDto) => void;
}

// Statuses that can be set by an admin
const ADMIN_SETTABLE_STATUSES = [
  'under_review',
  'planned',
  'wont_do',
  'cannot_reproduce',
] as const;

// Statuses that require a status note
const STATUSES_REQUIRING_NOTE = ['wont_do', 'cannot_reproduce'] as const;

const changeStatusSchema = z
  .object({
    status: z.enum(ADMIN_SETTABLE_STATUSES),
    statusNote: z.string().max(4000).optional(),
  })
  .refine(
    (data) => {
      if (
        STATUSES_REQUIRING_NOTE.includes(
          data.status as (typeof STATUSES_REQUIRING_NOTE)[number],
        )
      ) {
        return data.statusNote && data.statusNote.trim().length > 0;
      }
      return true;
    },
    {
      message: 'Write a status note explaining why.',
      path: ['statusNote'],
    },
  );

type ChangeStatusFormValues = z.infer<typeof changeStatusSchema>;

const linkIssueSchema = z.object({
  trackingIssueNumber: z
    .number()
    .int()
    .positive('Enter the tracking issue number.'),
});

type LinkIssueFormValues = z.infer<typeof linkIssueSchema>;

const markDeliveredSchema = z.object({
  releaseTag: z
    .string()
    .min(
      1,
      'Name the release this shipped in, such as v1.4.0 or mobile-v1.4.0.',
    ),
});

type MarkDeliveredFormValues = z.infer<typeof markDeliveredSchema>;

function getApiErrorMessage(err: unknown): string {
  if (isAxiosError(err)) {
    const data = err.response?.data;

    if (
      data &&
      typeof data === 'object' &&
      'message' in data &&
      typeof data.message === 'string'
    ) {
      return data.message;
    }
  }

  return 'Action failed. Please try again.';
}

function ChangeStatusForm({ report, onUpdated }: ChangeStatusFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const form = useForm<ChangeStatusFormValues>({
    resolver: zodResolver(changeStatusSchema),
    defaultValues: {
      status: 'under_review',
      statusNote: '',
    },
  });

  const onSubmit = useCallback(
    async (values: ChangeStatusFormValues) => {
      setError(null);
      setSuccess(false);

      try {
        const api = createPlatformAdminApi();
        const response = await api.changeFeedbackReportStatus({
          reportId: report.id,
          changeFeedbackReportStatusRequest: {
            status: values.status,
            statusNote: values.statusNote || undefined,
          },
        });
        onUpdated(response.data);
        setSuccess(true);
        form.reset({
          status: 'under_review',
          statusNote: '',
        });
      } catch (err) {
        setError(getApiErrorMessage(err));
      }
    },
    [report.id, onUpdated, form],
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
                  {ADMIN_SETTABLE_STATUSES.map((status) => (
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
        {success && (
          <p className="text-sm text-muted-foreground">Status updated.</p>
        )}

        <Button
          type="submit"
          disabled={form.formState.isSubmitting}
          className="w-full"
        >
          {form.formState.isSubmitting ? 'Updating…' : 'Update status'}
        </Button>
      </form>
    </Form>
  );
}

function TrackingIssueForm({ report, onUpdated }: TrackingIssueFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);

  const form = useForm<LinkIssueFormValues>({
    resolver: zodResolver(linkIssueSchema),
    defaultValues: {
      trackingIssueNumber: undefined,
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

  const handleNumberChange = useCallback(
    (
      e: React.ChangeEvent<HTMLInputElement>,
      onChange: (value: number | undefined) => void,
    ) => {
      onChange(e.target.value ? parseInt(e.target.value, 10) : undefined);
    },
    [],
  );

  const onSubmit = useCallback(
    async (values: LinkIssueFormValues) => {
      setError(null);
      setSuccess(false);

      try {
        const api = createPlatformAdminApi();
        const response = await api.linkFeedbackReportTrackingIssue({
          reportId: report.id,
          linkFeedbackReportTrackingIssueRequest: {
            trackingIssueNumber: values.trackingIssueNumber,
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
          <p className="font-medium">Linked to issue:</p>
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
                <Input
                  type="number"
                  placeholder="Issue number"
                  {...field}
                  onChange={(e) => handleNumberChange(e, field.onChange)}
                />
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

function MarkDeliveredForm({ report, onUpdated }: MarkDeliveredFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const form = useForm<MarkDeliveredFormValues>({
    resolver: zodResolver(markDeliveredSchema),
    defaultValues: {
      releaseTag: '',
    },
  });

  const onSubmit = useCallback(
    async (values: MarkDeliveredFormValues) => {
      setError(null);
      setSuccess(false);

      try {
        const api = createPlatformAdminApi();
        const response = await api.markFeedbackReportDelivered({
          reportId: report.id,
          markFeedbackReportDeliveredRequest: {
            releaseTag: values.releaseTag,
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

  // Get the button label based on report kind
  const buttonLabel = `Mark ${report.kind === 'suggestion' ? 'shipped' : 'fixed'}`;

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
                <Input placeholder="v1.4.0" {...field} />
              </FormControl>
              <FormDescription>
                Use this for a fix with no tracking issue, and for a mobile
                release.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && (
          <p className="text-sm text-muted-foreground">Release recorded.</p>
        )}

        <Button
          type="submit"
          disabled={form.formState.isSubmitting}
          className="w-full"
        >
          {form.formState.isSubmitting ? 'Processing…' : buttonLabel}
        </Button>
      </form>
    </Form>
  );
}

export function FeedbackReportTriageActions({
  report,
  onUpdated,
}: FeedbackReportTriageActionsProps) {
  return (
    <section className="max-w-2xl space-y-8">
      <div className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Change status</h2>
        <ChangeStatusForm report={report} onUpdated={onUpdated} />
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Tracking issue</h2>
        <TrackingIssueForm report={report} onUpdated={onUpdated} />
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">
          Mark {report.kind === 'suggestion' ? 'shipped' : 'fixed'}
        </h2>
        <MarkDeliveredForm report={report} onUpdated={onUpdated} />
      </div>
    </section>
  );
}
