import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import bodyParser from 'body-parser';
import express from 'express';
import request from 'supertest';

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

jest.mock('../middleware/authentication', () => {
  return {
    expressAuthentication: async (req: any, _securityName: string) => {
      const authHeader = req?.headers?.authorization;
      if (!authHeader) {
        const err = new Error('Unauthorized') as Error & { status?: number };
        err.status = 401;
        throw err;
      }

      const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length)
        : authHeader;

      // Authenticated non-admin: the real PlatformAdminControllerBase guard
      // (requirePlatformAdmin) produces the 403, not this stub.
      if (token === 'user') {
        req.user = { id: 'user-1', role: 'user', disabled: false };
        return req.user;
      }

      if (token === 'admin') {
        req.user = { id: 'admin-1', role: 'platform_admin', disabled: false };
        return req.user;
      }

      // Platform Admin whose account is disabled: the real guard
      // (requirePlatformAdmin) must refuse it, not this stub.
      if (token === 'disabled-admin') {
        req.user = { id: 'admin-2', role: 'platform_admin', disabled: true };
        return req.user;
      }

      const err = new Error('Unauthorized') as Error & { status?: number };
      err.status = 401;
      throw err;
    },
  };
});

jest.mock('../services/UserService', () => ({
  __esModule: true,
  default: {
    listAdminAuditLogs: jest.fn(),
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

jest.mock('../services/FeedbackService', () => ({
  __esModule: true,
  default: {},
}));

function makeApp() {
  jest.resetModules();

  const { RegisterRoutes } = require('../routes/routes');
  const { createTsoaErrorHandler } = require('../helpers/httpErrorHandler');

  const app = express();
  app.use(bodyParser.json({ limit: '2mb' }));
  RegisterRoutes(app);

  app.use(createTsoaErrorHandler());

  return app;
}

const auditRow = {
  id: 'log-1',
  actor_user_id: 'admin-1',
  target_user_id: 'u1',
  actor_name: 'Admin Example',
  target_name: 'Alice Example',
  action: 'disable' as const,
  created_at: new Date('2024-06-01T12:00:00.000Z'),
};

describe('AdminAuditLogController (HTTP integration)', () => {
  let app: express.Application;

  beforeAll(() => {
    app = makeApp();
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('GET /admin/audit-logs', () => {
    test('returns 401 when unauthenticated', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app).get('/admin/audit-logs');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(userService.listAdminAuditLogs).not.toHaveBeenCalled();
    });

    test('returns 403 for authenticated non-platform_admin', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app)
        .get('/admin/audit-logs')
        .set('Authorization', 'Bearer user');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: 'Platform Admin role required' });
      expect(userService.listAdminAuditLogs).not.toHaveBeenCalled();
    });

    test('returns 401 for a disabled platform_admin and skips the service', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app)
        .get('/admin/audit-logs')
        .set('Authorization', 'Bearer disabled-admin');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Account disabled' });
      expect(userService.listAdminAuditLogs).not.toHaveBeenCalled();
    });

    test('applies defaults when no params are given and returns the page envelope', async () => {
      const userService = require('../services/UserService').default;

      userService.listAdminAuditLogs.mockResolvedValueOnce({
        rows: [auditRow],
        total: 1,
      });

      const res = await request(app)
        .get('/admin/audit-logs')
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(userService.listAdminAuditLogs).toHaveBeenCalledWith({
        userId: undefined,
        action: undefined,
        page: 1,
        pageSize: 25,
      });
      expect(res.body).toEqual({
        entries: [expect.objectContaining({ id: 'log-1' })],
        total: 1,
        page: 1,
        pageSize: 25,
      });
    });

    test('maps a row with both users present to an entry with names, ids and not-deleted flags', async () => {
      const userService = require('../services/UserService').default;

      userService.listAdminAuditLogs.mockResolvedValueOnce({
        rows: [auditRow],
        total: 1,
      });

      const res = await request(app)
        .get('/admin/audit-logs')
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(res.body.entries).toEqual([
        {
          id: 'log-1',
          actorUserId: 'admin-1',
          targetUserId: 'u1',
          actorName: 'Admin Example',
          targetName: 'Alice Example',
          actorDeleted: false,
          targetDeleted: false,
          action: 'disable',
          createdAt: '2024-06-01T12:00:00.000Z',
        },
      ]);
    });

    test('maps a deleted actor and a deleted target to null ids and names with the deleted flags set', async () => {
      const userService = require('../services/UserService').default;

      userService.listAdminAuditLogs.mockResolvedValueOnce({
        rows: [
          {
            ...auditRow,
            id: 'log-2',
            actor_user_id: null,
            actor_name: null,
          },
          {
            ...auditRow,
            id: 'log-3',
            target_user_id: null,
            target_name: null,
          },
        ],
        total: 2,
      });

      const res = await request(app)
        .get('/admin/audit-logs')
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(res.body.entries).toEqual([
        {
          id: 'log-2',
          actorUserId: null,
          targetUserId: 'u1',
          actorName: null,
          targetName: 'Alice Example',
          actorDeleted: true,
          targetDeleted: false,
          action: 'disable',
          createdAt: '2024-06-01T12:00:00.000Z',
        },
        {
          id: 'log-3',
          actorUserId: 'admin-1',
          targetUserId: null,
          actorName: 'Admin Example',
          targetName: null,
          actorDeleted: false,
          targetDeleted: true,
          action: 'disable',
          createdAt: '2024-06-01T12:00:00.000Z',
        },
      ]);
    });

    test('forwards page and pageSize and echoes them with the service total', async () => {
      const userService = require('../services/UserService').default;

      userService.listAdminAuditLogs.mockResolvedValueOnce({
        rows: [auditRow],
        total: 14,
      });

      const res = await request(app)
        .get('/admin/audit-logs')
        .query({ page: 3, pageSize: 10 })
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(userService.listAdminAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ page: 3, pageSize: 10 }),
      );
      expect(res.body).toEqual(
        expect.objectContaining({ total: 14, page: 3, pageSize: 10 }),
      );
      expect(res.body.entries).toHaveLength(1);
    });

    test('forwards the userId filter to the service', async () => {
      const userService = require('../services/UserService').default;

      userService.listAdminAuditLogs.mockResolvedValueOnce({
        rows: [],
        total: 0,
      });

      const res = await request(app)
        .get('/admin/audit-logs')
        .query({ userId: 'u1' })
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(userService.listAdminAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1' }),
      );
    });

    test('forwards repeated action params as an array to the service', async () => {
      const userService = require('../services/UserService').default;

      userService.listAdminAuditLogs.mockResolvedValueOnce({
        rows: [],
        total: 0,
      });

      const res = await request(app)
        .get('/admin/audit-logs')
        .query('action=disable&action=enable')
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(userService.listAdminAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ action: ['disable', 'enable'] }),
      );
    });

    test('forwards a single action param as a one-element array to the service', async () => {
      const userService = require('../services/UserService').default;

      userService.listAdminAuditLogs.mockResolvedValueOnce({
        rows: [],
        total: 0,
      });

      const res = await request(app)
        .get('/admin/audit-logs')
        .query({ action: 'disable' })
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(userService.listAdminAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ action: ['disable'] }),
      );
    });

    test.each([
      { label: 'page=0', query: { page: 0 } },
      { label: 'page=1.5', query: { page: 1.5 } },
      { label: 'page=abc', query: { page: 'abc' } },
      { label: 'pageSize=0', query: { pageSize: 0 } },
      { label: 'pageSize=101', query: { pageSize: 101 } },
      { label: 'action=not_an_action', query: { action: 'not_an_action' } },
    ])('returns 422 and skips the service for $label', async ({ query }) => {
      const userService = require('../services/UserService').default;

      const res = await request(app)
        .get('/admin/audit-logs')
        .query(query)
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty('message', 'Validation Failed');
      expect(userService.listAdminAuditLogs).not.toHaveBeenCalled();
    });
  });
});
