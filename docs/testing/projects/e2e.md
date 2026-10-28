# Testing `apps/web-e2e`

Playwright E2E · `@playwright/test` · `yarn nx e2e web-e2e`

> **Canonical E2E guidance lives in the skill, not here.**
>
> - Workflow, gate routing, and the never-execute-autonomously policy:
>   [`.agents/skills/playwright-e2e-workflow/SKILL.md`](../../../.agents/skills/playwright-e2e-workflow/SKILL.md)
> - Flow matrix, selector rules, validation:
>   [`references/runbook.md`](../../../.agents/skills/playwright-e2e-workflow/references/runbook.md)
> - Code-level patterns and anti-patterns (Radix, vault unlock, CORS, forms, cross-browser):
>   [`references/e2e-patterns.md`](../../../.agents/skills/playwright-e2e-workflow/references/e2e-patterns.md)
>
> This file covers only the tooling facts specific to the Nx project.

## Config summary

```ts
// apps/web-e2e/playwright.config.ts
nxE2EPreset(__filename, { testDir: './src/e2e' })
baseURL: process.env.BASE_URL || `http://localhost:${port}`  // 4200 production, 4201 dev
webServer: { command: 'corepack yarn nx run web:start --port=4200', ... }  // start depends on build
browsers: chromium, firefox, webkit
```

The suite serves a **production build** by default, locally as well as in CI
([ADR 0050](../../adr/0050-e2e-runs-as-a-blocking-chromium-lane-and-a-nightly-rot-detector.md)).
`E2E_DEV_SERVER=1` swaps in `web:dev` for the fast edit-run loop.

The two modes use different ports — 4200 for production, 4201 for the dev loop
— so that reusing a server can only ever reuse one started for the mode asking.
The production path never reuses at all, and fails with `already used` if
something holds 4200.

The production command builds before it serves, and must keep doing so.
`next start` serves whatever `apps/web/.next` already holds — it never
rebuilds — so the command is `nx run web:start`, whose inferred target
depends on `build`; a bare `next start` would let the suite test a stale bundle
and report a missing feature as a failing assertion. Nx caches the build, so it
is a no-op when nothing changed.

## File naming

```
apps/web-e2e/src/e2e/<flow>.spec.ts
```

Use `@playwright/test` (`test`, `expect`) here — **never** Jest. Conversely, never use
`@playwright/test` outside this project.

## Commands

```bash
yarn nx e2e web-e2e                             # headless, Chromium only
yarn nx e2e web-e2e --ui                        # interactive UI mode
yarn nx run web-e2e:e2e-firefox                 # Firefox
yarn nx run web-e2e:e2e-webkit                  # WebKit
yarn nx run web-e2e:e2e-all                     # all three, in sequence
yarn nx e2e web-e2e --grep "<test name>"        # single test by name
```

`e2e` is Chromium-only — the blocking lane's browser. The other browsers are
separate targets, which is what the nightly matrix runs.

## Live logout

`auth-logout-live.spec.ts` is skipped unless `E2E_LIVE_BACKEND=1`. That flag
starts `tools/scripts/e2e-live-backend.ts` (migrate, seed a verified user,
serve the built API on port 3000) beside the frontend. CI runs that spec in the
`e2e-live-logout` job, not in the three hermetic shards. Locally, Postgres must
already match `DATABASE_URL` in `.env`, port
3000 must be free, and the API must already be built:

```bash
yarn build:backend
E2E_LIVE_BACKEND=1 yarn nx e2e web-e2e --grep "logs out against the real backend"
```

Do not commit traces, screenshots, videos, or other generated artifacts.
