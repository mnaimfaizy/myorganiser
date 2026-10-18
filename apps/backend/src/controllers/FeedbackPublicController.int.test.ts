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

jest.mock('../services/FeedbackFixNoticeService', () => ({
  __esModule: true,
  default: {
    unsubscribe: jest.fn(),
  },
}));

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

jest.mock('../services/FeedbackService', () => ({
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

jest.setTimeout(30_000);

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

describe('FeedbackPublicController (HTTP integration)', () => {
  let app: express.Application;

  beforeAll(() => {
    app = makeApp();
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('unsubscribes from Fix Notices with valid token (no auth headers)', async () => {
    const feedbackFixNoticeService =
      require('../services/FeedbackFixNoticeService').default;

    feedbackFixNoticeService.unsubscribe.mockResolvedValue(true);

    const res = await request(app)
      .post('/feedback/fix-notice/unsubscribe')
      .send({ token: 'valid-unsubscribe-token' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(feedbackFixNoticeService.unsubscribe).toHaveBeenCalledWith(
      'valid-unsubscribe-token',
    );
  });

  test('returns 404 when unsubscribe token is invalid (no auth headers)', async () => {
    const feedbackFixNoticeService =
      require('../services/FeedbackFixNoticeService').default;

    feedbackFixNoticeService.unsubscribe.mockResolvedValue(false);

    const res = await request(app)
      .post('/feedback/fix-notice/unsubscribe')
      .send({ token: 'invalid-token' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Unknown unsubscribe link.' });
    expect(feedbackFixNoticeService.unsubscribe).toHaveBeenCalledWith(
      'invalid-token',
    );
  });

  test('returns 400 when token field is missing from request body', async () => {
    const feedbackFixNoticeService =
      require('../services/FeedbackFixNoticeService').default;

    const res = await request(app)
      .post('/feedback/fix-notice/unsubscribe')
      .send({});

    expect(res.status).toBe(400);
    expect(feedbackFixNoticeService.unsubscribe).not.toHaveBeenCalled();
  });
});
