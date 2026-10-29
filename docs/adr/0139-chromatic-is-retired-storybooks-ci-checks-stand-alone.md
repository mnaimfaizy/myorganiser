# Chromatic is retired; Storybook's CI checks stand alone

## Status

accepted

## Context

[ADR 0027](0027-chromatic-ci-visual-tests.md) connected this repo's Storybook (UI Primitives +
Vault UI Components) to Chromatic cloud, with Chromatic's **UI Tests** status meant as the review
gate, scoped to the free plan's 5,000 billed snapshots/month with TurboSnap. That plan was sized against
usage at the time, but the monthly cap (CLI exit `11`, `ACCOUNT_QUOTA_REACHED`) now reaches before
the billing cycle resets often enough that the gate gives no reliable baseline: once the cap hits,
the `chromatic` job in `.github/workflows/ci.yml` warns and exits green by design — ADR 0027's own
tradeoff, so a quota pause does not freeze the rest of CI — which means visual review simply stops
happening for the remainder of that month, repeatedly. A paid Chromatic plan is not wanted.

## Decision

Chromatic is retired from this repository. Storybook stays, as the component catalogue. No job
publishes to Chromatic, and nothing requires its **UI Tests** status.

The Chromatic job was the only CI step that built Storybook, so a `build-storybook` job ("Build
Storybook") takes over that one check: on every CI run, `yarn build-storybook` must succeed, so a
story that no longer compiles fails CI. It does not run `test-storybook`; play functions run only
locally, as before.

Removed with Chromatic:

- The `chromatic` job ("Publish to Chromatic") in `.github/workflows/ci.yml`.
- `chromatic.config.json`, the `chromatic` npm script, and the `chromatic` devDependency (and its
  `yarn.lock` entries).
- The `.gitignore` entries for its local artifacts (`chromatic.log`, `chromatic-build-*.xml`,
  `chromatic-diagnostics.json`).
- Its entry in `tools/config/review-tier-paths.json`.
- The `--stats-json` and `--skip-nx-cache` flags on the `build-storybook` script. TurboSnap needed
  the stats file, and Chromatic built into `os.tmpdir()`, which Nx cannot cache.

`parameters.chromatic` is removed from every story that carried it. Where a viewport parameter
documented real intent, it is kept using Storybook's own `parameters.viewport` — every story that
carried `parameters.chromatic` already set `parameters.viewport` alongside it, so nothing is lost.

No replacement visual-regression tool is chosen here. That choice, if wanted, is a separate
decision.

## Consequences

- **UI Tests** was never added to the required checks of `main`'s ruleset (checked 2026-10-29), so
  merging needs no settings change. A person deletes the `CHROMATIC_PROJECT_TOKEN` repository
  secret and archives or deletes the Chromatic project; neither is reachable from inside the
  repository.
- [ADR 0027](0027-chromatic-ci-visual-tests.md) is superseded by this ADR; its setup and quota
  detail describe a tool no longer wired into CI.
- [docs/research/2026-08-18-chromatic-free-tier-ci.md](../research/2026-08-18-chromatic-free-tier-ci.md)
  is dated research, frozen as of 2026-08-18, and stays as a historical record of the free-tier
  math that motivated the original decision — it is not updated to describe the retirement.
- `docs/storybook/README.md`, `docs/deployment/CI_CD_AND_RELEASE_PROCESS.md`,
  `docs/ui/STORYBOOK-PATTERNS.md`, the root `README.md` docs index, and the
  `storybook-delegation-workflow` Skill no longer describe a Chromatic gate.
- Storybook authoring keeps using `parameters.viewport` to document an intentionally phone- or
  desktop-only story; nothing replaces the role `parameters.chromatic` played.
- Issue: [#1372](https://github.com/mnaimfaizy/myorganiser/issues/1372).
