import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';
import bodyParser from 'body-parser';
import express from 'express';
import request from 'supertest';
import { ValidateError } from 'tsoa';

jest.setTimeout(30_000);

jest.mock('../helpers/PlatformTokenHandler', () => ({
  __esModule: true,
  PlatformTokenHandler: {
    issueLoginSession: jest.fn(),
  },
  default: {
    issueLoginSession: jest.fn(),
  },
}));

jest.mock('../utils/passport', () => ({
  __esModule: true,
  default: {
    authenticate: () => (_req: any, _res: any, next: any) => next(),
  },
}));

const CRON_SECRET = 'test-youtube-cron-secret';
const ACKNOWLEDGED_AT = new Date('2026-10-01T09:30:00.000Z');

// The real expressAuthentication runs (so the youtube_access scope is really
// enforced). Only its boundaries are stubbed: the JWT decode and the User lookup.
// The token 'test' decodes to user-1; any other token is rejected.
jest.mock('../helpers/jwtHelper', () => ({
  __esModule: true,
  generateToken: () => 'unused-token',
  decodeToken: (token: string) =>
    token === 'test' ? { userId: 'user-1' } : new Error('invalid token'),
}));

jest.mock('../services/VaultService', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../services/VaultBackupService', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../services/UserService', () => ({
  __esModule: true,
  default: {
    getById: jest.fn(),
    getYouTubeAcknowledgedAt: jest.fn(),
    acknowledgeYouTube: jest.fn(),
  },
}));

jest.mock('../services/YouTubeSyncService', () => ({
  __esModule: true,
  default: {
    getAuthUrl: jest.fn(),
    handleOAuthCallback: jest.fn(),
    getStatus: jest.fn(),
    disconnect: jest.fn(),
    getSubscriptions: jest.fn(),
    syncChannels: jest.fn(),
    syncUploads: jest.fn(),
    getVideos: jest.fn(),
    getNotificationSettings: jest.fn(),
    updateNotificationSettings: jest.fn(),
    getSyncStatus: jest.fn(),
    toggleSubscription: jest.fn(),
    setVideoWatched: jest.fn(),
    getVideosGroupedByChannel: jest.fn(),
  },
}));

jest.mock('../services/YouTubeSyncWorkerService', () => ({
  __esModule: true,
  default: {
    runSyncWorker: jest.fn(),
  },
}));

jest.mock('../services/YouTubeDigestService', () => ({
  __esModule: true,
  default: {
    runDigestWorker: jest.fn(),
    unsubscribe: jest.fn(),
  },
}));

jest.mock('../services/FeedbackService', () => ({
  __esModule: true,
  default: {},
}));

function makeApp() {
  jest.resetModules();

  const { RegisterRoutes } = require('../routes/routes');
  const {
    createYouTubeAvailabilityGate,
  } = require('../middleware/youtubeAvailabilityGate');

  const app = express();
  app.use(bodyParser.json({ limit: '2mb' }));
  app.use('/youtube', createYouTubeAvailabilityGate());
  RegisterRoutes(app);

  app.use(function tsoaErrorHandler(
    err: unknown,
    _req: any,
    res: any,
    next: any,
  ) {
    if (err instanceof ValidateError) {
      return res.status(422).json({
        message: 'Validation Failed',
        details: err?.fields,
      });
    }

    const anyErr = err as { status?: number; message?: string };
    if (
      anyErr &&
      typeof anyErr === 'object' &&
      typeof anyErr.status === 'number'
    ) {
      return res.status(anyErr.status).json({ message: anyErr.message });
    }

    if (err instanceof Error) {
      return res.status(500).json({ message: 'Internal Server Error' });
    }

    return next(err);
  });

  return app;
}

/** Makes the User that a 'Bearer test' token resolves to, with or without YouTube Access. */
function signInAs(youtube_access: boolean) {
  const userService = require('../services/UserService').default;
  userService.getById.mockResolvedValue({
    id: 'user-1',
    role: 'user',
    disabled: false,
    sessions_invalidated_at: null,
    youtube_access,
  });
}

/** Sets the stored YouTube acknowledgement that the controller reads for user-1. */
function setAcknowledgedAt(acknowledgedAt: Date | null) {
  const userService = require('../services/UserService').default;
  userService.getYouTubeAcknowledgedAt.mockResolvedValue(acknowledgedAt);
}

describe('YouTubeController (HTTP integration)', () => {
  const originalCronSecret = process.env.YOUTUBE_CRON_SECRET;
  const originalYouTubeAvailable = process.env.YOUTUBE_AVAILABLE;
  let app: express.Application;

  beforeAll(() => {
    app = makeApp();
  });

  beforeEach(() => {
    process.env.YOUTUBE_CRON_SECRET = CRON_SECRET;
    process.env.YOUTUBE_AVAILABLE = 'true';
    jest.resetAllMocks();
    signInAs(true);
    setAcknowledgedAt(ACKNOWLEDGED_AT);
  });

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.YOUTUBE_CRON_SECRET;
    } else {
      process.env.YOUTUBE_CRON_SECRET = originalCronSecret;
    }
    if (originalYouTubeAvailable === undefined) {
      delete process.env.YOUTUBE_AVAILABLE;
    } else {
      process.env.YOUTUBE_AVAILABLE = originalYouTubeAvailable;
    }
  });

  test('requires auth for GET /youtube/auth-url', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;

    const res = await request(app).get('/youtube/auth-url');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthorized' });
    expect(youtubeSyncService.getAuthUrl).not.toHaveBeenCalled();
  });

  test('returns auth URL for authenticated GET /youtube/auth-url', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;

    youtubeSyncService.getAuthUrl.mockReturnValue(
      'https://accounts.google.com/o/oauth2/auth?state=user-1',
    );

    const res = await request(app)
      .get('/youtube/auth-url')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      url: 'https://accounts.google.com/o/oauth2/auth?state=user-1',
    });
    expect(youtubeSyncService.getAuthUrl).toHaveBeenCalledWith('user-1');
  });

  test('GET /youtube/auth-url is refused with 409 and no URL until the acknowledgement is stored', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;
    setAcknowledgedAt(null);

    const res = await request(app)
      .get('/youtube/auth-url')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      message: 'Accept the YouTube acknowledgement before connecting.',
      code: 'acknowledgement_required',
    });
    expect(youtubeSyncService.getAuthUrl).not.toHaveBeenCalled();
  });

  test('GET /youtube/acknowledgement returns a null acknowledgedAt before the User accepts', async () => {
    const userService = require('../services/UserService').default;
    setAcknowledgedAt(null);

    const res = await request(app)
      .get('/youtube/acknowledgement')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ acknowledgedAt: null });
    expect(userService.getYouTubeAcknowledgedAt).toHaveBeenCalledWith('user-1');
  });

  test('GET /youtube/acknowledgement returns the stored time as an ISO string once accepted', async () => {
    setAcknowledgedAt(ACKNOWLEDGED_AT);

    const res = await request(app)
      .get('/youtube/acknowledgement')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      acknowledgedAt: ACKNOWLEDGED_AT.toISOString(),
    });
  });

  test('POST /youtube/acknowledgement stores the acknowledgement and returns its time', async () => {
    const userService = require('../services/UserService').default;
    userService.acknowledgeYouTube.mockResolvedValue(ACKNOWLEDGED_AT);

    const res = await request(app)
      .post('/youtube/acknowledgement')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      acknowledgedAt: ACKNOWLEDGED_AT.toISOString(),
    });
    expect(userService.acknowledgeYouTube).toHaveBeenCalledWith('user-1');
  });

  test("POST /youtube/acknowledgement relays the service's stored time on repeat calls", async () => {
    const userService = require('../services/UserService').default;
    // The service keeps the first accepted time, so every call reports it.
    userService.acknowledgeYouTube.mockResolvedValue(ACKNOWLEDGED_AT);

    const first = await request(app)
      .post('/youtube/acknowledgement')
      .set('Authorization', 'Bearer test');
    const second = await request(app)
      .post('/youtube/acknowledgement')
      .set('Authorization', 'Bearer test');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(second.body).toEqual({
      acknowledgedAt: ACKNOWLEDGED_AT.toISOString(),
    });
    expect(userService.acknowledgeYouTube).toHaveBeenCalledTimes(2);
  });

  test('POST /youtube/acknowledgement returns 404 when the User is missing', async () => {
    const userService = require('../services/UserService').default;
    userService.acknowledgeYouTube.mockResolvedValue(null);

    const res = await request(app)
      .post('/youtube/acknowledgement')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'User not found' });
  });

  test('requires X-Cron-Secret for POST /youtube/cron/sync', async () => {
    const youTubeSyncWorkerService =
      require('../services/YouTubeSyncWorkerService').default;

    const res = await request(app).post('/youtube/cron/sync');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthorized' });
    expect(youTubeSyncWorkerService.runSyncWorker).not.toHaveBeenCalled();
  });

  test('rejects wrong X-Cron-Secret for POST /youtube/cron/sync', async () => {
    const youTubeSyncWorkerService =
      require('../services/YouTubeSyncWorkerService').default;

    const res = await request(app)
      .post('/youtube/cron/sync')
      .set('X-Cron-Secret', 'wrong-secret');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthorized' });
    expect(youTubeSyncWorkerService.runSyncWorker).not.toHaveBeenCalled();
  });

  test('runs cron sync with valid X-Cron-Secret', async () => {
    const youTubeSyncWorkerService =
      require('../services/YouTubeSyncWorkerService').default;

    youTubeSyncWorkerService.runSyncWorker.mockResolvedValue({
      ran: true,
      processed: 10,
      usersSynced: 8,
      failed: 2,
      done: false,
    });

    const res = await request(app)
      .post('/youtube/cron/sync')
      .set('X-Cron-Secret', CRON_SECRET);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ran: true,
      processed: 10,
      usersSynced: 8,
      failed: 2,
      done: false,
    });
    expect(youTubeSyncWorkerService.runSyncWorker).toHaveBeenCalledTimes(1);
  });

  test('requires X-Cron-Secret for POST /youtube/cron/digest', async () => {
    const youTubeDigestService =
      require('../services/YouTubeDigestService').default;

    const res = await request(app).post('/youtube/cron/digest');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthorized' });
    expect(youTubeDigestService.runDigestWorker).not.toHaveBeenCalled();
  });

  test('rejects wrong X-Cron-Secret for POST /youtube/cron/digest', async () => {
    const youTubeDigestService =
      require('../services/YouTubeDigestService').default;

    const res = await request(app)
      .post('/youtube/cron/digest')
      .set('X-Cron-Secret', 'wrong-secret');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthorized' });
    expect(youTubeDigestService.runDigestWorker).not.toHaveBeenCalled();
  });

  test('runs cron digest with valid X-Cron-Secret', async () => {
    const youTubeDigestService =
      require('../services/YouTubeDigestService').default;

    youTubeDigestService.runDigestWorker.mockResolvedValue({
      ran: true,
      processed: 25,
      sent: 18,
      skippedEmpty: 4,
      notDue: 2,
      duplicates: 1,
      failed: 0,
      done: false,
    });

    const res = await request(app)
      .post('/youtube/cron/digest')
      .set('X-Cron-Secret', CRON_SECRET);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ran: true,
      processed: 25,
      sent: 18,
      skippedEmpty: 4,
      notDue: 2,
      duplicates: 1,
      failed: 0,
      done: false,
    });
    expect(youTubeDigestService.runDigestWorker).toHaveBeenCalledTimes(1);
  });

  test('unsubscribes from digest with valid token (no auth headers)', async () => {
    const youTubeDigestService =
      require('../services/YouTubeDigestService').default;

    youTubeDigestService.unsubscribe.mockResolvedValue(true);

    const res = await request(app)
      .post('/youtube/digest/unsubscribe')
      .send({ token: 'valid-unsubscribe-token' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(youTubeDigestService.unsubscribe).toHaveBeenCalledWith(
      'valid-unsubscribe-token',
    );
  });

  test('returns 404 when unsubscribe token is invalid (no auth headers)', async () => {
    const youTubeDigestService =
      require('../services/YouTubeDigestService').default;

    youTubeDigestService.unsubscribe.mockResolvedValue(false);

    const res = await request(app)
      .post('/youtube/digest/unsubscribe')
      .send({ token: 'invalid-token' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Unknown unsubscribe link.' });
    expect(youTubeDigestService.unsubscribe).toHaveBeenCalledWith(
      'invalid-token',
    );
  });

  test('returns identical 401 body shape for JWT and cron-secret auth failures', async () => {
    const jwtRes = await request(app).get('/youtube/auth-url');
    const cronRes = await request(app).post('/youtube/cron/sync');

    expect(jwtRes.status).toBe(401);
    expect(cronRes.status).toBe(401);
    expect(jwtRes.body).toEqual({ message: 'Unauthorized' });
    expect(cronRes.body).toEqual({ message: 'Unauthorized' });
    expect(Object.keys(jwtRes.body).sort()).toEqual(
      Object.keys(cronRes.body).sort(),
    );
  });

  test('requires auth for DELETE /youtube/disconnect', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;

    const res = await request(app).delete('/youtube/disconnect');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthorized' });
    expect(youtubeSyncService.disconnect).not.toHaveBeenCalled();
  });

  test('returns 409 when disconnect is refused because a sync run is live', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;

    const liveRefuse = {
      ok: false as const,
      code: 'sync_run_live' as const,
      message:
        'Disconnect is not available while a sync is in progress. Wait for the sync to finish or cancel it, then try again.',
    };
    youtubeSyncService.disconnect.mockResolvedValue(liveRefuse);

    const res = await request(app)
      .delete('/youtube/disconnect')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(409);
    expect(res.body).toEqual(liveRefuse);
    expect(youtubeSyncService.disconnect).toHaveBeenCalledWith('user-1');
  });

  test('ignores a deleteWatchedMarks body field and disconnects with only the userId', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;

    const success = {
      ok: true as const,
      message: 'YouTube disconnected.',
    };
    youtubeSyncService.disconnect.mockResolvedValue(success);

    const res = await request(app)
      .delete('/youtube/disconnect')
      .set('Authorization', 'Bearer test')
      .send({ deleteWatchedMarks: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(success);
    expect(youtubeSyncService.disconnect).toHaveBeenCalledWith('user-1');
    expect(youtubeSyncService.disconnect.mock.calls[0]).toHaveLength(1);
  });

  test('calls disconnect with only the userId when no body is sent', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;

    const success = {
      ok: true as const,
      message: 'YouTube disconnected.',
    };
    youtubeSyncService.disconnect.mockResolvedValue(success);

    const res = await request(app)
      .delete('/youtube/disconnect')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(success);
    expect(youtubeSyncService.disconnect).toHaveBeenCalledWith('user-1');
    expect(youtubeSyncService.disconnect.mock.calls[0]).toHaveLength(1);
  });

  test('passes through revokeFailed and googlePermissionsUrl on successful disconnect', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;

    const revokeFailedSuccess = {
      ok: true as const,
      message: 'YouTube disconnected, but Google token revoke failed.',
      revokeFailed: true,
      googlePermissionsUrl: 'https://myaccount.google.com/permissions',
    };
    youtubeSyncService.disconnect.mockResolvedValue(revokeFailedSuccess);

    const res = await request(app)
      .delete('/youtube/disconnect')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(revokeFailedSuccess);
    expect(youtubeSyncService.disconnect).toHaveBeenCalledWith('user-1');
  });

  test('GET /youtube/availability returns true when switch is on', async () => {
    const res = await request(app).get('/youtube/availability');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true });
  });

  test('PUT /youtube/subscriptions/sync calls syncChannels and returns channel sync response', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;

    const lastAttemptAt = new Date('2026-09-22T10:00:00.000Z');
    youtubeSyncService.syncChannels.mockResolvedValue({
      synced: 2,
      status: 'success',
      lastAttemptAt,
      lastError: null,
      retryAt: null,
    });

    const res = await request(app)
      .put('/youtube/subscriptions/sync')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      synced: 2,
      status: 'success',
      lastAttemptAt: lastAttemptAt.toISOString(),
      lastError: null,
      retryAt: null,
    });
    expect(youtubeSyncService.syncChannels).toHaveBeenCalledWith('user-1');
    expect(youtubeSyncService.syncUploads).not.toHaveBeenCalled();
  });

  test('PUT /youtube/uploads/sync calls syncUploads and returns upload sync response', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;

    const lastSyncedAt = new Date('2026-09-22T09:00:00.000Z');
    const lastSyncAttemptAt = new Date('2026-09-22T10:00:00.000Z');
    const channelLastAttemptAt = new Date('2026-09-22T08:00:00.000Z');
    youtubeSyncService.syncUploads.mockResolvedValue({
      subscriptionsSynced: 3,
      videosSynced: 12,
      status: 'success',
      lastSyncedAt,
      lastSyncAttemptAt,
      lastSyncError: null,
      retryAt: null,
      progress: null,
      channelStatus: 'success',
      channelLastAttemptAt,
      channelLastError: null,
      channelRetryAt: null,
    });

    const res = await request(app)
      .put('/youtube/uploads/sync')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      synced: 3,
      videosSynced: 12,
      status: 'success',
      lastSyncedAt: lastSyncedAt.toISOString(),
      lastSyncAttemptAt: lastSyncAttemptAt.toISOString(),
      lastSyncError: null,
      retryAt: null,
      progress: null,
      channelStatus: 'success',
      channelLastAttemptAt: channelLastAttemptAt.toISOString(),
      channelLastError: null,
      channelRetryAt: null,
    });
    expect(youtubeSyncService.syncUploads).toHaveBeenCalledWith('user-1');
    expect(youtubeSyncService.syncChannels).not.toHaveBeenCalled();
  });

  test('GET /youtube/sync-status includes channel sync fields', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;

    const lastSyncedAt = new Date('2026-09-22T09:00:00.000Z');
    const lastSyncAttemptAt = new Date('2026-09-22T10:00:00.000Z');
    const channelRetryAt = new Date('2026-09-22T11:00:00.000Z');
    youtubeSyncService.getSyncStatus.mockResolvedValue({
      status: 'success',
      lastSyncedAt,
      lastSyncAttemptAt,
      lastSyncError: null,
      retryAt: null,
      progress: null,
      channelStatus: 'discovering',
      channelLastAttemptAt: null,
      channelLastError: null,
      channelRetryAt,
    });

    const res = await request(app)
      .get('/youtube/sync-status')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'success',
      lastSyncedAt: lastSyncedAt.toISOString(),
      lastSyncAttemptAt: lastSyncAttemptAt.toISOString(),
      lastSyncError: null,
      retryAt: null,
      progress: null,
      channelStatus: 'discovering',
      channelLastAttemptAt: null,
      channelLastError: null,
      channelRetryAt: channelRetryAt.toISOString(),
    });
    expect(youtubeSyncService.getSyncStatus).toHaveBeenCalledWith('user-1');
  });
});

describe('YouTube availability switch — off', () => {
  const originalCronSecret = process.env.YOUTUBE_CRON_SECRET;
  const originalYouTubeAvailable = process.env.YOUTUBE_AVAILABLE;
  let app: express.Application;

  beforeAll(() => {
    app = makeApp();
  });

  beforeEach(() => {
    process.env.YOUTUBE_CRON_SECRET = CRON_SECRET;
    process.env.YOUTUBE_AVAILABLE = 'false';
    jest.resetAllMocks();
  });

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.YOUTUBE_CRON_SECRET;
    } else {
      process.env.YOUTUBE_CRON_SECRET = originalCronSecret;
    }
    if (originalYouTubeAvailable === undefined) {
      delete process.env.YOUTUBE_AVAILABLE;
    } else {
      process.env.YOUTUBE_AVAILABLE = originalYouTubeAvailable;
    }
  });

  test('GET and POST /youtube/acknowledgement return 404 when switch is off', async () => {
    const userService = require('../services/UserService').default;

    const getRes = await request(app)
      .get('/youtube/acknowledgement')
      .set('Authorization', 'Bearer test');
    const postRes = await request(app)
      .post('/youtube/acknowledgement')
      .set('Authorization', 'Bearer test');

    expect(getRes.status).toBe(404);
    expect(getRes.body).toEqual({ message: 'Not Found' });
    expect(postRes.status).toBe(404);
    expect(postRes.body).toEqual({ message: 'Not Found' });
    expect(userService.getYouTubeAcknowledgedAt).not.toHaveBeenCalled();
    expect(userService.acknowledgeYouTube).not.toHaveBeenCalled();
  });

  test('GET /youtube/auth-url returns 404 when switch is off', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;

    const res = await request(app)
      .get('/youtube/auth-url')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not Found' });
    expect(youtubeSyncService.getAuthUrl).not.toHaveBeenCalled();
  });

  test('POST /youtube/callback returns 404 when switch is off', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;

    const res = await request(app)
      .post('/youtube/callback')
      .set('Authorization', 'Bearer test')
      .send({ code: 'auth-code' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not Found' });
    expect(youtubeSyncService.handleOAuthCallback).not.toHaveBeenCalled();
  });

  test('GET /youtube/status returns 404 when switch is off', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;

    const res = await request(app)
      .get('/youtube/status')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not Found' });
    expect(youtubeSyncService.getStatus).not.toHaveBeenCalled();
  });

  test('DELETE /youtube/disconnect returns 404 when switch is off', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;

    const res = await request(app)
      .delete('/youtube/disconnect')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not Found' });
    expect(youtubeSyncService.disconnect).not.toHaveBeenCalled();
  });

  test('GET /youtube/subscriptions returns 404 when switch is off', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;

    const res = await request(app)
      .get('/youtube/subscriptions')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not Found' });
    expect(youtubeSyncService.getSubscriptions).not.toHaveBeenCalled();
  });

  test('PUT /youtube/subscriptions/sync returns 404 when switch is off', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;

    const res = await request(app)
      .put('/youtube/subscriptions/sync')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not Found' });
    expect(youtubeSyncService.syncChannels).not.toHaveBeenCalled();
  });

  test('PUT /youtube/uploads/sync returns 404 when switch is off', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;

    const res = await request(app)
      .put('/youtube/uploads/sync')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not Found' });
    expect(youtubeSyncService.syncUploads).not.toHaveBeenCalled();
  });

  test('GET /youtube/videos returns 404 when switch is off', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;

    const res = await request(app)
      .get('/youtube/videos')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not Found' });
    expect(youtubeSyncService.getVideos).not.toHaveBeenCalled();
  });

  test('GET /youtube/notification-settings returns 404 when switch is off', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;

    const res = await request(app)
      .get('/youtube/notification-settings')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not Found' });
    expect(youtubeSyncService.getNotificationSettings).not.toHaveBeenCalled();
  });

  test('POST /youtube/digest/unsubscribe returns 404 when switch is off', async () => {
    const youTubeDigestService =
      require('../services/YouTubeDigestService').default;

    const res = await request(app)
      .post('/youtube/digest/unsubscribe')
      .send({ token: 'unsubscribe-token' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not Found' });
    expect(youTubeDigestService.unsubscribe).not.toHaveBeenCalled();
  });

  test('POST /youtube/cron/sync returns 200 with no-op body when switch is off', async () => {
    const youTubeSyncWorkerService =
      require('../services/YouTubeSyncWorkerService').default;

    const res = await request(app)
      .post('/youtube/cron/sync')
      .set('X-Cron-Secret', CRON_SECRET);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ran: false,
      processed: 0,
      usersSynced: 0,
      failed: 0,
      done: true,
    });
    expect(youTubeSyncWorkerService.runSyncWorker).not.toHaveBeenCalled();
  });

  test('POST /youtube/cron/sync returns 401 on missing X-Cron-Secret when switch is off', async () => {
    const youTubeSyncWorkerService =
      require('../services/YouTubeSyncWorkerService').default;

    const res = await request(app).post('/youtube/cron/sync');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthorized' });
    expect(youTubeSyncWorkerService.runSyncWorker).not.toHaveBeenCalled();
  });

  test('POST /youtube/cron/sync returns 401 on wrong X-Cron-Secret when switch is off', async () => {
    const youTubeSyncWorkerService =
      require('../services/YouTubeSyncWorkerService').default;

    const res = await request(app)
      .post('/youtube/cron/sync')
      .set('X-Cron-Secret', 'wrong-secret');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthorized' });
    expect(youTubeSyncWorkerService.runSyncWorker).not.toHaveBeenCalled();
  });

  test('POST /youtube/cron/digest returns 200 with no-op body when switch is off', async () => {
    const youTubeDigestService =
      require('../services/YouTubeDigestService').default;

    const res = await request(app)
      .post('/youtube/cron/digest')
      .set('X-Cron-Secret', CRON_SECRET);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ran: false,
      processed: 0,
      sent: 0,
      skippedEmpty: 0,
      notDue: 0,
      duplicates: 0,
      failed: 0,
      done: true,
    });
    expect(youTubeDigestService.runDigestWorker).not.toHaveBeenCalled();
  });

  test('POST /youtube/cron/digest returns 401 on missing X-Cron-Secret when switch is off', async () => {
    const youTubeDigestService =
      require('../services/YouTubeDigestService').default;

    const res = await request(app).post('/youtube/cron/digest');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthorized' });
    expect(youTubeDigestService.runDigestWorker).not.toHaveBeenCalled();
  });

  test('POST /youtube/cron/digest returns 401 on wrong X-Cron-Secret when switch is off', async () => {
    const youTubeDigestService =
      require('../services/YouTubeDigestService').default;

    const res = await request(app)
      .post('/youtube/cron/digest')
      .set('X-Cron-Secret', 'wrong-secret');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthorized' });
    expect(youTubeDigestService.runDigestWorker).not.toHaveBeenCalled();
  });

  test('GET /youtube/availability returns false when switch is off', async () => {
    const res = await request(app).get('/youtube/availability');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false });
  });
});

describe('YouTube Access — per-User gate', () => {
  const originalCronSecret = process.env.YOUTUBE_CRON_SECRET;
  const originalYouTubeAvailable = process.env.YOUTUBE_AVAILABLE;
  let app: express.Application;

  type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

  /** Every authenticated YouTube route (ADR 0129). */
  const AUTHENTICATED_YOUTUBE_ROUTES: Array<[HttpMethod, string]> = [
    ['get', '/youtube/auth-url'],
    ['post', '/youtube/callback'],
    ['get', '/youtube/status'],
    ['delete', '/youtube/disconnect'],
    ['get', '/youtube/subscriptions'],
    ['put', '/youtube/subscriptions/sync'],
    ['put', '/youtube/uploads/sync'],
    ['get', '/youtube/sync-status'],
    ['patch', '/youtube/subscriptions/sub-1'],
    ['get', '/youtube/videos'],
    ['patch', '/youtube/videos/video-1/watched'],
    ['get', '/youtube/videos/carousel'],
    ['get', '/youtube/notification-settings'],
    ['patch', '/youtube/notification-settings'],
    ['get', '/youtube/acknowledgement'],
    ['post', '/youtube/acknowledgement'],
  ];

  /** Total calls across every YouTubeSyncService mock; a gated route must add none. */
  function youTubeSyncServiceCallCount(): number {
    const youtubeSyncService: Record<string, { mock: { calls: unknown[] } }> =
      require('../services/YouTubeSyncService').default;
    return Object.values(youtubeSyncService).reduce(
      (total, fn) => total + fn.mock.calls.length,
      0,
    );
  }

  beforeAll(() => {
    app = makeApp();
  });

  beforeEach(() => {
    process.env.YOUTUBE_CRON_SECRET = CRON_SECRET;
    process.env.YOUTUBE_AVAILABLE = 'true';
    jest.resetAllMocks();
  });

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.YOUTUBE_CRON_SECRET;
    } else {
      process.env.YOUTUBE_CRON_SECRET = originalCronSecret;
    }
    if (originalYouTubeAvailable === undefined) {
      delete process.env.YOUTUBE_AVAILABLE;
    } else {
      process.env.YOUTUBE_AVAILABLE = originalYouTubeAvailable;
    }
  });

  test.each(AUTHENTICATED_YOUTUBE_ROUTES)(
    '%s %s returns 404 for a signed-in User without YouTube Access',
    async (method, path) => {
      signInAs(false);

      const res = await request(app)
        [method](path)
        .set('Authorization', 'Bearer test');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'Not Found' });
      expect(youTubeSyncServiceCallCount()).toBe(0);
      const userService = require('../services/UserService').default;
      expect(userService.getYouTubeAcknowledgedAt).not.toHaveBeenCalled();
      expect(userService.acknowledgeYouTube).not.toHaveBeenCalled();
    },
  );

  test('GET /youtube/status reaches the service for a User with YouTube Access', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;
    signInAs(true);
    youtubeSyncService.getStatus.mockResolvedValue({
      connected: true,
      status: 'success',
    });

    const res = await request(app)
      .get('/youtube/status')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true, status: 'success' });
    expect(youtubeSyncService.getStatus).toHaveBeenCalledWith('user-1');
  });

  test('DELETE /youtube/disconnect reaches the service for a User with YouTube Access', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;
    signInAs(true);
    const success = { ok: true as const, message: 'YouTube disconnected.' };
    youtubeSyncService.disconnect.mockResolvedValue(success);

    const res = await request(app)
      .delete('/youtube/disconnect')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(success);
    expect(youtubeSyncService.disconnect).toHaveBeenCalledWith('user-1');
  });

  test('GET /youtube/access returns granted false for a User without YouTube Access', async () => {
    signInAs(false);

    const res = await request(app)
      .get('/youtube/access')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ granted: false });
  });

  test('GET /youtube/access returns granted true for a User with YouTube Access', async () => {
    signInAs(true);

    const res = await request(app)
      .get('/youtube/access')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ granted: true });
  });

  test('digest unsubscribe, cron routes and availability stay reachable for a User without YouTube Access', async () => {
    const youTubeSyncWorkerService =
      require('../services/YouTubeSyncWorkerService').default;
    const youTubeDigestService =
      require('../services/YouTubeDigestService').default;
    signInAs(false);
    youTubeDigestService.unsubscribe.mockResolvedValue(true);
    youTubeSyncWorkerService.runSyncWorker.mockResolvedValue({
      ran: true,
      processed: 0,
      usersSynced: 0,
      failed: 0,
      done: true,
    });
    youTubeDigestService.runDigestWorker.mockResolvedValue({
      ran: true,
      processed: 0,
      sent: 0,
      skippedEmpty: 0,
      notDue: 0,
      duplicates: 0,
      failed: 0,
      done: true,
    });

    const unsubscribeRes = await request(app)
      .post('/youtube/digest/unsubscribe')
      .set('Authorization', 'Bearer test')
      .send({ token: 'valid-unsubscribe-token' });
    const cronSyncRes = await request(app)
      .post('/youtube/cron/sync')
      .set('X-Cron-Secret', CRON_SECRET);
    const cronDigestRes = await request(app)
      .post('/youtube/cron/digest')
      .set('X-Cron-Secret', CRON_SECRET);
    const availabilityRes = await request(app)
      .get('/youtube/availability')
      .set('Authorization', 'Bearer test');

    expect(unsubscribeRes.status).toBe(200);
    expect(unsubscribeRes.body).toEqual({ ok: true });
    expect(cronSyncRes.status).toBe(200);
    expect(youTubeSyncWorkerService.runSyncWorker).toHaveBeenCalledTimes(1);
    expect(cronDigestRes.status).toBe(200);
    expect(youTubeDigestService.runDigestWorker).toHaveBeenCalledTimes(1);
    expect(availabilityRes.status).toBe(200);
    expect(availabilityRes.body).toEqual({ available: true });
  });

  test('a granted User still gets 404 from GET /youtube/access and GET /youtube/status when the global switch is off', async () => {
    const youtubeSyncService =
      require('../services/YouTubeSyncService').default;
    signInAs(true);
    process.env.YOUTUBE_AVAILABLE = 'false';

    const accessRes = await request(app)
      .get('/youtube/access')
      .set('Authorization', 'Bearer test');
    const statusRes = await request(app)
      .get('/youtube/status')
      .set('Authorization', 'Bearer test');

    expect(accessRes.status).toBe(404);
    expect(accessRes.body).toEqual({ message: 'Not Found' });
    expect(statusRes.status).toBe(404);
    expect(statusRes.body).toEqual({ message: 'Not Found' });
    expect(youtubeSyncService.getStatus).not.toHaveBeenCalled();
  });
});
