#!/usr/bin/env node
// Asserts that the Prisma migration history is shaped the way the migrate
// engine requires, without a database (ADR 0094).
//
//   node tools/scripts/check-prisma-migrations.mjs [migrationsDir] [schemaDir] [--print]
//
// Until #748 nothing in .husky, .github/workflows, or the `gates:run` manifest
// read apps/backend/src/prisma/** as anything but source to reformat: the
// pre-commit hook runs `prisma format`, which rewrites the schema and asserts
// nothing. A broken migration therefore first failed on the shared host at
// deploy time, and release v0.4.0 shipped four migrations that were never
// applied at all (#437).
//
// This is the cheap half of the answer and it is deliberately narrow. It
// asserts only what can be read off the tree:
//
//   - every entry beside migration_lock.toml is a directory named
//     <14-digit timestamp>_<lowercase_snake_slug>, the shape
//     `prisma migrate dev` writes and `prisma migrate deploy` sorts by;
//   - no two migrations share a timestamp, because two branches that each
//     wrote one never conflict in git and the engine's order then depends on
//     which name sorts first (the same hazard ADR 0042 records for ADR
//     numbers);
//   - every migration directory carries a migration.sql holding at least one
//     statement once SQL comments are stripped, because an empty or
//     comment-only migration.sql applies silently and records itself as
//     applied, which is indistinguishable afterwards from having run;
//   - no other .sql file sits in a migration directory, because the engine
//     reads migration.sql and nothing else, so a second file is SQL somebody
//     wrote that will never run;
//   - a migration.sql that adds an enum value (`ALTER TYPE ... ADD VALUE`)
//     holds that one statement and nothing else, because PostgreSQL 11 and
//     earlier — which the shared host runs — refuse ADD VALUE beside any
//     other statement, while the Postgres CI and local development use
//     accepts it, so only a deploy would find out (ADR 0134). Only
//     top-level statements count: an ADD VALUE inside a dollar-quoted
//     function body runs when the function is called, not when the
//     migration is applied;
//   - migration_lock.toml exists and its provider agrees with the schema's
//     datasource provider, since a mismatch makes the engine refuse the whole
//     history at deploy time. `postgres` and `postgresql` are the same
//     provider spelled two ways — the schema says one, the lock file says the
//     other — so they are normalized rather than compared literally.
//
// What it deliberately does NOT assert, because every one of these needs a
// database and this checker runs in the pre-commit aggregate: that the SQL
// parses, that the history applies cleanly to an empty database, or that
// applying it reproduces the schema. Those are the expensive half, and they
// are asserted by the `Apply Prisma migrations and check schema drift` step
// of the `Test` job in .github/workflows/ci.yml, against that job's
// ephemeral Postgres service. Passing this check is not evidence
// that a migration works; it is evidence that the history is well-formed
// enough for the job that decides whether it works to be able to run it.
//
// Exit 0 = the history is well-formed. Exit 1 = drift, naming each migration
// and what is wrong with it. Exit 2 = the check could not run.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2).filter((arg) => arg !== '--print');
const printOnly = process.argv.includes('--print');

const MIGRATIONS = resolve(args[0] ?? 'apps/backend/src/prisma/migrations');
const SCHEMA = resolve(args[1] ?? 'apps/backend/src/prisma/schema');

const LOCK_FILE = 'migration_lock.toml';
const MIGRATION_SQL = 'migration.sql';

// 20260912115137_youtube_subscription_sync_run_columns — the exact shape
// `prisma migrate dev --name <name>` writes: a 14-digit UTC timestamp, an
// underscore, then lowercase alphanumeric words joined by single underscores.
const MIGRATION_DIR = /^(\d{14})_[a-z0-9]+(?:_[a-z0-9]+)*$/;

const fail = (msg) => {
  console.error(`prisma-migrations: ${msg}`);
  process.exit(2);
};

if (!existsSync(MIGRATIONS)) fail(`${MIGRATIONS} not found`);
if (!existsSync(SCHEMA)) fail(`${SCHEMA} not found`);

/** Strips `-- line` and block comments so a comment-only file reads as empty. */
const stripSqlComments = (sql) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

/**
 * Splits SQL into its statements, ignoring a `;` inside a comment, a quoted
 * string or identifier, or a dollar-quoted body. Returns each statement's
 * text with comments and literal contents removed, so a keyword quoted in a
 * string is not read as SQL either.
 */
function sqlStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
    } else if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i];
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === quote && sql[j + 1] === quote) j += 2;
        else if (sql[j] === quote) break;
        else j += 1;
      }
      current += `${quote}${quote}`;
      i = j + 1;
    } else if (dollar) {
      const end = sql.indexOf(dollar[0], i + dollar[0].length);
      current += '$$';
      i = end === -1 ? sql.length : end + dollar[0].length;
    } else if (sql[i] === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      i += 1;
    } else {
      current += sql[i];
      i += 1;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

const ADD_ENUM_VALUE = /^ALTER\s+TYPE\b[\s\S]*\bADD\s+VALUE\b/i;

/**
 * Prisma spells the same provider two ways: the schema's datasource accepts
 * `postgres` and `postgresql`, while the lock file always records
 * `postgresql`. Comparing the literals would fail on a repository that is
 * perfectly consistent.
 */
const PROVIDER_ALIASES = new Map([['postgres', 'postgresql']]);
const normalizeProvider = (provider) =>
  PROVIDER_ALIASES.get(provider) ?? provider;

/** Reads `provider = "x"` out of the lock file, ignoring its comment header. */
function readLockProvider(path) {
  const match = /^\s*provider\s*=\s*"([^"]+)"/m.exec(
    readFileSync(path, 'utf8'),
  );
  return match?.[1] ?? null;
}

/** Reads the `provider` of the first `datasource` block across the schema. */
function readSchemaProvider(dir) {
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.prisma')) continue;
    const source = readFileSync(join(dir, name), 'utf8');
    const block = /datasource\s+\w+\s*\{([\s\S]*?)\}/.exec(source);
    if (!block) continue;
    const provider = /^\s*provider\s*=\s*"([^"]+)"/m.exec(block[1]);
    if (provider) return { provider: provider[1], file: join(dir, name) };
  }
  return null;
}

const problems = [];
const migrations = [];
const byTimestamp = new Map();

for (const entry of readdirSync(MIGRATIONS, { withFileTypes: true }).sort(
  (a, b) => a.name.localeCompare(b.name),
)) {
  if (entry.name === LOCK_FILE) continue;

  const path = join(MIGRATIONS, entry.name);

  if (!entry.isDirectory()) {
    problems.push(
      `${path}\n    is a file, but the migrations directory holds only ${LOCK_FILE} and migration directories`,
    );
    continue;
  }

  const match = MIGRATION_DIR.exec(entry.name);
  if (!match) {
    problems.push(
      `${path}\n    name is not <14-digit timestamp>_<lowercase_snake_slug>, so the engine cannot order it`,
    );
    continue;
  }

  const [, timestamp] = match;
  if (!byTimestamp.has(timestamp)) byTimestamp.set(timestamp, []);
  byTimestamp.get(timestamp).push(entry.name);

  const sqlPath = join(path, MIGRATION_SQL);
  if (!existsSync(sqlPath) || !statSync(sqlPath).isFile()) {
    problems.push(
      `${path}\n    carries no ${MIGRATION_SQL}, so the engine has nothing to apply for it`,
    );
    continue;
  }

  const sql = readFileSync(sqlPath, 'utf8');
  if (!stripSqlComments(sql).trim()) {
    problems.push(
      `${sqlPath}\n    holds no statement once SQL comments are stripped; it would record itself as applied having done nothing`,
    );
  }

  const statements = sqlStatements(sql);
  const addsEnumValue = statements.filter((s) => ADD_ENUM_VALUE.test(s));
  if (addsEnumValue.length && statements.length > 1) {
    problems.push(
      `${sqlPath}\n    adds an enum value (ALTER TYPE ... ADD VALUE) in a migration of ${statements.length} statements; PostgreSQL 11 and earlier, which the shared host runs, refuse ADD VALUE beside any other statement, so give each enum value a migration of its own (ADR 0134)`,
    );
  }

  const straySql = readdirSync(path).filter(
    (name) => name.endsWith('.sql') && name !== MIGRATION_SQL,
  );
  for (const stray of straySql.sort()) {
    problems.push(
      `${join(path, stray)}\n    is SQL the engine never reads; it applies ${MIGRATION_SQL} and nothing else`,
    );
  }

  migrations.push({ name: entry.name, timestamp, sqlPath });
}

for (const [timestamp, names] of [...byTimestamp.entries()].sort()) {
  if (names.length < 2) continue;
  problems.push(
    `${timestamp}\n    is the timestamp of ${names.length} migrations (${names.join(
      ', ',
    )}); two branches that each wrote one never conflict in git, and the order the engine applies them in is then whichever name sorts first`,
  );
}

const lockPath = join(MIGRATIONS, LOCK_FILE);
const schemaDatasource = readSchemaProvider(SCHEMA);

if (!schemaDatasource) {
  fail(`no datasource block with a provider found in ${SCHEMA}`);
}

if (!existsSync(lockPath)) {
  problems.push(
    `${lockPath}\n    is missing; the engine records the provider a history was written for here and refuses a history without it`,
  );
} else {
  const lockProvider = readLockProvider(lockPath);
  if (!lockProvider) {
    problems.push(`${lockPath}\n    carries no provider line`);
  } else if (
    normalizeProvider(lockProvider) !==
    normalizeProvider(schemaDatasource.provider)
  ) {
    problems.push(
      `${lockPath}\n    records provider "${lockProvider}", but ${schemaDatasource.file} declares "${schemaDatasource.provider}"; the engine refuses the whole history on a mismatch`,
    );
  }
}

if (printOnly) {
  console.log(`prisma-migrations: ${MIGRATIONS}`);
  for (const migration of migrations) console.log(`  ${migration.name}`);
  console.log(
    `  ${LOCK_FILE}: ${existsSync(lockPath) ? readLockProvider(lockPath) : '(missing)'}`,
  );
  console.log(
    `  schema datasource: ${schemaDatasource.provider} (${schemaDatasource.file})`,
  );
}

if (problems.length) {
  console.error(
    'prisma-migrations: the migration history is not well-formed (ADR 0094)\n',
  );
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    '\nThis check reads files only. Whether the SQL applies and reproduces the' +
      "\nschema is asserted by CI's `Apply Prisma migrations and check schema" +
      '\ndrift` step against an ephemeral Postgres, which cannot run until the' +
      '\nhistory is well-formed.',
  );
  process.exit(1);
}

if (!migrations.length) {
  fail(`no migration directories found in ${MIGRATIONS}`);
}

console.log(
  `prisma-migrations: ${migrations.length} migration(s) well-formed, ` +
    `provider "${normalizeProvider(schemaDatasource.provider)}" agrees with ${LOCK_FILE}`,
);
