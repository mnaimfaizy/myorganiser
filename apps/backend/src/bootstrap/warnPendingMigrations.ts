import * as fs from 'fs';
import * as path from 'path';
import { createPrismaClient } from '../prisma';
import { runBootTask } from './runBootTask';

export const MIGRATE_HINT = 'Run `yarn nx run backend:migrate` to apply them.';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

export function listLocalMigrations(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function findPendingMigrations(
  local: readonly string[],
  applied: ReadonlySet<string>,
): string[] {
  return local.filter((name) => !applied.has(name));
}

async function listAppliedMigrations(): Promise<Set<string>> {
  const client = createPrismaClient();
  try {
    const rows = await client.$queryRaw<
      Array<{ migration_name: string }>
    >`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    return new Set(rows.map((r) => r.migration_name));
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

/**
 * Development only: warn at boot when migrations on disk are not applied to
 * the database. Never throws and never blocks boot; an unreachable database
 * or a missing migrations table is logged as a skipped check. Logs only —
 * nothing reaches an HTTP response.
 */
export async function warnPendingMigrationsOnBoot(
  deps: {
    isProd?: boolean;
    localMigrations?: () => string[];
    appliedMigrations?: () => Promise<Set<string>>;
  } = {},
): Promise<void> {
  const isProd = deps.isProd ?? process.env.NODE_ENV === 'production';
  if (isProd) return;

  await runBootTask(
    '[bootstrap] Skipped pending-migration check:',
    async () => {
      const local = (
        deps.localMigrations ?? (() => listLocalMigrations(MIGRATIONS_DIR))
      )();
      const applied = await (deps.appliedMigrations ?? listAppliedMigrations)();
      const pending = findPendingMigrations(local, applied);
      if (pending.length > 0) {
        console.warn(
          `[bootstrap] ${pending.length} Prisma migration(s) pending: ${pending.join(', ')}. ${MIGRATE_HINT}`,
        );
      }
    },
  );
}

/** True for Prisma P2022 (column does not exist) — the pending-migration symptom. */
export function isMissingColumnError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2022'
  );
}

/** Development only: log a hint for P2022. Returns whether it logged. */
export function logMissingColumnHint(
  err: unknown,
  isProd: boolean = process.env.NODE_ENV === 'production',
): boolean {
  if (isProd || !isMissingColumnError(err)) return false;
  console.error(
    `[dev] Prisma P2022 (column does not exist): the database schema is likely behind. ${MIGRATE_HINT}`,
  );
  return true;
}
