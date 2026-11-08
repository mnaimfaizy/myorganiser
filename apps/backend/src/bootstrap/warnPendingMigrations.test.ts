import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

import {
  findPendingMigrations,
  isMissingColumnError,
  logMissingColumnHint,
  warnPendingMigrationsOnBoot,
} from './warnPendingMigrations';

jest.mock('../prisma', () => ({ createPrismaClient: jest.fn() }));

describe('warnPendingMigrations', () => {
  let warnSpy: jest.SpiedFunction<typeof console.warn>;
  let errorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('findPendingMigrations returns unapplied names', () => {
    expect(findPendingMigrations(['a', 'b', 'c'], new Set(['a']))).toEqual([
      'b',
      'c',
    ]);
  });

  test('warns with names and hint when migrations are pending', async () => {
    await warnPendingMigrationsOnBoot({
      isProd: false,
      localMigrations: () => ['a', 'b'],
      appliedMigrations: async () => new Set(['a']),
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0][0]);
    expect(msg).toContain('b');
    expect(msg).toContain('yarn nx run backend:migrate');
  });

  test('is silent when nothing is pending', async () => {
    await warnPendingMigrationsOnBoot({
      isProd: false,
      localMigrations: () => ['a'],
      appliedMigrations: async () => new Set(['a']),
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('does nothing in production', async () => {
    const applied = jest.fn<() => Promise<Set<string>>>();
    await warnPendingMigrationsOnBoot({
      isProd: true,
      appliedMigrations: applied,
    });
    expect(applied).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('does not throw when the database is unreachable', async () => {
    await expect(
      warnPendingMigrationsOnBoot({
        isProd: false,
        localMigrations: () => ['a'],
        appliedMigrations: async () => {
          throw new Error('ECONNREFUSED');
        },
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('P2022 hint logs in development only', () => {
    const err = Object.assign(new Error('x'), { code: 'P2022' });
    expect(isMissingColumnError(err)).toBe(true);
    expect(logMissingColumnHint(err, false)).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('backend:migrate'),
    );
    errorSpy.mockClear();
    expect(logMissingColumnHint(err, true)).toBe(false);
    expect(logMissingColumnHint(new Error('other'), false)).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
