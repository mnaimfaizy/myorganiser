import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import userService from './UserService';

type AsyncMock = jest.Mock<(...args: unknown[]) => Promise<unknown>>;
type CountMock = jest.Mock<(...args: unknown[]) => Promise<number>>;

type MockPrismaClient = {
  user: {
    findMany: AsyncMock;
    count: CountMock;
  };
  $transaction: AsyncMock;
};

jest.mock('../prisma', () => {
  const __mockPrisma = {
    user: {
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

jest.mock('./EmailService', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../helpers/ApiTokens', () => ({
  __esModule: true,
  default: {
    generateEmailVerificationToken: jest.fn(),
  },
}));

const mockPrisma = require('../prisma').__mockPrisma as MockPrismaClient;

const OR_QUERY = [
  { email: { contains: 'ali', mode: 'insensitive' } },
  { name: { contains: 'ali', mode: 'insensitive' } },
  { first_name: { contains: 'ali', mode: 'insensitive' } },
  { last_name: { contains: 'ali', mode: 'insensitive' } },
];

function findManyArgs(): Record<string, unknown> {
  const call = mockPrisma.user.findMany.mock.calls[0] as unknown[];
  return call[0] as Record<string, unknown>;
}

function countArgs(): Record<string, unknown> {
  const call = mockPrisma.user.count.mock.calls[0] as unknown[];
  return call[0] as Record<string, unknown>;
}

describe('UserService.listIdentityUsers', () => {
  beforeEach(() => {
    mockPrisma.user.findMany.mockReset();
    mockPrisma.user.count.mockReset();
    mockPrisma.$transaction.mockReset();

    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.user.count.mockResolvedValue(0);
    mockPrisma.$transaction.mockImplementation(async (ops: unknown[]) =>
      Promise.all(ops),
    );
  });

  describe('filters', () => {
    test('builds an empty where when no q, status, or role is given', async () => {
      await userService.listIdentityUsers({
        sort: 'newest',
        page: 1,
        pageSize: 25,
      });

      expect(findManyArgs().where).toEqual({});
      expect(countArgs().where).toEqual({});
    });

    test('trims q and matches email, name, first_name, and last_name case-insensitively', async () => {
      await userService.listIdentityUsers({
        q: '  ali  ',
        sort: 'newest',
        page: 1,
        pageSize: 25,
      });

      expect(findManyArgs().where).toEqual({ OR: OR_QUERY });
      expect(countArgs().where).toEqual(findManyArgs().where);
    });

    test('ignores a whitespace-only q', async () => {
      await userService.listIdentityUsers({
        q: '   ',
        sort: 'newest',
        page: 1,
        pageSize: 25,
      });

      expect(findManyArgs().where).toEqual({});
      expect(countArgs().where).toEqual({});
    });

    test.each([
      ['disabled', { disabled: true }],
      ['unverified', { disabled: false, email_verification_timestamp: null }],
      [
        'active',
        { disabled: false, email_verification_timestamp: { not: null } },
      ],
    ] as const)(
      'status %s maps to its where clause on findMany and count',
      async (status, expected) => {
        await userService.listIdentityUsers({
          status,
          sort: 'newest',
          page: 1,
          pageSize: 25,
        });

        expect(findManyArgs().where).toEqual(expected);
        expect(countArgs().where).toEqual(findManyArgs().where);
      },
    );

    test.each([
      ['platform_admin', { role: 'platform_admin' }],
      ['user', { role: 'user' }],
    ] as const)(
      'role %s maps to a role clause on findMany and count',
      async (role, expected) => {
        await userService.listIdentityUsers({
          role,
          sort: 'newest',
          page: 1,
          pageSize: 25,
        });

        expect(findManyArgs().where).toEqual(expected);
        expect(countArgs().where).toEqual(findManyArgs().where);
      },
    );

    test('combines q, status, and role into one where clause', async () => {
      await userService.listIdentityUsers({
        q: 'ali',
        status: 'active',
        role: 'user',
        sort: 'newest',
        page: 1,
        pageSize: 25,
      });

      const expected = {
        OR: OR_QUERY,
        disabled: false,
        email_verification_timestamp: { not: null },
        role: 'user',
      };
      expect(findManyArgs().where).toEqual(expected);
      expect(countArgs().where).toEqual(expected);
    });
  });

  describe('sort', () => {
    test('newest orders by created_at descending with id as the tie-breaker', async () => {
      await userService.listIdentityUsers({
        sort: 'newest',
        page: 1,
        pageSize: 25,
      });

      expect(findManyArgs().orderBy).toEqual([
        { created_at: 'desc' },
        { id: 'asc' },
      ]);
    });

    test('name orders by name, then email, then id', async () => {
      await userService.listIdentityUsers({
        sort: 'name',
        page: 1,
        pageSize: 25,
      });

      expect(findManyArgs().orderBy).toEqual([
        { name: 'asc' },
        { email: 'asc' },
        { id: 'asc' },
      ]);
    });
  });

  describe('paging', () => {
    test('page 1 with pageSize 25 skips 0 and takes 25', async () => {
      await userService.listIdentityUsers({
        sort: 'newest',
        page: 1,
        pageSize: 25,
      });

      expect(findManyArgs().skip).toBe(0);
      expect(findManyArgs().take).toBe(25);
    });

    test('page 3 with pageSize 10 skips 20 and takes 10', async () => {
      await userService.listIdentityUsers({
        sort: 'newest',
        page: 3,
        pageSize: 10,
      });

      expect(findManyArgs().skip).toBe(20);
      expect(findManyArgs().take).toBe(10);
    });

    test('pageSize 100 is passed through as take 100', async () => {
      await userService.listIdentityUsers({
        sort: 'newest',
        page: 1,
        pageSize: 100,
      });

      expect(findManyArgs().take).toBe(100);
    });
  });

  describe('result', () => {
    test('returns users from findMany and total from count, which may differ from users.length', async () => {
      const rows = [
        { id: 'user-1', email: 'a@example.com' },
        { id: 'user-2', email: 'b@example.com' },
      ];
      mockPrisma.user.findMany.mockResolvedValue(rows);
      mockPrisma.user.count.mockResolvedValue(42);

      const result = await userService.listIdentityUsers({
        sort: 'newest',
        page: 1,
        pageSize: 2,
      });

      expect(result).toEqual({ users: rows, total: 42 });
    });

    test('a page past the end returns no users with the full total', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(4);

      const result = await userService.listIdentityUsers({
        sort: 'newest',
        page: 9,
        pageSize: 25,
      });

      expect(result).toEqual({ users: [], total: 4 });
    });

    test('findMany selects created_at and no sensitive User fields', async () => {
      await userService.listIdentityUsers({
        sort: 'newest',
        page: 1,
        pageSize: 25,
      });

      const select = findManyArgs().select as Record<string, unknown>;
      expect(select.created_at).toBe(true);
      for (const field of [
        'password',
        'reset_password_token',
        'email_verification_token',
        'blacklisted_tokens',
        'sessions_invalidated_at',
        'fix_notice_unsubscribe_token',
      ]) {
        expect(select).not.toHaveProperty(field);
      }
    });

    test('count receives only where, with no paging, ordering, or select', async () => {
      await userService.listIdentityUsers({
        q: 'ali',
        sort: 'name',
        page: 2,
        pageSize: 10,
      });

      expect(Object.keys(countArgs())).toEqual(['where']);
    });
  });
});
