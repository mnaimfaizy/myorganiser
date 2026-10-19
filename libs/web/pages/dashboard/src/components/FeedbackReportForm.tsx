'use client';

import { useCallback, useState } from 'react';
import { usePathname } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { isAxiosError } from 'axios';

import { FeedbackReportKind } from '@myorganiser/app-api-client';
import {
  FEEDBACK_REPORT_TITLE_MAX_LENGTH,
  FEEDBACK_REPORT_TEXT_MAX_LENGTH,
  FEEDBACK_REPORT_CAP_MESSAGES,
  FEEDBACK_REPORT_REQUIRED_MESSAGES,
} from '@myorganiser/core';
import {
  Button,
  Checkbox,
  DialogFooter,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
  useToast,
} from '@myorganiser/web-ui';

import { readReportContext, type ReportContext } from '../utils/reportContext';
import { createFeedbackApi } from '../lib/apiClient';

interface FeedbackKindChoice {
  label: string;
  hint: string;
  descriptionLabel: string;
  asksExpectedOutcome: boolean;
}

/**
 * The one table this form fans out over the report kind with (ADR 0053):
 * the choice labels, and the fact that only a Bug Report asks what the sender
 * expected to happen. A third kind fails to compile here until it has a home.
 */
const FEEDBACK_KIND_CHOICES = {
  bug_report: {
    label: 'Bug report',
    hint: "Something isn't working as it should.",
    descriptionLabel: 'What happened?',
    asksExpectedOutcome: true,
  },
  suggestion: {
    label: 'Suggestion',
    hint: 'An improvement or a new feature.',
    descriptionLabel: 'What would you like to see?',
    asksExpectedOutcome: false,
  },
} as const satisfies Record<FeedbackReportKind, FeedbackKindChoice>;

// Derive enum values from the pinned table (ADR 0053 — do not re-enumerate).
const FEEDBACK_KIND_VALUES = Object.keys(FEEDBACK_KIND_CHOICES) as [
  FeedbackReportKind,
  ...FeedbackReportKind[],
];

const feedbackFormSchema = z.object({
  kind: z.enum(FEEDBACK_KIND_VALUES),
  title: z
    .string()
    .trim()
    .min(1, FEEDBACK_REPORT_REQUIRED_MESSAGES.title)
    .max(FEEDBACK_REPORT_TITLE_MAX_LENGTH, FEEDBACK_REPORT_CAP_MESSAGES.title),
  description: z
    .string()
    .trim()
    .min(1, FEEDBACK_REPORT_REQUIRED_MESSAGES.description)
    .max(
      FEEDBACK_REPORT_TEXT_MAX_LENGTH,
      FEEDBACK_REPORT_CAP_MESSAGES.description,
    ),
  expectedOutcome: z
    .string()
    .trim()
    .max(
      FEEDBACK_REPORT_TEXT_MAX_LENGTH,
      FEEDBACK_REPORT_CAP_MESSAGES.expectedOutcome,
    ),
  fixNoticeOptIn: z.boolean(),
});

type FeedbackFormValues = z.infer<typeof feedbackFormSchema>;

interface ReportContextRowProps {
  label: string;
  value: string;
}

/**
 * Render a single row in the Report Context preview.
 */
function ReportContextRow({ label, value }: ReportContextRowProps) {
  return (
    <div className="flex gap-2">
      <span className="font-medium text-muted-foreground min-w-fit">
        {label}:
      </span>
      <span className="break-all">{value}</span>
    </div>
  );
}

interface KindChoiceFieldsetProps {
  kind: FeedbackReportKind;
  onKindChange: (kind: FeedbackReportKind) => void;
}

/**
 * Render the kind choice as a native radio group.
 */
function KindChoiceFieldset({ kind, onKindChange }: KindChoiceFieldsetProps) {
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onKindChange(event.target.value as FeedbackReportKind);
    },
    [onKindChange],
  );

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">
        What kind of feedback is this?
      </legend>
      <div className="space-y-2">
        {Object.entries(FEEDBACK_KIND_CHOICES).map(([kindValue, choice]) => (
          <label
            key={kindValue}
            className="flex items-start gap-3 rounded-md border border-input px-3 py-2 hover:bg-muted/50 cursor-pointer"
          >
            <input
              type="radio"
              name="kind"
              value={kindValue}
              checked={kind === kindValue}
              onChange={handleChange}
              className="mt-1"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{choice.label}</div>
              <div className="text-xs text-muted-foreground">{choice.hint}</div>
            </div>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface ReportContextPreviewProps {
  context: ReportContext;
}

/**
 * Render the report context preview.
 */
function ReportContextPreview({ context }: ReportContextPreviewProps) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Sent with your report</div>
      <div className="rounded-md bg-muted p-3 text-xs space-y-1">
        <ReportContextRow
          label="App"
          value={`MyOrganiser ${context.platform} ${context.appVersion}`}
        />
        <ReportContextRow label="Browser" value={context.browser} />
        <ReportContextRow
          label="Operating system"
          value={context.operatingSystem}
        />
        <ReportContextRow label="Page" value={context.path} />
        <ReportContextRow
          label="Time"
          value={new Date(context.sentAt).toLocaleString()}
        />
      </div>
      <div className="text-xs text-muted-foreground">
        No screenshots, logs, or vault contents are attached.
      </div>
    </div>
  );
}

export interface FeedbackReportFormProps {
  onSent: () => void;
  onCancel: () => void;
}

export function FeedbackReportForm({
  onSent,
  onCancel,
}: FeedbackReportFormProps) {
  const pathname = usePathname();
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);

  // Capture report context once at mount, so the form shows and sends the same values.
  const [reportContext] = useState(() => readReportContext(pathname));

  const form = useForm<FeedbackFormValues>({
    resolver: zodResolver(feedbackFormSchema),
    defaultValues: {
      kind: 'bug_report',
      title: '',
      description: '',
      expectedOutcome: '',
      fixNoticeOptIn: true,
    },
  });

  const kind = useWatch({ control: form.control, name: 'kind' });
  const kindChoice = FEEDBACK_KIND_CHOICES[kind];
  const { isSubmitting } = form.formState;

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  const onSubmit = useCallback(
    async (values: FeedbackFormValues) => {
      setServerError(null);

      try {
        // Only a Bug Report carries expectedOutcome, and only if non-empty.
        let expectedOutcome: string | undefined = undefined;
        if (
          kindChoice.asksExpectedOutcome &&
          values.expectedOutcome.trim().length > 0
        ) {
          expectedOutcome = values.expectedOutcome;
        }

        await createFeedbackApi().createReport({
          createFeedbackReportRequest: {
            kind: values.kind,
            title: values.title,
            description: values.description,
            ...(expectedOutcome !== undefined && { expectedOutcome }),
            context: {
              platform: reportContext.platform,
              appVersion: reportContext.appVersion,
              browser: reportContext.browser,
              operatingSystem: reportContext.operatingSystem,
              path: reportContext.path,
              sentAt: reportContext.sentAt,
            },
            fixNoticeOptIn: values.fixNoticeOptIn,
          },
        });

        // Success: show toast and close dialog.
        toast({
          title: 'Report received',
          description: "Thanks — we'll look at it.",
        });
        onSent();
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
          message ?? 'Your report could not be sent. Please try again.',
        );
      }
    },
    [kindChoice, toast, onSent, reportContext],
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Kind choice as native radio group */}
        <FormField
          control={form.control}
          name="kind"
          render={({ field }) => (
            <FormItem>
              <KindChoiceFieldset
                kind={field.value}
                onKindChange={field.onChange}
              />
            </FormItem>
          )}
        />

        {/* Title field */}
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input
                  placeholder="Brief summary of your feedback"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Description field */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{kindChoice.descriptionLabel}</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Please provide details..."
                  rows={4}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Expected outcome field — only for bug reports */}
        {kindChoice.asksExpectedOutcome && (
          <FormField
            control={form.control}
            name="expectedOutcome"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  What did you expect to happen?{' '}
                  <span className="text-xs text-muted-foreground font-normal">
                    (optional)
                  </span>
                </FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Describe what should have happened instead..."
                    rows={3}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Not-encrypted warning */}
        <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
          This report is not encrypted. Do not include passwords, passphrases,
          or anything from your vault.
        </div>

        {/* Report Context preview */}
        <ReportContextPreview context={reportContext} />

        {/* Fix Notice opt-in */}
        <FormField
          control={form.control}
          name="fixNoticeOptIn"
          render={({ field }) => (
            <FormItem className="flex items-center gap-2 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <FormLabel className="font-normal cursor-pointer">
                Email me when this is fixed
              </FormLabel>
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

        {/* Footer buttons */}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Sending...' : 'Send report'}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
