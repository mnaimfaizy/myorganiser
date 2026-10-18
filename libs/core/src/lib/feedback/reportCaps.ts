/**
 * The length caps a Feedback Report's typed fields carry, and the copy that
 * refuses a field over one.
 *
 * They live here because both sides of the boundary enforce them and must
 * agree: the dialog's Zod schema refuses before sending, and the backend
 * refuses again with 400 (PRD #1206). Held in one place, raising a cap is one
 * edit; held in two, a client that trusts the old number sends a report the
 * server rejects with a message the form was supposed to have shown.
 *
 * The rolling-window limit is here for the same reason — the dialog tells the
 * User "more than 10 in a day" in its own words, and the server counts stored
 * rows against the same number.
 */

export const FEEDBACK_REPORT_TITLE_MAX_LENGTH = 120;
export const FEEDBACK_REPORT_TEXT_MAX_LENGTH = 4000;
export const FEEDBACK_REPORT_FOLLOW_UP_MAX_LENGTH = 2000;

/** How many reports one User may send inside `FEEDBACK_REPORT_RATE_WINDOW_MS`. */
export const FEEDBACK_REPORTS_PER_DAY_LIMIT = 10;
export const FEEDBACK_REPORT_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * A cap in the reporter's own reading, so "4000" is never written as "4,000"
 * in one place and "4000" in another.
 */
export function formatFeedbackReportCap(cap: number): string {
  return cap.toLocaleString('en-US');
}

/**
 * The refusal for one over-long field, built from the cap rather than written
 * out with the number in it. Both the Zod schema and the service read these,
 * so the User sees the same sentence whichever side refuses.
 */
export const FEEDBACK_REPORT_CAP_MESSAGES = {
  title: `The title must be ${formatFeedbackReportCap(FEEDBACK_REPORT_TITLE_MAX_LENGTH)} characters or fewer.`,
  description: `The description must be ${formatFeedbackReportCap(FEEDBACK_REPORT_TEXT_MAX_LENGTH)} characters or fewer.`,
  expectedOutcome: `What you expected must be ${formatFeedbackReportCap(FEEDBACK_REPORT_TEXT_MAX_LENGTH)} characters or fewer.`,
  followUp: `Your follow-up must be ${formatFeedbackReportCap(FEEDBACK_REPORT_FOLLOW_UP_MAX_LENGTH)} characters or fewer.`,
} as const;

/** The refusals for a required field left empty, shared for the same reason. */
export const FEEDBACK_REPORT_REQUIRED_MESSAGES = {
  title: 'Enter a title.',
  description: 'Enter a description.',
  followUp: 'Enter a follow-up.',
} as const;
