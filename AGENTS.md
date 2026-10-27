# MyOrganiser Agent Guide

## Scope

Nx monorepo for a full-stack organizer app: Next.js frontend, Express/Prisma backend, shared TypeScript libraries, and Playwright e2e tests. Nested AGENTS.md files add local rules for apps and libraries.

## Reference documents

This guide holds the always-needed rules. Open these when the trigger applies:

- [Command reference](docs/agents/command-reference.md) — a task names a gate, or needs a command not under Commands below.
- [Repository conventions](docs/agents/repository-conventions.md) — before adding a file under `docs/`, committing a design, writing an ADR, or adding a `check-*.ts`.

<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->

## Next.js (this pin)

Current `next` version lives in `TECH_STACK.md`. Do not claim that Next.js auto-updates the marked block — at this pin the pointer is manual.

- This app has no `proxy.ts` or Next.js `middleware.ts`. Do not add one unless the ticket **explicitly** asks for Next.js request interception. See [ADR 0019](docs/adr/0019-nextjs-proxy-is-not-a-session-layer.md).
- If interception is required, the only live convention is `proxy.ts` (Node.js runtime only). Do not create `middleware.ts`, including the deprecated Edge hatch.
- Prefer `next.config` `redirects` / `rewrites` for static routing. Proxy is a last resort.
- Always `await` `cookies()`, `headers()`, `draftMode()`, `params`, and `searchParams`.
- Do not suggest `next lint`. Lint with Nx/ESLint (`yarn nx lint <project>` or `yarn lint`).
- Express middleware in `apps/backend/src/middleware/` is unrelated. Do not rename it to proxy.

## React Native

React Native ships no bundled documentation — verify an export against the installed package rather than from memory.

- Import only from the `react-native` package root, never a `react-native/...` subpath; `yarn mobile-platform:check` enforces this over `apps/mobile` and `libs/mobile`.
- Native mobile code reaches a shared library through its Portable Entry Point (`@myorganiser/auth/portable`, `@myorganiser/vault-core/portable`), never its main entry point: `typeof window` guards do not protect native, because React Native sets `global.window = global`. See [ADR 0103](docs/adr/0103-mobile-native-code-is-typechecked-without-dom-and-reaches-shared-libraries-through-a-portable-entry-point.md).
- No non-spec mobile program has Node types, so `process`, `Buffer`, and a global `crypto` do not compile. Import a missing name from a package that provides it; only for a global Hermes itself provides, declare it in `libs/mobile/native-globals.d.ts` (created with its first entry). Never restore `types: ["node"]` or add `dom` to make a name resolve. See [ADR 0120](docs/adr/0120-a-mobile-program-gets-node-types-only-if-it-runs-on-node.md).
- `targetSdk 36` means Android enforces edge-to-edge: every screen root must come from `react-native-safe-area-context`, not a manual status-bar inset.
- Reach the mobile theme through `useTheme()` inside a `ThemeProvider`, never as a module-level constant. Colours come from the Semantic Roles the theme exposes, and text size from a Type Scale step used whole.
- Style mobile components with `StyleSheet.create` over the token theme, never with a browser API or an inline object standing in for a stylesheet. Merging a `styles` reference with a small inline override for a per-render value — `style={[styles.header, { marginBottom: theme.spacing.md }]}` — stays fine. See [ADR 0008](docs/adr/0008-mobile-styling-stylesheet-theme.md).

## Setup

- Use Node and Corepack-managed Yarn.
- Install with `corepack yarn install --immutable`.
- Start local services with `docker-compose up -d`.
- Start apps with `yarn start:backend` and `yarn start:web`.

## Cursor Cloud specific instructions

The Cloud Agent VM has **no Docker**; `.cursor/install.sh` and `.cursor/start.sh` replace `docker-compose up -d` with native services.

- If a service is down, re-run `bash .cursor/start.sh` (idempotent; it does not reinstall dependencies). It starts PostgreSQL on **5453** and MailHog (**SMTP 1453 / UI 8453**), applies Prisma migrations, and seeds the QA Accounts.
- The backend serves on `:3000` and the frontend on `:4200`, pinned on the Nx `dev` target in `apps/web/project.json`.
- Verify email flows via MailHog at `http://localhost:8453`. Login and refresh require a verified email: register → read the verification email → verify → login. To skip that, use a QA Account: `yarn qa:accounts` prints the values.
- `next dev` rewrites `apps/web/AGENTS.md` (its `nextjs-agent-rules` block); do not commit that incidental change unless it is the point of your work.

## Commands

- Build: `yarn build:backend`, `yarn build:web`.
- Test one Jest project: `yarn nx test <project-name>`.
- E2E: `yarn nx e2e web-e2e`.
- Lint: `yarn nx lint <project-name>` or `yarn lint`.
- Format: `yarn format:write` rewrites uncommitted files. `yarn format:check --all` fails when Prettier would change any file in the tree; without `--all`, Nx checks only the files changed since `main`.
- A `git commit` runs `.husky/pre-commit` only when Husky is installed (`postinstall` sets `core.hooksPath`). Without `node_modules` the commit succeeds with no checker run, so that success is not evidence. CI runs `yarn format:check --all`.
- AI commit: `corepack yarn ai:commit --message-file <path>`.
- AI PR: draft with the `PrAuthor` sub-agent, then `corepack yarn ai:create-pr --title <text> --body-file <path> --merge-base <sha> [--label <name>] [--reviewer <login>]`. See [the create-pull-request-workflow Skill](.agents/skills/create-pull-request-workflow/SKILL.md).
- API sync after backend contract changes: `yarn openapi:sync`; check drift with `yarn openapi:check`.
- Prisma (backend): prefer Nx targets `yarn nx run backend:migrate` and `yarn nx run backend:generate-types`.
- Prisma (manual): run from `apps/backend/src` and pass schema path, e.g. `npx prisma migrate dev --schema prisma/schema --name <migration_name>` and `npx prisma generate --schema prisma/schema`.
- Assertion gates aggregate: `yarn gates:run` (runs the file-reading checkers plus OpenAPI artifacts, ADR numbering, and the wired-gate check in one Node process). See [ADR 0043](docs/adr/0043-gates-assert-facts.md).
- Every other command — each `*:check` gate, `*:measure` report, and `*:test` suite, plus release, sub-agent sync, and QA Accounts — is documented once in [the command reference](docs/agents/command-reference.md). Open it when a task names a gate or needs a command not listed here, and add a new command there, not here.

## Architecture

- Keep `apps/web/src/app/**` as thin Next.js route wrappers.
- Put page logic in `libs/web/pages/<route>` and shared code in `libs/**`.
- After adding or removing an app, a top-level lib, or a `/dashboard/*` route, update `README.md` and run `yarn readme:check`. Keep the README a front door: versions live in `TECH_STACK.md`, scripts in `package.json`, env vars in `.env.example` — link, do not restate.
- Use path aliases from `tsconfig.base.json`.
- Vault-backed features are end-to-end encrypted; the server stores ciphertext only.
- Treat `libs/app-api-client` and API specs as generated/synced outputs.

## Design Tokens

- The design reference lives in `libs/design-tokens/DESIGN.md`; use it together with `libs/design-tokens/src/tokens.json` when changing colors, typography, spacing, radii, or shadows.
- `libs/design-tokens/src/tokens.json` is the single source of truth for design values; do not hard-code hex colors, font stacks, or magic spacing values in components when a token should exist. Prefer importing token constants from `@myorganiser/design-tokens`.
- `DESIGN.md` is brand rationale, not a second palette. Update it when a semantic role or brand rule changes, not when a hex or spacing step moves. See ADR 0023.
- After editing tokens, regenerate with `yarn nx run design-tokens:build-tokens`; never edit files under `libs/design-tokens/src/generated/` directly.

## Do

- Follow existing TypeScript, Tailwind, Jest, and Nx patterns.
- Use React Hook Form + Zod for new forms.
- Use the generated API client when it covers the endpoint.
- Add or update focused tests for changed behavior.
- Keep docs concise and link to existing docs when possible.
- Before adding a file under `docs/`, committing a design, writing an ADR, or adding a `check-*.ts`, read [the repository conventions](docs/agents/repository-conventions.md): where notes live (short-lived working files go in `tmp/`, gitignored and never committed), how an approved design is committed, how an ADR is numbered and authored `accepted`, and what a checker header declares.
- Standards live in the documents indexed by [`CODING_STANDARDS.md`](CODING_STANDARDS.md). Add a rule to its source document and link, rather than restating it in the index.
- `CONTEXT.md` is the domain glossary — read it before changing domain language, and sharpen or extend a term it already carries instead of redefining it. A new term touching encrypted data must say whether it means plaintext (client-only) or ciphertext (server-storable).
- Code fanning out over a domain enum reaches one `as const satisfies Record<EnumType, …>` table; it does not re-enumerate the members in an object literal, an if-chain, or a list of `if` statements. `yarn enum:fanout:check` enforces it for guarded enums ([ADR 0053](docs/adr/0053-a-fan-out-over-a-domain-enum-is-pinned-at-its-call-site.md)).
- Before issuing 3 or more consecutive read/search operations to locate something in the codebase, stop and delegate to `CodeExplorer` (`.github/agents/explore.agent.md`) with an Explore Request: a `Goal` sentence, optionally `Known Locations`, `Search Hints`, `Supplied Evidence` (output of a command you ran for it — it has no shell), `Depth` (`quick` or `thorough`), `Out of Scope`, and `Expected Output`.
- Keep `.github/agents` as the canonical Sub-agent body source. Keep `CodeExplorer` in `.cursor/agents/explore.md` on `model: composer-2.5`.

## Workflows

Named workflows live in `.agents/skills/`. Load the Skill; do not copy its steps here. The lines below are **choosers** (which Skill to load), not procedures.

- When committing: `.agents/skills/commit-change-workflow/SKILL.md`
- When opening a PR: `.agents/skills/create-pull-request-workflow/SKILL.md`
- Ad-hoc GitHub issue (bug, task, or follow-up that is **not** a PRD): `.agents/skills/github-issue-creation-workflow/SKILL.md`
- Planned feature, spec, or grill outcome published as a **PRD Issue**: `.agents/skills/to-prd/SKILL.md` — do not use IssueCreator
- Break a PRD Issue into slices: `.agents/skills/to-issues/SKILL.md`
- Existing issue or external PR (state machine, not create): `.agents/skills/triage/SKILL.md`
- Jest tests: `.agents/skills/unit-test-delegation-workflow/SKILL.md`
- Playwright E2E: `.agents/skills/playwright-e2e-workflow/SKILL.md`
- Storybook: `.agents/skills/storybook-delegation-workflow/SKILL.md`
- UI components: `.agents/skills/component-builder/SKILL.md`
- API contracts: `.agents/skills/backend-api-contract-change/SKILL.md`
- Implement agreed work: `.agents/skills/implement/SKILL.md`
- Code review: `.agents/skills/code-review/SKILL.md`
- QA plan for finished work before its PR merges (PRD Issue, or a single issue) — compose or execute: `.agents/skills/qa-plan/SKILL.md`
- TDD: `.agents/skills/tdd/SKILL.md`
- Release: `.agents/skills/release-and-deploy-workflow/SKILL.md`
- Design / grilling session: `.agents/skills/grill-with-docs/SKILL.md` — filing that plan as tracked work is `to-prd`, not IssueCreator
- Brief a diagram or explainer page: `.agents/skills/design-brief/SKILL.md` — the brief goes to `Designer`, never to a general-purpose agent
- Upstream instruction audit: `.agents/skills/upstream-brief/SKILL.md`
- Domain model writes: `.agents/skills/domain-modeling/SKILL.md`
- Architecture review: `.agents/skills/improve-codebase-architecture/SKILL.md`
- Sub-agent add/remove/edit: `.agents/skills/sub-agent-sync-workflow/SKILL.md`

## Branch naming

Format: `<type>/<issue-number>-<short-slug>`. The issue number comes **first**, right after the
type. Omit the number only when there is no issue.

```
fix/292-graphify-extraction-gaps
feat/304-sandcastle-repo-wide-sweep
docs/287-component-agent-guardrails
chore/280-agent-model-governance
```

Pick the type from what the work _does_, not from the file it touches. Map issue labels — **first match wins, top to bottom**:

| Issue label                              | Type     |
| ---------------------------------------- | -------- |
| `bug`, `security`                        | `fix/`   |
| `enhancement`                            | `feat/`  |
| `documentation`                          | `docs/`  |
| `tooling`, `maintenance`, `dependencies` | `chore/` |
| `research`                               | `docs/`  |
| CI/workflow changes only                 | `ci/`    |
| _no label matches_                       | `chore/` |

`research` ranks last on purpose: an issue labelled `tooling` + `maintenance` + `research` is a chore, not documentation.

`qa` and `grilling` are Issue Orchestration Labels, not Surface Labels ([ADR 0049](docs/adr/0049-qa-and-grilling-are-orchestration-labels.md)): they never pick a branch type and never appear on a Pull Request. `qa` marks a **QA Plan Issue** and nothing else; `grilling` marks an issue whose design must be stress-tested before work starts.

Slugs are lowercase, hyphen-separated, and short (~40 chars).

Kind and area **Surface Labels** live in `tools/config/github-labels.json` ([ADR 0025](docs/adr/0025-pr-surface-labels.md)). Branch type uses **kind only**; area labels (`backend`, `web-app`, …) do not change the prefix. Pull Requests receive Surface Labels only.

Reserved prefixes, which do **not** follow the table:

- `release/v<semver>` — release branches (see `docs/deployment/CI_CD_AND_RELEASE_PROCESS.md`).
- `slice/<issue>-<slug>` — sandcastle PRD slices, which fast-forward into a `feat/<prd-slug>` integration branch and close their issue on success. Never create one by hand.
- `claude/…`, `copilot/…`, `cursor/…` — generated by agent tooling. Leave them alone; don't rename to match.

A reserved-prefix branch carries its issue in its **first commit** instead of its name ([ADR 0076](docs/adr/0076-an-agent-branch-carries-its-issue-in-its-first-commit.md)). `yarn dispatch-agents` writes that commit for a `feat/<prd-slug>` integration branch; on a `claude/…`, `copilot/…`, or `cursor/…` branch, **end your first commit's body with `Closes #<issue>`** (or `Refs #<issue>` when the work should not close the issue). A pull request body is **not** a spec source, so a branch with no reference reviews one axis instead of two.

A **fix** also names what introduced its defect, in a commit body on the branch: `Introduced in #<pull request>`, or `Introduced in unknown: <why>` when the archaeology finds nothing. CI enforces it with `yarn fix:attribution:check` ([ADR 0100](docs/adr/0100-a-fix-names-what-introduced-it-in-its-commits.md)).

## ⚠️ Tiered Quality Gates (ADR 0012)

Do not treat every test/component touch as a full multi-agent pipeline. Classify a **gate tier** first ([ADR 0012](docs/adr/0012-tiered-quality-gates.md); checklist Step 0 or slice `gate:*` label). When unsure → promote. Applies to interactive and AFK sessions.

| Tier              | Execution                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `gate:mechanical` | Main agent may edit (fixture/type retarget, rename, dead delete, selector-only E2E) + focused checks |
| `gate:standard`   | Matching specialist hop for the artifact                                                             |
| `gate:full`       | Full mandatory pipelines                                                                             |

### Key Anti-Patterns

❌ Skip specialists on behavioral (`standard`/`full`) test or component work.
❌ Run the full test pipeline for a pure mechanical fixture retarget.
❌ Main agent writes controllers or Prisma schema on `standard`/`full` instead of PrismaWriter / ApiWriter.

### Before You Edit Any File

Use [`.claude/checklist.md`](.claude/checklist.md) Step 0 → file-type matrix. The matrix routes each file pattern (Playwright, Jest, stories, components, API Contract, House Explainer Page, mobile) to its Skill per tier.

## Do Not

- Do not introduce `package-lock.json` or `pnpm-lock.yaml` changes.
- Do not put app-local shared helpers under `apps/web/src/lib/**`.
- Do not store vault plaintext on the server or add plaintext task APIs.
- Do not hand-edit generated API client code.
- Do not commit secrets or production credentials, and do not paste them into chat, logs, or issue bodies. This covers vault plaintext, JWT and session cookies, SMTP credentials, and environment file values. Redact instead — `Authorization: <REDACTED>` and similar. If redacted output is not enough to diagnose a problem, say so and ask rather than pasting the real value.
- Do not run `git commit` directly or `git add .`; use `corepack yarn ai:commit --message-file <path>`.
- Do not cancel, background, or abandon a running `yarn ai:commit` while Husky checks are still executing.
- Do not run `gh pr create` directly; use the AI PR command above. Do not fall back to a title-only PR if `PrAuthor` fails, and do not compute the merge base yourself to satisfy the gate.
- Do not open pull requests from `main` or another base branch directly.
- Do not leave harness-only agent additions/removals unsynchronized. If one agent is added/removed in canonical, propagate to all harnesses via `yarn agents:sync`.
