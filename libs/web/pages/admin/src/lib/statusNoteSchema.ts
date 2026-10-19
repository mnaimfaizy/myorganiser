import {
  FEEDBACK_REPORT_TEXT_MAX_LENGTH,
  formatFeedbackReportCap,
} from '@myorganiser/core';
import { z } from 'zod';

/** Shown when an admin's status note exceeds the report text cap. */
export const STATUS_NOTE_TOO_LONG_MESSAGE = `The status note must be ${formatFeedbackReportCap(FEEDBACK_REPORT_TEXT_MAX_LENGTH)} characters or fewer.`;

/** Shown when a status that requires a note is submitted without one. */
export const STATUS_NOTE_REQUIRED_MESSAGE =
  'Write a status note explaining why.';

/** A trimmed status note, capped at the report text limit. May be empty. */
export const statusNoteSchema = z
  .string()
  .trim()
  .max(FEEDBACK_REPORT_TEXT_MAX_LENGTH, STATUS_NOTE_TOO_LONG_MESSAGE);

/** A trimmed status note that must contain at least one character. */
export const requiredStatusNoteSchema = statusNoteSchema.min(
  1,
  STATUS_NOTE_REQUIRED_MESSAGE,
);
