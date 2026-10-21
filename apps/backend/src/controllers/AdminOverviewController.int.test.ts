/* eslint-disable import/first */
jest.mock('../prisma', () => {
  const mockPrisma = {
    user: { count: jest.fn() },
    feedbackReport: { count: jest.fn() },
  };
  return {
    __mockPrisma: mockPrisma,
    createPrismaClient: () => mockPrisma,
    FeedbackReportStatus: { received: 'received' },
  };
});

jest.mock('../middleware/authentication', () => {
  return {
    expressAuthentication: async (
      req: any,
      _securityName: string,
      scopes?: string[],
    ) => {
      const authHeader = req?.headers?.authorization;
      if (!authHeader) {
        const err = new Error('Unauthorized') as Error & { status?: number };
        err.status = 401;
        throw err;
      }

      const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length)
        : authHeader;

      if (token === 'user') {
        if (scopes?.includes('platform_admin')) {
          const err = new Error('Platform Admin role required') as Error & {
            status?: number;
          };
          err.status = 403;
          throw err;
        }
        req.user = { id: 'user-1', role: 'user', disabled: false };
        return req.user;
      }

      // No scope check: lets the controller's own guard decide.
      if (token === 'user-unscoped') {
        req.user = { id: 'user-2', role: 'user', disabled: false };
        return req.user;
      }

      if (token === 'disabled-admin') {
        req.user = { id: 'admin-2', role: 'platform_admin', disabled: true };
        return req.user;
      }

      if (token === 'admin') {
        req.user = { id: 'admin-1', role: 'platform_admin', disabled: false };
        return req.user;
      }

      const err = new Error('Unauthorized') as Error & { status?: number };
      err.status = 401;
      throw err;
    },
  };
});

jest.mock('../services/AdminFeedbackService', () => {
  return {
    __esModule: true,
    default: {
      listReports: jest.fn(),
      getReport: jest.fn(),
      changeStatus: jest.fn(),
      linkTrackingIssue: jest.fn(),
      unlinkTrackingIssue: jest.fn(),
      markDelivered: jest.fn(),
      reopenReport: jest.fn(),
    },
  };
});

jest.mock('../services/FeedbackService', () => ({
  __esModule: true,
  default: {},
}));

// Stubbed at the module boundary: the real UserService drags in email, bcrypt,
// and YouTube sync. The counting and mapping in AdminOverviewService stay real.
jest.mock('../services/UserService', () => ({
  __esModule: true,
  default: {
    getYouTubeAccessUsage: jest.fn(),
  },
}));

jest.mock('../services/VaultService', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../services/VaultBackupService', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../services/YouTubeSyncWorkerService', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../services/YouTubeDigestService', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../services/YouTubeSyncService', () => ({
  __esModule: true,
  default: {},
}));

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

import {
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

jest.setTimeout(30_000);

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FIXED_NOW_MS = Date.parse('2026-10-21T12:00:00.000Z');

interface OverviewSeed {
  users: number;
  usersJoinedLast7Days: number;
  platformAdmins: number;
  unverified: number;
  unverifiedOverAWeek: number;
  disabled: number;
  everGranted: number;
  ceiling: number;
  feedbackReportsReceived: number;
}

type CountArgs = { where?: Record<string, unknown> };
type CreatedAtFilter = { gte?: Date; lt?: Date };

/** Routes each user.count call by its where clause, as the service issues them. */
function userCountFor(seed: OverviewSeed) {
  return async (args?: CountArgs): Promise<number> => {
    const where = args?.where;
    if (where === undefined) return seed.users;
    const createdAt = where.created_at as CreatedAtFilter | undefined;
    if (where.role === 'platform_admin') return seed.platformAdmins;
    if (createdAt?.gte instanceof Date && Object.keys(where).length === 1) {
      return seed.usersJoinedLast7Days;
    }
    if (
      createdAt?.lt instanceof Date &&
      where.email_verification_timestamp === null &&
      Object.keys(where).length === 2
    ) {
      return seed.unverifiedOverAWeek;
    }
    if (where.email_verification_timestamp === null) return seed.unverified;
    if (where.disabled === true) return seed.disabled;
    throw new Error(`Unexpected user.count where: ${JSON.stringify(where)}`);
  };
}

function seedOverview(seed: OverviewSeed) {
  const prisma = require('../prisma').__mockPrisma;
  const users = require('../services/UserService').default;
  prisma.user.count.mockImplementation(userCountFor(seed));
  prisma.feedbackReport.count.mockResolvedValue(seed.feedbackReportsReceived);
  users.getYouTubeAccessUsage.mockResolvedValue({
    everGranted: seed.everGranted,
    ceiling: seed.ceiling,
  });
}

function makeApp() {
  jest.resetModules();

  const { RegisterRoutes } = require('../routes/routes');
  // Load the handler after resetModules so its tsoa instanceof checks match the
  // freshly required routes.
  const { attachTsoaErrorHandler } = require('../testing/tsoaErrorHandler');

  const app = express();
  app.use(bodyParser.json({ limit: '2mb' }));
  RegisterRoutes(app);
  attachTsoaErrorHandler(app);

  return app;
}

describe('AdminOverviewController (HTTP integration)', () => {
  let app: express.Application;

  beforeAll(() => {
    app = makeApp();
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('access control', () => {
    test('GET /admin/overview without auth returns 401 and reads no counts', async () => {
      const prisma = require('../prisma').__mockPrisma;
      const users = require('../services/UserService').default;

      const res = await request(app).get('/admin/overview');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(prisma.feedbackReport.count).not.toHaveBeenCalled();
      expect(users.getYouTubeAccessUsage).not.toHaveBeenCalled();
    });

    test('GET /admin/overview for a non-admin that passes authentication is refused by the controller guard with 403 and reads no counts', async () => {
      const prisma = require('../prisma').__mockPrisma;
      const users = require('../services/UserService').default;

      const res = await request(app)
        .get('/admin/overview')
        .set('Authorization', 'Bearer user-unscoped');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: 'Platform Admin role required' });
      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(prisma.feedbackReport.count).not.toHaveBeenCalled();
      expect(users.getYouTubeAccessUsage).not.toHaveBeenCalled();
    });

    test('GET /admin/overview for a disabled Platform Admin returns 401 Account disabled and reads no counts', async () => {
      const prisma = require('../prisma').__mockPrisma;
      const users = require('../services/UserService').default;

      const res = await request(app)
        .get('/admin/overview')
        .set('Authorization', 'Bearer disabled-admin');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Account disabled' });
      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(prisma.feedbackReport.count).not.toHaveBeenCalled();
      expect(users.getYouTubeAccessUsage).not.toHaveBeenCalled();
    });

    test('GET /admin/overview for a non-admin returns 403 and reads no counts', async () => {
      const prisma = require('../prisma').__mockPrisma;
      const users = require('../services/UserService').default;

      const res = await request(app)
        .get('/admin/overview')
        .set('Authorization', 'Bearer user');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: 'Platform Admin role required' });
      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(prisma.feedbackReport.count).not.toHaveBeenCalled();
      expect(users.getYouTubeAccessUsage).not.toHaveBeenCalled();
    });
  });

  describe('admin counts', () => {
    test('GET /admin/overview returns the exact ten-field body mapped from distinct counts', async () => {
      seedOverview({
        users: 148,
        usersJoinedLast7Days: 21,
        platformAdmins: 3,
        unverified: 12,
        unverifiedOverAWeek: 7,
        disabled: 4,
        everGranted: 18,
        ceiling: 25,
        feedbackReportsReceived: 9,
      });

      const res = await request(app)
        .get('/admin/overview')
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        users: 148,
        usersJoinedLast7Days: 21,
        platformAdmins: 3,
        unverified: 12,
        unverifiedOverAWeek: 7,
        disabled: 4,
        youtubeAccessPlacesUsed: 18,
        youtubeAccessPlacesLeft: 7,
        youtubeAccessCeiling: 25,
        feedbackReportsReceived: 9,
      });
    });

    test('each count is queried with its own filter, and both 7-day counts use the boundary now minus 7 days', async () => {
      const prisma = require('../prisma').__mockPrisma;
      const users = require('../services/UserService').default;
      seedOverview({
        users: 1,
        usersJoinedLast7Days: 1,
        platformAdmins: 1,
        unverified: 1,
        unverifiedOverAWeek: 1,
        disabled: 1,
        everGranted: 1,
        ceiling: 25,
        feedbackReportsReceived: 1,
      });
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS);
      const boundary = new Date(FIXED_NOW_MS - SEVEN_DAYS_MS);

      try {
        const res = await request(app)
          .get('/admin/overview')
          .set('Authorization', 'Bearer admin');

        expect(res.status).toBe(200);
        expect(prisma.user.count).toHaveBeenCalledTimes(6);
        expect(prisma.user.count).toHaveBeenCalledWith();
        expect(prisma.user.count).toHaveBeenCalledWith({
          where: { created_at: { gte: boundary } },
        });
        expect(prisma.user.count).toHaveBeenCalledWith({
          where: { role: 'platform_admin' },
        });
        expect(prisma.user.count).toHaveBeenCalledWith({
          where: { email_verification_timestamp: null },
        });
        expect(prisma.user.count).toHaveBeenCalledWith({
          where: {
            email_verification_timestamp: null,
            created_at: { lt: boundary },
          },
        });
        expect(prisma.user.count).toHaveBeenCalledWith({
          where: { disabled: true },
        });
        expect(prisma.feedbackReport.count).toHaveBeenCalledTimes(1);
        expect(prisma.feedbackReport.count).toHaveBeenCalledWith({
          where: { status: 'received' },
        });
        expect(users.getYouTubeAccessUsage).toHaveBeenCalledTimes(1);
      } finally {
        nowSpy.mockRestore();
      }
    });

    test('zero state reports zero counts and the full ceiling as places left', async () => {
      seedOverview({
        users: 0,
        usersJoinedLast7Days: 0,
        platformAdmins: 0,
        unverified: 0,
        unverifiedOverAWeek: 0,
        disabled: 0,
        everGranted: 0,
        ceiling: 25,
        feedbackReportsReceived: 0,
      });

      const res = await request(app)
        .get('/admin/overview')
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        users: 0,
        usersJoinedLast7Days: 0,
        platformAdmins: 0,
        unverified: 0,
        unverifiedOverAWeek: 0,
        disabled: 0,
        youtubeAccessPlacesUsed: 0,
        youtubeAccessPlacesLeft: 25,
        youtubeAccessCeiling: 25,
        feedbackReportsReceived: 0,
      });
    });

    test('fully used ceiling reports zero places left', async () => {
      seedOverview({
        users: 30,
        usersJoinedLast7Days: 3,
        platformAdmins: 2,
        unverified: 5,
        unverifiedOverAWeek: 2,
        disabled: 1,
        everGranted: 25,
        ceiling: 25,
        feedbackReportsReceived: 4,
      });

      const res = await request(app)
        .get('/admin/overview')
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        youtubeAccessPlacesUsed: 25,
        youtubeAccessPlacesLeft: 0,
        youtubeAccessCeiling: 25,
      });
    });

    test('ever-granted above a lowered ceiling clamps places left to zero', async () => {
      seedOverview({
        users: 30,
        usersJoinedLast7Days: 3,
        platformAdmins: 2,
        unverified: 5,
        unverifiedOverAWeek: 2,
        disabled: 1,
        everGranted: 18,
        ceiling: 10,
        feedbackReportsReceived: 4,
      });

      const res = await request(app)
        .get('/admin/overview')
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        youtubeAccessPlacesUsed: 18,
        youtubeAccessPlacesLeft: 0,
        youtubeAccessCeiling: 10,
      });
    });

    test('a failed count rejects the request with 500 and no partial body', async () => {
      const prisma = require('../prisma').__mockPrisma;
      seedOverview({
        users: 10,
        usersJoinedLast7Days: 2,
        platformAdmins: 1,
        unverified: 0,
        unverifiedOverAWeek: 0,
        disabled: 0,
        everGranted: 2,
        ceiling: 25,
        feedbackReportsReceived: 0,
      });
      prisma.feedbackReport.count.mockRejectedValue(
        new Error('database unavailable'),
      );

      const res = await request(app)
        .get('/admin/overview')
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ message: 'Internal Server Error' });
    });
  });
});
