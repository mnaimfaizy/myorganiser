import { describe, expect, jest, test } from '@jest/globals';
import { toYouTubeAccessResponse } from './YouTubeController';

// The controller module imports the YouTube services and UserService; none of
// them run here, so they are stubbed to keep this a pure unit test of the
// access-state derivation.
jest.mock('../services/UserService', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../services/YouTubeDigestService', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../services/YouTubeSyncWorkerService', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../services/YouTubeSyncService', () => ({
  __esModule: true,
  default: {},
}));

const FIRST_GRANTED_AT = new Date('2025-01-01T00:00:00.000Z');
const WITHDRAWN_AT = new Date('2026-06-15T12:30:00.000Z');

describe('toYouTubeAccessResponse', () => {
  test('a current grant reads as granted with no withdrawnAt, even when stale withdrawal fields are set', () => {
    expect(
      toYouTubeAccessResponse({
        youtube_access: true,
        youtube_access_first_granted_at: FIRST_GRANTED_AT,
        youtube_access_withdrawn_at: WITHDRAWN_AT,
      }),
    ).toStrictEqual({ granted: true, state: 'granted' });
  });

  test('a withdrawn grant reads as withdrawn with the ISO withdrawal time', () => {
    expect(
      toYouTubeAccessResponse({
        youtube_access: false,
        youtube_access_first_granted_at: FIRST_GRANTED_AT,
        youtube_access_withdrawn_at: WITHDRAWN_AT,
      }),
    ).toStrictEqual({
      granted: false,
      state: 'withdrawn',
      withdrawnAt: '2026-06-15T12:30:00.000Z',
    });
  });

  test('a User withdrawn before the withdrawal column existed reads as withdrawn without withdrawnAt', () => {
    const response = toYouTubeAccessResponse({
      youtube_access: false,
      youtube_access_first_granted_at: FIRST_GRANTED_AT,
      youtube_access_withdrawn_at: null,
    });

    expect(response).toStrictEqual({ granted: false, state: 'withdrawn' });
    expect(response).not.toHaveProperty('withdrawnAt');
  });

  test('a stale withdrawal time without a first grant still reads as not_granted without withdrawnAt', () => {
    const response = toYouTubeAccessResponse({
      youtube_access: false,
      youtube_access_first_granted_at: null,
      youtube_access_withdrawn_at: WITHDRAWN_AT,
    });

    expect(response).toStrictEqual({ granted: false, state: 'not_granted' });
    expect(response).not.toHaveProperty('withdrawnAt');
  });

  test('a never-granted User reads as not_granted without withdrawnAt', () => {
    const response = toYouTubeAccessResponse({
      youtube_access: false,
      youtube_access_first_granted_at: null,
      youtube_access_withdrawn_at: null,
    });

    expect(response).toStrictEqual({ granted: false, state: 'not_granted' });
    expect(response).not.toHaveProperty('withdrawnAt');
  });

  test('absent access fields read as not_granted', () => {
    const response = toYouTubeAccessResponse({});

    expect(response).toStrictEqual({ granted: false, state: 'not_granted' });
    expect(response).not.toHaveProperty('withdrawnAt');
  });
});
