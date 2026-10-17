import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';
import fs from 'fs';
import path from 'path';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { ACCESS_TOKEN_EXPIRES_IN_MS } from '../helpers/tokenLifetimes';

jest.setTimeout(30_000);

// PlatformTokenHandler imports @myorganiser/auth; keep ts-jest on the
// refresh-client-contract surface so the rest of that package is not compiled
// under the backend spec tsconfig.
jest.mock('@myorganiser/auth', () =>
  jest.requireActual('../../../../libs/auth/src/lib/refresh-client-contract'),
);

const verifiedUser = {
  id: 'user-1',
  name: 'Alice Example',
  first_name: 'Alice',
  last_name: 'Example',
  email: 'alice@example.com',
  phone: null,
  role: 'user',
  disabled: false,
  email_verification_timestamp: new Date('2024-01-01'),
  blacklisted_tokens: [] as string[],
  sessions_invalidated_at: null as Date | null,
};

const unverifiedUser = {
  ...verifiedUser,
  id: 'user-unverified',
  email: 'unverified@example.com',
  email_verification_timestamp: null,
};

const disabledUser = {
  ...verifiedUser,
  id: 'user-disabled',
  email: 'disabled@example.com',
  disabled: true,
};

const platformAdminUser = {
  ...verifiedUser,
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Platform Admin',
  first_name: 'Platform',
  last_name: 'Admin',
  role: 'platform_admin',
};

const defaultRoleUser = {
  id: 'user-default',
  name: 'Default User',
  first_name: 'Default',
  last_name: 'User',
  email: 'default@example.com',
  phone: null,
  email_verification_timestamp: new Date('2024-01-01'),
  blacklisted_tokens: [] as string[],
  sessions_invalidated_at: null as Date | null,
};

const filteredVerifiedUser = {
  id: verifiedUser.id,
  name: verifiedUser.name,
  email: verifiedUser.email,
  firstName: 'Alice',
  lastName: 'Example',
  phone: undefined,
  role: 'user',
  disabled: false,
};

jest.mock('../helpers/ApiTokens', () => ({
  __esModule: true,
  default: {
    createTokens: jest.fn(() => ({
      token: 'access-token',
      refreshToken: 'refresh-token-1',
    })),
  },
}));

jest.mock('../helpers/jwtHelper', () => ({
  __esModule: true,
  decodeToken: jest.fn((token: string) => {
    if (token === 'verify-ok') {
      return { userId: 'user-1' };
    }

    return new Error('jwt malformed');
  }),
  generateToken: jest.fn(),
}));

jest.mock('../utils/passport', () => ({
  __esModule: true,
  default: {
    initialize:
      () =>
      (
        _req: express.Request,
        _res: express.Response,
        next: express.NextFunction,
      ) =>
        next(),
    authenticate: (
      _strategy: string,
      options: unknown,
      callback?: (
        err: unknown,
        user: unknown,
        info?: { message?: string },
      ) => void,
    ) => {
      const cb =
        typeof options === 'function' ? (options as typeof callback) : callback;

      if (cb) {
        return (
          req: express.Request,
          _res: express.Response,
          _next: express.NextFunction,
        ) => {
          const email = (req.body as { email?: string })?.email;

          if (email === 'bad@example.com') {
            cb(null, false, { message: 'Invalid credentials' });
            return;
          }

          if (email === disabledUser.email) {
            cb(null, disabledUser);
            return;
          }

          if (email === unverifiedUser.email) {
            cb(null, unverifiedUser);
            return;
          }

          if (email === verifiedUser.email) {
            cb(null, verifiedUser);
            return;
          }

          if (email === platformAdminUser.email) {
            cb(null, platformAdminUser);
            return;
          }

          if (email === defaultRoleUser.email) {
            cb(null, defaultRoleUser);
            return;
          }

          cb(null, false, { message: 'Unauthorized' });
        };
      }

      return (
        req: express.Request & { user?: unknown },
        res: express.Response,
        next: express.NextFunction,
      ) => {
        const authHeader = req.headers?.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
          res.status(401).json({ message: 'Unauthorized' });
          return;
        }
        req.user = verifiedUser;
        next();
      };
    },
  },
}));

jest.mock('../middleware/authentication', () => ({
  expressAuthentication: async (req: {
    headers?: { authorization?: string };
  }) => {
    const authHeader = req?.headers?.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      const err = new Error('Unauthorized') as Error & { status?: number };
      err.status = 401;
      throw err;
    }
    return verifiedUser;
  },
}));

jest.mock('../services/UserService', () => ({
  __esModule: true,
  default: {
    getByEmail: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    sendVerificationMail: jest.fn(),
    sendPasswordResetMail: jest.fn(),
    resetPassword: jest.fn(),
    update: jest.fn(),
    deleteById: jest.fn(),
    refreshToken: jest.fn(),
    logout: jest.fn(),
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

function asSetCookieHeaders(headers: string | string[] | undefined): string[] {
  if (!headers) return [];
  return Array.isArray(headers) ? headers : [headers];
}

function makeApp() {
  jest.resetModules();

  const { RegisterRoutes } = require('../routes/routes');
  const passport = require('../utils/passport').default;
  const { attachTsoaErrorHandler } = require('../testing/tsoaErrorHandler');

  const app = express();
  app.use(cookieParser());
  app.use(bodyParser.json({ limit: '2mb' }));
  app.use(passport.initialize());
  RegisterRoutes(app);
  attachTsoaErrorHandler(app);

  return app;
}

describe('Auth HTTP routes (HTTP integration)', () => {
  let app: express.Application;

  beforeAll(() => {
    app = makeApp();
  });

  beforeEach(() => {
    jest.resetAllMocks();

    const apiTokens = require('../helpers/ApiTokens').default;
    apiTokens.createTokens.mockImplementation(() => ({
      token: 'access-token',
      refreshToken: 'refresh-token-1',
    }));

    const userService = require('../services/UserService').default;
    userService.logout.mockImplementation(async () => verifiedUser);

    const { decodeToken } = require('../helpers/jwtHelper');
    decodeToken.mockImplementation((token: string) => {
      if (token === 'verify-ok') {
        return { userId: 'user-1' };
      }

      if (token === 'other-user-refresh') {
        return { userId: 'other-user' };
      }

      if (token === 'refresh-token-1' || token === 'body-refresh-token') {
        return { userId: 'user-1' };
      }

      return new Error('jwt malformed');
    });
  });

  describe('POST /auth/login', () => {
    test('returns 200 for web client with refresh cookie and no refresh_token in JSON', async () => {
      const res = await request(app).post('/auth/login').send({
        email: verifiedUser.email,
        password: 'test-pass-1',
        client_type: 'web',
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        token: 'access-token',
        expires_in: ACCESS_TOKEN_EXPIRES_IN_MS,
        user: filteredVerifiedUser,
      });
      expect(res.body.refresh_token).toBeUndefined();

      const setCookie = asSetCookieHeaders(res.headers['set-cookie']);
      expect(setCookie.length).toBeGreaterThan(0);
      expect(
        setCookie.some((cookie) => cookie.startsWith('refresh_cookie=')),
      ).toBe(true);
      expect(setCookie.some((cookie) => cookie.includes('HttpOnly'))).toBe(
        true,
      );
    });

    test('returns 200 for mobile client with refresh_token in JSON and refresh cookie', async () => {
      const res = await request(app).post('/auth/login').send({
        email: verifiedUser.email,
        password: 'test-pass-1',
        client_type: 'mobile',
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        token: 'access-token',
        expires_in: ACCESS_TOKEN_EXPIRES_IN_MS,
        user: filteredVerifiedUser,
        refresh_token: 'refresh-token-1',
      });

      const setCookie = asSetCookieHeaders(res.headers['set-cookie']);
      expect(
        setCookie.some((cookie) => cookie.startsWith('refresh_cookie=')),
      ).toBe(true);
    });

    test('returns 403 when email is not verified', async () => {
      const res = await request(app).post('/auth/login').send({
        email: unverifiedUser.email,
        password: 'test-pass-1',
      });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        message: 'Email not verified. Please verify your email first.',
      });
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    test('returns 401 when account is disabled', async () => {
      const res = await request(app).post('/auth/login').send({
        email: disabledUser.email,
        password: 'test-pass-1',
      });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Account disabled' });
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    test('returns 422 when body fails validation', async () => {
      const res = await request(app).post('/auth/login').send({
        email: verifiedUser.email,
      });

      expect(res.status).toBe(422);
      expect(res.body.message).toBe('Validation Failed');
      expect(res.body.details).toEqual({
        password: {
          message: 'Invalid input: expected string, received undefined',
          value: 'invalid_type',
        },
      });
    });

    test('returns 401 for invalid credentials', async () => {
      const res = await request(app).post('/auth/login').send({
        email: 'bad@example.com',
        password: 'test-pass-1',
      });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Invalid credentials' });
    });

    test('returns 200 with platform_admin role and disabled false in user payload', async () => {
      const res = await request(app).post('/auth/login').send({
        email: platformAdminUser.email,
        password: 'test-pass-1',
      });

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('platform_admin');
      expect(res.body.user.disabled).toBe(false);
    });

    test('returns 200 with default role user and disabled false when role and disabled are omitted', async () => {
      const res = await request(app).post('/auth/login').send({
        email: defaultRoleUser.email,
        password: 'test-pass-1',
      });

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('user');
      expect(res.body.user.disabled).toBe(false);
    });

    test('returns 422 when client_type is an invalid enum value', async () => {
      const res = await request(app).post('/auth/login').send({
        email: verifiedUser.email,
        password: 'test-pass-1',
        client_type: 'desktop',
      });

      expect(res.status).toBe(422);
      expect(res.body.message).toBe('Validation Failed');
      expect(res.body.details).toEqual({
        client_type: {
          message: expect.stringContaining('mobile'),
          value: 'invalid_value',
        },
      });
    });
  });

  describe('main.ts auth routing', () => {
    test('does not mount a separate Express /auth router before TSOA routes', () => {
      const mainSource = fs.readFileSync(
        path.join(__dirname, '../main.ts'),
        'utf8',
      );

      expect(mainSource).toContain('RegisterRoutes(api)');
      expect(mainSource).not.toMatch(/use\(['"]\/auth['"]/);
      expect(mainSource).not.toMatch(/from ['"]\.\/routes\/auth['"]/);
    });
  });

  describe('POST /auth/refresh', () => {
    test('returns 200 from refresh cookie and sets a new refresh cookie', async () => {
      const userService = require('../services/UserService').default;
      const apiTokens = require('../helpers/ApiTokens').default;

      userService.refreshToken.mockResolvedValueOnce(verifiedUser);
      apiTokens.createTokens.mockImplementationOnce(() => ({
        token: 'access-token-2',
        refreshToken: 'refresh-token-2',
      }));

      const res = await request(app)
        .post('/auth/refresh')
        .set('Cookie', ['refresh_cookie=refresh-token-1']);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        token: 'access-token-2',
        expires_in: ACCESS_TOKEN_EXPIRES_IN_MS,
        user: filteredVerifiedUser,
      });
      expect(res.body.refresh_token).toBeUndefined();
      expect(userService.refreshToken).toHaveBeenCalledWith('refresh-token-1');

      const setCookie = asSetCookieHeaders(res.headers['set-cookie']);
      expect(
        setCookie.some((cookie) =>
          cookie.startsWith('refresh_cookie=refresh-token-2'),
        ),
      ).toBe(true);
    });

    test('returns 200 with role and disabled on the user payload', async () => {
      const userService = require('../services/UserService').default;

      userService.refreshToken.mockResolvedValueOnce(platformAdminUser);

      const res = await request(app)
        .post('/auth/refresh')
        .set('Cookie', ['refresh_cookie=refresh-token-1']);

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('platform_admin');
      expect(res.body.user.disabled).toBe(false);
      expect(res.body.refresh_token).toBeUndefined();
    });

    test('returns 401 when refresh token is missing', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app).post('/auth/refresh').send({});

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(userService.refreshToken).not.toHaveBeenCalled();
    });

    test('returns 403 for unverified user and clears refresh cookie', async () => {
      const userService = require('../services/UserService').default;

      userService.refreshToken.mockResolvedValueOnce(unverifiedUser);

      const res = await request(app)
        .post('/auth/refresh')
        .set('Cookie', ['refresh_cookie=refresh-token-1']);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        message: 'Email not verified. Please verify your email first.',
      });

      const setCookie = asSetCookieHeaders(res.headers['set-cookie']);
      expect(
        setCookie.some(
          (cookie) =>
            cookie.startsWith('refresh_cookie=;') ||
            cookie.includes('refresh_cookie=;'),
        ),
      ).toBe(true);
    });

    test('returns 401 and clears refresh cookie when user account is disabled', async () => {
      const userService = require('../services/UserService').default;
      const apiTokens = require('../helpers/ApiTokens').default;

      userService.refreshToken.mockResolvedValueOnce(disabledUser);

      const res = await request(app)
        .post('/auth/refresh')
        .set('Cookie', ['refresh_cookie=refresh-token-1']);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Account disabled' });
      expect(apiTokens.createTokens).not.toHaveBeenCalled();

      const setCookie = asSetCookieHeaders(res.headers['set-cookie']);
      expect(
        setCookie.some((cookie) => cookie.startsWith('refresh_cookie=')),
      ).toBe(true);
    });

    test('returns 401 and clears refresh cookie when session was invalidated after token was issued', async () => {
      const userService = require('../services/UserService').default;
      const { decodeToken } = require('../helpers/jwtHelper');
      const apiTokens = require('../helpers/ApiTokens').default;

      const sessionsInvalidatedAt = new Date('2025-06-01T12:00:00.000Z');
      const iatSeconds = Math.floor(
        sessionsInvalidatedAt.getTime() / 1000 - 60,
      );

      userService.refreshToken.mockResolvedValueOnce({
        ...verifiedUser,
        sessions_invalidated_at: sessionsInvalidatedAt,
      });
      decodeToken.mockReturnValue({
        userId: 'user-1',
        iat: iatSeconds,
      });

      const res = await request(app)
        .post('/auth/refresh')
        .set('Cookie', ['refresh_cookie=refresh-token-1']);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Session invalidated' });
      expect(apiTokens.createTokens).not.toHaveBeenCalled();

      const setCookie = asSetCookieHeaders(res.headers['set-cookie']);
      expect(
        setCookie.some((cookie) => cookie.startsWith('refresh_cookie=')),
      ).toBe(true);
    });

    test('accepts refresh token from request body', async () => {
      const userService = require('../services/UserService').default;

      userService.refreshToken.mockResolvedValueOnce(verifiedUser);

      const res = await request(app)
        .post('/auth/refresh')
        .send({ refresh_token: 'body-refresh-token' });

      expect(res.status).toBe(200);
      expect(res.body.refresh_token).toBeUndefined();
      expect(userService.refreshToken).toHaveBeenCalledWith(
        'body-refresh-token',
      );
    });

    test('prefers body refresh_token over cookie', async () => {
      const userService = require('../services/UserService').default;

      userService.refreshToken.mockResolvedValueOnce(verifiedUser);

      const res = await request(app)
        .post('/auth/refresh')
        .set('Cookie', ['refresh_cookie=cookie-token'])
        .send({ refresh_token: 'body-token' });

      expect(res.status).toBe(200);
      expect(userService.refreshToken).toHaveBeenCalledWith('body-token');
    });

    test('returns 401 when refresh token is blacklisted', async () => {
      const userService = require('../services/UserService').default;

      userService.refreshToken.mockResolvedValueOnce({
        ...verifiedUser,
        blacklisted_tokens: ['refresh-token-1'],
      });

      const res = await request(app)
        .post('/auth/refresh')
        .set('Cookie', ['refresh_cookie=refresh-token-1']);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
    });

    test('returns 401 when the service resolves null for a refresh token belonging to a deleted User', async () => {
      const userService = require('../services/UserService').default;
      const apiTokens = require('../helpers/ApiTokens').default;

      userService.refreshToken.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/auth/refresh')
        .set('Cookie', ['refresh_cookie=refresh-token-1']);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Invalid or expired refresh token' });
      expect(res.body.token).toBeUndefined();
      expect(apiTokens.createTokens).not.toHaveBeenCalled();

      const setCookie = asSetCookieHeaders(res.headers['set-cookie']);
      expect(
        setCookie.some((cookie) => cookie.startsWith('refresh_cookie=')),
      ).toBe(false);
    });

    test('returns 401 when the service resolves null for a refresh token sent in the body', async () => {
      const userService = require('../services/UserService').default;
      const apiTokens = require('../helpers/ApiTokens').default;

      userService.refreshToken.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/auth/refresh')
        .send({ refresh_token: 'expired-token-1' });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Invalid or expired refresh token' });
      expect(userService.refreshToken).toHaveBeenCalledWith('expired-token-1');
      expect(apiTokens.createTokens).not.toHaveBeenCalled();

      const setCookie = asSetCookieHeaders(res.headers['set-cookie']);
      expect(
        setCookie.some((cookie) => cookie.startsWith('refresh_cookie=')),
      ).toBe(false);
    });

    test('returns 401 when the service resolves null for a malformed refresh cookie', async () => {
      const userService = require('../services/UserService').default;
      const apiTokens = require('../helpers/ApiTokens').default;

      userService.refreshToken.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/auth/refresh')
        .set('Cookie', ['refresh_cookie=not-a-jwt']);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Invalid or expired refresh token' });
      expect(userService.refreshToken).toHaveBeenCalledWith('not-a-jwt');
      expect(apiTokens.createTokens).not.toHaveBeenCalled();

      const setCookie = asSetCookieHeaders(res.headers['set-cookie']);
      expect(
        setCookie.some((cookie) => cookie.startsWith('refresh_cookie=')),
      ).toBe(false);
    });
  });

  describe('POST /auth/register', () => {
    test('returns 201 when account is created and verification email is sent', async () => {
      const userService = require('../services/UserService').default;

      const createdUser = {
        id: 'user-new',
        name: 'Bob Example',
        first_name: 'Bob',
        last_name: 'Example',
        email: 'new@example.com',
        phone: null,
        role: 'user',
        disabled: false,
      };

      userService.getByEmail.mockImplementation(async (email: string) =>
        email === 'new@example.com' ? null : verifiedUser,
      );
      userService.create.mockImplementation(async () => createdUser);
      userService.sendVerificationMail.mockImplementation(
        async () => 'verify-token-1',
      );
      userService.update.mockImplementation(async (id, data) => ({
        ...createdUser,
        ...data,
      }));

      const res = await request(app).post('/auth/register').send({
        firstName: 'Bob',
        lastName: 'Example',
        email: 'new@example.com',
        password: 'test-pass-1',
      });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe(
        'Account created. Verification email sent.',
      );
      expect(res.body.user).toEqual({
        id: 'user-new',
        name: 'Bob Example',
        email: 'new@example.com',
        firstName: 'Bob',
        lastName: 'Example',
        phone: undefined,
        role: 'user',
        disabled: false,
      });
      expect(userService.create).toHaveBeenCalled();
      expect(userService.sendVerificationMail).toHaveBeenCalledWith(
        createdUser,
      );
      expect(userService.update).toHaveBeenCalledWith('user-new', {
        email_verification_token: 'verify-token-1',
      });
    });

    test('returns 409 when email is already registered and verified', async () => {
      const userService = require('../services/UserService').default;

      userService.getByEmail.mockResolvedValueOnce(verifiedUser);

      const res = await request(app).post('/auth/register').send({
        firstName: 'Alice',
        lastName: 'Example',
        email: verifiedUser.email,
        password: 'test-pass-1',
      });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        message: 'Email already registered. Please log in.',
      });
      expect(userService.create).not.toHaveBeenCalled();
    });

    test('resends verification and returns 409 when email is registered but unverified', async () => {
      const userService = require('../services/UserService').default;

      userService.getByEmail.mockImplementation(async () => unverifiedUser);
      userService.sendVerificationMail.mockImplementation(
        async () => 'verify-token-resend',
      );
      userService.update.mockImplementation(async (id, data) => ({
        ...unverifiedUser,
        id,
        ...data,
      }));

      const res = await request(app).post('/auth/register').send({
        firstName: 'Bob',
        lastName: 'Example',
        email: unverifiedUser.email,
        password: 'test-pass-1',
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe(
        "Email already registered but isn't verified yet. We've resent the verification email.",
      );
      expect(userService.sendVerificationMail).toHaveBeenCalledTimes(1);
      expect(userService.update).toHaveBeenCalledTimes(1);
      expect(userService.create).not.toHaveBeenCalled();
    });
    test('returns 422 Validation Failed when firstName is an empty string', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app).post('/auth/register').send({
        firstName: '',
        lastName: 'Example',
        email: 'new@example.com',
        password: 'test-pass-1',
      });

      expect(res.status).toBe(422);
      expect(res.body.message).toBe('Validation Failed');
      expect(res.body.details).toEqual({
        firstName: {
          message: 'First name is required',
          value: 'too_small',
        },
      });
      expect(userService.getByEmail).not.toHaveBeenCalled();
      expect(userService.create).not.toHaveBeenCalled();
      expect(userService.sendVerificationMail).not.toHaveBeenCalled();
    });

    test('returns 422 Validation Failed when password is missing', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app).post('/auth/register').send({
        firstName: 'Bob',
        lastName: 'Example',
        email: 'new@example.com',
      });

      expect(res.status).toBe(422);
      expect(res.body.message).toBe('Validation Failed');
      expect(res.body.details).toEqual({
        'requestBody.password': {
          message: "'password' is required",
        },
      });
      expect(userService.getByEmail).not.toHaveBeenCalled();
      expect(userService.create).not.toHaveBeenCalled();
      expect(userService.sendVerificationMail).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /auth/verify/email', () => {
    test('returns 200 with success message only, not a user object', async () => {
      const userService = require('../services/UserService').default;

      userService.update.mockImplementation(async (userId, data) => ({
        ...verifiedUser,
        id: userId,
        ...data,
      }));

      const res = await request(app)
        .patch('/auth/verify/email')
        .send({ token: 'verify-ok' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        message: 'Email verified successfully',
      });
      expect(res.body).not.toHaveProperty('id');
      expect(res.body).not.toHaveProperty('email');
      expect(userService.update).toHaveBeenCalledWith('user-1', {
        email_verification_timestamp: expect.any(Date),
        email_verification_token: null,
      });
    });
    test('returns 422 Validation Failed when token is an empty string', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app)
        .patch('/auth/verify/email')
        .send({ token: '' });

      expect(res.status).toBe(422);
      expect(res.body.message).toBe('Validation Failed');
      expect(res.body.details).toEqual({
        token: {
          message: 'Token field is required',
          value: 'too_small',
        },
      });
      expect(userService.update).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/verify/resend', () => {
    test('returns 200 when verification email is sent for unverified user', async () => {
      const userService = require('../services/UserService').default;

      userService.getByEmail.mockImplementation(async (email: string) =>
        email === unverifiedUser.email ? unverifiedUser : null,
      );
      userService.sendVerificationMail.mockImplementation(
        async () => 'verify-token-2',
      );
      userService.update.mockImplementation(async (id, data) => ({
        ...unverifiedUser,
        id,
        ...data,
      }));

      const res = await request(app)
        .post('/auth/verify/resend')
        .send({ email: unverifiedUser.email });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        message: 'Verification email sent successfully',
      });
      expect(res.body).not.toHaveProperty('user');
      expect(userService.sendVerificationMail).toHaveBeenCalledWith(
        unverifiedUser,
      );
      expect(userService.update).toHaveBeenCalledWith(unverifiedUser.id, {
        email_verification_token: 'verify-token-2',
      });
    });

    test('returns 404 when email is not found', async () => {
      const userService = require('../services/UserService').default;

      userService.getByEmail.mockImplementation(async () => null);

      const res = await request(app)
        .post('/auth/verify/resend')
        .send({ email: 'missing@example.com' });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'User not found' });
      expect(userService.sendVerificationMail).not.toHaveBeenCalled();
    });

    test('returns 429 when a verification email was already sent recently', async () => {
      const userService = require('../services/UserService').default;

      userService.getByEmail.mockImplementation(async () => ({
        ...unverifiedUser,
        email_verification_token: 'existing-verify-token',
      }));
      userService.sendVerificationMail.mockImplementation(
        async () => new Error('Verification email already sent recently'),
      );

      const res = await request(app)
        .post('/auth/verify/resend')
        .send({ email: unverifiedUser.email });

      expect(res.status).toBe(429);
      expect(res.body).toEqual({
        message:
          'A verification email was already sent recently. Please check your inbox and try again later.',
      });
      expect(userService.update).not.toHaveBeenCalled();
    });

    test('does not persist a token when sending the verification email fails', async () => {
      const userService = require('../services/UserService').default;

      userService.getByEmail.mockImplementation(async () => unverifiedUser);
      userService.sendVerificationMail.mockImplementation(
        async () => new Error('smtp down'),
      );

      const res = await request(app)
        .post('/auth/verify/resend')
        .send({ email: unverifiedUser.email });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        message: 'Failed to send verification email.',
      });
      expect(userService.update).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/verify/resend/:userId', () => {
    test('returns 200 when authenticated owner requests resend', async () => {
      const userService = require('../services/UserService').default;

      userService.sendVerificationMail.mockImplementation(
        async () => 'verify-token-3',
      );
      userService.update.mockImplementation(async (id, data) => ({
        ...verifiedUser,
        id,
        ...data,
      }));

      const res = await request(app)
        .post('/auth/verify/resend/user-1')
        .set('Authorization', 'Bearer access-token');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        message: 'Verification email sent successfully',
      });
      expect(userService.sendVerificationMail).toHaveBeenCalledWith(
        verifiedUser,
      );
      expect(userService.update).toHaveBeenCalledWith('user-1', {
        email_verification_token: 'verify-token-3',
      });
    });

    test('returns 403 when userId does not match authenticated user', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app)
        .post('/auth/verify/resend/other-id')
        .set('Authorization', 'Bearer access-token');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: 'Forbidden' });
      expect(userService.sendVerificationMail).not.toHaveBeenCalled();
    });

    test('returns 401 when unauthenticated', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app).post('/auth/verify/resend/user-1');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(userService.sendVerificationMail).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/password/reset', () => {
    test('returns 200 when password reset email is sent', async () => {
      const userService = require('../services/UserService').default;

      userService.getByEmail.mockImplementation(async (email: string) =>
        email === verifiedUser.email
          ? { ...verifiedUser, reset_password_token: null }
          : null,
      );
      userService.sendPasswordResetMail.mockImplementation(
        async () => 'reset-token-1',
      );
      userService.update.mockImplementation(async (id, data) => ({
        ...verifiedUser,
        id,
        ...data,
      }));

      const res = await request(app)
        .post('/auth/password/reset')
        .send({ email: verifiedUser.email });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        message: 'Password reset email sent successfully',
      });
      expect(userService.sendPasswordResetMail).toHaveBeenCalledWith(
        expect.objectContaining({ email: verifiedUser.email }),
      );
      expect(userService.update).toHaveBeenCalledWith('user-1', {
        reset_password_token: 'reset-token-1',
      });
    });

    test('returns 404 when email is not found', async () => {
      const userService = require('../services/UserService').default;

      userService.getByEmail.mockImplementation(async () => null);

      const res = await request(app)
        .post('/auth/password/reset')
        .send({ email: 'missing@example.com' });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'User not found' });
      expect(userService.sendPasswordResetMail).not.toHaveBeenCalled();
    });

    test('returns 429 when a non-expired reset token already exists', async () => {
      const userService = require('../services/UserService').default;
      const { decodeToken } = require('../helpers/jwtHelper');

      userService.getByEmail.mockImplementation(async () => ({
        ...verifiedUser,
        reset_password_token: 'existing-token',
      }));
      decodeToken.mockReturnValue({ userId: 'user-1' });

      const res = await request(app)
        .post('/auth/password/reset')
        .send({ email: verifiedUser.email });

      expect(res.status).toBe(429);
      expect(res.body).toEqual({
        message:
          'A password reset email was already sent recently. Please check your inbox and try again later.',
      });
      expect(userService.sendPasswordResetMail).not.toHaveBeenCalled();
      expect(userService.update).not.toHaveBeenCalled();
    });

    test('does not persist a token when sending the reset email fails', async () => {
      const userService = require('../services/UserService').default;

      userService.getByEmail.mockImplementation(async () => ({
        ...verifiedUser,
        reset_password_token: null,
      }));
      userService.sendPasswordResetMail.mockImplementation(
        async () => new Error('smtp down'),
      );

      const res = await request(app)
        .post('/auth/password/reset')
        .send({ email: verifiedUser.email });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ message: 'Failed to reset password' });
      expect(userService.update).not.toHaveBeenCalled();
    });
    test('returns 422 Validation Failed when email is not valid', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app)
        .post('/auth/password/reset')
        .send({ email: 'not-an-email' });

      expect(res.status).toBe(422);
      expect(res.body.message).toBe('Validation Failed');
      expect(res.body.details).toEqual({
        email: {
          message: 'Invalid email address',
          value: 'invalid_format',
        },
      });
      expect(userService.getByEmail).not.toHaveBeenCalled();
      expect(userService.sendPasswordResetMail).not.toHaveBeenCalled();
      expect(userService.update).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /auth/password/reset/confirm', () => {
    test('returns 200 when password is reset', async () => {
      const userService = require('../services/UserService').default;

      userService.getById.mockImplementation(async () => verifiedUser);
      userService.resetPassword.mockImplementation(async () => verifiedUser);

      const res = await request(app)
        .patch('/auth/password/reset/confirm')
        .send({
          token: 'verify-ok',
          password: 'test-pass-1',
          confirm_password: 'test-pass-1',
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Password reset successfully' });
      expect(userService.resetPassword).toHaveBeenCalledWith(
        'user-1',
        'test-pass-1',
        'verify-ok',
      );
    });

    test('returns 400 when token is invalid', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app)
        .patch('/auth/password/reset/confirm')
        .send({
          token: 'bad-token',
          password: 'test-pass-1',
          confirm_password: 'test-pass-1',
        });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: 'Invalid token' });
      expect(userService.resetPassword).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/logout/:userId (intended contract)', () => {
    test('returns 200, revokes cookie token, and clears refresh cookie', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app)
        .post('/auth/logout/user-1')
        .set('Authorization', 'Bearer access-token')
        .set('Cookie', ['refresh_cookie=refresh-token-1']);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Logged out successfully' });
      expect(userService.logout).toHaveBeenCalledWith(
        'user-1',
        'refresh-token-1',
      );

      const setCookie = asSetCookieHeaders(res.headers['set-cookie']);
      expect(
        setCookie.some(
          (cookie) =>
            cookie.startsWith('refresh_cookie=;') ||
            cookie.includes('refresh_cookie=;') ||
            cookie.includes('Max-Age=0'),
        ),
      ).toBe(true);
    });

    test('returns 200 and revokes body refresh_token when no cookie', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app)
        .post('/auth/logout/user-1')
        .set('Authorization', 'Bearer access-token')
        .send({ refresh_token: 'body-refresh-token' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Logged out successfully' });
      expect(userService.logout).toHaveBeenCalledWith(
        'user-1',
        'body-refresh-token',
      );
    });

    test('prefers body refresh_token over cookie', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app)
        .post('/auth/logout/user-1')
        .set('Authorization', 'Bearer access-token')
        .set('Cookie', ['refresh_cookie=refresh-token-1'])
        .send({ refresh_token: 'body-refresh-token' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Logged out successfully' });
      expect(userService.logout).toHaveBeenCalledWith(
        'user-1',
        'body-refresh-token',
      );
    });

    test('returns 401 when unauthenticated', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app)
        .post('/auth/logout/user-1')
        .set('Cookie', ['refresh_cookie=refresh-token-1']);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(userService.logout).not.toHaveBeenCalled();
    });

    test('returns 403 when userId does not match authenticated user', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app)
        .post('/auth/logout/other-id')
        .set('Authorization', 'Bearer access-token')
        .set('Cookie', ['refresh_cookie=refresh-token-1']);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: 'Forbidden' });
      expect(userService.logout).not.toHaveBeenCalled();
    });

    test('returns 401 when refresh token is missing from body and cookie', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app)
        .post('/auth/logout/user-1')
        .set('Authorization', 'Bearer access-token')
        .send({});

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(userService.logout).not.toHaveBeenCalled();
    });

    test('returns 401 when refresh token belongs to a different User', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app)
        .post('/auth/logout/user-1')
        .set('Authorization', 'Bearer access-token')
        .set('Cookie', ['refresh_cookie=other-user-refresh']);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(userService.logout).not.toHaveBeenCalled();
    });
  });
});
