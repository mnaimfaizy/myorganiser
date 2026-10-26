# Gates assert facts; they never require a file to be touched

Issue #438 was filed after release v0.4.0 shipped the focused YouTube experience with nine new production environment variables and a cron wiring requirement, none of which reached `docs/deployment/CPANEL_STAGING_DEPLOYMENT_PLAN_MYORGANISER.md` (since renamed [`CPANEL_BACKEND_HOSTING.md`](../deployment/CPANEL_BACKEND_HOSTING.md), #437). Following that deployment doc exactly produced an API that could neither authenticate cron nor send mail. The issue proposed the obvious fix: detect when a backend or frontend surface changes and fail the commit unless documentation changed too.

That is a different kind of gate from anything this repo has. `check-readme.ts`, `check-libs-markdown.ts`, `check-skill-map.ts`, `check-docs-notes.ts`, `check-openapi-artifacts.ts`, `check-lint-coverage.ts`, `check-vault-pages.ts`, and `check-auth-pages.ts` all compare two artifacts and fail on a factual mismatch. Not one of them says "you touched X, therefore touch Y."

## Decision

A gate in this repo is an **Assertion Gate** (`CONTEXT.md`): it compares two artifacts and fails on a factual mismatch, naming the specific fact that is wrong. It never fails on the shape of a diff.

A gate is never satisfied by editing a file. `check-vault-pages.ts` does not ask whether the vault page changed; it asserts that thirty specific claims still match the source constants. That is the shape.

The incident that motivated #438 is assertable under this rule and needs no coupling: the backend reads `YOUTUBE_CRON_SECRET`, so `.env.example` must declare it, and a deployment doc that declares an env var absent from `.env.example` is wrong. Both are factual comparisons.

**Corollary: a gate that runs nowhere asserts nothing.** If gates are the mechanism, then a checker not invoked by any pipeline is a bug of the same class as a checker that is wrong. `yarn readme:check` had no reference outside `package.json` while `AGENTS.md` mandated running it by hand; `yarn openapi:artifacts` — written after issue #408, where a gate went green having deleted the entire generated API client — was never invoked either, because CI ran only its `:test` contracts. Nine `check-*.mjs` scripts were unwired when #438 was designed, and `agents:map:check` was failing on `main` with nobody watching. A **Wired Gate** (`CONTEXT.md`) is one some pipeline actually invokes, and `gates:coverage:check` asserts that every checker is one.

## Considered Options

- **The coupling gate as filed** — rejected. It is satisfied by adding a comma. An author who knows the failure is wrong needs an escape hatch, which #438 anticipated by asking whether one should exist; the need for the hatch is the diagnosis, not a detail. And the coverage it appears to buy is illusory: coupling proves that _a_ file under `docs/` moved, never that the _right sentence_ did. A gate people learn to bypass teaches them to bypass gates.
- **Assertion where possible, coupling as a backstop** — rejected for the same reason, plus a worse one: mixing them means some failures are always true and others are usually noise, and a reader cannot tell which kind they are looking at without reading the checker. Uniformly trustworthy failures are worth more than nominal coverage.
- **Detect unwired gates by script-name convention (`*:check`)** — rejected. `openapi:artifacts` and `component:hygiene` carry no `:check` suffix, so the convention would have missed the very script that prompted the rule. `check-lint-coverage.ts` exists because `nx affected -t lint` selected on a target _name_ and a renamed target went unlinted for months; repeating that mistake one layer up would be hard to defend. Detection is by `tools/scripts/check-*.mjs`, which is what a checker _is_.
- **Require deployment docs to mark their env list with delimiters** — rejected. A doc that forgets the marker passes by being invisible, which is the `lint:coverage` failure mode again. Bare `KEY=value` lines inside fenced blocks are already how both cPanel docs are written, so the check reads what exists rather than asking authors to annotate it.
- **Assert env vars in both directions** — rejected. `.env.example` legitimately carries frontend and docker-compose keys the backend never reads, and a deployment doc legitimately omits variables that belong to a different host. Only the missing-declaration direction broke a deploy, so only that direction fails.

## Consequences

- **Prose drift is not caught, and this ADR does not pretend otherwise.** "Here is how the cron is wired" is unassertable. Review is the only defence, exactly as ADR 0041 concedes for note placement. Coupling would not have caught it either.
- Backend controllers, Prisma schema, frontend routes, and new top-level libs leave #438's scope. The last two are already asserted by `check-readme.ts`; the first two have no doc making a machine-comparable claim about them, and inventing one to justify a gate is the coupling gate wearing a disguise.
- `.env.example` becomes the single source of truth for the environment surface, with one-way subset assertions from backend reads and from deployment-doc env lists. The direction is recorded in the checker's header, not here.
- Every `check-*.mjs` must be wired or carry a written reason in the `gates:coverage:check` opt-out list. An opt-out becomes a decision someone made rather than a gap nobody saw.
- Wiring by exact script name is required. During the design of #438 a substring match on `yarn openapi:artifacts` matched `openapi:artifacts:test` and reported the unwired check as wired — the false pass this rule exists to prevent, reproduced while writing the rule.
- `.husky/pre-commit` invokes one aggregate runner rather than one line per checker: each `corepack yarn` invocation costs roughly 1.3s of overhead against roughly 350ms of work, so six separate lines would add about ten seconds to every commit to do two seconds of checking. The per-check scripts remain, for isolated runs and for readable CI steps. `gates:coverage:check` therefore resolves one level of indirection through the aggregate's manifest, and a checker reached that way counts as wired.
- Gates needing the Nx graph, Java, or a build stay CI-only. `check-lint-coverage.ts` takes 19s against roughly 350ms for the file-reading checkers, and that gap — not habit — is what splits Husky from CI.
