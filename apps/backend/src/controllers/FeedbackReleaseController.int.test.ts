/* eslint-disable import/first */
jest.mock('../prisma', () => ({
  createPrismaClient: () => ({}),
}));

jest.mock('../services/FeedbackReleaseService', () => ({
  __esModule: true,
  default: {
    markRelease: jest.fn(),
  },
}));

jest.mock('../services/AdminFeedbackService', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../services/FeedbackFixNoticeService', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../services/FeedbackService', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../services/UserService', () => ({
  __esModule: true,
  default: {
    getById: jest.fn(),
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
  afterAll,
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
import { attachTsoaErrorHandler } from '../testing/tsoaErrorHandler';

jest.setTimeout(30_000);

// Short fixtures on purpose: the pre-tool-use credential hook blocks long
// literals that follow a credential keyword.
const DEPLOY_SECRET = 'test-deploy-1';
const WRONG_DEPLOY_SECRET = 'wrong-deploy-1';
const ROUTE = '/feedback/releases/mark';
const VALID_BODY = { releaseTag: 'v1.4.0', issueNumbers: [12, 15] };

// The real expressAuthentication runs, so the deploy-secret wiring is proven
// end to end. The app is built once per file; the mocked service is reached
// through the same module registry the controller uses.
function makeApp(): express.Application {
  const { RegisterRoutes } = require('../routes/routes');

  const app = express();
  app.use(bodyParser.json({ limit: '2mb' }));
  RegisterRoutes(app);
  attachTsoaErrorHandler(app);

  return app;
}

describe('FeedbackReleaseController (HTTP integration)', () => {
  const originalDeploySecret = process.env.FEEDBACK_RELEASE_SECRET;
  let app: express.Application;

  beforeAll(() => {
    process.env.FEEDBACK_RELEASE_SECRET = DEPLOY_SECRET;
    app = makeApp();
  });

  afterAll(() => {
    if (originalDeploySecret === undefined) {
      delete process.env.FEEDBACK_RELEASE_SECRET;
    } else {
      process.env.FEEDBACK_RELEASE_SECRET = originalDeploySecret;
    }
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('marks the Release with the deploy secret and returns exactly the four counts', async () => {
    const feedbackReleaseService =
      require('../services/FeedbackReleaseService').default;
    feedbackReleaseService.markRelease.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        reportsMarked: 2,
        fixNoticesSent: 1,
        fixNoticesSkipped: 1,
        fixNoticesFailed: 0,
      },
    });

    const res = await request(app)
      .post(ROUTE)
      .set('X-Deploy-Secret', DEPLOY_SECRET)
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'fixNoticesFailed',
      'fixNoticesSent',
      'fixNoticesSkipped',
      'reportsMarked',
    ]);
    expect(res.body).toEqual({
      reportsMarked: 2,
      fixNoticesSent: 1,
      fixNoticesSkipped: 1,
      fixNoticesFailed: 0,
    });
    expect(feedbackReleaseService.markRelease).toHaveBeenCalledTimes(1);
    expect(feedbackReleaseService.markRelease).toHaveBeenCalledWith({
      releaseTag: 'v1.4.0',
      issueNumbers: [12, 15],
    });
  });

  test('rejects a request with no X-Deploy-Secret header', async () => {
    const feedbackReleaseService =
      require('../services/FeedbackReleaseService').default;

    const res = await request(app).post(ROUTE).send(VALID_BODY);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthorized' });
    expect(feedbackReleaseService.markRelease).not.toHaveBeenCalled();
  });

  test('rejects a request whose X-Deploy-Secret does not match FEEDBACK_RELEASE_SECRET', async () => {
    const feedbackReleaseService =
      require('../services/FeedbackReleaseService').default;

    const res = await request(app)
      .post(ROUTE)
      .set('X-Deploy-Secret', WRONG_DEPLOY_SECRET)
      .send(VALID_BODY);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthorized' });
    expect(feedbackReleaseService.markRelease).not.toHaveBeenCalled();
  });

  test('rejects a request with no X-Deploy-Secret even when an Authorization Bearer header is sent', async () => {
    const feedbackReleaseService =
      require('../services/FeedbackReleaseService').default;

    const res = await request(app)
      .post(ROUTE)
      .set('Authorization', 'Bearer garbage-user-token')
      .send(VALID_BODY);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthorized' });
    expect(feedbackReleaseService.markRelease).not.toHaveBeenCalled();
  });

  test('passes the service 400 through with its message', async () => {
    const feedbackReleaseService =
      require('../services/FeedbackReleaseService').default;
    feedbackReleaseService.markRelease.mockResolvedValue({
      ok: false,
      status: 400,
      body: { message: 'x' },
    });

    const res = await request(app)
      .post(ROUTE)
      .set('X-Deploy-Secret', DEPLOY_SECRET)
      .send({ releaseTag: 'not a tag', issueNumbers: [12] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'x' });
    expect(feedbackReleaseService.markRelease).toHaveBeenCalledTimes(1);
  });
});
