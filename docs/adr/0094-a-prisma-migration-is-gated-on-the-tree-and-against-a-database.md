# A Prisma migration is gated on the tree and against a database, and the cheap half says so

Release v0.4.0 shipped with four migrations that were never applied, found only when somebody
ran `prisma migrate status` by hand ([#437](https://github.com/mnaimfaizy/myorganiser/issues/437)).
A later `/code-review` on [#745](https://github.com/mnaimfaizy/myorganiser/pull/745) raised the
same gap from the other end: nothing in `.husky`, `.github/workflows`, or the `gates:run`
manifest read `apps/backend/src/prisma/**` as anything but source to reformat
([#748](https://github.com/mnaimfaizy/myorganiser/issues/748)). The only line touching it was
`.husky/pre-commit`'s `prisma format`, which rewrites the schema and asserts nothing — per
[ADR 0074](0074-a-gate-suppresses-a-finding-only-if-something-runs-it.md) there was not even a
checker to wire.

## Status

accepted

## Decision

A Prisma migration is gated in **two tiers**, because the two questions worth asking about one
have very different costs.

**Tier 1 — the tree.** `yarn prisma:migrations:check`
(`tools/scripts/check-prisma-migrations.ts`) is a file-reading Assertion Gate in the `gates:run`
manifest, so the pre-commit hook and CI both run it. It asserts only what can be read off the
tree: that every entry beside `migration_lock.toml` is a directory named
`<14-digit timestamp>_<lowercase_snake_slug>`, that no two migrations share a timestamp, that
every migration directory carries a `migration.sql` holding at least one statement once SQL
comments are stripped, that no other `.sql` file sits beside it, and that `migration_lock.toml`'s
provider agrees with the schema's datasource (`postgres` and `postgresql` normalized, since the
schema spells it one way and the lock file the other).

**Tier 2 — a database.** The `Test` job in `.github/workflows/ci.yml` runs
`prisma migrate deploy` followed by `prisma migrate diff --from-config-datasource --to-schema
prisma/schema --exit-code` against its ephemeral `postgres:16` service. That is what answers
whether the SQL parses, whether the history applies to an empty database, and whether applying
it reproduces the schema — the drift that #437 is a record of. It stays in CI and out of the
pre-commit aggregate, which is for cheap file-reading checkers ([ADR 0043](0043-gates-assert-facts.md)).

Tier 1 does **not** wait on tier 2 and is not a scaled-down version of it. The timestamp
collision it catches is a real hazard tier 2 cannot see at all: two branches that each write a
migration never conflict in git, so both land, and the order the engine applies them in is then
whichever name happens to sort first — the same shape [ADR 0042](0042-adr-numbers-are-claims-until-merged.md)
records for ADR numbers.

## The cheap half states what it does not assert

Issue #748 named the trap directly: a gate that catches some of this "does risk reading as more
coverage than it provides". [ADR 0085](0085-an-artifact-states-no-claim-it-does-not-assert.md)
already says an artifact states no claim it does not assert, and this is that rule applied to a
gate whose name — `prisma:migrations:check` — promises more than it delivers.

So the checker's header names the omitted direction and why: it does not assert that the SQL
parses, that the history applies, or that it reproduces the schema, because each of those needs
a database. Its failure output repeats it. Passing tier 1 is not evidence that a migration
works; it is evidence that the history is well-formed enough for the job that decides whether it
works to be able to run it.

`prisma validate` is deliberately **not** in tier 1 either, although it needs no database. It
spawns the Prisma CLI, and a gate in the pre-commit aggregate that shells out to a CLI is no
longer a file-reading checker. The `Generate Prisma client` step that runs immediately before tier 2
parses and validates the datamodel to emit the client, and fails on a schema `validate` would
have rejected, so the coverage is not lost — only the seconds are.

## Consequences

- A malformed migration history fails on the Pull Request that wrote it, and on the commit, not
  on the shared host at deploy time.
- Two migrations written on two branches with the same timestamp fail on the second one to
  update against `main`, the same vantage point ADR 0042 relies on: branch protection is strict,
  so a Pull Request cannot merge while behind.
- The findings `/code-review` raises on every Prisma change under
  `obligation-run-the-gate-that-covers-this-change` — acknowledged with `Review-ack:` lines on
  #745 rather than fixed — now have a gate to name.
- Tier 1 carries a contract suite (`yarn prisma:migrations:test`) proving it fails on each drift
  direction its header claims, as ADR 0085 requires, so it is not added to
  `tools/config/checker-contract-baseline.json`.
- This ADR addresses validating migration SQL **before** merge. Applying migrations reliably on
  the host **after** merge is still #437's, and is unaffected.
