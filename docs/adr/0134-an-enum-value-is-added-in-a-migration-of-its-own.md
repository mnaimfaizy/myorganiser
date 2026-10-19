# An enum value is added in a migration of its own

A Prisma migration that runs `ALTER TYPE ... ADD VALUE` holds that one statement and nothing else. `yarn prisma:migrations:check` fails any migration that adds an enum value beside another statement.

## Status

accepted

## Context

On 2026-10-19 a Host Apply on staging stopped at `20261014064934_add_youtube_access` with PostgreSQL error 25001: "ALTER TYPE ... ADD cannot be executed from a function or multi-command string". That migration added two `AdminAuditAction` values and two `User` columns in one file, and `20261017140000_add_feedback_admin_audit_actions` added four values in one file. Production had applied neither yet, so its next release would have stopped at the same place.

The shared host runs PostgreSQL 11 or earlier, which refuses `ADD VALUE` beside any other statement. PostgreSQL 12 lifted that limit, and CI's `postgres:16` service and local development's PostgreSQL 18 both accept the combined form. The drift check in CI ([ADR 0094](0094-a-prisma-migration-is-gated-on-the-tree-and-against-a-database.md)) therefore passed, and only a deploy could find out. `prisma migrate dev` writes the combined form by default and warns only in a comment at the top of the generated SQL, which nobody is made to read.

## Decision

- **One enum value per migration, alone.** A migration that adds an enum value holds only that statement. Any table change made for the same feature goes in a migration of its own beside it.
- **The checker asserts it from the tree.** `check-prisma-migrations.mjs` splits each `migration.sql` into statements, ignoring a `;` inside a comment, a quoted string or a dollar-quoted body. It fails any migration with an `ALTER TYPE ... ADD VALUE` statement and more than one statement. This needs no database, so it runs in the pre-commit aggregate with ADR 0094's other tier-1 assertions.
- **The two broken migrations were split in place.** Each now keeps its first enum value. The remaining values and the `User` columns moved to new migrations with timestamps right after the original (`…064935`, `…064936`, `…140001`–`…140003`). Every statement uses `IF NOT EXISTS`, so a database that already ran the combined form applies the new migrations as no-ops. Only local development databases had run them: production's last release predates both, and staging stopped on the first.

## Considered Options

- **Upgrade the host's PostgreSQL.** Rejected as the fix: the shared host's version is not ours to choose, and the rule costs nothing to follow on any version.
- **Run CI's migration job against PostgreSQL 11 as well.** Rejected as the gate: it is a second database service for one rule that the tree already shows. It would also catch only what the job happens to apply, not a migration on a branch that has not reached it.
- **Leave the applied migrations alone and add corrective migrations after them.** Not possible: a migration that fails on the host cannot be followed. The engine stops at the first failure, so the broken file itself had to change.

## Consequences

- `apps/backend/AGENTS.md`'s rule against editing an applied migration has a recorded exception here: these two had never been applied on staging or production. A local development database that ran the old form keeps working; `prisma migrate dev` may report the two edited migrations as modified, which a local reset clears.
- Staging's `_prisma_migrations` table holds a failed row for `20261014064934_add_youtube_access`. It has to be marked rolled back (`prisma migrate resolve --rolled-back`) before the next Host Apply can run. The failed statement was rolled back with its implicit transaction, so nothing from it was applied.
- A new enum value needs its own `--create-only` migration when Prisma generates a combined one. The checker names the file to split.
