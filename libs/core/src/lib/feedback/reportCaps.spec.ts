import { describe, expect, it } from '@jest/globals';

import {
  FEEDBACK_REPORT_CAP_MESSAGES,
  FEEDBACK_REPORT_REQUIRED_MESSAGES,
  FEEDBACK_REPORT_RATE_WINDOW_MS,
  FEEDBACK_REPORT_TEXT_MAX_LENGTH,
  FEEDBACK_REPORT_TITLE_MAX_LENGTH,
  FEEDBACK_REPORTS_PER_DAY_LIMIT,
  formatFeedbackReportCap,
} from './reportCaps';

describe('Feedback Report Caps', () => {
  describe('length caps', () => {
    it('holds the agreed title max length', () => {
      expect(FEEDBACK_REPORT_TITLE_MAX_LENGTH).toBe(120);
    });

    it('holds the agreed text max length', () => {
      expect(FEEDBACK_REPORT_TEXT_MAX_LENGTH).toBe(4000);
    });
  });

  describe('rate limit', () => {
    it('holds the agreed reports-per-day limit', () => {
      expect(FEEDBACK_REPORTS_PER_DAY_LIMIT).toBe(10);
    });

    it('holds the agreed 24-hour rate window in milliseconds', () => {
      const expectedMs = 24 * 60 * 60 * 1000;
      expect(FEEDBACK_REPORT_RATE_WINDOW_MS).toBe(expectedMs);
    });
  });

  describe('formatFeedbackReportCap', () => {
    it('formats 120 without thousand separator', () => {
      expect(formatFeedbackReportCap(120)).toBe('120');
    });

    it('formats 4000 with thousand separator', () => {
      expect(formatFeedbackReportCap(4000)).toBe('4,000');
    });
  });

  describe('FEEDBACK_REPORT_CAP_MESSAGES', () => {
    it('holds the agreed title cap message', () => {
      expect(FEEDBACK_REPORT_CAP_MESSAGES.title).toBe(
        'The title must be 120 characters or fewer.',
      );
    });

    it('holds the agreed description cap message', () => {
      expect(FEEDBACK_REPORT_CAP_MESSAGES.description).toBe(
        'The description must be 4,000 characters or fewer.',
      );
    });

    it('holds the agreed expected outcome cap message', () => {
      expect(FEEDBACK_REPORT_CAP_MESSAGES.expectedOutcome).toBe(
        'What you expected must be 4,000 characters or fewer.',
      );
    });
  });

  describe('FEEDBACK_REPORT_REQUIRED_MESSAGES', () => {
    it('holds the agreed title required message', () => {
      expect(FEEDBACK_REPORT_REQUIRED_MESSAGES.title).toBe('Enter a title.');
    });

    it('holds the agreed description required message', () => {
      expect(FEEDBACK_REPORT_REQUIRED_MESSAGES.description).toBe(
        'Enter a description.',
      );
    });
  });
});
