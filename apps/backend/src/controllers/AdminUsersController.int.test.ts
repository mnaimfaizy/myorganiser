import { beforeEach, describe, expect, jest, test } from '@jest/globals';
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

      if (token === 'disabled') {
        const err = new Error('Account disabled') as Error & {
          status?: number;
        };
        err.status = 401;
        throw err;
      }

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

jest.mock('../services/UserService', () => ({
  __esModule: true,
  default: {
    listIdentityUsers: jest.fn(),
    getIdentityById: jest.fn(),
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

const identityRow = {
  id: 'u1',
  name: 'Alice Example',
  first_name: 'Alice',
  last_name: 'Example',
  phone: null,
  email: 'alice@example.com',
  role: 'user',
  disabled: false,
  email_verification_timestamp: new Date('2024-01-01'),
  password: 'secret-hash',
  blacklisted_tokens: ['old-token'],
  reset_password_token: 'reset-token',
  email_verification_token: 'verify-token',
  youtube_access_token: 'yt-token',
  encrypted_vault: 'vault-ciphertext',
};

const sensitiveFields = [
  'password',
  'blacklisted_tokens',
  'reset_password_token',
  'email_verification_token',
  'youtube_access_token',
  'encrypted_vault',
];

describe('AdminUsersController (HTTP integration)', () => {
  let app: express.Application;

  beforeAll(() => {
    app = makeApp();
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('GET /admin/users', () => {
    test('returns 401 when unauthenticated', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app).get('/admin/users');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(userService.listIdentityUsers).not.toHaveBeenCalled();
    });

    test('returns 403 for authenticated non-platform_admin', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app)
        .get('/admin/users')
        .set('Authorization', 'Bearer user');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: 'Platform Admin role required' });
      expect(userService.listIdentityUsers).not.toHaveBeenCalled();
    });

    test('returns 401 when bearer account is disabled', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app)
        .get('/admin/users')
        .set('Authorization', 'Bearer disabled');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Account disabled' });
      expect(userService.listIdentityUsers).not.toHaveBeenCalled();
    });

    test('returns 200 with identity DTOs for platform_admin', async () => {
      const userService = require('../services/UserService').default;

      userService.listIdentityUsers.mockResolvedValueOnce([identityRow]);

      const res = await request(app)
        .get('/admin/users')
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(userService.listIdentityUsers).toHaveBeenCalledWith(undefined);
      expect(res.body).toEqual([
        {
          id: 'u1',
          name: 'Alice Example',
          email: 'alice@example.com',
          firstName: 'Alice',
          lastName: 'Example',
          role: 'user',
          disabled: false,
          emailVerified: true,
          youtubeAccess: false,
        },
      ]);
    });

    test('passes search query to listIdentityUsers', async () => {
      const userService = require('../services/UserService').default;

      userService.listIdentityUsers.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/admin/users')
        .query({ q: 'alice' })
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(userService.listIdentityUsers).toHaveBeenCalledWith('alice');
    });

    test('returns identity-only fields without sensitive data', async () => {
      const userService = require('../services/UserService').default;

      userService.listIdentityUsers.mockResolvedValueOnce([identityRow]);

      const res = await request(app)
        .get('/admin/users')
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);

      const item = res.body[0];
      expect(Object.keys(item).sort()).toEqual(
        [
          'disabled',
          'email',
          'emailVerified',
          'firstName',
          'id',
          'lastName',
          'name',
          'role',
          'youtubeAccess',
        ].sort(),
      );
      for (const field of sensitiveFields) {
        expect(item).not.toHaveProperty(field);
      }
    });
  });

  describe('GET /admin/users/:userId', () => {
    test('returns 401 when unauthenticated', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app).get('/admin/users/u1');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(userService.getIdentityById).not.toHaveBeenCalled();
    });

    test('returns 403 for authenticated non-platform_admin', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app)
        .get('/admin/users/u1')
        .set('Authorization', 'Bearer user');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: 'Platform Admin role required' });
      expect(userService.getIdentityById).not.toHaveBeenCalled();
    });

    test('returns 200 with identity DTO when user found', async () => {
      const userService = require('../services/UserService').default;

      userService.getIdentityById.mockResolvedValueOnce(identityRow);

      const res = await request(app)
        .get('/admin/users/u1')
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(userService.getIdentityById).toHaveBeenCalledWith('u1');
      expect(res.body).toEqual({
        id: 'u1',
        name: 'Alice Example',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Example',
        role: 'user',
        disabled: false,
        emailVerified: true,
        youtubeAccess: false,
      });
      for (const field of sensitiveFields) {
        expect(res.body).not.toHaveProperty(field);
      }
    });

    test('returns 404 when user not found', async () => {
      const userService = require('../services/UserService').default;

      userService.getIdentityById.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/admin/users/u1')
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'User not found' });
      expect(userService.getIdentityById).toHaveBeenCalledWith('u1');
    });
  });
});
