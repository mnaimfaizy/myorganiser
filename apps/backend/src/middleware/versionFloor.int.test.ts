import {
  afterAll,
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
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createVersionFloorMiddleware } from './versionFloor';

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

// The real authentication middleware is NOT mocked. Its only collaborator is
// UserService.getById, which is the seam for a valid token's User lookup.
jest.mock('../services/UserService', () => ({
  __esModule: true,
  default: {
    getById: jest.fn(),
  },
}));

jest.mock('../services/VaultService', () => ({
  __esModule: true,
  default: {
    getVaultMeta: jest.fn(),
  },
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

// Test-only signing key, short of the credential-fixture length limit.
const TEST_JWT_KEY = 'test-jwt-key';
const ORIGINAL_JWT_KEY = process.env.ACCESS_JWT_SECRET;

// The real authentication middleware reads ACCESS_JWT_SECRET from process.env,
// so it is set for this file and restored afterwards.
beforeAll(() => {
  process.env.ACCESS_JWT_SECRET = TEST_JWT_KEY;
});

afterAll(() => {
  if (ORIGINAL_JWT_KEY === undefined) {
    delete process.env.ACCESS_JWT_SECRET;
  } else {
    process.env.ACCESS_JWT_SECRET = ORIGINAL_JWT_KEY;
  }
});

type AnyMock = jest.Mock<(...args: any[]) => any>;

// Mirrors main.ts: the version floor is the first middleware on the API router,
// ahead of the routes, and the tsoa error handler sits at the app level.
function makeApp(env: Record<string, string | undefined>) {
  jest.resetModules();

  const { RegisterRoutes } = require('../routes/routes');
  // Loaded after resetModules so its tsoa ValidateError class matches the one
  // the routes throw.
  const { attachTsoaErrorHandler } = require('../testing/tsoaErrorHandler');
  const vaultService = require('../services/VaultService').default as {
    getVaultMeta: AnyMock;
  };
  const userService = require('../services/UserService').default as {
    getById: AnyMock;
  };

  const app = express();
  app.use(bodyParser.json({ limit: '2mb' }));

  const api = express.Router();
  api.use(createVersionFloorMiddleware(env));
  RegisterRoutes(api);
  app.use(api);
  attachTsoaErrorHandler(app);

  return { app, vaultService, userService };
}

function validToken(): string {
  return jwt.sign({ userId: 'user-1' }, TEST_JWT_KEY, { expiresIn: '1h' });
}

function arrangeAuthenticatedUser(userService: { getById: AnyMock }) {
  userService.getById.mockResolvedValue({
    id: 'user-1',
    role: 'user',
    disabled: false,
    sessions_invalidated_at: null,
  });
}

function arrangeVaultMeta(vaultService: { getVaultMeta: AnyMock }) {
  vaultService.getVaultMeta.mockResolvedValue({
    status: 200,
    body: { marker: 'vault-meta' },
  });
}

const FLOOR = '1.2.0';
const BELOW_FLOOR_HEADER = 'mobile/1.1.9 (android)';

describe('Version Floor HTTP wiring (integration)', () => {
  // An invalid floor logs at creation time. Silence it for every test and
  // assert on it where the invalid-floor behaviour is under test.
  let consoleErrorSpy: AnyMock;

  beforeEach(() => {
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined) as unknown as AnyMock;
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('when the floor is off', () => {
    test('an unset floor passes a Mobile App request far below any version', async () => {
      const { app, vaultService, userService } = makeApp({});
      arrangeAuthenticatedUser(userService);
      arrangeVaultMeta(vaultService);

      const response = await request(app)
        .get('/vault')
        .set('Authorization', `Bearer ${validToken()}`)
        .set('X-Client', 'mobile/0.0.1 (android)');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ marker: 'vault-meta' });
      expect(vaultService.getVaultMeta).toHaveBeenCalledWith('user-1');
    });

    test('a blank floor is off and passes the same request', async () => {
      const { app, vaultService, userService } = makeApp({
        MOBILE_VERSION_FLOOR: '  ',
      });
      arrangeAuthenticatedUser(userService);
      arrangeVaultMeta(vaultService);

      const response = await request(app)
        .get('/vault')
        .set('Authorization', `Bearer ${validToken()}`)
        .set('X-Client', 'mobile/0.0.1 (android)');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ marker: 'vault-meta' });
      expect(vaultService.getVaultMeta).toHaveBeenCalledWith('user-1');
    });
  });

  describe(`when the floor is ${FLOOR}`, () => {
    test('refuses a Mobile App below the floor with the typed 426 body and never reaches the route', async () => {
      const { app, vaultService, userService } = makeApp({
        MOBILE_VERSION_FLOOR: FLOOR,
      });
      arrangeAuthenticatedUser(userService);
      arrangeVaultMeta(vaultService);

      const response = await request(app)
        .get('/vault')
        .set('Authorization', `Bearer ${validToken()}`)
        .set('X-Client', BELOW_FLOOR_HEADER);

      expect(response.status).toBe(426);
      expect(response.body).toEqual({
        code: 'below_version_floor',
        message: expect.any(String),
        versionFloor: FLOOR,
        platform: 'android',
      });
      expect(vaultService.getVaultMeta).not.toHaveBeenCalled();
      expect(userService.getById).not.toHaveBeenCalled();
    });

    test('passes a Mobile App at exactly the floor', async () => {
      const { app, vaultService, userService } = makeApp({
        MOBILE_VERSION_FLOOR: FLOOR,
      });
      arrangeAuthenticatedUser(userService);
      arrangeVaultMeta(vaultService);

      const response = await request(app)
        .get('/vault')
        .set('Authorization', `Bearer ${validToken()}`)
        .set('X-Client', 'mobile/1.2.0 (ios)');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ marker: 'vault-meta' });
      expect(vaultService.getVaultMeta).toHaveBeenCalledWith('user-1');
    });

    test('compares semver numerically, so 1.10.0 passes a 1.2.0 floor', async () => {
      const { app, vaultService, userService } = makeApp({
        MOBILE_VERSION_FLOOR: FLOOR,
      });
      arrangeAuthenticatedUser(userService);
      arrangeVaultMeta(vaultService);

      const response = await request(app)
        .get('/vault')
        .set('Authorization', `Bearer ${validToken()}`)
        .set('X-Client', 'mobile/1.10.0 (ios)');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ marker: 'vault-meta' });
      expect(vaultService.getVaultMeta).toHaveBeenCalledWith('user-1');
    });

    test('passes the web app, which sends no X-Client header', async () => {
      const { app, vaultService, userService } = makeApp({
        MOBILE_VERSION_FLOOR: FLOOR,
      });
      arrangeAuthenticatedUser(userService);
      arrangeVaultMeta(vaultService);

      const response = await request(app)
        .get('/vault')
        .set('Authorization', `Bearer ${validToken()}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ marker: 'vault-meta' });
      expect(vaultService.getVaultMeta).toHaveBeenCalledWith('user-1');
    });

    test.each([
      ['mobile/1.2 (ios)', 'ios'],
      ['mobile/abc (android)', 'android'],
      ['mobile/2.0.0-beta.1 (ios)', 'ios'],
      ['mobile/2.0.0 (windows)', null],
      ['web/1.0.0', null],
      ['', null],
    ])(
      'refuses malformed X-Client %j with 426 below_version_floor (platform %j)',
      async (header, platform) => {
        const { app } = makeApp({ MOBILE_VERSION_FLOOR: FLOOR });

        const response = await request(app)
          .get('/vault')
          .set('X-Client', header);

        expect(response.status).toBe(426);
        expect(response.body.code).toBe('below_version_floor');
        expect(response.body.platform).toBe(platform);
        expect(response.body.versionFloor).toBe(FLOOR);
      },
    );
  });

  describe('ordering against authentication', () => {
    test('refuses a below-floor request without a token with 426, not 401', async () => {
      const { app, vaultService, userService } = makeApp({
        MOBILE_VERSION_FLOOR: FLOOR,
      });
      arrangeVaultMeta(vaultService);

      const response = await request(app)
        .get('/vault')
        .set('X-Client', BELOW_FLOOR_HEADER);

      expect(response.status).toBe(426);
      expect(response.body.code).toBe('below_version_floor');
      expect(userService.getById).not.toHaveBeenCalled();
      expect(vaultService.getVaultMeta).not.toHaveBeenCalled();
    });

    test('a passing client without a token still reaches authentication and gets 401', async () => {
      const { app, vaultService, userService } = makeApp({
        MOBILE_VERSION_FLOOR: FLOOR,
      });
      arrangeVaultMeta(vaultService);

      const response = await request(app)
        .get('/vault')
        .set('X-Client', 'mobile/1.2.0 (ios)');

      expect(response.status).toBe(401);
      expect(userService.getById).not.toHaveBeenCalled();
      expect(vaultService.getVaultMeta).not.toHaveBeenCalled();
    });
  });

  describe('when the floor is invalid', () => {
    test('a web request with no X-Client header still passes', async () => {
      const { app, vaultService, userService } = makeApp({
        MOBILE_VERSION_FLOOR: 'v1.0.0',
      });
      arrangeAuthenticatedUser(userService);
      arrangeVaultMeta(vaultService);

      const response = await request(app)
        .get('/vault')
        .set('Authorization', `Bearer ${validToken()}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ marker: 'vault-meta' });
      expect(vaultService.getVaultMeta).toHaveBeenCalledWith('user-1');
    });

    test.each([
      ['mobile/1.0.0 (ios)'],
      ['mobile/9.9.9 (android)'],
      ['mobile/abc (android)'],
    ])(
      'passes %j and reaches the route: an invalid floor turns the check fully off',
      async (header) => {
        const { app, vaultService, userService } = makeApp({
          MOBILE_VERSION_FLOOR: 'v1.0.0',
        });
        arrangeAuthenticatedUser(userService);
        arrangeVaultMeta(vaultService);

        const response = await request(app)
          .get('/vault')
          .set('Authorization', `Bearer ${validToken()}`)
          .set('X-Client', header);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ marker: 'vault-meta' });
        expect(vaultService.getVaultMeta).toHaveBeenCalledWith('user-1');
        expect(vaultService.getVaultMeta).toHaveBeenCalledTimes(1);
      },
    );

    test('logs exactly one console error when the middleware is created', () => {
      makeApp({ MOBILE_VERSION_FLOOR: 'v1.0.0' });

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('v1.0.0'),
      );
    });
  });
});
