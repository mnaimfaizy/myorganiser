/* eslint-disable import/first */
jest.mock('../prisma', () => ({
  createPrismaClient: () => ({}),
}));

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

jest.mock('../services/UserService', () => ({
  __esModule: true,
  default: {},
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

function makeApp() {
  jest.resetModules();

  const { RegisterRoutes } = require('../routes/routes');
  // Load tsoa after resetModules so instanceof matches the ValidateError the
  // freshly required routes throw.
  const { ValidateError } = require('tsoa');

  const app = express();
  app.use(bodyParser.json({ limit: '2mb' }));
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
        details: (err as { fields?: unknown }).fields,
      });
    }

    const anyErr = err as any;
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

describe('AdminFeedbackController (HTTP integration)', () => {
  let app: express.Application;

  beforeAll(() => {
    app = makeApp();
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('non-admin rejection across all routes (7 tests)', () => {
    const routes = [
      { method: 'get', path: '/admin/feedback/reports', body: undefined },
      {
        method: 'get',
        path: '/admin/feedback/reports/report-1',
        body: undefined,
      },
      {
        method: 'patch',
        path: '/admin/feedback/reports/report-1/status',
        body: { status: 'wont_do' },
      },
      {
        method: 'put',
        path: '/admin/feedback/reports/report-1/tracking-issue',
        body: { trackingIssueNumber: 42 },
      },
      {
        method: 'delete',
        path: '/admin/feedback/reports/report-1/tracking-issue',
        body: undefined,
      },
      {
        method: 'post',
        path: '/admin/feedback/reports/report-1/delivery',
        body: { releaseTag: 'v1.4.0' },
      },
      {
        method: 'post',
        path: '/admin/feedback/reports/report-1/reopen',
        body: { statusNote: 'Closed in error' },
      },
    ];

    routes.forEach((route, idx) => {
      test(`route ${idx + 1}: ${route.method.toUpperCase()} ${route.path} returns 403 for non-admin`, async () => {
        const svc = require('../services/AdminFeedbackService').default;

        const agent = request(app);
        let req = agent[route.method as keyof typeof request](route.path).set(
          'Authorization',
          'Bearer user',
        );

        if (route.body) {
          req = req.send(route.body);
        }

        const res = await req;

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ message: 'Platform Admin role required' });
        expect(svc.listReports).not.toHaveBeenCalled();
        expect(svc.getReport).not.toHaveBeenCalled();
        expect(svc.changeStatus).not.toHaveBeenCalled();
        expect(svc.linkTrackingIssue).not.toHaveBeenCalled();
        expect(svc.unlinkTrackingIssue).not.toHaveBeenCalled();
        expect(svc.markDelivered).not.toHaveBeenCalled();
        expect(svc.reopenReport).not.toHaveBeenCalled();
      });
    });
  });

  describe('unauthenticated rejection (2 tests)', () => {
    test('GET /admin/feedback/reports without auth returns 401', async () => {
      const svc = require('../services/AdminFeedbackService').default;

      const res = await request(app).get('/admin/feedback/reports');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(svc.listReports).not.toHaveBeenCalled();
    });

    test('PATCH /admin/feedback/reports/{reportId}/status without auth returns 401', async () => {
      const svc = require('../services/AdminFeedbackService').default;

      const res = await request(app)
        .patch('/admin/feedback/reports/report-1/status')
        .send({ status: 'wont_do', statusNote: 'Not planned.' });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(svc.changeStatus).not.toHaveBeenCalled();
    });
  });

  describe('admin success paths (4 tests)', () => {
    test('GET /admin/feedback/reports with admin token returns 200 with items and passes query filters', async () => {
      const svc = require('../services/AdminFeedbackService').default;
      const mockItems = [
        {
          id: 'report-1',
          kind: 'bug_report',
          status: 'planned',
          title: 'App crashes on tasks page',
          platform: 'web',
          trackingIssueNumber: 42,
          reporterUserId: 'user-1',
          statusChangedAt: '2026-10-17T10:00:00.000Z',
          createdAt: '2026-10-15T10:00:00.000Z',
        },
      ];

      svc.listReports.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: { items: mockItems },
      });

      const res = await request(app)
        .get('/admin/feedback/reports')
        .query({
          status: 'planned',
          kind: 'bug_report',
          platform: 'web',
          trackingIssueNumber: 42,
          limit: 10,
        })
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: mockItems });
      expect(svc.listReports).toHaveBeenCalledWith({
        status: 'planned',
        kind: 'bug_report',
        platform: 'web',
        trackingIssueNumber: 42,
        limit: 10,
      });
    });

    test('GET /admin/feedback/reports/{reportId} with admin token returns 200 with detail', async () => {
      const svc = require('../services/AdminFeedbackService').default;
      const mockDetail = {
        id: 'report-1',
        kind: 'bug_report',
        status: 'planned',
        title: 'App crashes on tasks page',
        description: 'Every time I click on tasks, app crashes',
        expectedOutcome: 'App should load normally',
        platform: 'web',
        trackingIssueNumber: 42,
        reporterUserId: 'user-1',
        statusChangedAt: '2026-10-17T10:00:00.000Z',
        createdAt: '2026-10-15T10:00:00.000Z',
        context: {
          platform: 'web',
          appVersion: '1.0.0',
          browser: 'Chrome 120',
          operatingSystem: 'macOS 14',
          path: '/dashboard/tasks',
          sentAt: '2026-10-15T09:50:00.000Z',
        },
        followUp: null,
        statusNote: null,
        releaseTag: null,
        fixNoticeOptIn: true,
        reporter: {
          id: 'user-1',
          name: 'Alice Example',
          email: 'alice@example.com',
        },
      };

      svc.getReport.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: mockDetail,
      });

      const res = await request(app)
        .get('/admin/feedback/reports/report-1')
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockDetail);
      expect(svc.getReport).toHaveBeenCalledWith('report-1');
    });

    test('PATCH /admin/feedback/reports/{reportId}/status with admin token calls changeStatus with admin id, reportId, and body', async () => {
      const svc = require('../services/AdminFeedbackService').default;
      const mockUpdated = {
        id: 'report-1',
        kind: 'bug_report',
        status: 'wont_do',
        title: 'App crashes on tasks page',
        description: 'Every time I click on tasks, app crashes',
        expectedOutcome: 'App should load normally',
        platform: 'web',
        trackingIssueNumber: null,
        reporterUserId: 'user-1',
        statusChangedAt: '2026-10-17T12:00:00.000Z',
        createdAt: '2026-10-15T10:00:00.000Z',
        context: {
          platform: 'web',
          appVersion: '1.0.0',
          browser: 'Chrome 120',
          operatingSystem: 'macOS 14',
          path: '/dashboard/tasks',
          sentAt: '2026-10-15T09:50:00.000Z',
        },
        followUp: null,
        statusNote: 'Not planned.',
        releaseTag: null,
        fixNoticeOptIn: true,
        reporter: {
          id: 'user-1',
          name: 'Alice Example',
          email: 'alice@example.com',
        },
      };

      svc.changeStatus.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: mockUpdated,
      });

      const res = await request(app)
        .patch('/admin/feedback/reports/report-1/status')
        .set('Authorization', 'Bearer admin')
        .send({ status: 'wont_do', statusNote: 'Not planned.' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockUpdated);
      expect(svc.changeStatus).toHaveBeenCalledWith('admin-1', 'report-1', {
        status: 'wont_do',
        statusNote: 'Not planned.',
      });
    });

    test('POST /admin/feedback/reports/{reportId}/delivery with admin token calls markDelivered with admin id, reportId, and body', async () => {
      const svc = require('../services/AdminFeedbackService').default;
      const mockUpdated = {
        id: 'report-1',
        kind: 'bug_report',
        status: 'fixed',
        title: 'App crashes on tasks page',
        description: 'Every time I click on tasks, app crashes',
        expectedOutcome: 'App should load normally',
        platform: 'web',
        trackingIssueNumber: null,
        reporterUserId: 'user-1',
        statusChangedAt: '2026-10-17T12:00:00.000Z',
        createdAt: '2026-10-15T10:00:00.000Z',
        context: {
          platform: 'web',
          appVersion: '1.0.0',
          browser: 'Chrome 120',
          operatingSystem: 'macOS 14',
          path: '/dashboard/tasks',
          sentAt: '2026-10-15T09:50:00.000Z',
        },
        followUp: null,
        statusNote: null,
        releaseTag: 'v1.4.0',
        fixNoticeOptIn: true,
        reporter: {
          id: 'user-1',
          name: 'Alice Example',
          email: 'alice@example.com',
        },
      };

      svc.markDelivered.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: mockUpdated,
      });

      const res = await request(app)
        .post('/admin/feedback/reports/report-1/delivery')
        .set('Authorization', 'Bearer admin')
        .send({ releaseTag: 'v1.4.0' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockUpdated);
      expect(svc.markDelivered).toHaveBeenCalledWith('admin-1', 'report-1', {
        releaseTag: 'v1.4.0',
      });
    });
  });

  describe('service error propagation (1 test)', () => {
    test('service refusal (ok: false) reaches client with correct status and message', async () => {
      const svc = require('../services/AdminFeedbackService').default;

      svc.getReport.mockResolvedValueOnce({
        ok: false,
        status: 404,
        body: { message: 'That feedback report does not exist.' },
      });

      const res = await request(app)
        .get('/admin/feedback/reports/nonexistent')
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        message: 'That feedback report does not exist.',
      });
    });
  });

  describe('reopen feedback report (6 tests)', () => {
    const reopenedDetail = {
      id: 'report-1',
      kind: 'bug_report',
      status: 'under_review',
      title: 'App crashes on tasks page',
      description: 'Every time I click on tasks, app crashes',
      expectedOutcome: 'App should load normally',
      platform: 'web',
      trackingIssueNumber: 42,
      reporterUserId: 'user-1',
      statusChangedAt: '2026-10-17T12:00:00.000Z',
      createdAt: '2026-10-15T10:00:00.000Z',
      context: {
        platform: 'web',
        appVersion: '1.0.0',
        browser: 'Chrome 120',
        operatingSystem: 'macOS 14',
        path: '/dashboard/tasks',
        sentAt: '2026-10-15T09:50:00.000Z',
      },
      followUp: null,
      statusNote: 'Closed in error',
      releaseTag: null,
      fixNoticeOptIn: true,
      reporter: {
        id: 'user-1',
        name: 'Alice Example',
        email: 'alice@example.com',
      },
    };

    test('POST /admin/feedback/reports/{reportId}/reopen with admin token returns 200 with detail and calls reopenReport with admin id, reportId, and body', async () => {
      const svc = require('../services/AdminFeedbackService').default;

      svc.reopenReport.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: reopenedDetail,
      });

      const res = await request(app)
        .post('/admin/feedback/reports/report-1/reopen')
        .set('Authorization', 'Bearer admin')
        .send({ statusNote: 'Closed in error' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(reopenedDetail);
      expect(svc.reopenReport).toHaveBeenCalledWith('admin-1', 'report-1', {
        statusNote: 'Closed in error',
      });
    });

    test('service refusal for a report that is not Fixed or Shipped reaches client as 400 with message', async () => {
      const svc = require('../services/AdminFeedbackService').default;

      svc.reopenReport.mockResolvedValueOnce({
        ok: false,
        status: 400,
        body: {
          message: 'Only a report marked Fixed or Shipped can be reopened.',
        },
      });

      const res = await request(app)
        .post('/admin/feedback/reports/report-1/reopen')
        .set('Authorization', 'Bearer admin')
        .send({ statusNote: 'Closed in error' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        message: 'Only a report marked Fixed or Shipped can be reopened.',
      });
    });

    test('blank status note is forwarded to the service and its 400 refusal reaches client', async () => {
      const svc = require('../services/AdminFeedbackService').default;

      svc.reopenReport.mockResolvedValueOnce({
        ok: false,
        status: 400,
        body: { message: 'Write a status note explaining why.' },
      });

      const res = await request(app)
        .post('/admin/feedback/reports/report-1/reopen')
        .set('Authorization', 'Bearer admin')
        .send({ statusNote: '   ' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        message: 'Write a status note explaining why.',
      });
      expect(svc.reopenReport).toHaveBeenCalledWith('admin-1', 'report-1', {
        statusNote: '   ',
      });
    });

    test('service not-found refusal reaches client as 404 with message', async () => {
      const svc = require('../services/AdminFeedbackService').default;

      svc.reopenReport.mockResolvedValueOnce({
        ok: false,
        status: 404,
        body: { message: 'That feedback report does not exist.' },
      });

      const res = await request(app)
        .post('/admin/feedback/reports/nonexistent/reopen')
        .set('Authorization', 'Bearer admin')
        .send({ statusNote: 'Closed in error' });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        message: 'That feedback report does not exist.',
      });
      expect(svc.reopenReport).toHaveBeenCalledWith('admin-1', 'nonexistent', {
        statusNote: 'Closed in error',
      });
    });

    test('body missing statusNote fails tsoa validation with 422 and never reaches the service', async () => {
      const svc = require('../services/AdminFeedbackService').default;

      const res = await request(app)
        .post('/admin/feedback/reports/report-1/reopen')
        .set('Authorization', 'Bearer admin')
        .send({});

      expect(res.status).toBe(422);
      expect(res.body.message).toBe('Validation Failed');
      expect(svc.reopenReport).not.toHaveBeenCalled();
    });

    test('POST /admin/feedback/reports/{reportId}/reopen without auth returns 401 and never reaches the service', async () => {
      const svc = require('../services/AdminFeedbackService').default;

      const res = await request(app)
        .post('/admin/feedback/reports/report-1/reopen')
        .send({ statusNote: 'Closed in error' });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(svc.reopenReport).not.toHaveBeenCalled();
    });
  });
});
