import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { logErrorWithStack } from '../helpers/describeError';
import userService from './UserService';

type AsyncMock = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

type MockPrismaClient = {
  user: {
    updateMany: AsyncMock;
  };
};

jest.mock('../prisma', () => {
  const __mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    adminAuditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
  };

  return {
    __esModule: true,
    __mockPrisma,
    createPrismaClient: jest.fn(() => __mockPrisma),
    PrismaClient: jest.fn(),
  };
});

jest.mock('./EmailService', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../helpers/describeError', () => {
  const actual = jest.requireActual<typeof import('../helpers/describeError')>(
    '../helpers/describeError',
  );
  return {
    __esModule: true,
    ...actual,
    logErrorWithStack: jest.fn(),
  };
});

const mockPrisma = require('../prisma').__mockPrisma as MockPrismaClient;
const mockLogErrorWithStack = logErrorWithStack as jest.MockedFunction<
  typeof logErrorWithStack
>;

const USER_ID = 'user-1';

describe('UserService.recordActivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
  });

  test('writes now when last_active_at is null, scoped to rows that are null or before the UTC day', async () => {
    const now = new Date('2026-11-04T09:00:00.000Z');

    await userService.recordActivity(
      { id: USER_ID, last_active_at: null },
      now,
    );

    expect(mockPrisma.user.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: USER_ID,
        OR: [
          { last_active_at: null },
          { last_active_at: { lt: new Date('2026-11-04T00:00:00.000Z') } },
        ],
      },
      data: { last_active_at: now },
    });
  });

  test('writes now when the stored value falls on an earlier UTC day', async () => {
    const now = new Date('2026-11-04T09:00:00.000Z');

    await userService.recordActivity(
      { id: USER_ID, last_active_at: new Date('2026-11-03T23:59:00.000Z') },
      now,
    );

    expect(mockPrisma.user.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { last_active_at: now } }),
    );
  });

  test('does not write when the stored value is earlier on the same UTC day', async () => {
    await userService.recordActivity(
      { id: USER_ID, last_active_at: new Date('2026-11-04T01:00:00.000Z') },
      new Date('2026-11-04T09:00:00.000Z'),
    );

    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  test('writes across the UTC midnight boundary even when less than a minute has passed', async () => {
    const now = new Date('2026-11-04T00:00:30.000Z');

    await userService.recordActivity(
      { id: USER_ID, last_active_at: new Date('2026-11-03T23:59:59.000Z') },
      now,
    );

    expect(mockPrisma.user.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { last_active_at: null },
            { last_active_at: { lt: new Date('2026-11-04T00:00:00.000Z') } },
          ],
        }),
        data: { last_active_at: now },
      }),
    );
  });

  test('resolves and logs with the userId when the write rejects', async () => {
    const failure = new Error('connection lost');
    mockPrisma.user.updateMany.mockRejectedValueOnce(failure);

    await expect(
      userService.recordActivity(
        { id: USER_ID, last_active_at: null },
        new Date('2026-11-04T09:00:00.000Z'),
      ),
    ).resolves.toBeUndefined();

    expect(mockLogErrorWithStack).toHaveBeenCalledTimes(1);
    expect(mockLogErrorWithStack).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining(USER_ID),
      failure,
    );
  });
});
