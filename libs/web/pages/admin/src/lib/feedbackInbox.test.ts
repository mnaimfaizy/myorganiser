import type {
  FeedbackReportPlatform,
  FeedbackReportStatus,
} from '@myorganiser/app-api-client';
import type { StatusPillTone } from '@myorganiser/web-ui';

import {
  countFeedbackSheetFilters,
  FEEDBACK_REPORT_PLATFORMS,
  type FeedbackInboxFilters,
  formatFeedbackInboxPhoneSubtitle,
  formatFeedbackInboxSubtitle,
  formatFeedbackPhoneSent,
  formatFeedbackReportPlatform,
  formatFeedbackShowingRange,
  isFeedbackInboxFiltered,
  NO_FEEDBACK_INBOX_FILTERS,
  parseTrackingIssueFilter,
} from './feedbackInbox';
import { getStatusPillTone } from './formatFeedbackReport';

const NOW = new Date(2026, 9, 22, 15, 0);

function filtersWith(
  overrides: Partial<FeedbackInboxFilters>,
): FeedbackInboxFilters {
  return { ...NO_FEEDBACK_INBOX_FILTERS, ...overrides };
}

describe('parseTrackingIssueFilter', () => {
  it.each<[string, number]>([
    ['12', 12],
    [' 12 ', 12],
  ])('reads %p as issue number %p', (text, expected) => {
    expect(parseTrackingIssueFilter(text)).toBe(expected);
  });

  it.each<string>(['', '0', '-3', '1.5', 'abc', '12a'])(
    'ignores %p because it is not a whole number from 1',
    (text) => {
      expect(parseTrackingIssueFilter(text)).toBeUndefined();
    },
  );
});

describe('isFeedbackInboxFiltered', () => {
  it('is false with no filters set', () => {
    expect(isFeedbackInboxFiltered(NO_FEEDBACK_INBOX_FILTERS)).toBe(false);
  });

  it('is false when the tracking issue text is not a number', () => {
    expect(isFeedbackInboxFiltered(filtersWith({ trackingIssue: 'abc' }))).toBe(
      false,
    );
  });

  it.each<[string, Partial<FeedbackInboxFilters>]>([
    ['status', { status: 'planned' }],
    ['kind', { kind: 'bug_report' }],
    ['platform', { platform: 'ios' }],
    ['a valid tracking issue', { trackingIssue: '42' }],
  ])('is true when %s is set', (_label, overrides) => {
    expect(isFeedbackInboxFiltered(filtersWith(overrides))).toBe(true);
  });
});

describe('countFeedbackSheetFilters', () => {
  it('counts kind, platform and a valid tracking issue', () => {
    expect(
      countFeedbackSheetFilters(
        filtersWith({
          kind: 'suggestion',
          platform: 'android',
          trackingIssue: '7',
        }),
      ),
    ).toBe(3);
  });

  it('ignores status and tracking issue text that is not a number', () => {
    expect(
      countFeedbackSheetFilters(
        filtersWith({ status: 'received', trackingIssue: 'abc' }),
      ),
    ).toBe(0);
  });
});

describe('formatFeedbackShowingRange', () => {
  it.each<[string, [number, number, number, number, boolean], string]>([
    [
      'filtered first page',
      [1, 25, 5, 5, true],
      'Showing 1–5 of 5 matching reports',
    ],
    [
      'unfiltered second page',
      [2, 25, 5, 30, false],
      'Showing 26–30 of 30 reports',
    ],
    ['zero rows', [1, 25, 0, 0, false], 'Showing 0 of 0 reports'],
  ])('%s', (_label, [page, pageSize, shown, total, filtered], expected) => {
    expect(
      formatFeedbackShowingRange(page, pageSize, shown, total, filtered),
    ).toBe(expected);
  });
});

describe('formatFeedbackInboxSubtitle', () => {
  const lead = 'Bug Reports and Suggestions, newest first.';

  it('shows only the lead sentence until the Received count is known', () => {
    expect(formatFeedbackInboxSubtitle(undefined)).toBe(lead);
  });

  it.each<[number, string]>([
    [5, `${lead} 5 are Received and waiting for triage.`],
    [1, `${lead} 1 is Received and waiting for triage.`],
    [0, `${lead} 0 are Received and waiting for triage.`],
  ])('reads %p Received with the right verb', (count, expected) => {
    expect(formatFeedbackInboxSubtitle(count)).toBe(expected);
  });
});

describe('formatFeedbackInboxPhoneSubtitle', () => {
  it('is null until the Received count is known', () => {
    expect(formatFeedbackInboxPhoneSubtitle(undefined)).toBeNull();
  });

  it('reads the Received count', () => {
    expect(formatFeedbackInboxPhoneSubtitle(5)).toBe(
      '5 Received, waiting for triage',
    );
  });
});

describe('formatFeedbackPhoneSent', () => {
  it('shows the clock time for a report sent on the same local day', () => {
    const iso = new Date(2026, 9, 22, 10, 42).toISOString();
    expect(formatFeedbackPhoneSent(iso, NOW)).toBe('10:42');
  });

  it('shows "Yesterday" for a report sent on the previous local day', () => {
    const iso = new Date(2026, 9, 21, 23, 30).toISOString();
    expect(formatFeedbackPhoneSent(iso, NOW)).toBe('Yesterday');
  });

  it('shows day and month for an older report in the same year', () => {
    const iso = new Date(2026, 9, 17, 8, 0).toISOString();
    expect(formatFeedbackPhoneSent(iso, NOW)).toBe('17 Oct');
  });

  it('includes the year for a report from a previous year', () => {
    const iso = new Date(2025, 11, 31, 9, 0).toISOString();
    expect(formatFeedbackPhoneSent(iso, NOW)).toBe('31 Dec 2025');
  });
});

describe('platform labels', () => {
  it('lists the platforms in web, iOS, Android order', () => {
    expect(FEEDBACK_REPORT_PLATFORMS).toEqual(['web', 'ios', 'android']);
  });

  it.each<[FeedbackReportPlatform, string]>([
    ['web', 'Web'],
    ['ios', 'iOS'],
    ['android', 'Android'],
  ])('labels %p as %p', (platform, label) => {
    expect(formatFeedbackReportPlatform(platform)).toBe(label);
  });
});

describe('getStatusPillTone', () => {
  it.each<[FeedbackReportStatus, StatusPillTone]>([
    ['received', 'neutral'],
    ['under_review', 'neutral'],
    ['planned', 'brand'],
    ['fixed', 'trust'],
    ['shipped', 'trust'],
    ['wont_do', 'danger'],
    ['cannot_reproduce', 'warning'],
  ])('tones %p as %p', (status, tone) => {
    expect(getStatusPillTone(status)).toBe(tone);
  });
});
