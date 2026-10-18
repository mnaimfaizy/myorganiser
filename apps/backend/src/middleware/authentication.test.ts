import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';
import type * as express from 'express';

import { decodeToken } from '../helpers/jwtHelper';
import userService from '../services/UserService';
import { expressAuthentication } from './authentication';

jest.mock('../services/UserService', () => ({
  __esModule: true,
  default: {
    getById: jest.fn(),
  },
}));

jest.mock('../helpers/jwtHelper', () => ({
  __esModule: true,
  decodeToken: jest.fn(),
}));

const decodeTokenMock = decodeToken as any;
const getByIdMock = (userService as any).getById as any;

function makeReq(overrides: Partial<express.Request> = {}): express.Request {
  return {
    headers: {},
    body: {},
    ...overrides,
  } as any;
}

describe('expressAuthentication (tsoa jwt)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ACCESS_JWT_SECRET = 'secret';
    delete process.env.YOUTUBE_CRON_SECRET;
    delete process.env.FEEDBACK_RELEASE_SECRET;
  });

  test('rejects when no token provided', async () => {
    const req = makeReq();

    await expect(expressAuthentication(req, 'jwt')).rejects.toHaveProperty(
      'status',
      401,
    );

    await expect(expressAuthentication(req, 'jwt')).rejects.toHaveProperty(
      'message',
      'Unauthorized',
    );
  });

  test('rejects unsupported security scheme', async () => {
    const req = makeReq();

    await expect(expressAuthentication(req, 'api_key')).rejects.toHaveProperty(
      'status',
      401,
    );

    await expect(expressAuthentication(req, 'api_key')).rejects.toHaveProperty(
      'message',
      'Unsupported security scheme',
    );
  });

  test('uses Authorization Bearer token', async () => {
    decodeTokenMock.mockReturnValue({ userId: 'u1' });
    getByIdMock.mockResolvedValue({ id: 'u1' });

    const req = makeReq({ headers: { authorization: 'Bearer abc' } });
    const user = await expressAuthentication(req, 'jwt');

    expect(decodeToken).toHaveBeenCalledWith('abc', 'secret');
    expect(userService.getById).toHaveBeenCalledWith('u1');
    expect((req as any).user).toEqual({ id: 'u1' });
    expect(user).toEqual({ id: 'u1' });
  });

  test('falls back to body.token when header missing', async () => {
    decodeTokenMock.mockReturnValue({ userId: 'u1' });
    getByIdMock.mockResolvedValue({ id: 'u1' });

    const req = makeReq({ body: { token: 'abc' } });
    const user = await expressAuthentication(req, 'jwt');

    expect(decodeToken).toHaveBeenCalledWith('abc', 'secret');
    expect((req.headers as any).authorization).toBe('Bearer abc');
    expect(user).toEqual({ id: 'u1' });
  });

  test('rejects when body.token is not a string', async () => {
    const req = makeReq({ body: { token: 123 } as any });

    await expect(expressAuthentication(req, 'jwt')).rejects.toHaveProperty(
      'status',
      401,
    );

    await expect(expressAuthentication(req, 'jwt')).rejects.toHaveProperty(
      'message',
      'Unauthorized',
    );
  });

  test('rejects invalid token', async () => {
    decodeTokenMock.mockReturnValue(new Error('bad'));

    const req = makeReq({ headers: { authorization: 'Bearer abc' } });

    await expect(expressAuthentication(req, 'jwt')).rejects.toHaveProperty(
      'status',
      401,
    );

    await expect(expressAuthentication(req, 'jwt')).rejects.toHaveProperty(
      'message',
      'Unauthorized',
    );
  });

  test('rejects when decoded payload missing userId', async () => {
    decodeTokenMock.mockReturnValue({});

    const req = makeReq({ headers: { authorization: 'Bearer abc' } });

    await expect(expressAuthentication(req, 'jwt')).rejects.toHaveProperty(
      'status',
      401,
    );

    await expect(expressAuthentication(req, 'jwt')).rejects.toHaveProperty(
      'message',
      'Unauthorized',
    );
  });

  test('rejects when user not found', async () => {
    decodeTokenMock.mockReturnValue({ userId: 'u1' });
    getByIdMock.mockResolvedValue(null);

    const req = makeReq({ headers: { authorization: 'Bearer abc' } });

    await expect(expressAuthentication(req, 'jwt')).rejects.toHaveProperty(
      'status',
      401,
    );

    await expect(expressAuthentication(req, 'jwt')).rejects.toHaveProperty(
      'message',
      'Unauthorized',
    );
  });

  test('rejects disabled user with 401 Account disabled', async () => {
    decodeTokenMock.mockReturnValue({ userId: 'u1' });
    getByIdMock.mockResolvedValue({ id: 'u1', disabled: true });

    const req = makeReq({ headers: { authorization: 'Bearer abc' } });

    await expect(expressAuthentication(req, 'jwt')).rejects.toMatchObject({
      status: 401,
      message: 'Account disabled',
    });
  });

  test('rejects when token was issued before sessions were invalidated', async () => {
    const sessionsInvalidatedAt = new Date('2025-06-01T12:00:00.000Z');
    const iatSeconds = Math.floor(sessionsInvalidatedAt.getTime() / 1000 - 60);

    decodeTokenMock.mockReturnValue({ userId: 'u1', iat: iatSeconds });
    getByIdMock.mockResolvedValue({
      id: 'u1',
      disabled: false,
      sessions_invalidated_at: sessionsInvalidatedAt,
    });

    const req = makeReq({ headers: { authorization: 'Bearer abc' } });

    await expect(expressAuthentication(req, 'jwt')).rejects.toMatchObject({
      status: 401,
      message: 'Session invalidated',
    });
  });

  test('allows when token was issued after sessions were invalidated', async () => {
    const sessionsInvalidatedAt = new Date('2025-06-01T12:00:00.000Z');
    const iatSeconds = Math.floor(sessionsInvalidatedAt.getTime() / 1000 + 60);

    decodeTokenMock.mockReturnValue({ userId: 'u1', iat: iatSeconds });
    getByIdMock.mockResolvedValue({
      id: 'u1',
      disabled: false,
      sessions_invalidated_at: sessionsInvalidatedAt,
    });

    const req = makeReq({ headers: { authorization: 'Bearer abc' } });
    const user = await expressAuthentication(req, 'jwt');

    expect(user).toEqual({
      id: 'u1',
      disabled: false,
      sessions_invalidated_at: sessionsInvalidatedAt,
    });
    expect((req as any).user).toEqual({
      id: 'u1',
      disabled: false,
      sessions_invalidated_at: sessionsInvalidatedAt,
    });
  });

  test('rejects non-admin when scopes include platform_admin', async () => {
    decodeTokenMock.mockReturnValue({ userId: 'u1' });
    getByIdMock.mockResolvedValue({ id: 'u1', role: 'user', disabled: false });

    const req = makeReq({ headers: { authorization: 'Bearer abc' } });

    await expect(
      expressAuthentication(req, 'jwt', ['platform_admin']),
    ).rejects.toMatchObject({
      status: 403,
      message: 'Platform Admin role required',
    });
  });

  test('allows platform_admin when scopes include platform_admin', async () => {
    decodeTokenMock.mockReturnValue({ userId: 'admin-1' });
    getByIdMock.mockResolvedValue({
      id: 'admin-1',
      role: 'platform_admin',
      disabled: false,
    });

    const req = makeReq({ headers: { authorization: 'Bearer abc' } });
    const user = await expressAuthentication(req, 'jwt', ['platform_admin']);

    expect(user).toEqual({
      id: 'admin-1',
      role: 'platform_admin',
      disabled: false,
    });
    expect((req as any).user).toEqual({
      id: 'admin-1',
      role: 'platform_admin',
      disabled: false,
    });
  });
});

describe('expressAuthentication (tsoa cron-secret)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.YOUTUBE_CRON_SECRET = 'cron-secret-value';
  });

  test('accepts matching X-Cron-Secret header', async () => {
    const req = makeReq({ headers: { 'x-cron-secret': 'cron-secret-value' } });

    await expect(
      expressAuthentication(req, 'cron-secret'),
    ).resolves.toBeUndefined();
  });

  test('rejects missing header', async () => {
    const req = makeReq();

    await expect(
      expressAuthentication(req, 'cron-secret'),
    ).rejects.toHaveProperty('status', 401);

    await expect(
      expressAuthentication(req, 'cron-secret'),
    ).rejects.toHaveProperty('message', 'Unauthorized');
  });

  test('rejects wrong secret', async () => {
    const req = makeReq({ headers: { 'x-cron-secret': 'wrong' } });

    await expect(
      expressAuthentication(req, 'cron-secret'),
    ).rejects.toHaveProperty('status', 401);

    await expect(
      expressAuthentication(req, 'cron-secret'),
    ).rejects.toHaveProperty('message', 'Unauthorized');
  });

  test('rejects when YOUTUBE_CRON_SECRET env is unset', async () => {
    delete process.env.YOUTUBE_CRON_SECRET;
    const req = makeReq({ headers: { 'x-cron-secret': 'cron-secret-value' } });

    await expect(
      expressAuthentication(req, 'cron-secret'),
    ).rejects.toHaveProperty('status', 401);
  });
});

describe('expressAuthentication (tsoa deploy-secret)', () => {
  const savedEnv = {
    ACCESS_JWT_SECRET: process.env.ACCESS_JWT_SECRET,
    YOUTUBE_CRON_SECRET: process.env.YOUTUBE_CRON_SECRET,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FEEDBACK_RELEASE_SECRET = 'release-key1';
  });

  afterEach(() => {
    delete process.env.FEEDBACK_RELEASE_SECRET;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  async function expectUnauthorized(run: () => Promise<unknown>) {
    const err = await run().then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toHaveProperty('status', 401);
    expect(err).toHaveProperty('message', 'Unauthorized');
    return err;
  }

  test('accepts matching x-deploy-secret header', async () => {
    const req = makeReq({ headers: { 'x-deploy-secret': 'release-key1' } });

    await expect(
      expressAuthentication(req, 'deploy-secret'),
    ).resolves.toBeUndefined();
  });

  test('rejects missing x-deploy-secret header', async () => {
    const req = makeReq();

    await expectUnauthorized(() => expressAuthentication(req, 'deploy-secret'));
  });

  test('rejects wrong secret of the same length', async () => {
    const req = makeReq({ headers: { 'x-deploy-secret': 'release-key2' } });

    await expectUnauthorized(() => expressAuthentication(req, 'deploy-secret'));
  });

  test('rejects wrong secret of a different length without a RangeError', async () => {
    const req = makeReq({ headers: { 'x-deploy-secret': 'rel-key' } });

    const err = await expectUnauthorized(() =>
      expressAuthentication(req, 'deploy-secret'),
    );

    expect(err).not.toBeInstanceOf(RangeError);
  });

  test('rejects when FEEDBACK_RELEASE_SECRET env is unset, even with a header sent', async () => {
    delete process.env.FEEDBACK_RELEASE_SECRET;

    await expectUnauthorized(() =>
      expressAuthentication(
        makeReq({ headers: { 'x-deploy-secret': 'release-key1' } }),
        'deploy-secret',
      ),
    );

    await expectUnauthorized(() =>
      expressAuthentication(
        makeReq({ headers: { 'x-deploy-secret': '' } }),
        'deploy-secret',
      ),
    );
  });

  test('rejects a valid user JWT when no x-deploy-secret header is sent', async () => {
    process.env.ACCESS_JWT_SECRET = 'secret';
    decodeTokenMock.mockReturnValue({ userId: 'u1' });
    getByIdMock.mockResolvedValue({ id: 'u1', disabled: false });

    const req = makeReq({ headers: { authorization: 'Bearer abc' } });

    // Sanity: the same token is valid for the user scheme.
    await expect(expressAuthentication(req, 'jwt')).resolves.toEqual({
      id: 'u1',
      disabled: false,
    });

    await expectUnauthorized(() => expressAuthentication(req, 'deploy-secret'));
  });

  test('rejects the cron secret sent as x-deploy-secret', async () => {
    process.env.YOUTUBE_CRON_SECRET = 'cron-key-one1';
    process.env.FEEDBACK_RELEASE_SECRET = 'release-key1';

    const req = makeReq({ headers: { 'x-deploy-secret': 'cron-key-one1' } });

    await expectUnauthorized(() => expressAuthentication(req, 'deploy-secret'));
  });
});
