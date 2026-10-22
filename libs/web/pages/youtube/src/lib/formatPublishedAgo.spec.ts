import { formatPublishedAgo } from './formatPublishedAgo';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const NOW = new Date('2026-10-22T12:00:00.000Z');

// Built the same way the implementation builds it, so the expectations hold
// on any machine locale without pinning English wording.
const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const expected = (value: number, unit: Intl.RelativeTimeFormatUnit) =>
  formatter.format(value, unit);

const publishedAgo = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('formatPublishedAgo', () => {
  it('uses the zero-second phrase for a publish time under a minute ago', () => {
    expect(formatPublishedAgo(publishedAgo(30 * SECOND), NOW)).toBe(
      expected(0, 'second'),
    );
  });

  it('switches to minutes at exactly one minute ago', () => {
    expect(formatPublishedAgo(publishedAgo(MINUTE), NOW)).toBe(
      expected(-1, 'minute'),
    );
    expect(formatPublishedAgo(publishedAgo(5 * MINUTE), NOW)).toBe(
      expected(-5, 'minute'),
    );
  });

  it('switches to hours at exactly one hour ago and stays in hours below a day', () => {
    expect(formatPublishedAgo(publishedAgo(HOUR), NOW)).toBe(
      expected(-1, 'hour'),
    );
    expect(formatPublishedAgo(publishedAgo(23 * HOUR), NOW)).toBe(
      expected(-23, 'hour'),
    );
  });

  it('switches to days at exactly 24 hours ago and stays in days below a week', () => {
    expect(formatPublishedAgo(publishedAgo(DAY), NOW)).toBe(
      expected(-1, 'day'),
    );
    expect(formatPublishedAgo(publishedAgo(6 * DAY), NOW)).toBe(
      expected(-6, 'day'),
    );
  });

  it('switches to weeks at exactly seven days ago', () => {
    expect(formatPublishedAgo(publishedAgo(7 * DAY), NOW)).toBe(
      expected(-1, 'week'),
    );
    expect(formatPublishedAgo(publishedAgo(14 * DAY), NOW)).toBe(
      expected(-2, 'week'),
    );
  });

  it('switches to months at exactly thirty days ago', () => {
    expect(formatPublishedAgo(publishedAgo(30 * DAY), NOW)).toBe(
      expected(-1, 'month'),
    );
    expect(formatPublishedAgo(publishedAgo(90 * DAY), NOW)).toBe(
      expected(-3, 'month'),
    );
  });

  it('switches to years at exactly 365 days ago', () => {
    expect(formatPublishedAgo(publishedAgo(365 * DAY), NOW)).toBe(
      expected(-1, 'year'),
    );
    expect(formatPublishedAgo(publishedAgo(2 * 365 * DAY), NOW)).toBe(
      expected(-2, 'year'),
    );
  });

  it('formats a publish time after now as an upcoming interval', () => {
    const inTwoHours = new Date(NOW.getTime() + 2 * HOUR).toISOString();
    expect(formatPublishedAgo(inTwoHours, NOW)).toBe(expected(2, 'hour'));
  });

  it('returns an empty string for an unparseable timestamp', () => {
    expect(formatPublishedAgo('not-a-date', NOW)).toBe('');
    expect(formatPublishedAgo('', NOW)).toBe('');
  });

  it('measures against the injected now rather than the wall clock', () => {
    const publishedAt = new Date(NOW.getTime() - 3 * DAY).toISOString();
    expect(formatPublishedAgo(publishedAt, NOW)).toBe(expected(-3, 'day'));
    expect(
      formatPublishedAgo(publishedAt, new Date(NOW.getTime() + 3 * DAY)),
    ).toBe(expected(-6, 'day'));
  });
});
