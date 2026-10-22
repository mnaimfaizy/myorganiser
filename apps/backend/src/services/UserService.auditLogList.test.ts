import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import userService from './UserService';

type AsyncMock = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

type MockPrismaClient = {
  adminAuditLog: {
    findMany: AsyncMock;
    count: AsyncMock;
  };
  $transaction: AsyncMock;
};

jest.mock('../prisma', () => {
  const __mockPrisma = {
    adminAuditLog: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  return {
    __esModule: true,
    __mockPrisma,
    createPrismaClient: jest.fn(() => __mockPrisma),
    PrismaClient: jest.fn(),
  };
});

const mockPrisma = require('../prisma').__mockPrisma as MockPrismaClient;

const ACTOR_ID = 'actor-1';
const TARGET_ID = 'target-1';

const AUDIT_USER_SELECT = {
  name: true,
  first_name: true,
  last_name: true,
  email: true,
};

function findManyArgs(): Record<string, unknown> {
  const call = mockPrisma.adminAuditLog.findMany.mock.calls[0] as unknown[];
  return call[0] as Record<string, unknown>;
}

function countArgs(): Record<string, unknown> {
  const call = mockPrisma.adminAuditLog.count.mock.calls[0] as unknown[];
  return call[0] as Record<string, unknown>;
}

function entry(
  overrides: Partial<{
    id: string;
    actor_user_id: string | null;
    target_user_id: string | null;
    action: string;
    actor: Record<string, unknown> | null;
    target: Record<string, unknown> | null;
  }> = {},
): Record<string, unknown> {
  return {
    id: 'log-1',
    actor_user_id: ACTOR_ID,
    target_user_id: TARGET_ID,
    action: 'disable',
    created_at: new Date('2025-06-01T00:00:00.000Z'),
    actor: {
      name: 'Sam Miller',
      first_name: 'Sam',
      last_name: 'Miller',
      email: 'sam@example.com',
    },
    target: {
      name: 'Tara Lee',
      first_name: 'Tara',
      last_name: 'Lee',
      email: 'tara@example.com',
    },
    ...overrides,
  };
}

describe('UserService.listAdminAuditLogs', () => {
  beforeEach(() => {
    mockPrisma.adminAuditLog.findMany.mockReset();
    mockPrisma.adminAuditLog.count.mockReset();
    mockPrisma.$transaction.mockReset();

    mockPrisma.adminAuditLog.findMany.mockResolvedValue([]);
    mockPrisma.adminAuditLog.count.mockResolvedValue(0);
    mockPrisma.$transaction.mockImplementation(async (ops: unknown[]) =>
      Promise.all(ops),
    );
  });

  describe('paging and ordering', () => {
    test('with no filters reads page 1 newest-first with an empty where and a single transaction', async () => {
      mockPrisma.adminAuditLog.findMany.mockResolvedValue([entry()]);
      mockPrisma.adminAuditLog.count.mockResolvedValue(1);

      await userService.listAdminAuditLogs({ page: 1, pageSize: 25 });

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(findManyArgs()).toEqual({
        where: {},
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 25,
        select: {
          id: true,
          actor_user_id: true,
          target_user_id: true,
          action: true,
          created_at: true,
          actor: { select: AUDIT_USER_SELECT },
          target: { select: AUDIT_USER_SELECT },
        },
      });
      expect(countArgs()).toEqual({ where: {} });
    });

    test('computes skip from the 1-based page and returns the total from count', async () => {
      mockPrisma.adminAuditLog.count.mockResolvedValue(42);

      const result = await userService.listAdminAuditLogs({
        page: 3,
        pageSize: 10,
      });

      expect(findManyArgs()).toEqual(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(result.total).toBe(42);
    });

    test('a page past the end returns no rows with the full total', async () => {
      mockPrisma.adminAuditLog.findMany.mockResolvedValue([]);
      mockPrisma.adminAuditLog.count.mockResolvedValue(7);

      const result = await userService.listAdminAuditLogs({
        page: 9,
        pageSize: 25,
      });

      expect(result).toEqual({ rows: [], total: 7 });
    });
  });

  describe('filters', () => {
    test('userId matches actor OR target on findMany and count', async () => {
      await userService.listAdminAuditLogs({
        userId: ACTOR_ID,
        page: 1,
        pageSize: 25,
      });

      const expected = {
        OR: [{ actor_user_id: ACTOR_ID }, { target_user_id: ACTOR_ID }],
      };
      expect(findManyArgs().where).toEqual(expected);
      expect(countArgs().where).toEqual(expected);
    });

    test('action list maps to an in clause on findMany and count', async () => {
      await userService.listAdminAuditLogs({
        action: ['disable', 'enable'],
        page: 1,
        pageSize: 25,
      });

      const expected = { action: { in: ['disable', 'enable'] } };
      expect(findManyArgs().where).toEqual(expected);
      expect(countArgs().where).toEqual(expected);
    });

    test('an empty action list adds no action clause', async () => {
      await userService.listAdminAuditLogs({
        action: [],
        page: 1,
        pageSize: 25,
      });

      expect(findManyArgs().where).toEqual({});
      expect(countArgs().where).toEqual({});
    });

    test('userId and action combine into one where on findMany and count', async () => {
      await userService.listAdminAuditLogs({
        userId: TARGET_ID,
        action: ['promote'],
        page: 2,
        pageSize: 5,
      });

      const expected = {
        OR: [{ actor_user_id: TARGET_ID }, { target_user_id: TARGET_ID }],
        action: { in: ['promote'] },
      };
      expect(findManyArgs().where).toEqual(expected);
      expect(countArgs().where).toEqual(expected);
    });
  });

  describe('display names and rows', () => {
    test('uses the User name when it has content', async () => {
      mockPrisma.adminAuditLog.findMany.mockResolvedValue([entry()]);

      const { rows } = await userService.listAdminAuditLogs({
        page: 1,
        pageSize: 25,
      });

      expect(rows[0]).toEqual(
        expect.objectContaining({
          actor_name: 'Sam Miller',
          target_name: 'Tara Lee',
        }),
      );
    });

    test('falls back to trimmed first and last name when name is blank or null', async () => {
      mockPrisma.adminAuditLog.findMany.mockResolvedValue([
        entry({
          actor: {
            name: '   ',
            first_name: '  Ali ',
            last_name: ' Khan ',
            email: 'ali@example.com',
          },
          target: {
            name: null,
            first_name: 'Tara',
            last_name: 'Lee',
            email: 'tara@example.com',
          },
        }),
      ]);

      const { rows } = await userService.listAdminAuditLogs({
        page: 1,
        pageSize: 25,
      });

      expect(rows[0].actor_name).toBe('Ali Khan');
      expect(rows[0].target_name).toBe('Tara Lee');
    });

    test('falls back to email when name and first/last are all blank', async () => {
      mockPrisma.adminAuditLog.findMany.mockResolvedValue([
        entry({
          actor: {
            name: '  ',
            first_name: ' ',
            last_name: '   ',
            email: 'ghost@example.com',
          },
        }),
      ]);

      const { rows } = await userService.listAdminAuditLogs({
        page: 1,
        pageSize: 25,
      });

      expect(rows[0].actor_name).toBe('ghost@example.com');
    });

    test('a deleted actor or target yields null names and drops the relation objects', async () => {
      mockPrisma.adminAuditLog.findMany.mockResolvedValue([
        entry({
          actor_user_id: null,
          actor: null,
          target_user_id: null,
          target: null,
          action: 'demote',
        }),
      ]);

      const { rows } = await userService.listAdminAuditLogs({
        page: 1,
        pageSize: 25,
      });

      expect(rows).toEqual([
        {
          id: 'log-1',
          actor_user_id: null,
          target_user_id: null,
          actor_name: null,
          target_name: null,
          action: 'demote',
          created_at: new Date('2025-06-01T00:00:00.000Z'),
        },
      ]);
    });
  });
});
