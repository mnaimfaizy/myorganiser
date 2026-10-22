import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

import { createPrismaClient, type Prisma } from '../prisma';

jest.setTimeout(60_000);

// Runs the migration file's SQL text against the local database. The statement
// is global, so it may also move other rows earlier. Everything runs inside one
// transaction that is rolled back, so nothing persists, and every assertion is
// scoped to the rows this file creates.
const MIGRATION_SQL = readFileSync(
  join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20261022120000_backfill_user_created_at_from_id',
    'migration.sql',
  ),
  'utf8',
);

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomBase36(length: number): string {
  return Array.from(randomBytes(length), (byte) => BASE36[byte % 36]).join('');
}

// A v1 cuid: "c", the creation time in epoch milliseconds as 8 base36 digits,
// then 16 more base36 characters (a counter, fingerprint and random part).
function cuidWithTime(time: Date, suffixLength = 16): string {
  return `c${time.getTime().toString(36).padStart(8, '0')}${randomBase36(suffixLength)}`;
}

// Sentinel thrown at the end of the transaction to roll it back. It is the only
// error the test is allowed to swallow.
class RollbackSentinel extends Error {}

const RUN_ID = randomBytes(4).toString('hex');
const EMBEDDED_2021 = new Date(Date.UTC(2021, 5, 15, 12, 34, 56, 789));
const EMBEDDED_2026_APR = new Date(Date.UTC(2026, 3, 1, 0, 0, 0, 0));
const CREATED_AT_2026_JAN = new Date(Date.UTC(2026, 0, 10, 8, 0, 0, 0));

const fixtures = {
  // Case 1: id embeds 2021; created_at was stamped with "now" by the earlier migration.
  decodes: {
    id: cuidWithTime(EMBEDDED_2021),
    email: `backfill-${RUN_ID}-decodes@example.test`,
    createdAt: new Date(),
    expected: EMBEDDED_2021,
  },
  // Case 2: id embeds a time after created_at; the migration must not move it later.
  embeddedLater: {
    id: cuidWithTime(EMBEDDED_2026_APR),
    email: `backfill-${RUN_ID}-later@example.test`,
    createdAt: CREATED_AT_2026_JAN,
    expected: CREATED_AT_2026_JAN,
  },
  // Case 3: cuid-shaped prefix with an early embedded time, but 24 characters
  // long instead of 25. The length check must skip it.
  wrongLength: {
    id: cuidWithTime(EMBEDDED_2021, 15),
    email: `backfill-${RUN_ID}-wrong-length@example.test`,
    createdAt: CREATED_AT_2026_JAN,
    expected: CREATED_AT_2026_JAN,
  },
  // Case 4: 25 characters starting with "c", early embedded time, but one time
  // digit is uppercase (not base36 lowercase). The charset check must skip it.
  uppercaseDigit: {
    id: `c${EMBEDDED_2021.getTime().toString(36).padStart(8, '0').slice(0, 7)}Z${randomBase36(16)}`,
    email: `backfill-${RUN_ID}-uppercase@example.test`,
    createdAt: CREATED_AT_2026_JAN,
    expected: CREATED_AT_2026_JAN,
  },
};

const allFixtures = Object.values(fixtures);
const ids = allFixtures.map((fixture) => fixture.id);

const expectedMs: Record<string, number> = Object.fromEntries(
  allFixtures.map((fixture) => [fixture.id, fixture.expected.getTime()]),
);

const prisma = createPrismaClient();

async function readCreatedAtMs(
  db: Prisma.TransactionClient,
): Promise<Record<string, number>> {
  const rows = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, created_at: true },
  });
  return Object.fromEntries(
    rows.map((row) => [row.id, row.created_at.getTime()]),
  );
}

const captured: {
  afterFirstRun?: Record<string, number>;
  afterSecondRun?: Record<string, number>;
} = {};

describe('backfill User.created_at from cuid id migration', () => {
  beforeAll(async () => {
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.user.createMany({
            data: allFixtures.map((fixture) => ({
              id: fixture.id,
              email: fixture.email,
              first_name: 'Backfill',
              last_name: 'Fixture',
              password: 'unused-hash',
              created_at: fixture.createdAt,
            })),
          });

          await tx.$executeRawUnsafe(MIGRATION_SQL);
          captured.afterFirstRun = await readCreatedAtMs(tx);

          await tx.$executeRawUnsafe(MIGRATION_SQL);
          captured.afterSecondRun = await readCreatedAtMs(tx);

          throw new RollbackSentinel();
        },
        { timeout: 60_000 },
      );
    } catch (error) {
      if (!(error instanceof RollbackSentinel)) {
        throw error;
      }
    }
  });

  afterAll(async () => {
    // Defensive: the transaction rolled back, so no fixture rows should exist.
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  test('moves created_at back to the time encoded in a v1 cuid id', () => {
    expect(captured.afterFirstRun?.[fixtures.decodes.id]).toBe(
      EMBEDDED_2021.getTime(),
    );
  });

  test('leaves created_at unchanged when the embedded time is later', () => {
    expect(captured.afterFirstRun?.[fixtures.embeddedLater.id]).toBe(
      CREATED_AT_2026_JAN.getTime(),
    );
  });

  test('leaves created_at unchanged for an id that is not a 25-character v1 cuid', () => {
    expect(captured.afterFirstRun?.[fixtures.wrongLength.id]).toBe(
      CREATED_AT_2026_JAN.getTime(),
    );
  });

  test('leaves created_at unchanged for a 25-character id with a non-base36 character', () => {
    expect(captured.afterFirstRun?.[fixtures.uppercaseDigit.id]).toBe(
      CREATED_AT_2026_JAN.getTime(),
    );
  });

  test('running the migration a second time changes nothing', () => {
    expect(captured.afterFirstRun).toEqual(expectedMs);
    expect(captured.afterSecondRun).toEqual(captured.afterFirstRun);
  });
});
