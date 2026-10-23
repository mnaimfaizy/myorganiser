'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Checkbox,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@myorganiser/web-ui';
import Link from 'next/link';
import { useCallback, useId } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

/**
 * What the User agrees to before a first connect (ADR 0129). Plain copy, in the
 * terms CONTEXT.md uses: YouTube Disconnect, Vault, Cached Upload, Watched.
 */
const ACKNOWLEDGEMENT_POINTS = [
  'MyOrganiser reads your YouTube subscriptions and the channel and upload details for the channels you enable. It only reads from YouTube, and it never stores video files.',
  'That data is stored outside your Vault and is not end-to-end encrypted. Your YouTube access tokens are encrypted at rest.',
  'Google will show an "unverified app" warning when you connect. MyOrganiser is run personally and has not been through Google\'s app verification.',
  'If you disconnect YouTube, or the operator withdraws your YouTube access, everything is deleted straight away: your followed channels, cached uploads, Watched marks, digest settings and tokens. Nothing is kept for a later reconnect.',
  'YouTube in MyOrganiser is run personally by its operator, who can switch it off.',
] as const;

const acknowledgementSchema = z.object({
  accepted: z.literal(true, {
    error: 'Tick the box to agree before connecting',
  }),
});

type AcknowledgementFormValues = z.infer<typeof acknowledgementSchema>;

interface YouTubeAcknowledgementFormProps {
  /** Stores the acknowledgement, then connects. Its failure is shown through submitError. */
  onAccept: () => Promise<void>;
  submitError: string | null;
}

/**
 * The first-connect acknowledgement card. The Connect YouTube submit stays
 * disabled until the box is ticked.
 */
export function YouTubeAcknowledgementForm({
  onAccept,
  submitError,
}: YouTubeAcknowledgementFormProps) {
  const headingId = useId();
  const form = useForm<AcknowledgementFormValues>({
    resolver: zodResolver(acknowledgementSchema),
  });
  const { isSubmitting } = form.formState;
  const accepted = useWatch({ control: form.control, name: 'accepted' });

  const handleAcceptedChange = useCallback(
    (checked: boolean | 'indeterminate') => {
      if (checked === true) {
        form.setValue('accepted', true);
      } else {
        form.resetField('accepted');
      }
    },
    [form],
  );

  return (
    <Form {...form}>
      <form
        aria-labelledby={headingId}
        onSubmit={form.handleSubmit(onAccept)}
        className="flex min-w-0 flex-[1.3_1_420px] flex-col gap-4 rounded-panel border-2 border-brand bg-raised-surface p-6"
      >
        <h2
          id={headingId}
          className="m-0 font-display text-title text-foreground"
        >
          Before you connect
        </h2>
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {ACKNOWLEDGEMENT_POINTS.map((point, index) => (
            <li
              key={point}
              className="flex items-start gap-3 text-body text-foreground-secondary"
            >
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-control-sm bg-brand-soft text-caption font-bold text-brand-text"
              >
                {index + 1}
              </span>
              <span>{point}</span>
            </li>
          ))}
        </ol>
        <FormField
          control={form.control}
          name="accepted"
          render={({ field }) => (
            <FormItem className="space-y-2">
              <div className="flex items-start gap-3 rounded-control border border-border bg-background p-3.5">
                <FormControl>
                  <Checkbox
                    checked={field.value === true}
                    onCheckedChange={handleAcceptedChange}
                    disabled={isSubmitting}
                    ref={field.ref}
                  />
                </FormControl>
                <FormLabel className="cursor-pointer text-body-sm font-normal leading-relaxed text-foreground-supporting">
                  I agree to the{' '}
                  <Link href="/privacy" className="underline">
                    Privacy Policy
                  </Link>{' '}
                  and to{' '}
                  <a
                    href="https://www.youtube.com/t/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    YouTube&apos;s Terms of Service
                    <span aria-hidden="true"> ↗</span>
                  </a>
                  .
                </FormLabel>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        {submitError ? (
          <p role="alert" className="text-body-sm text-destructive-text">
            {submitError}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="brand"
          size="lg"
          className="w-full disabled:opacity-45"
          disabled={!accepted || isSubmitting}
        >
          Connect YouTube
        </Button>
      </form>
    </Form>
  );
}
