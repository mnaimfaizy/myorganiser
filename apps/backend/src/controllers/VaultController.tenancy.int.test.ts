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

      const tokenToUser: Record<string, string> = {
        'token-a': 'user-a',
        'token-b': 'user-b',
      };

      const userId = tokenToUser[token];
      if (!userId) {
        const err = new Error('Unauthorized') as Error & { status?: number };
        err.status = 401;
        throw err;
      }

      req.user = { id: userId };
      return req.user;
    },
  };
});

jest.mock('../services/VaultService', () => {
  return {
    __esModule: true,
    default: {
      getVaultMeta: jest.fn(),
      putVaultMeta: jest.fn(),
      getBlob: jest.fn(),
      putBlob: jest.fn(),
      getBlobInventory: jest.fn(),
      exportVault: jest.fn(),
      importVault: jest.fn(),
    },
  };
});

jest.mock('../services/VaultBackupService', () => ({
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

function makeApp() {
  // Reset modules to ensure mocks are applied before importing routes.
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

describe('VaultController (HTTP tenancy integration)', () => {
  const metaA = {
    version: 1,
    kdf_name: 'PBKDF2',
    kdf_salt: 'salt-a',
    kdf_params: { iterations: 1 },
    wrapped_mk_passphrase: { any: 'shape' },
    wrapped_mk_recovery: { any: 'shape' },
  };

  const metaB = {
    version: 1,
    kdf_name: 'PBKDF2',
    kdf_salt: 'salt-b',
    kdf_params: { iterations: 1 },
    wrapped_mk_passphrase: { any: 'shape' },
    wrapped_mk_recovery: { any: 'shape' },
  };

  const blob = {
    version: 1,
    iv: Buffer.alloc(12).toString('base64'),
    ciphertext: Buffer.from('ciphertext').toString('base64'),
  };

  let app: express.Application;

  beforeAll(() => {
    app = makeApp();
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('GET /vault with token-a passes user-a; token-b passes user-b', async () => {
    const vaultService = require('../services/VaultService').default;

    vaultService.getVaultMeta.mockImplementation((userId: string) => {
      const meta = userId === 'user-a' ? metaA : metaB;
      return Promise.resolve({
        ok: true,
        status: 200,
        body: {
          meta,
          updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
          etag: `W/"${userId}"`,
        },
      });
    });

    // Request as user-a
    const resA = await request(app)
      .get('/vault')
      .set('Authorization', 'Bearer token-a');

    expect(resA.status).toBe(200);
    expect(resA.body.meta.kdf_salt).toBe('salt-a');
    expect(vaultService.getVaultMeta).toHaveBeenCalledWith('user-a');

    // Request as user-b
    const resB = await request(app)
      .get('/vault')
      .set('Authorization', 'Bearer token-b');

    expect(resB.status).toBe(200);
    expect(resB.body.meta.kdf_salt).toBe('salt-b');
    expect(vaultService.getVaultMeta).toHaveBeenCalledWith('user-b');

    // Verify each user's id was used exactly once
    expect(vaultService.getVaultMeta).toHaveBeenCalledTimes(2);
    const calls = vaultService.getVaultMeta.mock.calls;
    expect(calls[0][0]).toBe('user-a');
    expect(calls[1][0]).toBe('user-b');
  });

  test('GET /vault/blob/:type with token-a passes user-a; token-b passes user-b', async () => {
    const vaultService = require('../services/VaultService').default;

    vaultService.getBlob.mockImplementation((userId: string, type: string) => {
      return Promise.resolve({
        ok: true,
        status: 200,
        body: {
          type,
          blob,
          updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
          etag: `W/"${userId}"`,
        },
      });
    });

    // Request as user-a
    const resA = await request(app)
      .get('/vault/blob/addresses')
      .set('Authorization', 'Bearer token-a');

    expect(resA.status).toBe(200);
    expect(vaultService.getBlob).toHaveBeenCalledWith('user-a', 'addresses');

    // Request as user-b
    const resB = await request(app)
      .get('/vault/blob/addresses')
      .set('Authorization', 'Bearer token-b');

    expect(resB.status).toBe(200);
    expect(vaultService.getBlob).toHaveBeenCalledWith('user-b', 'addresses');

    // Verify call order and user ids
    const calls = vaultService.getBlob.mock.calls;
    expect(calls[0][0]).toBe('user-a');
    expect(calls[1][0]).toBe('user-b');
  });

  test('PUT /vault with body { meta, userId: "user-b" } returns 400 and never calls service', async () => {
    const vaultService = require('../services/VaultService').default;

    // Send request as user-a, but include a spoofed userId in the body.
    // This is rejected by tsoa's throw-on-extras validation before the handler runs.
    const res = await request(app)
      .put('/vault')
      .set('Authorization', 'Bearer token-a')
      .send({
        meta: metaA,
        userId: 'user-b',
      });

    // HTTP 400 because tsoa rejects extra body properties as a security boundary.
    expect(res.status).toBe(400);
    // The critical assertion: the service method was never invoked.
    expect(vaultService.putVaultMeta).not.toHaveBeenCalled();
  });

  test('PUT /vault/blob/:type?userId=user-b with valid body returns 200, query param ignored, service called with token userId', async () => {
    const vaultService = require('../services/VaultService').default;

    vaultService.putBlob.mockResolvedValueOnce({
      ok: true,
      status: 201,
      body: {
        ok: true,
        etag: 'W/"1"',
        updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      },
    });

    // Query parameters are not part of body validation; userId=user-b is silently ignored.
    const res = await request(app)
      .put('/vault/blob/addresses?userId=user-b')
      .set('Authorization', 'Bearer token-a')
      .send({
        type: 'addresses',
        blob,
      });

    expect(res.status).toBe(201);
    // The query parameter did not steer identity; service receives user-a.
    expect(vaultService.putBlob).toHaveBeenCalledWith(
      'user-a',
      'addresses',
      blob,
      undefined,
    );
    // Verify it was never called with user-b
    for (const call of vaultService.putBlob.mock.calls) {
      expect(call[0]).not.toBe('user-b');
    }
  });

  test('PUT /vault/blob/:type with body { type, blob, userId: "user-b" } returns 400 and never calls service', async () => {
    const vaultService = require('../services/VaultService').default;

    // Extra userId in body is rejected at the tsoa validation boundary.
    const res = await request(app)
      .put('/vault/blob/addresses')
      .set('Authorization', 'Bearer token-a')
      .send({
        type: 'addresses',
        blob,
        userId: 'user-b',
      });

    expect(res.status).toBe(400);
    // Service was not invoked because the request was rejected at the validation boundary.
    expect(vaultService.putBlob).not.toHaveBeenCalled();
  });

  test('POST /vault/export with spoofed headers X-User-Id and X-Forwarded-User, token-a still calls service with user-a', async () => {
    const vaultService = require('../services/VaultService').default;

    vaultService.exportVault.mockImplementation((userId: string) => {
      const salt = userId === 'user-a' ? 'salt-a' : 'salt-b';
      return Promise.resolve({
        ok: true,
        status: 200,
        body: {
          exportVersion: 1,
          exportedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
          meta: {
            kdf_salt: salt,
            kdf_name: 'PBKDF2',
            kdf_params: { iterations: 1 },
            wrapped_mk_passphrase: { any: 'shape' },
            wrapped_mk_recovery: { any: 'shape' },
          },
          blobs: {},
        },
      });
    });

    // Headers are not validated by tsoa; spoofed X-User-Id and X-Forwarded-User are ignored.
    const res = await request(app)
      .post('/vault/export')
      .set('Authorization', 'Bearer token-a')
      .set('X-User-Id', 'user-b')
      .set('X-Forwarded-User', 'user-b');

    expect(res.status).toBe(200);
    // Response carries user-a's data (salt-a), proving the spoofed headers were ignored.
    expect(res.body.meta.kdf_salt).toBe('salt-a');
    // Service was called with user-a, not user-b.
    expect(vaultService.exportVault).toHaveBeenCalledWith('user-a');
    expect(vaultService.exportVault).not.toHaveBeenCalledWith('user-b');
  });

  test('POST /vault/import with clean bundle returns 200 and calls service; same bundle plus userId field returns 400 and does not call service', async () => {
    const vaultService = require('../services/VaultService').default;

    vaultService.importVault.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        body: { ok: true },
      }),
    );

    const cleanBundle = {
      exportVersion: 1,
      exportedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      meta: metaA,
      blobs: {},
    };

    // First request: clean bundle, should succeed.
    const resClean = await request(app)
      .post('/vault/import')
      .set('Authorization', 'Bearer token-a')
      .send(cleanBundle);

    expect(resClean.status).toBe(200);
    expect(vaultService.importVault).toHaveBeenCalledWith(
      'user-a',
      cleanBundle,
    );

    // Clear mocks for second request
    jest.clearAllMocks();
    vaultService.importVault.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        body: { ok: true },
      }),
    );

    const pollutedBundle = {
      ...cleanBundle,
      userId: 'user-b',
    };

    // Second request: same bundle with extra userId field, should be rejected.
    const resPolluted = await request(app)
      .post('/vault/import')
      .set('Authorization', 'Bearer token-a')
      .send(pollutedBundle);

    expect(resPolluted.status).toBe(400);
    // No additional importVault call because request was rejected at validation boundary.
    expect(vaultService.importVault).not.toHaveBeenCalled();
  });

  test('Interleaved requests A -> B -> A prove no module-scope caching, responses carry per-user data', async () => {
    const vaultService = require('../services/VaultService').default;

    vaultService.getVaultMeta.mockImplementation((userId: string) => {
      const meta = userId === 'user-a' ? metaA : metaB;
      return Promise.resolve({
        ok: true,
        status: 200,
        body: {
          meta,
          updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
          etag: `W/"${userId}"`,
        },
      });
    });

    // Request 1: user-a
    const res1 = await request(app)
      .get('/vault')
      .set('Authorization', 'Bearer token-a');

    expect(res1.status).toBe(200);
    expect(res1.body.meta.kdf_salt).toBe('salt-a');

    // Request 2: user-b
    const res2 = await request(app)
      .get('/vault')
      .set('Authorization', 'Bearer token-b');

    expect(res2.status).toBe(200);
    expect(res2.body.meta.kdf_salt).toBe('salt-b');

    // Request 3: user-a again (different from req 2)
    const res3 = await request(app)
      .get('/vault')
      .set('Authorization', 'Bearer token-a');

    expect(res3.status).toBe(200);
    expect(res3.body.meta.kdf_salt).toBe('salt-a');

    // Verify all three calls were recorded in order with correct user ids.
    expect(vaultService.getVaultMeta).toHaveBeenCalledTimes(3);
    const calls = vaultService.getVaultMeta.mock.calls;
    expect(calls[0][0]).toBe('user-a');
    expect(calls[1][0]).toBe('user-b');
    expect(calls[2][0]).toBe('user-a');
  });

  test('GET /vault/blobs?userId=user-b with spoofed headers under token-a calls service with user-a', async () => {
    const vaultService = require('../services/VaultService').default;

    vaultService.getBlobInventory.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: { blobs: [], etag: 'W/"x"' },
    });

    // Spoofed headers X-User-Id and X-Forwarded-User are ignored by tsoa/controller.
    const res = await request(app)
      .get('/vault/blobs?userId=user-b')
      .set('Authorization', 'Bearer token-a')
      .set('X-User-Id', 'user-b')
      .set('X-Forwarded-User', 'user-b');

    expect(res.status).toBe(200);
    // Service was called exactly once with user-a (from the token), not user-b.
    expect(vaultService.getBlobInventory).toHaveBeenCalledTimes(1);
    expect(vaultService.getBlobInventory).toHaveBeenCalledWith('user-a');
    expect(vaultService.getBlobInventory).not.toHaveBeenCalledWith('user-b');
  });
});
