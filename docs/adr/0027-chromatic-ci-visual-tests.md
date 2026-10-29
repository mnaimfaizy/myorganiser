# Chromatic UI Tests run inside CI, with TurboSnap, on the free plan

> **Superseded by [ADR 0139](0139-chromatic-is-retired-storybooks-ci-checks-stand-alone.md).**
> The free plan's monthly snapshot cap started pausing visual review too often to keep a reliable
> baseline, and a paid plan was not wanted. Chromatic is removed from CI, from the dependency
> tree, and from every story's `parameters`; Storybook stays with its existing checks.

Visual regression for UI Primitives and Vault UI Components was set up locally in #12 and never connected to Chromatic cloud. We **publish** Storybook from a job in `.github/workflows/ci.yml` (after `prepare-dependencies`) so “CI passed” means the upload ran. The visual **review** gate is Chromatic’s own GitHub status **UI Tests**, which stays **pending** until a maintainer Accepts (green) or Denies (red). Accept/Deny updates that check in place and does **not** recapture snapshots. The job calls `yarn chromatic` with repo secret `CHROMATIC_PROJECT_TOKEN`.

Pushes to `main` and `release/**` auto-accept so each line’s baseline moves after merge. TurboSnap (`onlyChanged`) is on in config: affected stories are captured (1 billed snapshot); unchanged stories are copied (0.2). Chromatic unlocks TurboSnap only after **ten successful CI builds**; until then every story is captured (expected on a new project). We stay on Chromatic’s free plan (5,000 billed snapshots/month, Chrome only): no extra browsers, viewports, modes, or Chromatic accessibility snapshots. If that monthly cap is hit, the CLI exits `11`; the publish job **warns and exits green** so a quota pause cannot freeze the rest of `CI`. Missing token, CLI failure, or Chromatic outage still fail the publish job. The Chromatic project, GitHub secret, required **UI Tests** check, and a usage alert (~4,000 billed) are HITL and must exist **before** this job is merged to `main`.

`yarn chromatic` is the CI command, not a local visual-test loop. Chromatic never diffs pixels on a laptop.

## Status

superseded by ADR 0139

## Considered Options

- **Publish-only / baseline on `main` without PR gating** — rejected. Stories without a merge-blocking visual comparison still do not catch pixel changes.
- **Playwright (or similar) screenshots in Actions instead of Chromatic** — rejected. #12 already pointed this repo at Chromatic; the leftover was cloud + CI, not a second visual stack.
- **Separate `chromatic.yml`** — rejected. Staging deploys when `CI` succeeds. A sibling workflow would ship to staging unless `deploy-staging.yml` were rewired.
- **Full capture every run (no TurboSnap)** — rejected for the free plan. This Storybook is 127 stories × 1 viewport × Chrome. At current CI cadence, 5,000 billed snapshots would be exhausted in well under a month.
- **Skip the Chromatic job unless a path glob says “UI changed”** — rejected as the default. TurboSnap already skips recapture for unaffected stories; a homemade skip is how token/CSS/lockfile-adjacent pixel changes get missed. (Storybook today does not import `design-tokens`; `preview-styles.css` is imported from preview and already forces a full TurboSnap rebuild when it changes.)
- **Fail the GitHub Actions job on unreviewed diffs (CLI exit 1)** — rejected. A completed Actions job does not turn green when you Accept in Chromatic. Re-running recaptures snapshots and burns free-tier quota. Chromatic’s **UI Tests** status already goes pending → green/red in place.
- **`--exit-once-uploaded`** — rejected. The publish job should still wait for capture errors (exit 2/3). `--exit-zero-on-changes` is enough so unreviewed diffs do not fail Actions.
- **Soft-pass when the project token is missing** — rejected. The gate could be off for months without anyone noticing. Unset token fails CI; add the secret before the job lands.

## Consequences

- Setup and commands: [docs/storybook/README.md](../storybook/README.md).
- Quota, snapshot math, GitHub sign-in: [docs/research/2026-08-18-chromatic-free-tier-ci.md](../research/2026-08-18-chromatic-free-tier-ci.md).
- Authoring determinism: [docs/ui/STORYBOOK-PATTERNS.md](../ui/STORYBOOK-PATTERNS.md) §10.
- Issue: [#367](https://github.com/mnaimfaizy/myorganiser/issues/367).
- Pass `--exit-zero-on-changes` (and map CLI exit `1` to job success). Do **not** re-run the publish job after Accept. Require Chromatic’s **UI Tests** status in branch protection so merge waits while it is pending. Do **not** use `--exit-once-uploaded`. TurboSnap needs `fetch-depth: 0`. On `pull_request`, check out `pull_request.head.sha` and set `CHROMATIC_SHA` / `CHROMATIC_BRANCH` / `CHROMATIC_SLUG` — TurboSnap is not valid against GitHub’s ephemeral merge commit. Point Chromatic at `libs/web/ui/.storybook` (the glob already includes `web-vault-ui`), and set `storybookBaseDir` to `libs/web/ui` — a **separate** key from `storybookConfigDir`: the config dir is where `main.ts` lives, the base dir is the Vite root that TurboSnap resolves `preview-stats.json` module paths against. Stories outside that root resolve through it (`./../vault-ui/…` → `libs/web/vault-ui/…`), so one base dir covers both libraries. Omitting it does not warn while TurboSnap is still locked; it fails the publish job with exit `254` the first build after Chromatic unlocks TurboSnap. `yarn build-storybook` must pass `--skip-nx-cache`: Chromatic builds into `os.tmpdir()`, and Nx will not cache outputs outside the workspace.
