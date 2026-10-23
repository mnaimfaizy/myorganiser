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

      // Stub-level rejection only: the authentication layer refuses a disabled
      // bearer. The real disabled rule is covered in the authentication
      // middleware tests, not here.
      if (token === 'disabled') {
        const err = new Error('Account disabled') as Error & {
          status?: number;
        };
        err.status = 401;
        throw err;
      }

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
    // `makeApp` resets the module registry, so routes load a different `tsoa`
    // instance than this file's import; match by name as well as by class.
    if (
      err instanceof ValidateError ||
      (err as { name?: unknown } | null)?.name === 'ValidateError'
    ) {
      return res.status(422).json({
        message: 'Validation Failed',
        details: (err as { fields?: unknown } | null)?.fields,
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
  created_at: new Date('2024-01-01T00:00:00.000Z'),
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

    test('returns 401 when the authentication layer rejects a disabled User', async () => {
      const userService = require('../services/UserService').default;

      const res = await request(app)
        .get('/admin/users')
        .set('Authorization', 'Bearer disabled');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Account disabled' });
      expect(userService.listIdentityUsers).not.toHaveBeenCalled();
    });

    test('applies defaults when no params are given and returns the page envelope', async () => {
      const userService = require('../services/UserService').default;

      userService.listIdentityUsers.mockResolvedValueOnce({
        users: [identityRow],
        total: 1,
      });

      const res = await request(app)
        .get('/admin/users')
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(userService.listIdentityUsers).toHaveBeenCalledWith({
        q: undefined,
        status: undefined,
        role: undefined,
        sort: 'newest',
        page: 1,
        pageSize: 25,
      });
      expect(res.body).toEqual({
        users: [
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
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      });
    });

    test('forwards every query param to the service and echoes page, pageSize and the service total', async () => {
      const userService = require('../services/UserService').default;

      userService.listIdentityUsers.mockResolvedValueOnce({
        users: [identityRow],
        total: 14,
      });

      const res = await request(app)
        .get('/admin/users')
        .query({
          q: 'alice',
          status: 'unverified',
          role: 'platform_admin',
          sort: 'name',
          page: 3,
          pageSize: 10,
        })
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(userService.listIdentityUsers).toHaveBeenCalledWith({
        q: 'alice',
        status: 'unverified',
        role: 'platform_admin',
        sort: 'name',
        page: 3,
        pageSize: 10,
      });
      expect(res.body.total).toBe(14);
      expect(res.body.page).toBe(3);
      expect(res.body.pageSize).toBe(10);
      expect(res.body.users).toHaveLength(1);
    });

    test('returns an empty users page with the total when the requested page is past the end', async () => {
      const userService = require('../services/UserService').default;

      userService.listIdentityUsers.mockResolvedValueOnce({
        users: [],
        total: 4,
      });

      const res = await request(app)
        .get('/admin/users')
        .query({ page: 9 })
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(userService.listIdentityUsers).toHaveBeenCalledWith(
        expect.objectContaining({ page: 9, pageSize: 25 }),
      );
      expect(res.body).toEqual({
        users: [],
        total: 4,
        page: 9,
        pageSize: 25,
      });
    });

    test('accepts the boundary values page=1 and pageSize=100', async () => {
      const userService = require('../services/UserService').default;

      userService.listIdentityUsers.mockResolvedValueOnce({
        users: [],
        total: 0,
      });

      const res = await request(app)
        .get('/admin/users')
        .query({ page: 1, pageSize: 100 })
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(userService.listIdentityUsers).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, pageSize: 100 }),
      );
      expect(res.body.pageSize).toBe(100);
    });

    test('returns identity-only fields without sensitive data', async () => {
      const userService = require('../services/UserService').default;

      userService.listIdentityUsers.mockResolvedValueOnce({
        users: [identityRow],
        total: 1,
      });

      const res = await request(app)
        .get('/admin/users')
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(1);

      const item = res.body.users[0];
      expect(Object.keys(item).sort()).toEqual(
        [
          'createdAt',
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

    test.each([
      { label: 'status=archived', query: { status: 'archived' } },
      { label: 'role=admin', query: { role: 'admin' } },
      { label: 'sort=oldest', query: { sort: 'oldest' } },
      { label: 'page=0', query: { page: 0 } },
      { label: 'pageSize=0', query: { pageSize: 0 } },
      { label: 'pageSize=101', query: { pageSize: 101 } },
      { label: 'page=1.5', query: { page: 1.5 } },
      { label: 'page=abc', query: { page: 'abc' } },
    ])('returns 422 and skips the service for $label', async ({ query }) => {
      const userService = require('../services/UserService').default;

      const res = await request(app)
        .get('/admin/users')
        .query(query)
        .set('Authorization', 'Bearer admin');

      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty('message', 'Validation Failed');
      expect(userService.listIdentityUsers).not.toHaveBeenCalled();
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
        createdAt: '2024-01-01T00:00:00.000Z',
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
