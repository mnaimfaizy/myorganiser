// Mock googleapis
jest.mock('googleapis', () => {
  const mockYoutube = {
    subscriptions: {
      list: jest.fn(),
    },
    channels: {
      list: jest.fn(),
    },
    playlistItems: {
      list: jest.fn(),
    },
    videos: {
      list: jest.fn(),
    },
  };

  return {
    google: {
      auth: {
        OAuth2: jest.fn().mockImplementation(() => ({
          generateAuthUrl: jest
            .fn()
            .mockReturnValue('https://accounts.google.com/o/oauth2/auth?test'),
          getToken: jest.fn().mockResolvedValue({
            tokens: {
              access_token: 'mock-access-token',
              refresh_token: 'mock-refresh-token',
            },
          }),
          setCredentials: jest.fn(),
          revokeToken: jest.fn().mockResolvedValue({}),
          on: jest.fn(),
        })),
      },
      youtube: jest.fn().mockReturnValue(mockYoutube),
    },
  };
});

jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  })),
  format: { json: jest.fn(() => ({})) },
  transports: { Console: jest.fn() },
}));

// Mock encryption
jest.mock('./YouTubeTokenEncryption', () => ({
  encryptToken: jest.fn().mockImplementation((text) => ({
    ciphertext: `encrypted_${text}`,
    iv: 'mock-iv',
    authTag: 'mock-auth-tag',
  })),
  decryptToken: jest
    .fn()
    .mockImplementation((encrypted) =>
      encrypted.ciphertext.replace('encrypted_', ''),
    ),
}));

// Mock Prisma — mock object must be created inside the factory because
// jest.mock is hoisted above all variable declarations.
// We export __mockPrisma so tests can reference mock methods.
jest.mock('../prisma', () => {
  const transaction = {
    youTubeVideo: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    youTubeSubscription: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    youTubeNotificationSettings: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    youTubeDigestDelivery: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    youTubeIntegration: {
      findUnique: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
    },
    user: {
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };

  const __mockPrisma = {
    youTubeIntegration: {
      upsert: jest
        .fn()
        .mockResolvedValue({ userId: 'user-1', status: 'connected' }),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(async (args) => {
        const row = await __mockPrisma.youTubeIntegration.findUnique(args);
        if (!row) {
          throw new Error('YouTubeIntegration not found');
        }
        return row;
      }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    youTubeSubscription: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(1),
    },
    youTubeVideo: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn(),
    },
    youTubeDigestDelivery: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    youTubeNotificationSettings: {
      upsert: jest.fn().mockResolvedValue({ intervalDays: 7, enabled: true }),
      findUnique: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    // Provide a $transaction implementation that passes a transaction-like
    // object to the callback so the service's transactional upserts/deletes
    // can be asserted.
    $transaction: jest.fn().mockImplementation(async (fn: any) => {
      // call the provided function with the transaction stub
      await fn(transaction as any);
      return;
    }),
    // expose the transaction stub so tests can assert on transactional calls
    __transaction: transaction,
  };

  transaction.youTubeIntegration.findUnique =
    __mockPrisma.youTubeIntegration.findUnique;

  return {
    createPrismaClient: () => __mockPrisma,
    PrismaClient: jest.fn(),
    __mockPrisma,
  };
});

const winston = require('winston');
const youtubeSyncService = require('./YouTubeSyncService').default;
const mockLogger = jest.mocked(winston.createLogger).mock.results[0].value;
const mockPrisma = require('../prisma').__mockPrisma;
const { decryptToken } = require('./YouTubeTokenEncryption');
const mockTransaction = mockPrisma.__transaction;
const {
  RUN_TTL_MS,
  MANUAL_REFRESH_COOLDOWN_MS,
  CHANNEL_SYNC_COOLDOWN_MS,
  CHANNEL_SYNC_TTL_MS,
  UPLOAD_SYNC_COOLDOWN_MS,
  UPLOAD_SYNC_TTL_MS,
  GOOGLE_PERMISSIONS_URL,
  LIVE_SYNC_STATUSES,
  isAnyYouTubeSyncLive,
  youtubeSyncClaimableWhere,
} = require('./YouTubeSyncService');

const defaultChannelSyncFields = {
  lastChannelSyncStatus: 'never',
  lastChannelSyncAt: null,
  lastChannelSyncError: null,
};

const connectedIntegration = {
  userId: 'user-1',
  encrypted_refresh_token: 'enc-rt',
  encrypted_access_token: 'enc-at',
  token_iv: 'iv-a:iv-b',
  token_auth_tag: 'tag-a:tag-b',
  status: 'connected',
  lastSyncStatus: 'success',
  lastSyncAttemptAt: new Date('2026-01-01'),
  ...defaultChannelSyncFields,
};

describe('YouTubeSyncService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_REDIRECT_URI =
      'http://localhost:3000/api/v1/youtube/callback';
  });

  describe('getAuthUrl', () => {
    it('should generate an OAuth consent URL', () => {
      const url = youtubeSyncService.getAuthUrl('user-1');
      expect(url).toContain('https://accounts.google.com');
    });
  });

  describe('handleOAuthCallback', () => {
    it('should exchange code for tokens and store them encrypted', async () => {
      const result = await youtubeSyncService.handleOAuthCallback(
        'user-1',
        'auth-code',
      );

      expect(result.ok).toBe(true);
      expect(result.message).toContain('connected successfully');
      expect(mockPrisma.youTubeIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          create: expect.objectContaining({
            userId: 'user-1',
            status: 'connected',
            encrypted_access_token: 'encrypted_mock-access-token',
            encrypted_refresh_token: 'encrypted_mock-refresh-token',
          }),
        }),
      );
    });

    it('should clear revokedAt in the upsert update branch so a reconnect ends the Revoked period', async () => {
      await youtubeSyncService.handleOAuthCallback('user-1', 'auth-code');

      expect(mockPrisma.youTubeIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            status: 'connected',
            revokedAt: null,
          }),
        }),
      );
    });

    it('should seed notification settings with the digest opted out', async () => {
      await youtubeSyncService.handleOAuthCallback('user-1', 'auth-code');

      expect(
        mockPrisma.youTubeNotificationSettings.upsert,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          create: expect.objectContaining({
            userId: 'user-1',
            intervalDays: 7,
            // The weekly digest is opt-in: connecting must not start mailing.
            enabled: false,
          }),
        }),
      );
    });
  });

  describe('getStatus', () => {
    it('should return not connected if no integration exists', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const status = await youtubeSyncService.getStatus('user-1');
      expect(status).toEqual({ connected: false, status: 'not_connected' });
    });

    it('should return connected status when integration exists', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        { userId: 'user-1', status: 'connected' },
      );

      const status = await youtubeSyncService.getStatus('user-1');
      expect(status).toEqual({ connected: true, status: 'connected' });
    });

    it('should return false for revoked integration', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        { userId: 'user-1', status: 'revoked' },
      );

      const status = await youtubeSyncService.getStatus('user-1');
      expect(status).toEqual({ connected: false, status: 'revoked' });
    });
  });

  describe('disconnect', () => {
    it('D1: should return error when no integration exists and skip transaction', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await youtubeSyncService.disconnect('user-1');

      expect(result).toEqual({
        ok: false,
        message: 'No YouTube integration found.',
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('D2: should delete all YouTube stores inside a transaction without reading Watched marks', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        connectedIntegration,
      );

      const result = await youtubeSyncService.disconnect('user-1');

      expect(result).toEqual({
        ok: true,
        message: 'YouTube account disconnected.',
      });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      // The User's acknowledgement lives on the User row; a YouTube Disconnect never writes it.
      expect(mockTransaction.user.update).not.toHaveBeenCalled();
      expect(mockTransaction.user.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
      // Watched marks live on youTubeVideo rows; disconnect neither reads nor keeps them.
      expect(mockTransaction.youTubeVideo.findMany).not.toHaveBeenCalled();
      expect(mockTransaction.youTubeVideo.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(
        mockTransaction.youTubeSubscription.deleteMany,
      ).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(
        mockTransaction.youTubeNotificationSettings.deleteMany,
      ).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(
        mockTransaction.youTubeDigestDelivery.deleteMany,
      ).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(mockTransaction.youTubeIntegration.delete).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(mockPrisma.youTubeVideo.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.youTubeIntegration.delete).not.toHaveBeenCalled();
    });

    it('D4: should refuse disconnect while a sync run is live', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          ...connectedIntegration,
          lastSyncStatus: 'running',
          lastSyncAttemptAt: new Date(),
        },
      );

      const result = await youtubeSyncService.disconnect('user-1');

      expect(result).toEqual({
        ok: false,
        code: 'sync_run_live',
        message:
          'Disconnect is not available while a sync is in progress. Wait for the sync to finish or cancel it, then try again.',
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockTransaction.youTubeVideo.deleteMany).not.toHaveBeenCalled();
      expect(mockTransaction.youTubeIntegration.delete).not.toHaveBeenCalled();
    });

    it('D4: should refuse disconnect while discovery is live', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          ...connectedIntegration,
          lastSyncStatus: 'discovering',
          lastSyncAttemptAt: new Date(),
        },
      );

      const result = await youtubeSyncService.disconnect('user-1');

      expect(result.ok).toBe(false);
      expect(result.code).toBe('sync_run_live');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('D4: should refuse disconnect while channel sync is live', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          ...connectedIntegration,
          lastSyncStatus: 'success',
          lastSyncAttemptAt: new Date('2026-01-01'),
          lastChannelSyncStatus: 'discovering',
          lastChannelSyncAt: new Date(),
          lastChannelSyncError: null,
        },
      );

      const result = await youtubeSyncService.disconnect('user-1');

      expect(result).toEqual({
        ok: false,
        code: 'sync_run_live',
        message:
          'Disconnect is not available while a sync is in progress. Wait for the sync to finish or cancel it, then try again.',
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should allow disconnect when channel sync is stale beyond CHANNEL_SYNC_TTL_MS', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          ...connectedIntegration,
          lastSyncStatus: 'success',
          lastChannelSyncStatus: 'discovering',
          lastChannelSyncAt: new Date(Date.now() - CHANNEL_SYNC_TTL_MS - 1000),
          lastChannelSyncError: null,
        },
      );

      const result = await youtubeSyncService.disconnect('user-1');

      expect(result.ok).toBe(true);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('refuses disconnect when a sync run becomes live before the transaction commits', async () => {
      let reads = 0;
      (
        mockPrisma.youTubeIntegration.findUnique as jest.Mock
      ).mockImplementation(() => {
        reads += 1;
        if (reads === 1) {
          return Promise.resolve(connectedIntegration);
        }
        return Promise.resolve({
          ...connectedIntegration,
          lastSyncStatus: 'running',
          lastSyncAttemptAt: new Date(),
        });
      });

      const result = await youtubeSyncService.disconnect('user-1');

      expect(result.ok).toBe(false);
      expect(result.code).toBe('sync_run_live');
      expect(mockTransaction.$queryRaw).toHaveBeenCalled();
      expect(mockTransaction.youTubeIntegration.delete).not.toHaveBeenCalled();
      expect(mockTransaction.youTubeVideo.deleteMany).not.toHaveBeenCalled();
    });

    it('should allow disconnect when a sync run is stale beyond RUN_TTL_MS', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          ...connectedIntegration,
          lastSyncStatus: 'running',
          lastSyncAttemptAt: new Date(Date.now() - RUN_TTL_MS - 1000),
        },
      );

      const result = await youtubeSyncService.disconnect('user-1');

      expect(result.ok).toBe(true);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockTransaction.youTubeIntegration.delete).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });

    it('D5: should complete local disconnect when Google revoke fails', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        connectedIntegration,
      );
      const { google } = require('googleapis');
      (google.auth.OAuth2 as jest.Mock).mockImplementationOnce(() => ({
        generateAuthUrl: jest.fn(),
        getToken: jest.fn(),
        setCredentials: jest.fn(),
        revokeToken: jest.fn().mockRejectedValue(new Error('revoke rejected')),
        on: jest.fn(),
      }));

      const result = await youtubeSyncService.disconnect('user-1');

      expect(result).toEqual({
        ok: true,
        message:
          'YouTube account disconnected locally. Remove Google access at your Google account permissions if needed.',
        revokeFailed: true,
        googlePermissionsUrl: GOOGLE_PERMISSIONS_URL,
      });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockTransaction.youTubeIntegration.delete).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });

    it('D6: should still delete everything and log a failed Google revoke at debug when swept as Revoked', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          ...connectedIntegration,
          status: 'revoked',
        },
      );
      const { google } = require('googleapis');
      (google.auth.OAuth2 as jest.Mock).mockImplementationOnce(() => ({
        generateAuthUrl: jest.fn(),
        getToken: jest.fn(),
        setCredentials: jest.fn(),
        revokeToken: jest.fn().mockRejectedValue(new Error('revoke rejected')),
        on: jest.fn(),
      }));

      const result = await youtubeSyncService.disconnect('user-1', {
        expectRevokeFailure: true,
      });

      expect(result).toEqual({
        ok: true,
        message:
          'YouTube account disconnected locally. Remove Google access at your Google account permissions if needed.',
        revokeFailed: true,
        googlePermissionsUrl: GOOGLE_PERMISSIONS_URL,
      });
      expect(mockTransaction.youTubeVideo.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(mockTransaction.youTubeIntegration.delete).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Revocation at Google skipped for a Revoked YouTube Connection (already revoked)',
        expect.any(Error),
      );
    });

    it('D7: should keep warning when Google revoke fails and no expectRevokeFailure flag is passed', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        connectedIntegration,
      );
      const { google } = require('googleapis');
      (google.auth.OAuth2 as jest.Mock).mockImplementationOnce(() => ({
        generateAuthUrl: jest.fn(),
        getToken: jest.fn(),
        setCredentials: jest.fn(),
        revokeToken: jest.fn().mockRejectedValue(new Error('revoke rejected')),
        on: jest.fn(),
      }));

      const result = await youtubeSyncService.disconnect('user-1');

      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to revoke token at Google (may already be revoked)',
        expect.any(Error),
      );
    });
  });

  describe('getSubscriptions', () => {
    it('should return subscriptions ordered by channel title', async () => {
      const subs = [
        { id: '1', channelTitle: 'Alpha', channelId: 'ch-1' },
        { id: '2', channelTitle: 'Beta', channelId: 'ch-2' },
      ];
      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue(
        subs,
      );

      const result = await youtubeSyncService.getSubscriptions('user-1');
      expect(result).toEqual(subs);
      expect(mockPrisma.youTubeSubscription.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { channelTitle: 'asc' },
      });
    });
  });

  describe('toggleSubscription', () => {
    it('should update subscription enabled state', async () => {
      await youtubeSyncService.toggleSubscription('user-1', 'sub-1', false);

      expect(mockPrisma.youTubeSubscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-1', userId: 'user-1' },
          data: expect.objectContaining({ enabled: false }),
        }),
      );
    });
  });

  describe('video sync behavior', () => {
    it('should upsert new videos and delete removed videos when snapshot differs', async () => {
      // Setup integration and a single enabled subscription
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          encrypted_access_token: 'encrypted_access',
          encrypted_refresh_token: 'encrypted_refresh',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          status: 'connected',
        },
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'sub-1',
          userId: 'user-1',
          channelId: 'ch-1',
          uploadsPlaylistId: 'pl-1',
          enabled: true,
        },
      ]);

      // Existing DB has three videos; snapshot will contain two (one new)
      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([
        {
          videoId: 'v1',
          title: 'Old title',
          thumbnail: 't1',
          publishedAt: new Date('2026-01-01'),
          durationSeconds: null,
          watched: true,
        },
        {
          videoId: 'v2',
          title: 'Keep',
          thumbnail: 't2',
          publishedAt: new Date('2026-01-02'),
          durationSeconds: null,
        },
        {
          videoId: 'v3',
          title: 'DeleteMe',
          thumbnail: 't3',
          publishedAt: new Date('2026-01-03'),
          durationSeconds: null,
          watched: true,
        },
      ]);

      const mockYoutube = require('googleapis').google.youtube();
      mockYoutube.playlistItems.list.mockResolvedValue({
        data: {
          items: [
            { snippet: { resourceId: { videoId: 'v1' } } },
            { snippet: { resourceId: { videoId: 'v4' } } },
          ],
        },
      });

      mockYoutube.videos.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'v1',
              snippet: {
                title: 'Updated title',
                thumbnails: { medium: { url: 'updated-t1' } },
                publishedAt: '2026-01-05T00:00:00Z',
              },
            },
            {
              id: 'v4',
              snippet: {
                title: 'New Video',
                thumbnails: { medium: { url: 't4' } },
                publishedAt: '2026-01-04T00:00:00Z',
              },
            },
          ],
        },
      });

      const result =
        await youtubeSyncService.syncVideosForUserWithStatus('user-1');

      // Transactional upserts should have been invoked for snapshot items
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(
        mockPrisma.__transaction.youTubeVideo.upsert,
      ).toHaveBeenCalledTimes(2);

      expect(mockPrisma.__transaction.youTubeVideo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_videoId: { userId: 'user-1', videoId: 'v1' } },
          update: {
            channelId: 'ch-1',
            title: 'Updated title',
            thumbnail: 'updated-t1',
            publishedAt: new Date('2026-01-05T00:00:00Z'),
            durationSeconds: null,
          },
        }),
      );

      const v1Upsert = (
        mockPrisma.__transaction.youTubeVideo.upsert as jest.Mock
      ).mock.calls.find(
        ([payload]) => payload.where.userId_videoId.videoId === 'v1',
      );
      expect(v1Upsert?.[0].update).not.toHaveProperty('watched');

      expect(mockPrisma.__transaction.youTubeVideo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_videoId: { userId: 'user-1', videoId: 'v4' } },
          create: expect.not.objectContaining({ watched: true }),
        }),
      );

      // Deleted videos should be pruned (videoId not in snapshot)
      expect(
        mockPrisma.__transaction.youTubeVideo.deleteMany,
      ).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          channelId: 'ch-1',
          videoId: { notIn: ['v1', 'v4'] },
        },
      });

      expect(result.videosSynced).toBe(2);
    });

    it('D6: after disconnect and reconnect, a previously Watched upload is re-created unwatched', async () => {
      // Stateful fake: one Watched row for user-1. Disconnect's transaction
      // deletes every youTubeVideo row for the user; the upload sync reads
      // whatever rows remain.
      type FakeRow = {
        userId: string;
        videoId: string;
        channelId: string;
        title: string;
        thumbnail: string;
        publishedAt: Date;
        durationSeconds: number | null;
        watched: boolean;
      };
      const rows: FakeRow[] = [
        {
          userId: 'user-1',
          videoId: 'v1',
          channelId: 'ch-1',
          title: 'Old title',
          thumbnail: 't1',
          publishedAt: new Date('2026-01-01'),
          durationSeconds: null,
          watched: true,
        },
      ];
      const readRows = async () => rows.map((row) => ({ ...row }));
      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockImplementation(
        readRows,
      );
      (mockTransaction.youTubeVideo.findMany as jest.Mock).mockImplementation(
        readRows,
      );
      (mockTransaction.youTubeVideo.deleteMany as jest.Mock).mockImplementation(
        async ({
          where,
        }: {
          where: { channelId?: unknown; videoId?: unknown };
        }) => {
          if (where.channelId === undefined && where.videoId === undefined) {
            rows.splice(0, rows.length);
          }
          return { count: 0 };
        },
      );

      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          encrypted_access_token: 'enc-at',
          encrypted_refresh_token: 'enc-rt',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          status: 'connected',
        },
      );
      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'sub-1',
          userId: 'user-1',
          channelId: 'ch-1',
          uploadsPlaylistId: 'pl-1',
          enabled: true,
        },
      ]);

      const mockYoutube = require('googleapis').google.youtube();
      mockYoutube.playlistItems.list.mockResolvedValue({
        data: {
          items: [{ snippet: { resourceId: { videoId: 'v1' } } }],
        },
      });
      mockYoutube.videos.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'v1',
              snippet: {
                title: 'Reconnected upload',
                thumbnails: { medium: { url: 't1' } },
                publishedAt: '2026-01-05T00:00:00Z',
              },
            },
          ],
        },
      });

      const disconnectResult = await youtubeSyncService.disconnect('user-1');
      expect(disconnectResult.ok).toBe(true);
      expect(rows).toHaveLength(0);

      await youtubeSyncService.syncVideosForUserWithStatus('user-1');

      expect(mockTransaction.youTubeVideo.upsert).toHaveBeenCalledTimes(1);
      const [upsertPayload] = (mockTransaction.youTubeVideo.upsert as jest.Mock)
        .mock.calls[0];
      expect(upsertPayload.where).toEqual({
        userId_videoId: { userId: 'user-1', videoId: 'v1' },
      });
      expect(upsertPayload.create.watched).toBeUndefined();
      expect(upsertPayload.update).not.toHaveProperty('watched');
      expect(
        (mockTransaction.youTubeVideo.updateMany as jest.Mock).mock.calls.some(
          ([args]) => args?.data?.watched === true,
        ),
      ).toBe(false);
      expect(mockPrisma.youTubeVideo.updateMany).not.toHaveBeenCalled();

      // Restore the default stubs so later tests see the factory defaults.
      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([]);
      (mockTransaction.youTubeVideo.findMany as jest.Mock).mockResolvedValue(
        [],
      );
      (mockTransaction.youTubeVideo.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });
    });

    it('should cap a successful snapshot at 100 videos', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          encrypted_access_token: 'encrypted_access',
          encrypted_refresh_token: 'encrypted_refresh',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          status: 'connected',
        },
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockImplementation(
        (args: { where?: { enabled?: boolean } }) => {
          if (args?.where?.enabled === true) {
            return [
              {
                id: 'sub-1',
                userId: 'user-1',
                channelId: 'ch-1',
                uploadsPlaylistId: 'pl-1',
                enabled: true,
              },
            ];
          }
          return [];
        },
      );
      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([]);

      const videoIds = Array.from(
        { length: 100 },
        (_, index) => `v${index + 1}`,
      );
      const mockYoutube = require('googleapis').google.youtube();
      mockYoutube.playlistItems.list.mockImplementation(
        (args: { pageToken?: string }) => {
          if (args?.pageToken === 'page-2') {
            return {
              data: {
                items: videoIds.slice(50).map((videoId) => ({
                  snippet: { resourceId: { videoId } },
                })),
              },
            };
          }
          return {
            data: {
              items: videoIds.slice(0, 50).map((videoId) => ({
                snippet: { resourceId: { videoId } },
              })),
              nextPageToken: 'page-2',
            },
          };
        },
      );
      mockYoutube.videos.list.mockResolvedValue({
        data: {
          items: videoIds.map((videoId) => ({
            id: videoId,
            snippet: {
              title: `Video ${videoId}`,
              thumbnails: { medium: { url: `https://img.test/${videoId}` } },
              publishedAt: '2026-01-01T00:00:00Z',
            },
          })),
        },
      });

      const result =
        await youtubeSyncService.syncVideosForUserWithStatus('user-1');

      expect(result.videosSynced).toBe(100);
      expect(
        mockPrisma.__transaction.youTubeVideo.upsert,
      ).toHaveBeenCalledTimes(100);
    });

    it('should not perform transaction when snapshot is unchanged', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          encrypted_access_token: 'encrypted_access',
          encrypted_refresh_token: 'encrypted_refresh',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          status: 'connected',
        },
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'sub-1',
          userId: 'user-1',
          channelId: 'ch-1',
          uploadsPlaylistId: 'pl-1',
          enabled: true,
        },
      ]);

      // Existing DB and snapshot will match exactly (including durationSeconds)
      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([
        {
          videoId: 'v1',
          title: 'Same',
          thumbnail: 't1',
          publishedAt: new Date('2026-01-01'),
          durationSeconds: null,
        },
      ]);

      const mockYoutube = require('googleapis').google.youtube();
      mockYoutube.playlistItems.list.mockResolvedValue({
        data: { items: [{ snippet: { resourceId: { videoId: 'v1' } } }] },
      });
      mockYoutube.videos.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'v1',
              snippet: {
                title: 'Same',
                thumbnails: { medium: { url: 't1' } },
                publishedAt: '2026-01-01T00:00:00Z',
              },
              // No contentDetails means durationSeconds will be null, matching existing
            },
          ],
        },
      });

      const result =
        await youtubeSyncService.syncVideosForUserWithStatus('user-1');

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(result.videosSynced).toBe(0);
    });

    it('should retain last-good snapshot on fetch failure', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          encrypted_access_token: 'encrypted_access',
          encrypted_refresh_token: 'encrypted_refresh',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          status: 'connected',
        },
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockImplementation(
        (args: { where?: { enabled?: boolean } }) => {
          if (args?.where?.enabled === true) {
            return [
              {
                id: 'sub-1',
                userId: 'user-1',
                channelId: 'ch-err',
                uploadsPlaylistId: 'pl-err',
                enabled: true,
              },
            ];
          }
          return [];
        },
      );

      const mockYoutube = require('googleapis').google.youtube();
      mockYoutube.playlistItems.list.mockRejectedValue(
        new Error('network failure'),
      );

      await youtubeSyncService.syncVideosForUserWithStatus('user-1');

      // Should mark lastSyncStatus as failed and should not have deleted cached rows
      expect(mockPrisma.youTubeIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          data: expect.objectContaining({ lastSyncStatus: 'failed' }),
        }),
      );

      expect(mockPrisma.youTubeVideo.deleteMany).not.toHaveBeenCalled();

      // Subscription is updated with the channel sync error, but lastSyncedAt is NOT included
      // (preserving the last-good snapshot). Assert the invariant explicitly.
      const failureCall = (
        mockPrisma.youTubeSubscription.update as jest.Mock
      ).mock.calls.find(
        ([args]) =>
          args.data?.lastSyncError === 'syncFailed' &&
          args.data?.lastSyncAttemptAt,
      );
      expect(failureCall).toBeDefined();
      expect(failureCall[0].data).toHaveProperty('lastSyncError', 'syncFailed');
      expect(failureCall[0].data).toHaveProperty('lastSyncAttemptAt');
      expect(failureCall[0].data).not.toHaveProperty('lastSyncedAt');
    });

    it('should prune expired disabled channel videos during sync', async () => {
      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockImplementation(
        (args: { where?: { enabled?: boolean } }) => {
          if (args?.where?.enabled === false) {
            return [{ channelId: 'ch-expired' }];
          }
          return [];
        },
      );

      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          status: 'connected',
        },
      );

      await youtubeSyncService.syncVideosForUserWithStatus('user-1');

      expect(mockPrisma.youTubeVideo.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', channelId: { in: ['ch-expired'] } },
        }),
      );
    });

    describe('ADR 0096 Channel Sync and Upload Sync phase split', () => {
      const noopUploadStatusFields = {
        status: 'success' as const,
        lastSyncedAt: null,
        lastSyncAttemptAt: null,
        lastSyncError: null,
        retryAt: null,
        progress: null,
        channelStatus: 'never' as const,
        channelLastAttemptAt: null,
        channelLastError: null,
        channelRetryAt: null,
      };

      it('syncChannels should sync subscriptions only when not in cooldown', async () => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          lastChannelSyncAt: null,
          ...defaultChannelSyncFields,
        });

        (
          mockPrisma.youTubeIntegration.updateMany as jest.Mock
        ).mockResolvedValue({ count: 1 });

        const subscriptions = [
          {
            channelId: 'ch-1',
            channelTitle: 'Test Channel',
            channelThumbnail: null,
            uploadsPlaylistId: 'pl-1',
          },
        ];
        const subsSpy = jest
          .spyOn(youtubeSyncService, 'syncSubscriptions')
          .mockResolvedValue(subscriptions);
        const videosSpy = jest.spyOn(
          youtubeSyncService,
          'syncVideosForUserWithStatus',
        );

        const result = await youtubeSyncService.syncChannels('user-1');

        expect(subsSpy).toHaveBeenCalledWith('user-1');
        expect(videosSpy).not.toHaveBeenCalled();
        expect(result.status).toBe('success');
        expect(result.synced).toBe(subscriptions.length);
      });

      it('syncChannels should return cooldown when lastChannelSyncAt is within 5 minutes', async () => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          ...defaultChannelSyncFields,
          lastChannelSyncAt: new Date(),
        });

        const subsSpy = jest.spyOn(youtubeSyncService, 'syncSubscriptions');
        const result = await youtubeSyncService.syncChannels('user-1');

        expect(result.status).toBe('cooldown');
        expect(result.synced).toBe(0);
        expect(result.retryAt).toBeInstanceOf(Date);
        expect(subsSpy).not.toHaveBeenCalled();
      });

      it('syncChannels should restore lastChannelSyncAt when upload sync blocks the claim', async () => {
        const priorChannelSyncAt = new Date('2026-08-01T10:00:00Z');
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          ...defaultChannelSyncFields,
          lastChannelSyncAt: priorChannelSyncAt,
          lastSyncStatus: 'running',
          lastSyncAttemptAt: new Date(),
        });

        let updateManyCallCount = 0;
        (
          mockPrisma.youTubeIntegration.updateMany as jest.Mock
        ).mockImplementation(async () => {
          updateManyCallCount += 1;
          if (updateManyCallCount === 1) {
            return { count: 1 };
          }
          return { count: 0 };
        });

        const subsSpy = jest.spyOn(youtubeSyncService, 'syncSubscriptions');

        const result = await youtubeSyncService.syncChannels('user-1');

        expect(mockPrisma.youTubeIntegration.update).toHaveBeenCalledWith({
          where: { userId: 'user-1' },
          data: { lastChannelSyncAt: priorChannelSyncAt },
        });
        expect(subsSpy).not.toHaveBeenCalled();
        expect(result.synced).toBe(0);
      });

      it('syncChannels should throw when YouTube is not connected', async () => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue(null);

        await expect(youtubeSyncService.syncChannels('user-1')).rejects.toThrow(
          'YouTube account is not connected.',
        );
        expect(mockPrisma.youTubeIntegration.updateMany).not.toHaveBeenCalled();
      });

      it('syncChannels should store channel quota_exceeded without touching upload sync state', async () => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          lastChannelSyncAt: null,
          ...defaultChannelSyncFields,
        });

        (
          mockPrisma.youTubeIntegration.updateMany as jest.Mock
        ).mockResolvedValue({ count: 1 });

        const quotaError = new Error('quotaExceeded');
        jest
          .spyOn(youtubeSyncService, 'syncSubscriptions')
          .mockRejectedValue(quotaError);

        const result = await youtubeSyncService.syncChannels('user-1');

        expect(result.status).toBe('quota_exceeded');
        expect(result.synced).toBe(0);
        expect(mockLogger.error).toHaveBeenCalledTimes(1);
        expect(mockLogger.error).toHaveBeenCalledWith(
          `YouTube channel sync failed for user user-1: quotaExceeded`,
          { stack: quotaError.stack },
        );
        expect(mockPrisma.youTubeIntegration.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { userId: 'user-1' },
            data: expect.objectContaining({
              lastChannelSyncStatus: 'quota_exceeded',
              lastChannelSyncError: 'quotaExceeded',
            }),
          }),
        );
        const uploadStateUpdate = (
          mockPrisma.youTubeIntegration.update as jest.Mock
        ).mock.calls.find(([args]) => args.data?.lastSyncStatus !== undefined);
        expect(uploadStateUpdate).toBeUndefined();
      });

      it('syncChannels should log the real error and store syncFailed when subscription sync throws', async () => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          lastChannelSyncAt: null,
          ...defaultChannelSyncFields,
        });

        (
          mockPrisma.youTubeIntegration.updateMany as jest.Mock
        ).mockResolvedValue({ count: 1 });

        const subError = new Error('subscriptions unavailable');
        jest
          .spyOn(youtubeSyncService, 'syncSubscriptions')
          .mockRejectedValue(subError);

        const result = await youtubeSyncService.syncChannels('user-1');

        expect(result.status).toBe('failed');
        expect(result.synced).toBe(0);
        expect(mockLogger.error).toHaveBeenCalledTimes(1);
        expect(mockLogger.error).toHaveBeenCalledWith(
          `YouTube channel sync failed for user user-1: subscriptions unavailable`,
          { stack: subError.stack },
        );
        expect(mockPrisma.youTubeIntegration.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { userId: 'user-1' },
            data: expect.objectContaining({
              lastChannelSyncStatus: 'failed',
              lastChannelSyncError: 'syncFailed',
            }),
          }),
        );
        const uploadStateUpdate = (
          mockPrisma.youTubeIntegration.update as jest.Mock
        ).mock.calls.find(([args]) => args.data?.lastSyncStatus !== undefined);
        expect(uploadStateUpdate).toBeUndefined();
      });

      const oauthGrantRevokedCode = ['invalid', 'grant'].join('_');
      const googleRefreshRevokedMessage = 'Token has been expired or revoked';

      it('markRevokedIfTokenError should mark integration revoked on OAuth grant errors', async () => {
        const grantError = new Error(oauthGrantRevokedCode);
        (
          mockPrisma.youTubeIntegration.updateMany as jest.Mock
        ).mockResolvedValueOnce({ count: 1 });

        const marked = await youtubeSyncService.markRevokedIfTokenError(
          'user-1',
          grantError,
        );

        expect(marked).toBe(true);
        expect(mockPrisma.youTubeIntegration.updateMany).toHaveBeenCalledWith({
          where: { userId: 'user-1', revokedAt: null },
          data: { status: 'revoked', revokedAt: expect.any(Date) },
        });
        expect(mockPrisma.youTubeIntegration.update).not.toHaveBeenCalled();
      });

      describe('ADR 0129 revokedAt stamp', () => {
        afterEach(() => {
          jest.useRealTimers();
        });

        it('stamps revokedAt with the moment of the first revocation', async () => {
          const firstRevokedAt = new Date('2026-10-01T09:00:00Z');
          jest.useFakeTimers({ now: firstRevokedAt });
          (
            mockPrisma.youTubeIntegration.updateMany as jest.Mock
          ).mockResolvedValueOnce({ count: 1 });

          await youtubeSyncService.markRevokedIfTokenError(
            'user-1',
            new Error(oauthGrantRevokedCode),
          );

          expect(mockPrisma.youTubeIntegration.updateMany).toHaveBeenCalledWith(
            {
              where: { userId: 'user-1', revokedAt: null },
              data: { status: 'revoked', revokedAt: firstRevokedAt },
            },
          );
          expect(mockPrisma.youTubeIntegration.update).not.toHaveBeenCalled();
        });

        it('keeps the original revokedAt on a repeat detection by falling back to a status-only update', async () => {
          (
            mockPrisma.youTubeIntegration.updateMany as jest.Mock
          ).mockResolvedValueOnce({ count: 0 });

          const marked = await youtubeSyncService.markRevokedIfTokenError(
            'user-1',
            new Error(oauthGrantRevokedCode),
          );

          expect(marked).toBe(true);
          expect(mockPrisma.youTubeIntegration.updateMany).toHaveBeenCalledWith(
            {
              where: { userId: 'user-1', revokedAt: null },
              data: { status: 'revoked', revokedAt: expect.any(Date) },
            },
          );
          expect(mockPrisma.youTubeIntegration.update).toHaveBeenCalledTimes(1);
          expect(mockPrisma.youTubeIntegration.update).toHaveBeenCalledWith({
            where: { userId: 'user-1' },
            data: { status: 'revoked' },
          });
          const [updateArgs] = (
            mockPrisma.youTubeIntegration.update as jest.Mock
          ).mock.calls[0];
          expect(updateArgs.data).not.toHaveProperty('revokedAt');
        });
      });

      it('markRevokedIfTokenError should not update integration for unrelated errors', async () => {
        const marked = await youtubeSyncService.markRevokedIfTokenError(
          'user-1',
          new Error('Network error'),
        );

        expect(marked).toBe(false);
        expect(mockPrisma.youTubeIntegration.update).not.toHaveBeenCalled();
      });

      it('syncChannels should mark integration revoked and record channel syncFailed on OAuth grant errors', async () => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          lastChannelSyncAt: null,
          ...defaultChannelSyncFields,
        });

        (
          mockPrisma.youTubeIntegration.updateMany as jest.Mock
        ).mockResolvedValue({ count: 1 });

        const grantError = new Error(oauthGrantRevokedCode);
        jest
          .spyOn(youtubeSyncService, 'syncSubscriptions')
          .mockRejectedValue(grantError);

        const result = await youtubeSyncService.syncChannels('user-1');

        expect(result.status).toBe('failed');
        expect(result.synced).toBe(0);
        expect(mockPrisma.youTubeIntegration.updateMany).toHaveBeenCalledWith({
          where: { userId: 'user-1', revokedAt: null },
          data: { status: 'revoked', revokedAt: expect.any(Date) },
        });
        expect(mockPrisma.youTubeIntegration.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { userId: 'user-1' },
            data: expect.objectContaining({
              lastChannelSyncStatus: 'failed',
              lastChannelSyncError: 'syncFailed',
            }),
          }),
        );
      });

      it('syncChannels should mark integration revoked when Google reports refresh token revoked', async () => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          lastChannelSyncAt: null,
          ...defaultChannelSyncFields,
        });

        (
          mockPrisma.youTubeIntegration.updateMany as jest.Mock
        ).mockResolvedValue({ count: 1 });

        jest
          .spyOn(youtubeSyncService, 'syncSubscriptions')
          .mockRejectedValue(new Error(googleRefreshRevokedMessage));

        const result = await youtubeSyncService.syncChannels('user-1');

        expect(result.status).toBe('failed');
        expect(mockPrisma.youTubeIntegration.updateMany).toHaveBeenCalledWith({
          where: { userId: 'user-1', revokedAt: null },
          data: { status: 'revoked', revokedAt: expect.any(Date) },
        });
      });

      it('syncChannels should not mark integration revoked on non-grant failures', async () => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          lastChannelSyncAt: null,
          ...defaultChannelSyncFields,
        });

        (
          mockPrisma.youTubeIntegration.updateMany as jest.Mock
        ).mockResolvedValue({ count: 1 });

        jest
          .spyOn(youtubeSyncService, 'syncSubscriptions')
          .mockRejectedValue(new Error('Network error'));

        await youtubeSyncService.syncChannels('user-1');

        const revokedWrites = [
          ...(mockPrisma.youTubeIntegration.update as jest.Mock).mock.calls,
          ...(mockPrisma.youTubeIntegration.updateMany as jest.Mock).mock.calls,
        ].filter(
          ([args]: [{ data?: { status?: string } }]) =>
            args.data?.status === 'revoked',
        );
        expect(revokedWrites).toHaveLength(0);
      });

      it('syncUploads should mark integration revoked when video sync fails with OAuth grant errors', async () => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          lastManualRefreshAt: null,
          ...defaultChannelSyncFields,
        });

        (
          mockPrisma.youTubeIntegration.updateMany as jest.Mock
        ).mockResolvedValue({ count: 1 });

        const grantError = new Error(oauthGrantRevokedCode);
        jest
          .spyOn(youtubeSyncService, 'syncVideosForUserWithStatus')
          .mockRejectedValue(grantError);

        jest.spyOn(youtubeSyncService, 'getSyncStatus').mockResolvedValue({
          ...noopUploadStatusFields,
          status: 'failed',
          lastSyncError: 'syncFailed',
        });

        const result = await youtubeSyncService.syncUploads('user-1');

        expect(result.status).toBe('failed');
        expect(mockPrisma.youTubeIntegration.updateMany).toHaveBeenCalledWith({
          where: { userId: 'user-1', revokedAt: null },
          data: { status: 'revoked', revokedAt: expect.any(Date) },
        });
        expect(mockPrisma.youTubeIntegration.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { userId: 'user-1' },
            data: expect.objectContaining({
              lastSyncStatus: 'failed',
              lastSyncError: 'syncFailed',
            }),
          }),
        );
      });

      it('syncUploads should delegate to syncVideosForUserWithStatus with claimedAt', async () => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          lastManualRefreshAt: null,
          ...defaultChannelSyncFields,
        });

        (
          mockPrisma.youTubeIntegration.updateMany as jest.Mock
        ).mockResolvedValue({ count: 1 });

        const subsSpy = jest.spyOn(youtubeSyncService, 'syncSubscriptions');
        const videosSpy = jest
          .spyOn(youtubeSyncService, 'syncVideosForUserWithStatus')
          .mockResolvedValue({
            subscriptionsSynced: 0,
            videosSynced: 3,
            ...noopUploadStatusFields,
          });

        const result = await youtubeSyncService.syncUploads('user-1');

        expect(videosSpy).toHaveBeenCalledWith('user-1', {
          claimedAt: expect.any(Date),
        });
        expect(subsSpy).not.toHaveBeenCalled();
        expect(result.videosSynced).toBe(3);
      });

      it('syncUploads should return cooldown when lastManualRefreshAt is within 15 minutes', async () => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          ...defaultChannelSyncFields,
          lastManualRefreshAt: new Date(),
        });

        const videosSpy = jest.spyOn(
          youtubeSyncService,
          'syncVideosForUserWithStatus',
        );
        const result = await youtubeSyncService.syncUploads('user-1');

        expect(result.status).toBe('cooldown');
        expect(result.videosSynced).toBe(0);
        expect(videosSpy).not.toHaveBeenCalled();
      });

      it('syncUploads should restore lastManualRefreshAt when channel sync blocks the claim', async () => {
        const priorManualRefreshAt = new Date('2026-08-01T10:00:00Z');
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          lastManualRefreshAt: priorManualRefreshAt,
          lastChannelSyncStatus: 'discovering',
          lastChannelSyncAt: new Date(),
          lastChannelSyncError: null,
        });

        let updateManyCallCount = 0;
        (
          mockPrisma.youTubeIntegration.updateMany as jest.Mock
        ).mockImplementation(async () => {
          updateManyCallCount += 1;
          if (updateManyCallCount === 1) {
            return { count: 1 };
          }
          return { count: 0 };
        });

        jest.spyOn(youtubeSyncService, 'getSyncStatus').mockResolvedValue({
          ...noopUploadStatusFields,
          status: 'running',
        });

        const videosSpy = jest.spyOn(
          youtubeSyncService,
          'syncVideosForUserWithStatus',
        );

        const result = await youtubeSyncService.syncUploads('user-1');

        expect(mockPrisma.youTubeIntegration.update).toHaveBeenCalledWith({
          where: { userId: 'user-1' },
          data: { lastManualRefreshAt: priorManualRefreshAt },
        });
        expect(videosSpy).not.toHaveBeenCalled();
        expect(result.videosSynced).toBe(0);
        expect(result.subscriptionsSynced).toBe(0);
      });

      it('syncUploads should restore null lastManualRefreshAt when claim is lost and none existed', async () => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          lastManualRefreshAt: null,
          lastChannelSyncStatus: 'discovering',
          lastChannelSyncAt: new Date(),
          lastChannelSyncError: null,
        });

        let updateManyCallCount = 0;
        (
          mockPrisma.youTubeIntegration.updateMany as jest.Mock
        ).mockImplementation(async () => {
          updateManyCallCount += 1;
          if (updateManyCallCount === 1) {
            return { count: 1 };
          }
          return { count: 0 };
        });

        jest.spyOn(youtubeSyncService, 'getSyncStatus').mockResolvedValue({
          ...noopUploadStatusFields,
          status: 'running',
        });

        await youtubeSyncService.syncUploads('user-1');

        expect(mockPrisma.youTubeIntegration.update).toHaveBeenCalledWith({
          where: { userId: 'user-1' },
          data: { lastManualRefreshAt: null },
        });
      });

      it('syncUploads should not invoke video sync when upload claim is lost', async () => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          lastManualRefreshAt: new Date('2026-08-01T10:00:00Z'),
          lastChannelSyncStatus: 'discovering',
          lastChannelSyncAt: new Date(),
          lastChannelSyncError: null,
        });

        let updateManyCallCount = 0;
        (
          mockPrisma.youTubeIntegration.updateMany as jest.Mock
        ).mockImplementation(async () => {
          updateManyCallCount += 1;
          if (updateManyCallCount === 1) {
            return { count: 1 };
          }
          return { count: 0 };
        });

        jest.spyOn(youtubeSyncService, 'getSyncStatus').mockResolvedValue({
          ...noopUploadStatusFields,
          status: 'running',
        });

        const mockYoutube = require('googleapis').google.youtube();
        const videosSpy = jest.spyOn(
          youtubeSyncService,
          'syncVideosForUserWithStatus',
        );

        await youtubeSyncService.syncUploads('user-1');

        expect(mockYoutube.playlistItems.list).not.toHaveBeenCalled();
        expect(videosSpy).not.toHaveBeenCalled();
      });

      it('syncUploads should not restore lastManualRefreshAt when claim succeeds', async () => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          lastManualRefreshAt: new Date('2026-08-01T10:00:00Z'),
          encrypted_access_token: 'token-a',
          encrypted_refresh_token: 'token-r',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          ...defaultChannelSyncFields,
        });

        (
          mockPrisma.youTubeIntegration.updateMany as jest.Mock
        ).mockResolvedValue({ count: 1 });

        jest
          .spyOn(youtubeSyncService, 'syncVideosForUserWithStatus')
          .mockResolvedValue({
            subscriptionsSynced: 1,
            videosSynced: 5,
            ...noopUploadStatusFields,
          });

        await youtubeSyncService.syncUploads('user-1');

        const updateCalls = (mockPrisma.youTubeIntegration.update as jest.Mock)
          .mock.calls;
        const restoredManualRefresh = updateCalls.some(
          ([args]) => args.data?.lastManualRefreshAt !== undefined,
        );
        expect(restoredManualRefresh).toBe(false);
      });

      it('syncUploads should throw when YouTube is not connected', async () => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'disconnected',
          ...defaultChannelSyncFields,
        });

        await expect(youtubeSyncService.syncUploads('user-1')).rejects.toThrow(
          'YouTube account is not connected.',
        );
        expect(mockPrisma.youTubeSubscription.count).not.toHaveBeenCalled();
      });

      it('syncUploads should return the noop result and claim nothing when no channel is enabled', async () => {
        const lastSyncAttemptAt = new Date('2026-01-01');
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          lastManualRefreshAt: null,
          lastSyncStatus: 'success',
          lastSyncAttemptAt,
          lastSyncError: null,
          ...defaultChannelSyncFields,
        });
        (
          mockPrisma.youTubeSubscription.count as jest.Mock
        ).mockResolvedValueOnce(0);

        const videosSpy = jest.spyOn(
          youtubeSyncService,
          'syncVideosForUserWithStatus',
        );

        const result = await youtubeSyncService.syncUploads('user-1');

        expect(result).toEqual({
          subscriptionsSynced: 0,
          videosSynced: 0,
          status: 'success',
          lastSyncedAt: null,
          lastSyncAttemptAt,
          lastSyncError: null,
          retryAt: null,
          progress: null,
          channelStatus: 'never',
          channelLastAttemptAt: null,
          channelLastError: null,
          channelRetryAt: null,
        });
        expect(mockPrisma.youTubeSubscription.count).toHaveBeenCalledWith({
          where: { userId: 'user-1', enabled: true },
        });
        expect(mockPrisma.youTubeIntegration.updateMany).not.toHaveBeenCalled();
        expect(mockPrisma.youTubeIntegration.update).not.toHaveBeenCalled();
        expect(videosSpy).not.toHaveBeenCalled();
      });

      it('syncUploads should stay a no-op without touching the stamp when no channel is enabled during an active cooldown', async () => {
        const lastManualRefreshAt = new Date(Date.now() - 60 * 1000);
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          lastManualRefreshAt,
          lastSyncStatus: 'success',
          lastSyncAttemptAt: new Date('2026-01-01'),
          lastSyncError: null,
          ...defaultChannelSyncFields,
        });
        (
          mockPrisma.youTubeSubscription.count as jest.Mock
        ).mockResolvedValueOnce(0);

        const videosSpy = jest.spyOn(
          youtubeSyncService,
          'syncVideosForUserWithStatus',
        );

        const result = await youtubeSyncService.syncUploads('user-1');

        expect(result.status).toBe('success');
        expect(result.status).not.toBe('cooldown');
        expect(result.videosSynced).toBe(0);
        expect(result.subscriptionsSynced).toBe(0);
        expect(result.retryAt).toEqual(
          new Date(lastManualRefreshAt.getTime() + UPLOAD_SYNC_COOLDOWN_MS),
        );
        expect(mockPrisma.youTubeIntegration.updateMany).not.toHaveBeenCalled();
        expect(mockPrisma.youTubeIntegration.update).not.toHaveBeenCalled();
        expect(videosSpy).not.toHaveBeenCalled();
      });

      it('syncUploads should record upload failure via recordSyncState when video sync throws', async () => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          lastManualRefreshAt: null,
          ...defaultChannelSyncFields,
        });

        (
          mockPrisma.youTubeIntegration.updateMany as jest.Mock
        ).mockResolvedValue({ count: 1 });

        const networkError = new Error('network failure');
        jest
          .spyOn(youtubeSyncService, 'syncVideosForUserWithStatus')
          .mockRejectedValue(networkError);

        jest.spyOn(youtubeSyncService, 'getSyncStatus').mockResolvedValue({
          ...noopUploadStatusFields,
          status: 'failed',
          lastSyncError: 'syncFailed',
        });

        const result = await youtubeSyncService.syncUploads('user-1');

        expect(mockLogger.error).toHaveBeenCalledTimes(1);
        expect(mockLogger.error).toHaveBeenCalledWith(
          `YouTube upload sync failed for user user-1: network failure`,
          { stack: networkError.stack },
        );
        expect(mockPrisma.youTubeIntegration.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { userId: 'user-1' },
            data: expect.objectContaining({
              lastSyncStatus: 'failed',
              lastSyncError: 'syncFailed',
            }),
          }),
        );
        expect(result.status).toBe('failed');
      });

      it('syncUploads should log an auth failure once from the returning handler and store syncFailed', async () => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          ...connectedIntegration,
          lastManualRefreshAt: null,
        });

        (
          mockPrisma.youTubeIntegration.updateMany as jest.Mock
        ).mockResolvedValue({ count: 1 });

        (
          mockPrisma.youTubeSubscription.findMany as jest.Mock
        ).mockImplementation((args: { where?: { enabled?: boolean } }) => {
          if (args?.where?.enabled === true) {
            return [
              {
                id: 'sub-1',
                userId: 'user-1',
                channelId: 'ch-1',
                uploadsPlaylistId: 'pl-1',
                enabled: true,
              },
            ];
          }
          return [];
        });

        const authError = new Error('token decrypt failed');
        (decryptToken as jest.Mock).mockImplementationOnce(() => {
          throw authError;
        });

        jest.spyOn(youtubeSyncService, 'getSyncStatus').mockResolvedValue({
          ...noopUploadStatusFields,
          status: 'failed',
          lastSyncError: 'syncFailed',
        });

        const mockYoutube = require('googleapis').google.youtube();

        const result = await youtubeSyncService.syncUploads('user-1');

        expect(mockLogger.error).toHaveBeenCalledTimes(1);
        expect(mockLogger.error).toHaveBeenCalledWith(
          `YouTube upload sync failed for user user-1: token decrypt failed`,
          { stack: authError.stack },
        );
        expect(mockPrisma.youTubeIntegration.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { userId: 'user-1' },
            data: expect.objectContaining({
              lastSyncStatus: 'failed',
              lastSyncError: 'syncFailed',
            }),
          }),
        );
        expect(mockYoutube.playlistItems.list).not.toHaveBeenCalled();
        expect(result.status).toBe('failed');
      });

      it('syncUploads should log a non-Error failure without a stack and store syncFailed', async () => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          lastManualRefreshAt: null,
          ...defaultChannelSyncFields,
        });

        (
          mockPrisma.youTubeIntegration.updateMany as jest.Mock
        ).mockResolvedValue({ count: 1 });

        jest
          .spyOn(youtubeSyncService, 'syncVideosForUserWithStatus')
          .mockRejectedValue('plain failure');

        jest.spyOn(youtubeSyncService, 'getSyncStatus').mockResolvedValue({
          ...noopUploadStatusFields,
          status: 'failed',
          lastSyncError: 'syncFailed',
        });

        const result = await youtubeSyncService.syncUploads('user-1');

        expect(mockLogger.error).toHaveBeenCalledTimes(1);
        expect(mockLogger.error).toHaveBeenCalledWith(
          `YouTube upload sync failed for user user-1: "plain failure"`,
        );
        expect(mockPrisma.youTubeIntegration.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { userId: 'user-1' },
            data: expect.objectContaining({
              lastSyncStatus: 'failed',
              lastSyncError: 'syncFailed',
            }),
          }),
        );
        expect(result.status).toBe('failed');
      });

      it('syncUploads should log a non-serializable failure with its string form and store syncFailed', async () => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          status: 'connected',
          lastManualRefreshAt: null,
          ...defaultChannelSyncFields,
        });

        (
          mockPrisma.youTubeIntegration.updateMany as jest.Mock
        ).mockResolvedValue({ count: 1 });

        const circular = { reason: 'loop' } as {
          reason: string;
          self?: unknown;
          toString: () => string;
        };
        circular.self = circular;
        circular.toString = () => 'circular sync failure';

        jest
          .spyOn(youtubeSyncService, 'syncVideosForUserWithStatus')
          .mockRejectedValue(circular);

        jest.spyOn(youtubeSyncService, 'getSyncStatus').mockResolvedValue({
          ...noopUploadStatusFields,
          status: 'failed',
          lastSyncError: 'syncFailed',
        });

        const result = await youtubeSyncService.syncUploads('user-1');

        expect(mockLogger.error).toHaveBeenCalledTimes(1);
        expect(mockLogger.error).toHaveBeenCalledWith(
          'YouTube upload sync failed for user user-1: circular sync failure',
        );
        expect(mockPrisma.youTubeIntegration.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { userId: 'user-1' },
            data: expect.objectContaining({
              lastSyncStatus: 'failed',
              lastSyncError: 'syncFailed',
            }),
          }),
        );
        expect(result.status).toBe('failed');
      });
    });

    it('should stop processing channels on quotaExceeded and report quota_exceeded', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          encrypted_access_token: 'encrypted_access',
          encrypted_refresh_token: 'encrypted_refresh',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          status: 'connected',
          lastSyncStatus: 'quota_exceeded',
          lastSyncError: 'quotaExceeded',
        },
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          id: 's1',
          channelId: 'c1',
          uploadsPlaylistId: 'p1',
          userId: 'user-1',
          enabled: true,
        },
        {
          id: 's2',
          channelId: 'c2',
          uploadsPlaylistId: 'p2',
          userId: 'user-1',
          enabled: true,
        },
      ]);

      const mockYoutube = require('googleapis').google.youtube();
      mockYoutube.playlistItems.list.mockRejectedValueOnce(
        new Error('quotaExceeded'),
      );

      const result =
        await youtubeSyncService.syncVideosForUserWithStatus('user-1');

      expect(mockYoutube.playlistItems.list).toHaveBeenCalledTimes(1);
      expect(mockPrisma.youTubeIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          data: expect.objectContaining({
            lastSyncStatus: 'quota_exceeded',
            lastSyncError: 'quotaExceeded',
          }),
        }),
      );
      expect(result.status).toBe('quota_exceeded');
    });

    describe('per-channel failures during an Upload Sync', () => {
      beforeEach(() => {
        (
          mockPrisma.youTubeIntegration.findUnique as jest.Mock
        ).mockResolvedValue({
          userId: 'user-1',
          encrypted_access_token: 'enc-at',
          encrypted_refresh_token: 'enc-rt',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          status: 'connected',
        });
        (
          mockPrisma.youTubeSubscription.findMany as jest.Mock
        ).mockImplementation((args: { where?: { enabled?: boolean } }) =>
          args?.where?.enabled === true
            ? [
                {
                  id: 'sub-1',
                  userId: 'user-1',
                  channelId: 'ch-1',
                  uploadsPlaylistId: 'pl-1',
                  enabled: true,
                },
                {
                  id: 'sub-2',
                  userId: 'user-1',
                  channelId: 'ch-2',
                  uploadsPlaylistId: 'pl-2',
                  enabled: true,
                },
              ]
            : [],
        );
      });

      // Rejects playlist fetches for the first channel with `error`; the
      // second channel's playlist returns no items.
      function failFirstChannelWith(error: Error) {
        const mockYoutube = require('googleapis').google.youtube();
        mockYoutube.playlistItems.list.mockImplementation(
          async ({ playlistId }: { playlistId: string }) => {
            if (playlistId === 'pl-1') {
              throw error;
            }
            return { data: { items: [] } };
          },
        );
        return mockYoutube;
      }

      it('rethrows a grant error from the first channel instead of swallowing it', async () => {
        const grantError = new Error('invalid_grant');
        failFirstChannelWith(grantError);

        await expect(
          youtubeSyncService.syncVideosForUserWithStatus('user-1'),
        ).rejects.toBe(grantError);
      });

      it('stops the run on a grant error and never requests the second channel uploads', async () => {
        const mockYoutube = failFirstChannelWith(new Error('invalid_grant'));

        await expect(
          youtubeSyncService.syncVideosForUserWithStatus('user-1'),
        ).rejects.toThrow('invalid_grant');

        expect(mockYoutube.playlistItems.list).toHaveBeenCalledTimes(1);
        expect(mockYoutube.playlistItems.list).not.toHaveBeenCalledWith(
          expect.objectContaining({ playlistId: 'pl-2' }),
        );
      });

      it('does not write a subscription lastSyncError for a grant error', async () => {
        failFirstChannelWith(new Error('invalid_grant'));

        await expect(
          youtubeSyncService.syncVideosForUserWithStatus('user-1'),
        ).rejects.toThrow('invalid_grant');

        expect(mockPrisma.youTubeSubscription.update).not.toHaveBeenCalled();
      });

      it('records the run as failed with the sync error code before rethrowing a grant error', async () => {
        failFirstChannelWith(new Error('invalid_grant'));

        await expect(
          youtubeSyncService.syncVideosForUserWithStatus('user-1'),
        ).rejects.toThrow('invalid_grant');

        expect(mockPrisma.youTubeIntegration.update).toHaveBeenCalledWith({
          where: { userId: 'user-1' },
          data: {
            lastSyncAttemptAt: expect.any(Date),
            lastSyncStatus: 'failed',
            lastSyncError: 'syncFailed',
          },
        });
      });

      it('marks the run failed, not partial, when a grant error hits a later channel after an earlier channel succeeded', async () => {
        const mockYoutube = require('googleapis').google.youtube();
        mockYoutube.playlistItems.list.mockImplementation(
          async ({ playlistId }: { playlistId: string }) => {
            if (playlistId === 'pl-2') {
              throw new Error('invalid_grant');
            }
            return { data: { items: [] } };
          },
        );

        await expect(
          youtubeSyncService.syncVideosForUserWithStatus('user-1'),
        ).rejects.toThrow('invalid_grant');

        expect(mockPrisma.youTubeIntegration.update).toHaveBeenCalledWith({
          where: { userId: 'user-1' },
          data: {
            lastSyncAttemptAt: expect.any(Date),
            lastSyncStatus: 'failed',
            lastSyncError: 'syncFailed',
          },
        });
        const channelTwoErrorWrites = (
          mockPrisma.youTubeSubscription.update as jest.Mock
        ).mock.calls.filter(
          ([args]) => args.where?.id === 'sub-2' && args.data?.lastSyncError,
        );
        expect(channelTwoErrorWrites).toEqual([]);
      });

      it('keeps syncing the next channel when the first channel fails with a non-grant error', async () => {
        const mockYoutube = failFirstChannelWith(
          new Error('Request failed with status code 404'),
        );

        await expect(
          youtubeSyncService.syncVideosForUserWithStatus('user-1'),
        ).resolves.toMatchObject({ subscriptionsSynced: 1 });

        expect(mockYoutube.playlistItems.list).toHaveBeenCalledWith(
          expect.objectContaining({ playlistId: 'pl-2' }),
        );
        expect(mockPrisma.youTubeSubscription.update).toHaveBeenCalledWith({
          where: { id: 'sub-1' },
          data: expect.objectContaining({ lastSyncError: 'syncFailed' }),
        });
        expect(mockPrisma.youTubeSubscription.update).toHaveBeenCalledWith({
          where: { id: 'sub-2' },
          data: expect.objectContaining({
            lastSyncedAt: expect.any(Date),
            lastSyncError: null,
          }),
        });
        expect(mockPrisma.youTubeIntegration.update).toHaveBeenCalledWith({
          where: { userId: 'user-1' },
          data: expect.objectContaining({
            lastSyncStatus: 'partial',
            lastSyncError: 'syncFailed',
          }),
        });
      });
    });
  });

  describe('getVideos', () => {
    it('should query with correct sort order for latest', async () => {
      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.youTubeVideo.count as jest.Mock).mockResolvedValue(0);

      const result = await youtubeSyncService.getVideos('user-1', {
        sort: 'latest',
      });

      expect(result.page).toBe(1);
      expect(result.videos).toEqual([]);
      expect(mockPrisma.youTubeVideo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { publishedAt: 'desc' },
        }),
      );
    });

    it('should query with A-Z sort', async () => {
      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.youTubeVideo.count as jest.Mock).mockResolvedValue(0);

      await youtubeSyncService.getVideos('user-1', { sort: 'az' });

      expect(mockPrisma.youTubeVideo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { title: 'asc' },
        }),
      );
    });

    it('should include search filter when provided', async () => {
      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.youTubeVideo.count as jest.Mock).mockResolvedValue(0);

      await youtubeSyncService.getVideos('user-1', {
        search: 'tutorial',
      });

      expect(mockPrisma.youTubeVideo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            title: { contains: 'tutorial', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('should paginate correctly', async () => {
      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.youTubeVideo.count as jest.Mock).mockResolvedValue(50);

      const result = await youtubeSyncService.getVideos('user-1', {
        page: 2,
        limit: 10,
      });

      expect(result.totalPages).toBe(5);
      expect(mockPrisma.youTubeVideo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
    });
  });

  describe('setVideoWatched', () => {
    it('should update watched state to true and return affected count', async () => {
      (mockPrisma.youTubeVideo.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const count = await youtubeSyncService.setVideoWatched(
        'user-1',
        'v1',
        true,
      );

      expect(mockPrisma.youTubeVideo.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', videoId: 'v1' },
        data: { watched: true },
      });
      expect(count).toBe(1);
    });

    it('should update watched state to false and return affected count', async () => {
      (mockPrisma.youTubeVideo.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const count = await youtubeSyncService.setVideoWatched(
        'user-1',
        'v1',
        false,
      );

      expect(mockPrisma.youTubeVideo.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', videoId: 'v1' },
        data: { watched: false },
      });
      expect(count).toBe(1);
    });

    it('should return 0 when no video matched the criteria', async () => {
      (mockPrisma.youTubeVideo.updateMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      const count = await youtubeSyncService.setVideoWatched(
        'user-1',
        'v-nonexistent',
        true,
      );

      expect(mockPrisma.youTubeVideo.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', videoId: 'v-nonexistent' },
        data: { watched: true },
      });
      expect(count).toBe(0);
    });
  });

  describe('getNotificationSettings', () => {
    it('should return stored settings', async () => {
      (
        mockPrisma.youTubeNotificationSettings.findUnique as jest.Mock
      ).mockResolvedValue({
        enabled: true,
        lastNotifiedAt: null,
        preferredWeekday: 4,
        timeZone: 'Australia/Sydney',
      });

      const settings =
        await youtubeSyncService.getNotificationSettings('user-1');
      expect(settings.enabled).toBe(true);
      expect(settings.preferredWeekday).toBe(4);
      expect(settings.timeZone).toBe('Australia/Sydney');
    });

    it('should return defaults when no settings exist', async () => {
      (
        mockPrisma.youTubeNotificationSettings.findUnique as jest.Mock
      ).mockResolvedValue(null);

      const settings =
        await youtubeSyncService.getNotificationSettings('user-1');
      // Absent settings read as opted out, never as opted in.
      expect(settings.enabled).toBe(false);
      expect(settings.preferredWeekday).toBe(1);
      expect(settings.timeZone).toBeNull();
    });
  });

  describe('updateNotificationSettings', () => {
    it('should reject a weekday outside 0-6', async () => {
      await expect(
        youtubeSyncService.updateNotificationSettings('user-1', {
          preferredWeekday: 7,
        }),
      ).rejects.toThrow('0 (Sunday) to 6 (Saturday)');
    });

    it('should reject a non-integer weekday', async () => {
      await expect(
        youtubeSyncService.updateNotificationSettings('user-1', {
          preferredWeekday: 2.5,
        }),
      ).rejects.toThrow('0 (Sunday) to 6 (Saturday)');
    });

    it('should reject an unknown IANA time zone', async () => {
      await expect(
        youtubeSyncService.updateNotificationSettings('user-1', {
          timeZone: 'Mars/Olympus_Mons',
        }),
      ).rejects.toThrow('valid IANA identifier');
    });

    it('should accept a valid weekday and time zone', async () => {
      (
        mockPrisma.youTubeNotificationSettings.findUnique as jest.Mock
      ).mockResolvedValue({ optedInAt: new Date('2026-01-01') });

      await youtubeSyncService.updateNotificationSettings('user-1', {
        preferredWeekday: 5,
        timeZone: 'Australia/Sydney',
      });

      expect(
        mockPrisma.youTubeNotificationSettings.upsert,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          update: { preferredWeekday: 5, timeZone: 'Australia/Sydney' },
        }),
      );
    });

    it('should stamp optedInAt the first time the digest is enabled', async () => {
      (
        mockPrisma.youTubeNotificationSettings.findUnique as jest.Mock
      ).mockResolvedValue({ optedInAt: null });

      await youtubeSyncService.updateNotificationSettings('user-1', {
        enabled: true,
      });

      const call = (mockPrisma.youTubeNotificationSettings.upsert as jest.Mock)
        .mock.calls[0][0];
      expect(call.update.optedInAt).toBeInstanceOf(Date);
    });

    it('should not restamp optedInAt when the digest is re-enabled', async () => {
      const originalOptIn = new Date('2026-01-01');
      (
        mockPrisma.youTubeNotificationSettings.findUnique as jest.Mock
      ).mockResolvedValue({ optedInAt: originalOptIn });

      await youtubeSyncService.updateNotificationSettings('user-1', {
        enabled: true,
      });

      const call = (mockPrisma.youTubeNotificationSettings.upsert as jest.Mock)
        .mock.calls[0][0];
      expect(call.update.optedInAt).toBeUndefined();
    });
  });

  describe('parseIso8601DurationSeconds', () => {
    const { parseIso8601DurationSeconds } = require('./YouTubeSyncService');

    it('should parse seconds only', () => {
      expect(parseIso8601DurationSeconds('PT30S')).toBe(30);
      expect(parseIso8601DurationSeconds('PT1S')).toBe(1);
    });

    it('should parse minutes', () => {
      expect(parseIso8601DurationSeconds('PT1M')).toBe(60);
      expect(parseIso8601DurationSeconds('PT5M')).toBe(300);
    });

    it('should parse combined minutes and seconds', () => {
      expect(parseIso8601DurationSeconds('PT1M30S')).toBe(90);
      expect(parseIso8601DurationSeconds('PT2M15S')).toBe(135);
    });

    it('should parse hours', () => {
      expect(parseIso8601DurationSeconds('PT1H')).toBe(3600);
      expect(parseIso8601DurationSeconds('PT2H')).toBe(7200);
    });

    it('should parse hours, minutes, and seconds', () => {
      expect(parseIso8601DurationSeconds('PT2H3M4S')).toBe(7384);
      expect(parseIso8601DurationSeconds('PT1H30M45S')).toBe(5445);
    });

    it('should parse days', () => {
      expect(parseIso8601DurationSeconds('P1D')).toBe(86400);
      expect(parseIso8601DurationSeconds('P2D')).toBe(172800);
    });

    it('should parse days with time component', () => {
      expect(parseIso8601DurationSeconds('P1DT2H')).toBe(93600);
      expect(parseIso8601DurationSeconds('P1DT2H3M4S')).toBe(93784);
    });

    it('should round fractional seconds', () => {
      expect(parseIso8601DurationSeconds('PT1M30.5S')).toBe(91);
      expect(parseIso8601DurationSeconds('PT1.5S')).toBe(2);
      expect(parseIso8601DurationSeconds('PT0.4S')).toBe(0);
    });

    it('should parse zero duration', () => {
      expect(parseIso8601DurationSeconds('PT0S')).toBe(0);
    });

    it('should return null for null input', () => {
      expect(parseIso8601DurationSeconds(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(parseIso8601DurationSeconds(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseIso8601DurationSeconds('')).toBeNull();
    });

    it('should return null for garbage input', () => {
      expect(parseIso8601DurationSeconds('garbage')).toBeNull();
      expect(parseIso8601DurationSeconds('123')).toBeNull();
      expect(parseIso8601DurationSeconds('not-iso')).toBeNull();
    });

    it('should return null for malformed ISO 8601', () => {
      expect(parseIso8601DurationSeconds('P')).toBeNull();
      expect(parseIso8601DurationSeconds('PT')).toBeNull();
      expect(parseIso8601DurationSeconds('T1H')).toBeNull();
    });
  });

  describe('isShortDuration', () => {
    const {
      isShortDuration,
      SHORTS_MAX_DURATION_SECONDS,
    } = require('./YouTubeSyncService');

    it('should identify shorts under the ceiling', () => {
      expect(isShortDuration(1)).toBe(true);
      expect(isShortDuration(30)).toBe(true);
      expect(isShortDuration(60)).toBe(true);
      expect(isShortDuration(179)).toBe(true);
    });

    it('should identify exactly 180 seconds as short (inclusive ceiling)', () => {
      expect(isShortDuration(SHORTS_MAX_DURATION_SECONDS)).toBe(true);
    });

    it('should reject durations over the ceiling', () => {
      expect(isShortDuration(181)).toBe(false);
      expect(isShortDuration(300)).toBe(false);
      expect(isShortDuration(3600)).toBe(false);
    });

    it('should reject zero duration', () => {
      expect(isShortDuration(0)).toBe(false);
    });

    it('should reject negative duration', () => {
      expect(isShortDuration(-1)).toBe(false);
      expect(isShortDuration(-100)).toBe(false);
    });

    it('should treat null as not short (safety critical)', () => {
      expect(isShortDuration(null)).toBe(false);
    });

    it('should treat undefined as not short (safety critical)', () => {
      expect(isShortDuration(undefined)).toBe(false);
    });
  });

  describe('videoKindWhere', () => {
    const {
      videoKindWhere,
      SHORTS_MAX_DURATION_SECONDS,
    } = require('./YouTubeSyncService');

    it('should select shorts when kind=short', () => {
      const where = videoKindWhere('short');
      expect(where).toEqual({
        durationSeconds: { gt: 0, lte: SHORTS_MAX_DURATION_SECONDS },
      });
    });

    it('should select long-form when kind=long', () => {
      const where = videoKindWhere('long');
      expect(where).toEqual({
        OR: [
          { durationSeconds: null },
          { durationSeconds: { gt: SHORTS_MAX_DURATION_SECONDS } },
          { durationSeconds: { lte: 0 } },
        ],
      });
    });

    it('should select all when kind=all', () => {
      const where = videoKindWhere('all');
      expect(where).toEqual({});
    });
  });

  describe('video sync with duration backfill', () => {
    it('should request contentDetails in video fetch', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          encrypted_access_token: 'encrypted_access',
          encrypted_refresh_token: 'encrypted_refresh',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          status: 'connected',
        },
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'sub-1',
          userId: 'user-1',
          channelId: 'ch-1',
          uploadsPlaylistId: 'pl-1',
          enabled: true,
        },
      ]);

      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([]);

      const mockYoutube = require('googleapis').google.youtube();
      mockYoutube.playlistItems.list.mockResolvedValue({
        data: { items: [{ snippet: { resourceId: { videoId: 'v1' } } }] },
      });

      mockYoutube.videos.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'v1',
              snippet: {
                title: 'Video 1',
                thumbnails: { medium: { url: 't1' } },
                publishedAt: '2026-01-01T00:00:00Z',
              },
              contentDetails: { duration: 'PT2M30S' },
            },
          ],
        },
      });

      await youtubeSyncService.syncVideosForUserWithStatus('user-1');

      // Verify contentDetails was requested
      expect(mockYoutube.videos.list).toHaveBeenCalledWith(
        expect.objectContaining({
          part: ['snippet', 'contentDetails'],
        }),
      );
    });

    it('should populate durationSeconds from contentDetails.duration', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          encrypted_access_token: 'encrypted_access',
          encrypted_refresh_token: 'encrypted_refresh',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          status: 'connected',
        },
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'sub-1',
          userId: 'user-1',
          channelId: 'ch-1',
          uploadsPlaylistId: 'pl-1',
          enabled: true,
        },
      ]);

      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([]);

      const mockYoutube = require('googleapis').google.youtube();
      mockYoutube.playlistItems.list.mockResolvedValue({
        data: { items: [{ snippet: { resourceId: { videoId: 'v1' } } }] },
      });

      mockYoutube.videos.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'v1',
              snippet: {
                title: 'A Short Video',
                thumbnails: { medium: { url: 't1' } },
                publishedAt: '2026-01-01T00:00:00Z',
              },
              contentDetails: { duration: 'PT30S' },
            },
          ],
        },
      });

      await youtubeSyncService.syncVideosForUserWithStatus('user-1');

      // Verify durationSeconds was included in the upsert
      expect(mockPrisma.__transaction.youTubeVideo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_videoId: { userId: 'user-1', videoId: 'v1' } },
          create: expect.objectContaining({
            durationSeconds: 30,
          }),
        }),
      );
    });

    it('should store null when contentDetails.duration is missing', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          encrypted_access_token: 'encrypted_access',
          encrypted_refresh_token: 'encrypted_refresh',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          status: 'connected',
        },
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'sub-1',
          userId: 'user-1',
          channelId: 'ch-1',
          uploadsPlaylistId: 'pl-1',
          enabled: true,
        },
      ]);

      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([]);

      const mockYoutube = require('googleapis').google.youtube();
      mockYoutube.playlistItems.list.mockResolvedValue({
        data: { items: [{ snippet: { resourceId: { videoId: 'v1' } } }] },
      });

      mockYoutube.videos.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'v1',
              snippet: {
                title: 'No Duration Video',
                thumbnails: { medium: { url: 't1' } },
                publishedAt: '2026-01-01T00:00:00Z',
              },
              // Missing contentDetails
            },
          ],
        },
      });

      await youtubeSyncService.syncVideosForUserWithStatus('user-1');

      expect(mockPrisma.__transaction.youTubeVideo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            durationSeconds: null,
          }),
        }),
      );
    });

    it('should treat duration mismatch as changed and backfill null', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          encrypted_access_token: 'encrypted_access',
          encrypted_refresh_token: 'encrypted_refresh',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          status: 'connected',
        },
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'sub-1',
          userId: 'user-1',
          channelId: 'ch-1',
          uploadsPlaylistId: 'pl-1',
          enabled: true,
        },
      ]);

      // Existing video has null duration (cached before duration collection)
      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([
        {
          videoId: 'v1',
          title: 'Same Video',
          thumbnail: 't1',
          publishedAt: new Date('2026-01-01'),
          durationSeconds: null, // Previously unclassified
        },
      ]);

      const mockYoutube = require('googleapis').google.youtube();
      mockYoutube.playlistItems.list.mockResolvedValue({
        data: { items: [{ snippet: { resourceId: { videoId: 'v1' } } }] },
      });

      // Now we have the duration
      mockYoutube.videos.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'v1',
              snippet: {
                title: 'Same Video',
                thumbnails: { medium: { url: 't1' } },
                publishedAt: '2026-01-01T00:00:00Z',
              },
              contentDetails: { duration: 'PT2M30S' },
            },
          ],
        },
      });

      const result =
        await youtubeSyncService.syncVideosForUserWithStatus('user-1');

      // Should recognize it as changed and perform the transaction
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.__transaction.youTubeVideo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_videoId: { userId: 'user-1', videoId: 'v1' } },
          update: expect.objectContaining({
            durationSeconds: 150,
          }),
        }),
      );
      expect(result.videosSynced).toBe(1);
    });

    it('should include durationSeconds in the update block of upsert', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          encrypted_access_token: 'encrypted_access',
          encrypted_refresh_token: 'encrypted_refresh',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          status: 'connected',
        },
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'sub-1',
          userId: 'user-1',
          channelId: 'ch-1',
          uploadsPlaylistId: 'pl-1',
          enabled: true,
        },
      ]);

      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([
        {
          videoId: 'v1',
          title: 'Old Title',
          thumbnail: 't1',
          publishedAt: new Date('2026-01-01'),
          durationSeconds: 60,
        },
      ]);

      const mockYoutube = require('googleapis').google.youtube();
      mockYoutube.playlistItems.list.mockResolvedValue({
        data: { items: [{ snippet: { resourceId: { videoId: 'v1' } } }] },
      });

      mockYoutube.videos.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'v1',
              snippet: {
                title: 'New Title',
                thumbnails: { medium: { url: 't1-new' } },
                publishedAt: '2026-01-01T00:00:00Z',
              },
              contentDetails: { duration: 'PT1M30S' },
            },
          ],
        },
      });

      await youtubeSyncService.syncVideosForUserWithStatus('user-1');

      expect(mockPrisma.__transaction.youTubeVideo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            durationSeconds: 90,
          }),
        }),
      );
    });
  });

  describe('getVideos with kind filtering', () => {
    it('should default to kind=all when not specified', async () => {
      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.youTubeVideo.count as jest.Mock).mockResolvedValue(0);

      await youtubeSyncService.getVideos('user-1', {});

      expect(mockPrisma.youTubeVideo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            // No duration filter when kind=all
          }),
        }),
      );

      // Verify the where clause doesn't have durationSeconds
      const call = (mockPrisma.youTubeVideo.findMany as jest.Mock).mock
        .calls[0][0];
      expect(call.where).not.toHaveProperty('durationSeconds');
    });

    it('should filter shorts when kind=short', async () => {
      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.youTubeVideo.count as jest.Mock).mockResolvedValue(0);

      await youtubeSyncService.getVideos('user-1', { kind: 'short' });

      expect(mockPrisma.youTubeVideo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            durationSeconds: { gt: 0, lte: 180 },
          }),
        }),
      );
    });

    it('should filter long-form when kind=long', async () => {
      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.youTubeVideo.count as jest.Mock).mockResolvedValue(0);

      await youtubeSyncService.getVideos('user-1', { kind: 'long' });

      const call = (mockPrisma.youTubeVideo.findMany as jest.Mock).mock
        .calls[0][0];
      expect(call.where).toHaveProperty('OR');
      expect(call.where.OR).toContainEqual({ durationSeconds: null });
      expect(call.where.OR).toContainEqual({
        durationSeconds: { gt: 180 },
      });
    });

    it('should apply kind filter alongside other filters', async () => {
      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.youTubeVideo.count as jest.Mock).mockResolvedValue(0);

      await youtubeSyncService.getVideos('user-1', {
        kind: 'short',
        search: 'test',
        channelId: 'ch-1',
      });

      const call = (mockPrisma.youTubeVideo.findMany as jest.Mock).mock
        .calls[0][0];
      expect(call.where).toMatchObject({
        userId: 'user-1',
        durationSeconds: { gt: 0, lte: 180 },
        channelId: 'ch-1',
        title: { contains: 'test', mode: 'insensitive' },
      });
    });
  });

  describe('Channel Sync and Upload Sync claim and phases (ADR 0096)', () => {
    it('CHANNEL_SYNC_TTL_MS must equal CHANNEL_SYNC_COOLDOWN_MS (ADR 0096 decision 3)', () => {
      expect(CHANNEL_SYNC_TTL_MS).toBe(CHANNEL_SYNC_COOLDOWN_MS);
    });

    it('UPLOAD_SYNC_TTL_MS must equal UPLOAD_SYNC_COOLDOWN_MS (ADR 0096 decision 3)', () => {
      expect(UPLOAD_SYNC_TTL_MS).toBe(UPLOAD_SYNC_COOLDOWN_MS);
    });

    it('RUN_TTL_MS must equal MANUAL_REFRESH_COOLDOWN_MS (ADR 0080 decision 3)', () => {
      expect(RUN_TTL_MS).toBe(MANUAL_REFRESH_COOLDOWN_MS);
      expect(RUN_TTL_MS).toBe(UPLOAD_SYNC_TTL_MS);
    });

    it('isAnyYouTubeSyncLive is true for live upload or live channel sync', () => {
      const at = new Date('2026-06-01T12:00:00.000Z');

      expect(
        isAnyYouTubeSyncLive(
          {
            lastSyncStatus: 'running',
            lastSyncAttemptAt: at,
            lastChannelSyncStatus: 'never',
            lastChannelSyncAt: null,
          },
          at,
        ),
      ).toBe(true);

      expect(
        isAnyYouTubeSyncLive(
          {
            lastSyncStatus: 'success',
            lastSyncAttemptAt: null,
            lastChannelSyncStatus: 'discovering',
            lastChannelSyncAt: at,
          },
          at,
        ),
      ).toBe(true);

      expect(
        isAnyYouTubeSyncLive(
          {
            lastSyncStatus: 'success',
            lastSyncAttemptAt: null,
            lastChannelSyncStatus: 'discovering',
            lastChannelSyncAt: new Date(
              at.getTime() - CHANNEL_SYNC_TTL_MS - 1000,
            ),
          },
          at,
        ),
      ).toBe(false);
    });

    it('youtubeSyncClaimableWhere ANDs upload and channel sides (ADR 0096 decision 2)', () => {
      const at = new Date('2026-06-01T12:00:00.000Z');
      const uploadDeadline = new Date(at.getTime() - UPLOAD_SYNC_TTL_MS);
      const channelDeadline = new Date(at.getTime() - CHANNEL_SYNC_TTL_MS);

      expect(youtubeSyncClaimableWhere('user-1', at)).toEqual({
        userId: 'user-1',
        AND: [
          {
            OR: [
              { lastSyncStatus: { notIn: ['running', 'discovering'] } },
              { lastSyncAttemptAt: { lt: uploadDeadline } },
            ],
          },
          {
            OR: [
              { lastChannelSyncStatus: { not: 'discovering' } },
              { lastChannelSyncAt: { lt: channelDeadline } },
            ],
          },
        ],
      });
    });

    it('should claim upload sync as running when cron path has no claimedAt', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          encrypted_access_token: 'token-a',
          encrypted_refresh_token: 'token-r',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          status: 'connected',
          lastSyncStatus: 'success',
          lastSyncAttemptAt: new Date('2026-01-01'),
          ...defaultChannelSyncFields,
        },
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      await youtubeSyncService.syncVideosForUserWithStatus('user-1');

      expect(mockPrisma.youTubeIntegration.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            AND: expect.arrayContaining([
              expect.objectContaining({ OR: expect.any(Array) }),
              expect.objectContaining({ OR: expect.any(Array) }),
            ]),
          }),
          data: {
            lastSyncAttemptAt: expect.any(Date),
            lastSyncStatus: 'running',
            lastSyncError: null,
          },
        }),
      );
    });

    it('should return early with noop when cron upload claim is lost', async () => {
      const now = new Date();
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          status: 'connected',
          lastSyncStatus: 'running',
          lastSyncAttemptAt: now,
          lastSyncError: null,
          ...defaultChannelSyncFields,
        },
      );

      (mockPrisma.youTubeSubscription.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      (
        mockPrisma.youTubeIntegration.updateMany as jest.Mock
      ).mockResolvedValueOnce({ count: 0 });

      const mockYoutube = require('googleapis').google.youtube();
      const playlistItemsSpy = jest.spyOn(mockYoutube.playlistItems, 'list');

      const result =
        await youtubeSyncService.syncVideosForUserWithStatus('user-1');

      expect(playlistItemsSpy).not.toHaveBeenCalled();
      expect(result.videosSynced).toBe(0);
      expect(result.subscriptionsSynced).toBe(0);

      playlistItemsSpy.mockRestore();
    });

    it('should reclaim a stranded upload run at UPLOAD_SYNC_TTL boundary', async () => {
      const now = new Date();
      const strandedRunStart = new Date(now.getTime() - UPLOAD_SYNC_TTL_MS);

      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          encrypted_access_token: 'token-a',
          encrypted_refresh_token: 'token-r',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          status: 'connected',
          lastSyncStatus: 'running',
          lastSyncAttemptAt: strandedRunStart,
          ...defaultChannelSyncFields,
        },
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      (
        mockPrisma.youTubeIntegration.updateMany as jest.Mock
      ).mockResolvedValueOnce({ count: 1 });

      await youtubeSyncService.syncVideosForUserWithStatus('user-1');

      const callArgs = (mockPrisma.youTubeIntegration.updateMany as jest.Mock)
        .mock.calls[0][0];
      const uploadThreshold = callArgs.where.AND[0].OR[1].lastSyncAttemptAt.lt;
      const expectedThreshold = now.getTime() - UPLOAD_SYNC_TTL_MS;

      expect(
        Math.abs(uploadThreshold.getTime() - expectedThreshold),
      ).toBeLessThan(100);
    });

    it('syncChannels claimChannelSyncRun sets channel discovering without lastSyncStatus', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          status: 'connected',
          lastChannelSyncAt: null,
          ...defaultChannelSyncFields,
        },
      );

      let channelDiscoveringMarked = false;
      (
        mockPrisma.youTubeIntegration.updateMany as jest.Mock
      ).mockImplementation(
        async (args: {
          data?: {
            lastChannelSyncStatus?: string;
            lastSyncStatus?: string;
          };
        }) => {
          if (args.data?.lastChannelSyncStatus === 'discovering') {
            channelDiscoveringMarked = true;
            expect(args.data?.lastSyncStatus).toBeUndefined();
          }
          return { count: 1 };
        },
      );

      jest.spyOn(youtubeSyncService, 'syncSubscriptions').mockResolvedValue([]);

      await youtubeSyncService.syncChannels('user-1');

      expect(channelDiscoveringMarked).toBe(true);
    });

    it('syncUploads should sync videos without a second upload claim when claimedAt is passed', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          status: 'connected',
          lastManualRefreshAt: null,
          encrypted_access_token: 'token-a',
          encrypted_refresh_token: 'token-r',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          lastSyncStatus: null,
          ...defaultChannelSyncFields,
        },
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'sub-1',
          userId: 'user-1',
          channelId: 'ch-1',
          uploadsPlaylistId: 'pl-1',
          enabled: true,
        },
      ]);

      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([]);

      const mockYoutube = require('googleapis').google.youtube();
      mockYoutube.playlistItems.list.mockResolvedValue({
        data: {
          items: [{ snippet: { resourceId: { videoId: 'v1' } } }],
        },
      });

      mockYoutube.videos.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'v1',
              snippet: {
                title: 'Test Video',
                thumbnails: { medium: { url: 't1' } },
                publishedAt: '2026-01-01T00:00:00Z',
              },
            },
          ],
        },
      });

      let updateManyCallCount = 0;
      (
        mockPrisma.youTubeIntegration.updateMany as jest.Mock
      ).mockImplementation(async () => {
        updateManyCallCount += 1;
        return { count: 1 };
      });

      const result = await youtubeSyncService.syncUploads('user-1');

      expect(result.videosSynced).toBeGreaterThan(0);
      expect(mockYoutube.playlistItems.list).toHaveBeenCalled();
      expect(mockPrisma.__transaction.youTubeVideo.upsert).toHaveBeenCalled();
      expect(updateManyCallCount).toBe(2);
    });

    it('syncUploads should reuse the upload claim stamp on subscription updates', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          status: 'connected',
          lastManualRefreshAt: null,
          encrypted_access_token: 'token-a',
          encrypted_refresh_token: 'token-r',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          ...defaultChannelSyncFields,
        },
      );

      let capturedRunStamp: Date | null = null;

      (
        mockPrisma.youTubeIntegration.updateMany as jest.Mock
      ).mockImplementation(
        async (args: {
          data?: {
            lastSyncStatus?: string;
            lastSyncAttemptAt?: Date;
          };
        }) => {
          if (args.data?.lastSyncStatus === 'running') {
            capturedRunStamp = args.data.lastSyncAttemptAt ?? null;
          }
          return { count: 1 };
        },
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'sub-1',
          userId: 'user-1',
          channelId: 'ch-1',
          uploadsPlaylistId: 'pl-1',
          enabled: true,
        },
      ]);

      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([]);

      const mockYoutube = require('googleapis').google.youtube();
      mockYoutube.playlistItems.list.mockResolvedValue({
        data: {
          items: [{ snippet: { resourceId: { videoId: 'v1' } } }],
        },
      });

      mockYoutube.videos.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'v1',
              snippet: {
                title: 'Test Video',
                thumbnails: { medium: { url: 't1' } },
                publishedAt: '2026-01-01T00:00:00Z',
              },
            },
          ],
        },
      });

      await youtubeSyncService.syncUploads('user-1');

      const subscriptionUpdateCall = (
        mockPrisma.youTubeSubscription.update as jest.Mock
      ).mock.calls[0];

      if (capturedRunStamp && subscriptionUpdateCall) {
        expect(
          subscriptionUpdateCall[0].data.lastSyncAttemptAt.getTime(),
        ).toEqual(capturedRunStamp.getTime());
      }
    });

    it('should claim upload sync when called via syncVideosForUser (worker/digest path)', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          encrypted_access_token: 'token-a',
          encrypted_refresh_token: 'token-r',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          status: 'connected',
          ...defaultChannelSyncFields,
        },
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      (mockPrisma.youTubeIntegration.updateMany as jest.Mock).mockClear();
      (mockPrisma.youTubeIntegration.updateMany as jest.Mock).mockResolvedValue(
        { count: 1 },
      );

      await youtubeSyncService.syncVideosForUser('user-1');

      expect(mockPrisma.youTubeIntegration.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            AND: expect.any(Array),
          }),
          data: {
            lastSyncAttemptAt: expect.any(Date),
            lastSyncStatus: 'running',
            lastSyncError: null,
          },
        }),
      );
    });
  });

  describe('getSyncStatus projection and per-channel stamps (ADR 0080 batch 2)', () => {
    it('should clear lastSyncError to null on successful channel sync', async () => {
      const now = new Date();
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          encrypted_access_token: 'token-a',
          encrypted_refresh_token: 'token-r',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          status: 'connected',
          ...defaultChannelSyncFields,
          lastSyncStatus: 'success',
          lastSyncAttemptAt: now,
          lastSyncError: null,
        },
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'sub-1',
          userId: 'user-1',
          channelId: 'ch-1',
          uploadsPlaylistId: 'pl-1',
          enabled: true,
        },
      ]);

      (mockPrisma.youTubeVideo.findMany as jest.Mock).mockResolvedValue([]);

      const mockYoutube = require('googleapis').google.youtube();
      mockYoutube.playlistItems.list.mockResolvedValue({
        data: { items: [{ snippet: { resourceId: { videoId: 'v1' } } }] },
      });

      mockYoutube.videos.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'v1',
              snippet: {
                title: 'Video 1',
                thumbnails: { medium: { url: 't1' } },
                publishedAt: '2026-01-01T00:00:00Z',
              },
            },
          ],
        },
      });

      await youtubeSyncService.syncVideosForUserWithStatus('user-1');

      // On success, verify lastSyncError is set to null explicitly
      const successCall = (mockPrisma.youTubeSubscription.update as jest.Mock)
        .mock.calls[0];
      expect(successCall[0].data).toHaveProperty('lastSyncError', null);
      expect(successCall[0].data).toHaveProperty('lastSyncedAt');
      expect(successCall[0].data).toHaveProperty('lastSyncAttemptAt');
    });

    it('should not update channels after quota_exceeded breaks the loop', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          encrypted_access_token: 'token-a',
          encrypted_refresh_token: 'token-r',
          token_iv: 'iv1:iv2',
          token_auth_tag: 'tag1:tag2',
          status: 'connected',
          ...defaultChannelSyncFields,
        },
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'sub-1',
          userId: 'user-1',
          channelId: 'ch-quota',
          uploadsPlaylistId: 'pl-quota',
          enabled: true,
        },
        {
          id: 'sub-2',
          userId: 'user-1',
          channelId: 'ch-unreached',
          uploadsPlaylistId: 'pl-unreached',
          enabled: true,
        },
      ]);

      const mockYoutube = require('googleapis').google.youtube();
      // First channel hits quota
      mockYoutube.playlistItems.list.mockRejectedValueOnce(
        new Error('quotaExceeded'),
      );

      await youtubeSyncService.syncVideosForUserWithStatus('user-1');

      // Verify only first channel was updated (with error), second channel untouched
      const updateCalls = (mockPrisma.youTubeSubscription.update as jest.Mock)
        .mock.calls;
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0][0].where.id).toBe('sub-1');
      expect(updateCalls[0][0].data.lastSyncError).toBe('quotaExceeded');
    });

    it('should compute progress with correct totals and counts for live run', async () => {
      const now = new Date();
      const runStamp = new Date(now.getTime() - 5000); // 5 seconds ago, well within TTL
      const oldStamp = new Date(now.getTime() - RUN_TTL_MS - 1000);

      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          status: 'connected',
          ...defaultChannelSyncFields,
          lastSyncStatus: 'running',
          lastSyncAttemptAt: runStamp,
          lastSyncError: null,
        },
      );

      (mockPrisma.youTubeSubscription.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      // Mix of channels: some at run stamp (processed), some at old stamp (unprocessed), one never stamped
      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          channelId: 'ch-1',
          channelTitle: 'Success Channel',
          lastSyncAttemptAt: runStamp,
          lastSyncedAt: runStamp,
          lastSyncError: null,
        },
        {
          channelId: 'ch-2',
          channelTitle: 'Failed Channel',
          lastSyncAttemptAt: runStamp,
          lastSyncedAt: null,
          lastSyncError: 'syncFailed',
        },
        {
          channelId: 'ch-3',
          channelTitle: 'Unprocessed Old',
          lastSyncAttemptAt: oldStamp,
          lastSyncedAt: oldStamp,
          lastSyncError: null,
        },
        {
          channelId: 'ch-4',
          channelTitle: 'Never Stamped',
          lastSyncAttemptAt: null,
          lastSyncedAt: null,
          lastSyncError: null,
        },
      ]);

      const status = await youtubeSyncService.getSyncStatus('user-1');

      expect(status.status).toBe('running');
      expect(status.progress).not.toBeNull();
      expect(status.progress!.total).toBe(4);
      expect(status.progress!.processed).toBe(2);
      expect(status.progress!.succeeded).toBe(1);
      expect(status.progress!.failed).toBe(1);
      expect(status.progress!.startedAt).toEqual(runStamp);
    });

    it('should count channel as unprocessed when stamp differs from run stamp', async () => {
      const now = new Date();
      const runStamp = new Date(now.getTime() - 5000);
      const differentStamp = new Date(now.getTime() - 65000);

      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          status: 'connected',
          ...defaultChannelSyncFields,
          lastSyncStatus: 'running',
          lastSyncAttemptAt: runStamp,
          lastSyncError: null,
        },
      );

      (mockPrisma.youTubeSubscription.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          channelId: 'ch-synced-by-cron',
          channelTitle: 'Different Run',
          lastSyncAttemptAt: differentStamp,
          lastSyncedAt: differentStamp,
          lastSyncError: null,
        },
      ]);

      const status = await youtubeSyncService.getSyncStatus('user-1');

      expect(status.progress!.total).toBe(1);
      expect(status.progress!.processed).toBe(0); // Not processed by this run
      expect(status.progress!.succeeded).toBe(0);
    });

    it('should report Interrupted Sync when run exceeds TTL', async () => {
      const now = new Date();
      const strandedRunStart = new Date(now.getTime() - RUN_TTL_MS - 1000);

      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          status: 'connected',
          ...defaultChannelSyncFields,
          lastSyncStatus: 'running',
          lastSyncAttemptAt: strandedRunStart,
          lastSyncError: null,
        },
      );

      (mockPrisma.youTubeSubscription.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          channelId: 'ch-1',
          channelTitle: 'Any Channel',
          lastSyncAttemptAt: strandedRunStart,
          lastSyncedAt: strandedRunStart,
          lastSyncError: null,
        },
      ]);

      const status = await youtubeSyncService.getSyncStatus('user-1');

      expect(status.status).toBe('failed');
      expect(status.lastSyncError).toBe('syncInterrupted');
      expect(status.progress).not.toBeNull();
      expect(status.progress!.processed).toBe(1); // Keeps last known counts
    });

    it('should not write updates in getSyncStatus for interrupted run', async () => {
      const now = new Date();
      const strandedRunStart = new Date(now.getTime() - RUN_TTL_MS - 1000);

      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          status: 'connected',
          ...defaultChannelSyncFields,
          lastSyncStatus: 'running',
          lastSyncAttemptAt: strandedRunStart,
          lastSyncError: null,
        },
      );

      (mockPrisma.youTubeSubscription.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      // Clear any prior calls
      (mockPrisma.youTubeIntegration.update as jest.Mock).mockClear();
      (mockPrisma.youTubeIntegration.updateMany as jest.Mock).mockClear();

      await youtubeSyncService.getSyncStatus('user-1');

      // Read path should never write
      expect(mockPrisma.youTubeIntegration.update).not.toHaveBeenCalled();
      expect(mockPrisma.youTubeIntegration.updateMany).not.toHaveBeenCalled();
    });

    it('should include failedChannels in progress for partial sync', async () => {
      const now = new Date();
      const runStamp = new Date(now.getTime() - 5000);

      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          status: 'connected',
          ...defaultChannelSyncFields,
          lastSyncStatus: 'partial',
          lastSyncAttemptAt: runStamp,
          lastSyncError: 'syncFailed',
        },
      );

      (mockPrisma.youTubeSubscription.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          channelId: 'ch-success',
          channelTitle: 'Working Channel',
          lastSyncAttemptAt: runStamp,
          lastSyncedAt: runStamp,
          lastSyncError: null,
        },
        {
          channelId: 'ch-fail1',
          channelTitle: 'Network Error Channel',
          lastSyncAttemptAt: runStamp,
          lastSyncedAt: null,
          lastSyncError: 'syncFailed',
        },
        {
          channelId: 'ch-fail2',
          channelTitle: 'Permission Denied Channel',
          lastSyncAttemptAt: runStamp,
          lastSyncedAt: null,
          lastSyncError: 'syncFailed',
        },
      ]);

      const status = await youtubeSyncService.getSyncStatus('user-1');

      expect(status.status).toBe('partial');
      expect(status.progress!.failedChannels).toHaveLength(2);
      expect(status.progress!.failedChannels[0]).toEqual({
        channelId: 'ch-fail1',
        channelTitle: 'Network Error Channel',
        error: 'syncFailed',
      });
      expect(status.progress!.failedChannels[1]).toEqual({
        channelId: 'ch-fail2',
        channelTitle: 'Permission Denied Channel',
        error: 'syncFailed',
      });
    });

    it('should include quota-hit channel in failedChannels on quota_exceeded', async () => {
      const now = new Date();
      const runStamp = new Date(now.getTime() - 5000);

      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          status: 'connected',
          ...defaultChannelSyncFields,
          lastSyncStatus: 'quota_exceeded',
          lastSyncAttemptAt: runStamp,
          lastSyncError: 'quotaExceeded',
        },
      );

      (mockPrisma.youTubeSubscription.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          channelId: 'ch-before-quota',
          channelTitle: 'Processed Channel',
          lastSyncAttemptAt: runStamp,
          lastSyncedAt: runStamp,
          lastSyncError: null,
        },
        {
          channelId: 'ch-quota-hit',
          channelTitle: 'Quota Hit Channel',
          lastSyncAttemptAt: runStamp,
          lastSyncedAt: null,
          lastSyncError: 'quotaExceeded',
        },
      ]);

      const status = await youtubeSyncService.getSyncStatus('user-1');

      expect(status.status).toBe('quota_exceeded');
      expect(status.progress!.failedChannels).toHaveLength(1);
      expect(status.progress!.failedChannels[0]).toEqual({
        channelId: 'ch-quota-hit',
        channelTitle: 'Quota Hit Channel',
        error: 'quotaExceeded',
      });
    });

    it('should return progress null and skip subscription query for success', async () => {
      const now = new Date();
      const runStamp = new Date(now.getTime() - 5000);

      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          status: 'connected',
          ...defaultChannelSyncFields,
          lastSyncStatus: 'success',
          lastSyncAttemptAt: runStamp,
          lastSyncError: null,
        },
      );

      (mockPrisma.youTubeSubscription.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      // Clear the mock to detect calls in getSyncStatus
      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockClear();

      const status = await youtubeSyncService.getSyncStatus('user-1');

      expect(status.status).toBe('success');
      expect(status.progress).toBeNull();
      // Verify the channel findMany for progress was never called
      expect(mockPrisma.youTubeSubscription.findMany).not.toHaveBeenCalled();
    });

    it('should return never status with null progress when no integration exists', async () => {
      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const status = await youtubeSyncService.getSyncStatus('user-1');

      expect(status.status).toBe('never');
      expect(status.lastSyncedAt).toBeNull();
      expect(status.lastSyncAttemptAt).toBeNull();
      expect(status.lastSyncError).toBeNull();
      expect(status.progress).toBeNull();
      expect(status.channelStatus).toBe('never');
      expect(status.channelLastAttemptAt).toBeNull();
      expect(status.channelLastError).toBeNull();
      expect(status.channelRetryAt).toBeNull();
    });

    it('should report channel syncInterrupted when discovering exceeds CHANNEL_SYNC_TTL_MS', async () => {
      const strandedChannelStart = new Date(
        Date.now() - CHANNEL_SYNC_TTL_MS - 1000,
      );

      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          status: 'connected',
          lastSyncStatus: 'success',
          lastSyncAttemptAt: new Date('2026-01-01'),
          lastSyncError: null,
          lastChannelSyncStatus: 'discovering',
          lastChannelSyncAt: strandedChannelStart,
          lastChannelSyncError: null,
        },
      );

      (mockPrisma.youTubeSubscription.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      const status = await youtubeSyncService.getSyncStatus('user-1');

      expect(status.channelStatus).toBe('failed');
      expect(status.channelLastError).toBe('syncInterrupted');
    });

    it('should not write channel syncInterrupted correction in getSyncStatus', async () => {
      const strandedChannelStart = new Date(
        Date.now() - CHANNEL_SYNC_TTL_MS - 1000,
      );

      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          status: 'connected',
          lastSyncStatus: 'success',
          lastChannelSyncStatus: 'discovering',
          lastChannelSyncAt: strandedChannelStart,
          lastChannelSyncError: null,
        },
      );

      (mockPrisma.youTubeSubscription.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      (mockPrisma.youTubeIntegration.update as jest.Mock).mockClear();
      (mockPrisma.youTubeIntegration.updateMany as jest.Mock).mockClear();

      await youtubeSyncService.getSyncStatus('user-1');

      expect(mockPrisma.youTubeIntegration.update).not.toHaveBeenCalled();
      expect(mockPrisma.youTubeIntegration.updateMany).not.toHaveBeenCalled();
    });

    it('should report TTL boundary correctly: just inside TTL', async () => {
      const now = new Date();
      const justInsideTTL = new Date(now.getTime() - RUN_TTL_MS + 1000);

      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          status: 'connected',
          ...defaultChannelSyncFields,
          lastSyncStatus: 'running',
          lastSyncAttemptAt: justInsideTTL,
          lastSyncError: null,
        },
      );

      (mockPrisma.youTubeSubscription.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      const status = await youtubeSyncService.getSyncStatus('user-1');

      // Still running, not yet interrupted
      expect(status.status).toBe('running');
      expect(status.lastSyncError).not.toBe('syncInterrupted');
    });

    it('should report TTL boundary correctly: just outside TTL', async () => {
      const now = new Date();
      const justOutsideTTL = new Date(now.getTime() - RUN_TTL_MS - 1000);

      (mockPrisma.youTubeIntegration.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          status: 'connected',
          ...defaultChannelSyncFields,
          lastSyncStatus: 'running',
          lastSyncAttemptAt: justOutsideTTL,
          lastSyncError: null,
        },
      );

      (mockPrisma.youTubeSubscription.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      const status = await youtubeSyncService.getSyncStatus('user-1');

      // Past TTL, now interrupted
      expect(status.status).toBe('failed');
      expect(status.lastSyncError).toBe('syncInterrupted');
    });
  });

  describe('getVideosGroupedByChannel', () => {
    it('should default to kind=long', async () => {
      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          channelId: 'ch-1',
          channelTitle: 'Channel 1',
          channelThumbnail: null,
          videos: [],
        },
      ]);

      await youtubeSyncService.getVideosGroupedByChannel('user-1');

      const call = (mockPrisma.youTubeSubscription.findMany as jest.Mock).mock
        .calls[0][0];
      expect(call.include.videos.where).toEqual({
        OR: [
          { durationSeconds: null },
          { durationSeconds: { gt: 180 } },
          { durationSeconds: { lte: 0 } },
        ],
      });
    });

    it('should filter nested videos when kind=short', async () => {
      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          channelId: 'ch-1',
          channelTitle: 'Channel 1',
          channelThumbnail: null,
          videos: [],
        },
      ]);

      await youtubeSyncService.getVideosGroupedByChannel('user-1', 'short');

      const call = (mockPrisma.youTubeSubscription.findMany as jest.Mock).mock
        .calls[0][0];
      expect(call.include.videos.where).toEqual({
        durationSeconds: { gt: 0, lte: 180 },
      });
    });

    it('should not filter when kind=all', async () => {
      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          channelId: 'ch-1',
          channelTitle: 'Channel 1',
          channelThumbnail: null,
          videos: [],
        },
      ]);

      await youtubeSyncService.getVideosGroupedByChannel('user-1', 'all');

      const call = (mockPrisma.youTubeSubscription.findMany as jest.Mock).mock
        .calls[0][0];
      expect(call.include.videos.where).toEqual({});
    });

    it('should order nested videos by publishedAt descending', async () => {
      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          channelId: 'ch-1',
          channelTitle: 'Channel 1',
          channelThumbnail: null,
          videos: [],
        },
      ]);

      await youtubeSyncService.getVideosGroupedByChannel('user-1');

      const call = (mockPrisma.youTubeSubscription.findMany as jest.Mock).mock
        .calls[0][0];
      expect(call.include.videos.orderBy).toEqual({ publishedAt: 'desc' });
    });

    it('should limit nested videos to 20 per channel', async () => {
      (mockPrisma.youTubeSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          channelId: 'ch-1',
          channelTitle: 'Channel 1',
          channelThumbnail: null,
          videos: [],
        },
      ]);

      await youtubeSyncService.getVideosGroupedByChannel('user-1');

      const call = (mockPrisma.youTubeSubscription.findMany as jest.Mock).mock
        .calls[0][0];
      expect(call.include.videos.take).toBe(20);
    });
  });
});
