/* eslint-disable import/first */
jest.mock('../prisma', () => ({
  createPrismaClient: () => ({}),
}));

jest.mock('../middleware/authentication', () => {
  return {
    expressAuthentication: async (req: any) => {
      const authHeader = req?.headers?.authorization;
      if (!authHeader) {
        const err = new Error('Unauthorized') as Error & { status?: number };
        err.status = 401;
        throw err;
      }

      const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length)
        : authHeader;

      if (token === 'no-id') {
        req.user = {};
        return req.user;
      }

      req.user = { id: token || 'user-1' };
      return req.user;
    },
  };
});

jest.mock('../services/FeedbackService', () => {
  const createReport = jest.fn();
  return {
    __esModule: true,
    default: { createReport },
    FeedbackService: jest.fn(),
  };
});

// Prevent module-level createPrismaClient() calls from attempting a real DB connection
jest.mock('../services/VaultService', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../services/UserService', () => ({
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
import { ValidateError } from 'tsoa';

jest.setTimeout(120_000);

function makeApp() {
  jest.resetModules();

  const { RegisterRoutes } = require('../routes/routes');

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
        details: err?.fields,
      });
    }
    const anyErr = err as any;
    if (anyErr && typeof anyErr.status === 'number') {
      return res.status(anyErr.status).json({ message: anyErr.message });
    }
    if (err instanceof Error) {
      return res.status(500).json({ message: 'Internal Server Error' });
    }
    return next(err);
  });

  return app;
}

function makeValidBody() {
  return {
    kind: 'bug_report',
    title: 'App Crashes When Viewing Tasks',
    description: 'Every time I click on the tasks page, the app crashes',
    expectedOutcome: 'The tasks page should load without crashing',
    context: {
      platform: 'web',
      appVersion: '1.0.0',
      browser: 'Chrome 120',
      operatingSystem: 'macOS 14',
      path: '/dashboard/tasks',
      sentAt: new Date().toISOString(),
    },
    fixNoticeOptIn: true,
  };
}

describe('FeedbackController (HTTP integration)', () => {
  let app: express.Application;

  beforeAll(() => {
    app = makeApp();
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('authentication', () => {
    test('requires auth for POST /feedback/reports (returns 401)', async () => {
      const svc = require('../services/FeedbackService').default;

      const res = await request(app)
        .post('/feedback/reports')
        .send(makeValidBody());

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(svc.createReport).not.toHaveBeenCalled();
    });

    test('returns 401 when authenticated user has no id', async () => {
      const svc = require('../services/FeedbackService').default;

      const res = await request(app)
        .post('/feedback/reports')
        .set('Authorization', 'Bearer no-id')
        .send(makeValidBody());

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(svc.createReport).not.toHaveBeenCalled();
    });
  });

  describe('successful report creation', () => {
    test('creates a report and returns 201 with DTO', async () => {
      const svc = require('../services/FeedbackService').default;
      const now = new Date();
      svc.createReport.mockResolvedValueOnce({
        ok: true,
        status: 201,
        body: {
          id: 'report-1',
          kind: 'bug_report',
          status: 'received',
          title: 'App Crashes When Viewing Tasks',
          createdAt: now.toISOString(),
        },
      });

      const body = makeValidBody();
      const res = await request(app)
        .post('/feedback/reports')
        .set('Authorization', 'Bearer user-1')
        .send(body);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: 'report-1',
        kind: 'bug_report',
        status: 'received',
        title: 'App Crashes When Viewing Tasks',
        createdAt: now.toISOString(),
      });
      expect(svc.createReport).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining(body),
      );
    });

    test('passes authenticated user id to service', async () => {
      const svc = require('../services/FeedbackService').default;
      svc.createReport.mockResolvedValueOnce({
        ok: true,
        status: 201,
        body: {
          id: 'report-2',
          kind: 'suggestion',
          status: 'received',
          title: 'Add dark mode',
          createdAt: new Date().toISOString(),
        },
      });

      const res = await request(app)
        .post('/feedback/reports')
        .set('Authorization', 'Bearer user-42')
        .send(makeValidBody());

      expect(res.status).toBe(201);
      expect(svc.createReport).toHaveBeenCalledWith(
        'user-42',
        expect.anything(),
      );
    });
  });

  describe('service validation errors', () => {
    test('returns 400 when service validation fails', async () => {
      const svc = require('../services/FeedbackService').default;
      svc.createReport.mockResolvedValueOnce({
        ok: false,
        status: 400,
        body: { message: 'The title must be 120 characters or fewer.' },
      });

      const body = makeValidBody();
      const res = await request(app)
        .post('/feedback/reports')
        .set('Authorization', 'Bearer user-1')
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        message: 'The title must be 120 characters or fewer.',
      });
    });

    test('returns 429 when rate limit is exceeded', async () => {
      const svc = require('../services/FeedbackService').default;
      svc.createReport.mockResolvedValueOnce({
        ok: false,
        status: 429,
        body: {
          message:
            'You have sent too many reports today. Please try again later.',
        },
      });

      const body = makeValidBody();
      const res = await request(app)
        .post('/feedback/reports')
        .set('Authorization', 'Bearer user-1')
        .send(body);

      expect(res.status).toBe(429);
      expect(res.body).toEqual({
        message:
          'You have sent too many reports today. Please try again later.',
      });
      expect(svc.createReport).toHaveBeenCalled();
    });
  });

  describe('suggestion reports', () => {
    test('creates a suggestion report without expectedOutcome', async () => {
      const svc = require('../services/FeedbackService').default;
      svc.createReport.mockResolvedValueOnce({
        ok: true,
        status: 201,
        body: {
          id: 'report-3',
          kind: 'suggestion',
          status: 'received',
          title: 'Add export to PDF',
          createdAt: new Date().toISOString(),
        },
      });

      const body = {
        kind: 'suggestion',
        title: 'Add export to PDF',
        description: 'It would be useful to export reports to PDF',
        context: {
          platform: 'web',
          appVersion: '1.0.0',
          browser: 'Firefox',
          operatingSystem: 'Windows 11',
          path: '/dashboard/reports',
          sentAt: new Date().toISOString(),
        },
        fixNoticeOptIn: false,
      };

      const res = await request(app)
        .post('/feedback/reports')
        .set('Authorization', 'Bearer user-1')
        .send(body);

      expect(res.status).toBe(201);
      expect(res.body.kind).toBe('suggestion');
      expect(svc.createReport).toHaveBeenCalledWith(
        'user-1',
        expect.anything(),
      );
    });
  });

  describe('opt-in preference', () => {
    test('respects fix notice opt-in flag from client', async () => {
      const svc = require('../services/FeedbackService').default;
      svc.createReport.mockResolvedValueOnce({
        ok: true,
        status: 201,
        body: {
          id: 'report-4',
          kind: 'bug_report',
          status: 'received',
          title: 'Test',
          createdAt: new Date().toISOString(),
        },
      });

      const body = { ...makeValidBody(), fixNoticeOptIn: false };
      const res = await request(app)
        .post('/feedback/reports')
        .set('Authorization', 'Bearer user-1')
        .send(body);

      expect(res.status).toBe(201);
      expect(svc.createReport).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ fixNoticeOptIn: false }),
      );
    });
  });
});
