# Backend Agent Guide

## Scope

Express REST API with TypeScript, TSOA, Prisma, Passport, JWT auth, email, vault, and YouTube integration code.

## Commands

- Serve: `yarn start:backend` or `yarn nx serve backend`.
- Test: `yarn nx test backend`.
- Lint: `yarn nx lint backend`.
- Build: `yarn build:backend`.
- Prisma: run from `apps/backend/src` with `npx prisma ...` or use Nx targets `backend:generate-types` and `backend:migrate`.

## Do

- Use TSOA controllers, service classes, Prisma, and Zod/class-validator-style boundary validation.
- Run `yarn openapi:sync` after endpoint or DTO changes.
- Keep auth cookies, JWT refresh flow, CORS credentials, and rate limits aligned with docs.
- Store vault blobs and exports as ciphertext plus metadata only.

## Do Not

- Do not expose internal errors or secrets in responses.
- Do not construct raw SQL with string concatenation.
- Do not add plaintext storage for vault-backed data.
- Do not hand-edit generated DDL in a Prisma migration, and never edit a
  migration that has already been applied — Prisma checksums them, so an edit
  surfaces as drift.
- Data-only migrations (backfills) are the exception and are permitted. Prisma
  emits no data statements, so the only route is `--create-only` plus
  hand-written SQL. Put those in their own clearly-named migration, never
  appended to a DDL one.
- A migration that adds an enum value (`ALTER TYPE ... ADD VALUE`) holds that
  one statement and nothing else: the shared host's PostgreSQL 11 refuses it
  beside any other statement. When Prisma generates a combined one, split it
  with `--create-only`, one value per migration. `yarn prisma:migrations:check`
  fails a combined one. See
  [ADR 0134](../../docs/adr/0134-an-enum-value-is-added-in-a-migration-of-its-own.md).
