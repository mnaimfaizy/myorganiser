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

      if (token === 'no-id') {
        req.user = {};
        return req.user;
      }

      req.user = { id: 'user-1' };
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
      getBlobInventory: jest.fn(),
      putBlob: jest.fn(),
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

// Prevent module-level createPrismaClient() calls in YouTube services from
// attempting a real DB connection during Vault integration tests.
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
  // Ensure mocks are applied before importing the generated routes.

  // Other test suites may import the generated routes first, which would cache
  // them without these jest mocks. Resetting modules ensures our require below
  // re-evaluates with the mocks in place.
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

describe('VaultController (HTTP integration)', () => {
  const meta = {
    version: 1,
    kdf_name: 'PBKDF2',
    kdf_salt: 'salt',
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

  describe('auth requirements', () => {
    test('requires auth for GET /vault', async () => {
      const vaultService = require('../services/VaultService').default;

      const res = await request(app).get('/vault');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(vaultService.getVaultMeta).not.toHaveBeenCalled();
    });

    test('requires auth for PUT /vault', async () => {
      const vaultService = require('../services/VaultService').default;

      const res = await request(app).put('/vault').send({ meta });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(vaultService.putVaultMeta).not.toHaveBeenCalled();
    });

    test('requires auth for GET /vault/blob/:type', async () => {
      const vaultService = require('../services/VaultService').default;

      const res = await request(app).get('/vault/blob/addresses');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(vaultService.getBlob).not.toHaveBeenCalled();
    });

    test('requires auth for GET /vault/blobs', async () => {
      const vaultService = require('../services/VaultService').default;

      const res = await request(app).get('/vault/blobs');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(vaultService.getBlobInventory).not.toHaveBeenCalled();
    });

    test('requires auth for PUT /vault/blob/:type', async () => {
      const vaultService = require('../services/VaultService').default;

      const res = await request(app)
        .put('/vault/blob/addresses')
        .send({ type: 'addresses', blob });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(vaultService.putBlob).not.toHaveBeenCalled();
    });

    test('requires auth for POST /vault/export', async () => {
      const vaultService = require('../services/VaultService').default;

      const res = await request(app).post('/vault/export');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(vaultService.exportVault).not.toHaveBeenCalled();
    });

    test('requires auth for POST /vault/import', async () => {
      const vaultService = require('../services/VaultService').default;

      const res = await request(app)
        .post('/vault/import')
        .send({ version: 1, meta, blobs: {} });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(vaultService.importVault).not.toHaveBeenCalled();
    });

    test('returns 401 with Unauthorized when authenticated user has no id', async () => {
      const vaultService = require('../services/VaultService').default;

      const res = await request(app)
        .get('/vault')
        .set('Authorization', 'Bearer no-id');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized' });
      expect(vaultService.getVaultMeta).not.toHaveBeenCalled();
    });
  });

  test('returns 404 on missing vault meta', async () => {
    const vaultService = require('../services/VaultService').default;

    vaultService.getVaultMeta.mockResolvedValueOnce({
      ok: false,
      status: 404,
      body: { message: 'Vault not found' },
    });

    const res = await request(app)
      .get('/vault')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Vault not found' });
  });

  test('passes If-Match to PUT /vault and returns 201 on create', async () => {
    const vaultService = require('../services/VaultService').default;

    vaultService.putVaultMeta.mockResolvedValueOnce({
      ok: true,
      status: 201,
      body: {
        ok: true,
        etag: 'W/"1"',
        updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      },
    });

    const res = await request(app)
      .put('/vault')
      .set('Authorization', 'Bearer test')
      .set('If-Match', 'W/"0"')
      .send({ meta });

    expect(res.status).toBe(201);
    expect(vaultService.putVaultMeta).toHaveBeenCalledWith(
      'user-1',
      meta,
      'W/"0"',
    );
  });

  test('returns 422 when PUT /vault/blob/:type body type mismatches path type', async () => {
    const vaultService = require('../services/VaultService').default;

    const res = await request(app)
      .put('/vault/blob/addresses')
      .set('Authorization', 'Bearer test')
      .send({ type: 'mobileNumbers', blob });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ message: 'Body type must match path type' });
    expect(vaultService.putBlob).not.toHaveBeenCalled();
  });

  test('returns 200 for GET /vault/blob/:type when service returns ok', async () => {
    const vaultService = require('../services/VaultService').default;

    vaultService.getBlob.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        type: 'addresses',
        blob,
        updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
        etag: 'W/"1"',
      },
    });

    const res = await request(app)
      .get('/vault/blob/addresses')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('addresses');
    expect(vaultService.getBlob).toHaveBeenCalledWith('user-1', 'addresses');
  });

  describe('ADR 0055: GET /vault/blob/:type If-None-Match handling', () => {
    test('returns 304 with empty body when If-None-Match matches current ETag', async () => {
      const vaultService = require('../services/VaultService').default;
      const currentEtag = 'W/"abcd1234"';

      vaultService.getBlob.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          type: 'addresses',
          blob,
          updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
          etag: currentEtag,
        },
      });

      const res = await request(app)
        .get('/vault/blob/addresses')
        .set('Authorization', 'Bearer test')
        .set('If-None-Match', currentEtag);

      expect(res.status).toBe(304);
      expect(res.text).toBe('');
    });

    test('returns 200 with full body when If-None-Match does not match current ETag', async () => {
      const vaultService = require('../services/VaultService').default;
      const currentEtag = 'W/"abcd1234"';

      vaultService.getBlob.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          type: 'addresses',
          blob,
          updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
          etag: currentEtag,
        },
      });

      const res = await request(app)
        .get('/vault/blob/addresses')
        .set('Authorization', 'Bearer test')
        .set('If-None-Match', 'W/"different-etag"');

      expect(res.status).toBe(200);
      expect(res.body.type).toBe('addresses');
      expect(res.body.etag).toBe(currentEtag);
    });

    test('returns 404 unchanged when If-None-Match is set but blob does not exist', async () => {
      const vaultService = require('../services/VaultService').default;

      vaultService.getBlob.mockResolvedValueOnce({
        ok: false,
        status: 404,
        body: { message: 'Vault blob not found' },
      });

      const res = await request(app)
        .get('/vault/blob/addresses')
        .set('Authorization', 'Bearer test')
        .set('If-None-Match', 'W/"anything"');

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Vault blob not found');
    });
  });

  describe('ADR 0087: GET /vault/blobs If-None-Match handling', () => {
    test('returns 200 with full body when service succeeds and no If-None-Match header', async () => {
      const vaultService = require('../services/VaultService').default;

      vaultService.getBlobInventory.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          blobs: [
            {
              type: 'addresses',
              etag: 'W/"abc123"',
              updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
            },
          ],
          etag: 'W/"inventory-etag"',
        },
      });

      const res = await request(app)
        .get('/vault/blobs')
        .set('Authorization', 'Bearer test');

      expect(res.status).toBe(200);
      expect(res.body.blobs).toHaveLength(1);
      expect(res.body.blobs[0].type).toBe('addresses');
      expect(res.body.etag).toBe('W/"inventory-etag"');
      expect(vaultService.getBlobInventory).toHaveBeenCalledWith('user-1');
    });

    test('returns 200 with empty blobs array when user has no blobs (never 404)', async () => {
      const vaultService = require('../services/VaultService').default;

      vaultService.getBlobInventory.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          blobs: [],
          etag: 'W/"empty-inventory"',
        },
      });

      const res = await request(app)
        .get('/vault/blobs')
        .set('Authorization', 'Bearer test');

      expect(res.status).toBe(200);
      expect(res.body.blobs).toEqual([]);
      expect(res.body.etag).toBe('W/"empty-inventory"');
      expect(vaultService.getBlobInventory).toHaveBeenCalledWith('user-1');
    });

    test('returns 304 with empty body when If-None-Match matches current inventory etag', async () => {
      const vaultService = require('../services/VaultService').default;
      const currentEtag = 'W/"current-inventory-etag"';

      vaultService.getBlobInventory.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          blobs: [
            {
              type: 'addresses',
              etag: 'W/"abc123"',
              updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
            },
          ],
          etag: currentEtag,
        },
      });

      const res = await request(app)
        .get('/vault/blobs')
        .set('Authorization', 'Bearer test')
        .set('If-None-Match', currentEtag);

      expect(res.status).toBe(304);
      expect(res.text).toBe('');
    });

    test('returns 200 with full body when If-None-Match does not match current inventory etag', async () => {
      const vaultService = require('../services/VaultService').default;
      const currentEtag = 'W/"current-inventory-etag"';

      vaultService.getBlobInventory.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          blobs: [
            {
              type: 'addresses',
              etag: 'W/"abc123"',
              updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
            },
          ],
          etag: currentEtag,
        },
      });

      const res = await request(app)
        .get('/vault/blobs')
        .set('Authorization', 'Bearer test')
        .set('If-None-Match', 'W/"different-etag"');

      expect(res.status).toBe(200);
      expect(res.body.blobs).toHaveLength(1);
      expect(res.body.etag).toBe(currentEtag);
    });

    test('returns 200 with full body when If-None-Match is set but multiple blobs exist', async () => {
      const vaultService = require('../services/VaultService').default;

      vaultService.getBlobInventory.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          blobs: [
            {
              type: 'addresses',
              etag: 'W/"abc123"',
              updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
            },
            {
              type: 'groceries',
              etag: 'W/"def456"',
              updatedAt: new Date('2026-01-02T00:00:00.000Z').toISOString(),
            },
          ],
          etag: 'W/"multi-blob-etag"',
        },
      });

      const res = await request(app)
        .get('/vault/blobs')
        .set('Authorization', 'Bearer test')
        .set('If-None-Match', 'W/"different-etag"');

      expect(res.status).toBe(200);
      expect(res.body.blobs).toHaveLength(2);
      expect(res.body.blobs[0].type).toBe('addresses');
      expect(res.body.blobs[1].type).toBe('groceries');
      expect(res.body.etag).toBe('W/"multi-blob-etag"');
    });
  });
});
