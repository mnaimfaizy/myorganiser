'use client';

import { useCallback, useId, useState } from 'react';
import { usePathname } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { isAxiosError } from 'axios';
import { TriangleAlert } from 'lucide-react';

import {
  BottomSheetDescription,
  BottomSheetTitle,
  Button,
  Checkbox,
  DialogFooter,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  Illustration,
  cn,
  useToast,
} from '@myorganiser/web-ui';

import { readReportContext, type ReportContext } from '../utils/reportContext';
import { createFeedbackApi } from '../lib/apiClient';
import {
  FEEDBACK_DIALOG_DESCRIPTION,
  FEEDBACK_KIND_CHOICES,
  feedbackFormSchema,
  type FeedbackFormValues,
  type FeedbackReportFormVariant,
} from '../schemas/feedback-report';
import { FeedbackKindField } from './FeedbackKindField';
import { FeedbackDetailsFields } from './FeedbackDetailsFields';

interface ReportContextRowProps {
  label: string;
  value: string;
}

/**
 * Render a single row in the Report Context preview.
 */
function ReportContextRow({ label, value }: ReportContextRowProps) {
  return (
    <div className="flex gap-1.5 text-caption text-foreground-supporting">
      <span className="w-32 shrink-0 font-semibold text-foreground-secondary">
        {label}:
      </span>
      <span className="min-w-0 break-all">{value}</span>
    </div>
  );
}

interface ReportContextPreviewProps {
  context: ReportContext;
}

/**
 * Render the report context preview.
 */
function ReportContextPreview({ context }: ReportContextPreviewProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-1.5 rounded-panel border border-border bg-subtle p-4"
    >
      <h3 id={headingId} className="m-0 text-field font-semibold">
        Sent with your report
      </h3>
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
      <p className="m-0 mt-1 text-caption text-muted-foreground">
        No screenshots, logs, or vault contents are attached.
      </p>
    </section>
  );
}

export interface FeedbackReportFormProps {
  onSent: () => void;
  onCancel: () => void;
  /** Internal layout switch set by FeedbackDialog. Defaults to desktop. */
  variant?: FeedbackReportFormVariant;
}

export function FeedbackReportForm({
  onSent,
  onCancel,
  variant = 'desktop',
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
  const isPhone = variant === 'phone';
  const sendLabel = isSubmitting ? 'Sending...' : 'Send report';

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
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('flex flex-col', isPhone && 'min-h-0 flex-1')}
      >
        {/* Phone: the header bar carries Cancel and Send report, so the submit lives inside the form. */}
        {isPhone && (
          <div className="grid h-14 grid-cols-[72px_1fr_72px] items-center border-b border-border px-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleCancel}
              disabled={isSubmitting}
              className="h-11 justify-self-start px-2"
            >
              Cancel
            </Button>
            <BottomSheetTitle className="text-center text-body font-semibold">
              Send feedback
            </BottomSheetTitle>
            <Button
              type="submit"
              variant="link"
              disabled={isSubmitting}
              className="h-11 justify-self-end px-2 font-bold"
            >
              {sendLabel}
            </Button>
          </div>
        )}

        <div
          className={cn(
            'flex flex-col gap-4',
            isPhone
              ? 'min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-8'
              : 'px-6 py-5',
          )}
        >
          {/* Phone: the illustration sits beside the intro line. */}
          {isPhone && (
            <div className="flex items-center gap-3">
              <Illustration kind="feedback" size={48} />
              <BottomSheetDescription className="m-0 text-body-sm text-foreground-supporting">
                {FEEDBACK_DIALOG_DESCRIPTION}
              </BottomSheetDescription>
            </div>
          )}

          <FeedbackKindField control={form.control} variant={variant} />

          <FeedbackDetailsFields
            control={form.control}
            kind={kind}
            variant={variant}
          />

          {/* Not-encrypted warning */}
          <div
            role="note"
            className="flex items-start gap-2.5 rounded-control border border-destructive-edge bg-destructive-faint p-3 text-body-sm text-destructive-text"
          >
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-destructive"
            />
            <span>
              This report is not encrypted. Do not include passwords,
              passphrases, or anything from your vault.
            </span>
          </div>

          {/* Report Context preview */}
          <ReportContextPreview context={reportContext} />

          {/* Fix Notice opt-in */}
          <FormField
            control={form.control}
            name="fixNoticeOptIn"
            render={({ field }) => (
              <FormItem className="flex min-h-11 items-center gap-3 space-y-0">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <FormLabel className="cursor-pointer font-normal text-body">
                  Email me when this is fixed
                </FormLabel>
              </FormItem>
            )}
          />

          {/* Server error message */}
          {serverError && (
            <div
              role="alert"
              className="rounded-control border border-destructive-edge bg-destructive-faint p-3 text-body-sm text-destructive-text"
            >
              {serverError}
            </div>
          )}
        </div>

        {/* Desktop footer buttons */}
        {!isPhone && (
          <DialogFooter className="border-t border-border px-6 py-4">
            <Button
              type="button"
              variant="ghost"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={isSubmitting}>
              {sendLabel}
            </Button>
          </DialogFooter>
        )}
      </form>
    </Form>
  );
}
