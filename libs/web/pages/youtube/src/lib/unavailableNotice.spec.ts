import type { YouTubeAvailabilityState } from '@myorganiser/web-youtube';
import {
  formatWithdrawalDate,
  toUnavailableNoticeProps,
} from './unavailableNotice';

type AvailabilityView = Pick<YouTubeAvailabilityState, 'access' | 'error'>;

const WITHDRAWN_AT = '2026-10-14T09:00:00.000Z';
const NOW = new Date('2026-11-07T12:00:00.000Z');

describe('toUnavailableNoticeProps', () => {
  it('returns withdrawn with the withdrawal time for withdrawn access', () => {
    const state: AvailabilityView = {
      access: { state: 'withdrawn', withdrawnAt: WITHDRAWN_AT },
      error: null,
    };

    expect(toUnavailableNoticeProps(state)).toEqual({
      reason: 'withdrawn',
      withdrawnAt: WITHDRAWN_AT,
    });
  });

  it('returns withdrawn with a null time when withdrawn access has no recorded date', () => {
    const state: AvailabilityView = {
      access: { state: 'withdrawn', withdrawnAt: null },
      error: null,
    };

    expect(toUnavailableNoticeProps(state)).toEqual({
      reason: 'withdrawn',
      withdrawnAt: null,
    });
  });

  it('gives withdrawn precedence over an error, so a failed re-check does not become Try again', () => {
    const state: AvailabilityView = {
      access: { state: 'withdrawn', withdrawnAt: WITHDRAWN_AT },
      error: new Error('network blip'),
    };

    expect(toUnavailableNoticeProps(state)).toEqual({
      reason: 'withdrawn',
      withdrawnAt: WITHDRAWN_AT,
    });
  });

  it.each([
    ['null access', null],
    [
      'not_granted access',
      { state: 'not_granted' as const, withdrawnAt: null },
    ],
    ['granted access', { state: 'granted' as const, withdrawnAt: null }],
  ])('returns unreachable when the check errored with %s', (_label, access) => {
    const state: AvailabilityView = {
      access,
      error: new Error('Service unavailable'),
    };

    expect(toUnavailableNoticeProps(state)).toEqual({
      reason: 'unreachable',
    });
  });

  it.each([
    ['null access', null],
    [
      'not_granted access',
      { state: 'not_granted' as const, withdrawnAt: null },
    ],
  ])('returns unavailable with no error and %s', (_label, access) => {
    const state: AvailabilityView = { access, error: null };

    expect(toUnavailableNoticeProps(state)).toEqual({
      reason: 'unavailable',
    });
  });
});

describe('formatWithdrawalDate', () => {
  it('formats a withdrawal in the current year as day and short month', () => {
    expect(formatWithdrawalDate('2026-10-14T12:00:00.000Z', NOW)).toBe(
      '14 Oct',
    );
  });

  it('appends the year when the withdrawal is in a different year', () => {
    expect(formatWithdrawalDate('2025-10-14T12:00:00.000Z', NOW)).toBe(
      '14 Oct 2025',
    );
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
  ])('returns null for %s', (_label, iso) => {
    expect(formatWithdrawalDate(iso, NOW)).toBeNull();
  });

  it('returns null for an unparsable timestamp', () => {
    expect(formatWithdrawalDate('not-a-date', NOW)).toBeNull();
  });
});
