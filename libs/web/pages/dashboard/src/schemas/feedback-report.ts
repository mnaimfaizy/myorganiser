import { z } from 'zod';

import { FeedbackReportKind } from '@myorganiser/app-api-client';
import {
  FEEDBACK_REPORT_TITLE_MAX_LENGTH,
  FEEDBACK_REPORT_TEXT_MAX_LENGTH,
  FEEDBACK_REPORT_CAP_MESSAGES,
  FEEDBACK_REPORT_REQUIRED_MESSAGES,
} from '@myorganiser/core';

export interface FeedbackKindChoice {
  label: string;
  hint: string;
  descriptionLabel: string;
  asksExpectedOutcome: boolean;
}

/**
 * The one table the feedback form fans out over the report kind with (ADR 0053):
 * the choice labels, and the fact that only a Bug Report asks what the sender
 * expected to happen. A third kind fails to compile here until it has a home.
 */
export const FEEDBACK_KIND_CHOICES = {
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

export const feedbackFormSchema = z.object({
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

export type FeedbackFormValues = z.infer<typeof feedbackFormSchema>;

/** Desktop lays the form out in the 640px Dialog; phone in the full-height sheet. */
export type FeedbackReportFormVariant = 'desktop' | 'phone';
