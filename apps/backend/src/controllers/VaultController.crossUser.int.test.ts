import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import bodyParser from 'body-parser';
import express from 'express';
import request from 'supertest';
import { ValidateError } from 'tsoa';
import { FakeVaultStore } from '../testing/fakeVaultStore';

jest.setTimeout(30_000);

// The other two tenancy suites each prove one half of the guarantee in isolation:
// VaultController.tenancy.int.test.ts mocks VaultService wholesale, so it can show
// which userId crosses the controller boundary but has no stored row to inspect;
// VaultService.tenancy.test.ts inspects stored rows but never sees a token. Issue
// #505 asks for the refusal to be asserted "by status code AND by confirming B's
// stored record is unchanged" — that is one claim, so it needs one test. This file
// wires the REAL routes, controller, and VaultService over a fake store, drives it
// over HTTP with User A's token, and reads User B's rows back out of the store.

const store = new FakeVaultStore();

// The real VaultService singleton is constructed at module load from
// createPrismaClient(). Handing it the fake store is what lets this suite keep the
// service REAL — mocking VaultService here would collapse the very seam under test.
jest.mock('../prisma', () => ({
  __esModule: true,
  createPrismaClient: () => store,
  Prisma: {},
}));

jest.mock('../helpers/PlatformTokenHandler', () => ({
  __esModule: true,
  PlatformTokenHandler: { issueLoginSession: jest.fn() },
  default: { issueLoginSession: jest.fn() },
}));

jest.mock('../utils/passport', () => ({
  __esModule: true,
  default: { authenticate: () => (_req: any, _res: any, next: any) => next() },
}));

const TOKEN_TO_USER: Record<string, string> = {
  'token-a': 'user-a',
  'token-b': 'user-b',
};

jest.mock('../middleware/authentication', () => ({
  expressAuthentication: async (req: any) => {
    const header = req?.headers?.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length)
        : header;
    const id = typeof token === 'string' ? TOKEN_TO_USER[token] : undefined;
    if (!id) {
      const err = new Error('Unauthorized') as Error & { status?: number };
      err.status = 401;
      throw err;
    }
    req.user = { id };
    return req.user;
  },
}));

jest.mock('../services/VaultBackupService', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../services/UserService', () => ({ __esModule: true, default: {} }));
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

function makeApp() {
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
      return res
        .status(422)
        .json({ message: 'Validation Failed', details: err?.fields });
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

const IV = Buffer.alloc(12).toString('base64');
const A_CIPHERTEXT = Buffer.from('user-a-secret').toString('base64');
const B_CIPHERTEXT = Buffer.from('user-b-secret').toString('base64');
const A_REWRITTEN_CIPHERTEXT =
  Buffer.from('user-a-rewritten').toString('base64');

function blobWith(ciphertext: string) {
  return { version: 1, iv: IV, ciphertext };
}

function metaWith(kdfSalt: string) {
  return {
    version: 1,
    kdf_name: 'PBKDF2',
    kdf_salt: kdfSalt,
    kdf_params: { iterations: 1 },
    wrapped_mk_passphrase: { owner: kdfSalt },
    wrapped_mk_recovery: { owner: kdfSalt },
  };
}

describe('Vault cross-user isolation (real service over a fake store)', () => {
  let app: express.Express;

  beforeEach(() => {
    store.reset();
    store.seedVault('user-a', 'salt-a');
    store.seedBlob('user-a', 'addresses', blobWith(A_CIPHERTEXT));
    store.seedVault('user-b', 'salt-b');
    store.seedBlob('user-b', 'addresses', blobWith(B_CIPHERTEXT));
    app = makeApp();
  });

  test('GET /vault under token-a returns A own meta and never B meta', async () => {
    const res = await request(app)
      .get('/vault')
      .set('Authorization', 'Bearer token-a');

    expect(res.status).toBe(200);
    expect(res.body.meta.kdf_salt).toBe('salt-a');
    expect(JSON.stringify(res.body)).not.toContain('salt-b');
  });

  test('GET /vault/blob/:type under token-a returns A ciphertext and never B ciphertext', async () => {
    const res = await request(app)
      .get('/vault/blob/addresses')
      .set('Authorization', 'Bearer token-a');

    expect(res.status).toBe(200);
    expect(res.body.blob.ciphertext).toBe(A_CIPHERTEXT);
    expect(JSON.stringify(res.body)).not.toContain(B_CIPHERTEXT);
  });

  test('PUT /vault under token-a leaves B stored vault row byte-identical', async () => {
    const before = store.readVault('user-b');

    const res = await request(app)
      .put('/vault')
      .set('Authorization', 'Bearer token-a')
      .send({ meta: metaWith('salt-a-rewritten') });

    expect(res.status).toBe(200);

    const after = store.readVault('user-b');
    expect(after).toEqual(before);
    expect(after?.kdf_salt).toBe('salt-b');
    expect(store.readVault('user-a')?.kdf_salt).toBe('salt-a-rewritten');
  });

  test('PUT /vault/blob/:type under token-a leaves B stored blob row byte-identical', async () => {
    const before = store.readBlob('user-b', 'addresses');

    const res = await request(app)
      .put('/vault/blob/addresses')
      .set('Authorization', 'Bearer token-a')
      .send({ type: 'addresses', blob: blobWith(A_REWRITTEN_CIPHERTEXT) });

    expect(res.status).toBe(200);

    const after = store.readBlob('user-b', 'addresses');
    expect(after).toEqual(before);
    expect((after?.blob as { ciphertext: string }).ciphertext).toBe(
      B_CIPHERTEXT,
    );

    const rewritten = store.readBlob('user-a', 'addresses');
    expect((rewritten?.blob as { ciphertext: string }).ciphertext).toBe(
      A_REWRITTEN_CIPHERTEXT,
    );
  });

  test('POST /vault/export under token-a returns only A blobs', async () => {
    store.seedBlob('user-b', 'groceries', blobWith(B_CIPHERTEXT));

    const res = await request(app)
      .post('/vault/export')
      .set('Authorization', 'Bearer token-a');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.blobs)).toEqual(['addresses']);
    expect(res.body.meta.kdf_salt).toBe('salt-a');
    expect(JSON.stringify(res.body)).not.toContain(B_CIPHERTEXT);
  });

  test('the same GET /vault under token-b returns B own records, proving the token selects the owner', async () => {
    const res = await request(app)
      .get('/vault')
      .set('Authorization', 'Bearer token-b');

    expect(res.status).toBe(200);
    expect(res.body.meta.kdf_salt).toBe('salt-b');
    expect(JSON.stringify(res.body)).not.toContain('salt-a');
  });

  test('GET /vault/blobs under token-a lists only A types and each etag matches GET /vault/blob/:type', async () => {
    // Seed B with an extra type (tasks) that A lacks
    store.seedBlob('user-b', 'tasks', blobWith(B_CIPHERTEXT));

    // Get inventory list as user-a
    const inventoryRes = await request(app)
      .get('/vault/blobs')
      .set('Authorization', 'Bearer token-a');

    expect(inventoryRes.status).toBe(200);
    expect(inventoryRes.body.blobs).toHaveLength(1);
    expect(inventoryRes.body.blobs[0].type).toBe('addresses');
    const addressesEtagFromInventory = inventoryRes.body.blobs[0].etag;

    // Fetch the same blob individually and verify etags match
    const blobRes = await request(app)
      .get('/vault/blob/addresses')
      .set('Authorization', 'Bearer token-a');

    expect(blobRes.status).toBe(200);
    expect(blobRes.body.etag).toBe(addressesEtagFromInventory);

    // Verify B's tasks blob is not in A's inventory and B's ciphertext is not in A's response
    const types = inventoryRes.body.blobs.map((b: any) => b.type);
    expect(types).not.toContain('tasks');
    expect(JSON.stringify(inventoryRes.body)).not.toContain(B_CIPHERTEXT);
  });

  test('GET /vault/blobs under token-a with If-None-Match is isolated from B writes', async () => {
    // First, get A's inventory and etag
    const firstRes = await request(app)
      .get('/vault/blobs')
      .set('Authorization', 'Bearer token-a');

    expect(firstRes.status).toBe(200);
    const aEtag = firstRes.body.etag;

    // Now B writes a new blob (addresses update)
    await request(app)
      .put('/vault/blob/addresses')
      .set('Authorization', 'Bearer token-b')
      .send({
        type: 'addresses',
        blob: blobWith(Buffer.from('user-b-new-secret').toString('base64')),
      });

    // A's conditional request should still return 304 (their list hasn't changed)
    const condRes = await request(app)
      .get('/vault/blobs')
      .set('Authorization', 'Bearer token-a')
      .set('If-None-Match', aEtag);

    expect(condRes.status).toBe(304);
    expect(condRes.text).toBe('');
  });

  test('GET /vault/blobs under token-b returns B own set and different list etag than A', async () => {
    // Get A's inventory
    const aRes = await request(app)
      .get('/vault/blobs')
      .set('Authorization', 'Bearer token-a');

    expect(aRes.status).toBe(200);
    const aEtag = aRes.body.etag;
    const aAddressesEtag = aRes.body.blobs[0]?.etag;
    expect(aRes.body.blobs).toHaveLength(1);
    expect(aRes.body.blobs[0].type).toBe('addresses');

    // Get B's inventory
    const bRes = await request(app)
      .get('/vault/blobs')
      .set('Authorization', 'Bearer token-b');

    expect(bRes.status).toBe(200);
    expect(bRes.body.blobs).toHaveLength(1);
    expect(bRes.body.blobs[0].type).toBe('addresses');

    // Verify list etags are different (different blob contents)
    expect(bRes.body.etag).not.toBe(aEtag);

    // Verify individual blob etags are different (A and B have different ciphertexts)
    const bAddressesEtag = bRes.body.blobs[0]?.etag;
    expect(bAddressesEtag).not.toBe(aAddressesEtag);

    // Verify by fetching the actual blob: B's blob has B's ciphertext, not A's
    const bBlobRes = await request(app)
      .get('/vault/blob/addresses')
      .set('Authorization', 'Bearer token-b');

    expect(bBlobRes.status).toBe(200);
    expect(bBlobRes.body.blob.ciphertext).toBe(B_CIPHERTEXT);
    expect(bBlobRes.body.blob.ciphertext).not.toBe(A_CIPHERTEXT);
  });
});
