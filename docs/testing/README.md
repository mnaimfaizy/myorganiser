# Testing Guide

This document is the canonical **tooling** reference for the MyOrganiser Nx monorepo: which runner,
environment, and mock patterns apply to each project, plus the patterns shared across all of them.

It is deliberately short. Per-project detail lives in [`projects/`](./projects/) — read the index
below plus **only the file for the project you are testing**.

> **Where the rules live**
>
> | Concern                                                    | Source of truth                                                                 |
> | ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
> | How to analyze, scope, write, and validate a test suite    | `.github/agents/test-scaffold.agent.md`                                         |
> | What a reviewer gates on                                   | `.github/agents/test-reviewer.agent.md`                                         |
> | Delegation brief format                                    | `.agents/skills/unit-test-delegation-workflow/references/delegation-runbook.md` |
> | Playwright workflow, patterns, and anti-patterns           | `.agents/skills/playwright-e2e-workflow/`                                       |
> | Per-project tooling, environment, and mocks (**this doc**) | `docs/testing/projects/<project>.md`                                            |
>
> Do not restate agent rules here, and do not restate this doc's tooling facts in agent prompts.

## Project index

| Target                               | Test type                    | Runner                               | Command                          | Guide                                         |
| ------------------------------------ | ---------------------------- | ------------------------------------ | -------------------------------- | --------------------------------------------- |
| `apps/backend`                       | Jest unit/integration        | `ts-jest` + `node` env               | `yarn nx test backend`           | [backend.md](./projects/backend.md)           |
| `apps/web`                           | Jest unit/integration        | `babel-jest` + `jsdom` env           | `yarn nx test web`               | [web.md](./projects/web.md)                   |
| `libs/web/ui`                        | Jest unit/integration        | `babel-jest` + `jsdom` env (React)   | `yarn nx test web-ui`            | [web-ui.md](./projects/web-ui.md)             |
| `libs/auth`                          | Jest unit/integration        | `ts-jest` + `jsdom` env              | `yarn nx test auth`              | [auth.md](./projects/auth.md)                 |
| `libs/core`                          | Jest unit                    | `ts-jest` or `babel-jest`            | `yarn nx test core`              | [core.md](./projects/core.md)                 |
| `libs/email-shell`                   | Jest unit                    | `ts-jest` + `node` env               | `yarn nx test email-shell`       | [email-shell.md](./projects/email-shell.md)   |
| `libs/vault-core`                    | Jest unit/integration        | `babel-jest` + `jsdom` env           | `yarn nx test vault-core`        | [vault-core.md](./projects/vault-core.md)     |
| `libs/web/vault`                     | Jest unit/integration        | `babel-jest` + `jsdom` env (React)   | `yarn nx test web-vault`         | [web-vault.md](./projects/web-vault.md)       |
| `libs/web/vault-ui`                  | Jest unit/integration        | `babel-jest` + `jsdom` env (React)   | `yarn nx test web-vault-ui`      | [web-vault-ui.md](./projects/web-vault-ui.md) |
| `libs/web/pages/*`                   | Jest unit/integration        | `babel-jest` + `jsdom` env (React)   | `yarn nx test <lib-name>`        | [web-pages.md](./projects/web-pages.md)       |
| `apps/web-e2e`                       | Playwright E2E               | `@playwright/test`                   | `yarn nx e2e web-e2e`            | [e2e.md](./projects/e2e.md)                   |
| `libs/mobile/ui`                     | Jest unit + component        | `babel-jest` + `react-native` preset | `yarn nx test mobile-ui`         | [mobile.md](./projects/mobile.md)             |
| `libs/mobile/core`                   | Jest unit (pure logic only)  | `babel-jest` + `node` env            | `yarn nx test mobile-core`       | [mobile.md](./projects/mobile.md)             |
| `libs/mobile/screens`                | Jest unit (pure logic only)  | `babel-jest` + `node` env            | `yarn nx test mobile-screens`    | [mobile.md](./projects/mobile.md)             |
| `libs/mobile/feat/vault`             | Jest unit (pure logic only)  | `babel-jest` + `node` env            | `yarn nx test mobile-feat-vault` | [mobile.md](./projects/mobile.md)             |
| `libs/mobile/feat/auth`              | Jest unit (pure logic only)  | `babel-jest` + `node` env            | `yarn nx test mobile-feat-auth`  | [mobile.md](./projects/mobile.md)             |
| `apps/mobile`, other `libs/mobile/*` | Jest — **no spec files yet** | `babel-jest` + `react-native` preset | `yarn nx test mobile`            | [mobile.md](./projects/mobile.md)             |

Use Jest for `*.spec.ts(x)` and `*.test.ts(x)` **outside** `apps/web-e2e`.
Use `@playwright/test` **only** under `apps/web-e2e`.

## How to identify the right config

Before writing any test, read the owning project's `jest.config.ts` (or `playwright.config.ts`).
The config determines:

1. **Test environment** (`testEnvironment: 'node'` vs `jsdom`)
2. **Transformer** (`ts-jest` vs `babel-jest`)
3. **Module extensions** (`.ts` only vs `.ts,.tsx,.js,.jsx`)
4. **tsconfig** override path (backend uses `tsconfig.spec.json`)

Detection order:

1. Read `<project>/jest.config.ts` (or `playwright.config.ts`).
2. Fall back to `jest.preset.js` at the repo root.
3. Fall back to `package.json` `scripts` for available targets.

---

## Nx lazy-loading & `jest.mock()` ordering

Nx enforces module boundary rules at **lint time** (before Jest transformation). `jest.mock()`
hoisting only takes effect at **runtime**. This creates a trap that costs more debugging time than
any other issue in this repo:

**Rule: place ALL `jest.mock()` calls before any imports — including `import type`.**

```typescript
// ❌ WRONG — linting flags the static import as a boundary violation
import { randomId } from '@myorganiser/core';
jest.mock('@myorganiser/core');

// ✅ CORRECT — mocks first, then imports
jest.mock('@myorganiser/core', () => ({
  ...jest.requireActual('@myorganiser/core'),
  randomId: jest.fn(),
}));
jest.mock('@myorganiser/web-vault');

import { randomId } from '@myorganiser/core';
import { loadDecryptedData } from '@myorganiser/web-vault';
import { useMyHook } from './useMyHook';
```

Known lazy-loaded libraries (verify against `nx.json` when new libs are added):

- `@myorganiser/core`
- `@myorganiser/auth`
- `@myorganiser/vault-core`

---

## Shared patterns across all projects

### Naming

```ts
describe('MyService', () => {
  describe('methodName', () => {
    it('should <expected outcome> when <condition>', () => { ... });
  });
});
```

### Assertion quality

| Avoid                    | Prefer                                   |
| ------------------------ | ---------------------------------------- |
| `expect(x).toBeTruthy()` | `expect(x).toBe('exact-value')`          |
| Generic snapshots        | Structural assertions on specific fields |
| `toBeDefined()` alone    | `expect(x).toBe(...)` or `toEqual(...)`  |

### Mock state isolation

Mocks retain their `.mockResolvedValue()` / `.mockReturnValue()` implementations across tests
unless explicitly reset. Signs of state leakage:

- A test passes in isolation (`yarn nx test <project> --testNamePattern="My Test"`) but fails when
  run with others.
- Tests pass on a fresh `--clearCache` run but fail on the second run.

`clearAllMocks` and `resetAllMocks` are not interchangeable, and the gap between them is where the
leakage above comes from:

| Call                   | Zeroes recorded calls | Removes an implementation | Drains an unconsumed `…Once` queue |
| ---------------------- | --------------------- | ------------------------- | ---------------------------------- |
| `jest.clearAllMocks()` | yes                   | **no**                    | **no**                             |
| `jest.resetAllMocks()` | yes                   | yes                       | yes                                |

`clearAllMocks` is enough when every test supplies its own implementation before the code under test
reads it — either a fresh default each time, or a `…Once` the test provably consumes:

```typescript
// ✅ clearAllMocks zeroes call counts; the default is re-applied every test
beforeEach(() => {
  jest.clearAllMocks();
  (mockFn as jest.Mock).mockResolvedValue(defaultData);
});
```

Reach for `resetAllMocks` when a stale implementation could outlive the test that set it:

```typescript
// ✅ Nothing can carry over — implementations and …Once queues both go
beforeEach(() => {
  jest.resetAllMocks();
});
```

**The `beforeAll` trap.** A suite that builds its app or module graph once in `beforeAll` holds one
stable mock instance for the whole file, so `clearAllMocks` alone lets an implementation set in one
test reach the next. A suite that rebuilds per test with `jest.resetModules()` gets brand-new
`jest.fn()`s each time and cannot leak — which is why moving construction into `beforeAll` requires
moving to `resetAllMocks` in the same change. The backend HTTP integration suites in
`apps/backend/src/controllers/*.int.test.ts` are the worked example.

A `…Once` value that is queued but never consumed — a test that stubs a service, then takes a 4xx
path that never calls it — survives `clearAllMocks` and is spent by the _next_ test. Assert the call
you queued for, so an unconsumed queue fails loudly instead of drifting.

`resetAllMocks` only touches `jest.fn()`s. Plain functions returned from a `jest.mock` factory are
untouched, so auth stubs written as plain functions keep working across a reset.

Mock the external boundary first. Prefer mocking vault load/save behavior over asserting incidental
ID-generation details, unless IDs are part of the behavior contract.

### Dead code detection during testing

When implementing or reviewing a hook or utility, flag any state or functions that:

- are declared but never returned from the hook;
- are never referenced in any test assertion;
- are never exported or called externally.

These are dead code and must be removed before committing. ESLint's `no-unused-vars` will surface
them — run `yarn nx lint <project> --fix` to confirm.

### Coverage target

Aim for meaningful coverage, not high percentages. Priority order:

1. Error/rejection paths
2. Side effects and collaborator calls
3. Boundary conditions
4. Happy path

### Security baseline (apply when in scope)

- Unauthorized/missing credentials → assert rejection, not silent pass-through.
- Sensitive fields (passwords, tokens, plaintext vault data) → assert never returned in plain text.
- Tampered input (corrupted ciphertext, oversized payloads, invalid schema versions) → assert
  throws, not silent corruption.
- Input sanitization → assert invalid characters/formats are rejected at the boundary.

### Credentials in test fixtures

A pre-tool-use hook (`tools/scripts/copilot-hooks/secret-scan.ts`) blocks tool input that looks
like a committed credential. Its rule is narrow and purely mechanical — a credential keyword,
then `:` or `=`, then a quoted literal of **16 or more** characters:

```
/(?:client[_-]?secret|refresh[_-]?token|access[_-]?token|api[_-]?key|password|passphrase)\s*[:=]\s*['"`][^'"`\n]{16,}['"`]/i
```

Assigning a 28-character phrase to a variable named `passphrase` is therefore blocked, while
`const passphrase = 'vault-pass-a'` passes. Specs written before the hook existed still contain
the long form; they are not a precedent, because the hook only scans tool input and never
re-scans what is already committed.

One exemption exists: the code-review reviewer must quote tracked lines verbatim in its answer
sheet, so a `Write` or `Edit` whose every destination is inside `tmp/code-review/` skips this rule
and only this rule. Every other secret pattern, every shell command, and every other path is
still scanned. It is not a way to land a long fixture in a spec; see
[ADR 0119](../adr/0119-a-reviewers-citation-is-exempt-from-the-quoted-value-secret-pattern-in-its-own-directory.md).

**Keep test passphrases and passwords to 10–15 characters.** `VaultGate` requires at least 10
(`setupPassphrase.length >= 10`), and the hook triggers at 16, so that window satisfies both.
`apps/web-e2e/src/e2e/multi-user-vault.spec.ts` is the worked example.

Do **not** encode a value, rename a variable to dodge the keyword, or move fixture credentials
into env vars or a side-channel script to get past the hook. Those defeat a control rather than
satisfy it, and a scanner that agents route around protects nothing. If a fixture genuinely
cannot be written within the rule, stop and say so rather than improvising.

> Two separate scaffold runs — one Jest, one Playwright — each burned well over 100k tokens
> concluding this hook was unworkable and reaching for base64 and char-code encodings. The rule
> was documented nowhere they read. That is why it is written here. This very section was itself
> blocked on first write, for quoting a long literal as an example; the fix was to describe it
> instead, not to work around the scanner.
