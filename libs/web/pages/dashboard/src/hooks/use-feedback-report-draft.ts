import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type UseFormReturn } from 'react-hook-form';

import {
  feedbackFormSchema,
  type FeedbackFormValues,
} from '../schemas/feedback-report';

/**
 * Form state that outlives one rendering of the form. FeedbackDialog owns it
 * above the Dialog/BottomSheet swap so crossing the phone/desktop breakpoint
 * remounts the layout without losing what the user typed.
 */
export interface FeedbackReportDraft {
  form: UseFormReturn<FeedbackFormValues>;
  serverError: string | null;
  setServerError: (message: string | null) => void;
}

/**
 * Own the draft of a Feedback Report. While `isActive` is false (the dialog is
 * closed) the draft is cleared, so reopening starts from a blank form.
 */
export function useFeedbackReportDraft(isActive = true): FeedbackReportDraft {
  const [serverError, setServerError] = useState<string | null>(null);

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

  // Adjust state during render (not in an effect) when the dialog closes.
  if (!isActive && serverError !== null) {
    setServerError(null);
  }

  const { reset } = form;
  useEffect(() => {
    if (!isActive) {
      reset();
    }
  }, [isActive, reset]);

  return { form, serverError, setServerError };
}
