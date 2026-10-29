# The npm audit runs on `main`, and a failure there is one tracked issue

## Status

accepted

## Context

`Secure Install Review` in `.github/workflows/ci.yml` runs `yarn npm audit --all --recursive --severity high`. The audit queries the live advisory database, so its result depends on the day it runs as well as on the tree it reads.

Two commits narrowed where it runs:

- `b6cd1b60` (2026-05-20) skipped it on pull requests that change no dependency manifest.
- `5e02d893` (#284, 2026-08-09) made that detection content-aware, in `tools/scripts/ci/dependency-manifest-changed.mjs`. Pull request #282 had gone red overnight on an advisory it had nothing to do with. Pushes audit unconditionally.

So a new advisory against a dependency already in the tree surfaces as a red `main`, by design. Nothing said so outside those two commit messages, and nothing announced the failure. `main` failed at the audit step on 15 pushes between 25 and 30 September 2026 and on four more on 1 October. Each was a red check on a merge commit, and each later merge failed the same way. Issue #977 was first filed proposing to audit every pull request, which is the change #284 had deliberately undone.

## Decision

1. **Where the audit runs does not change.** A pull request is audited only when it changes dependencies. A push to `main` or a release branch is always audited. An advisory is a fact about the dependency tree, not about whichever pull request happens to be open when it is published.
2. **A failed audit on a push to `main` opens one issue, or comments on the open one.** `Report Audit Failure` owns the issue titled `[automation] npm audit is failing on main`. It creates it with `needs-triage` and `github-actions`, so it enters the triage queue. The report carries the run link and, for each advisory, the package, the installed versions, the advisory id, the severity and the vulnerable range.
3. **The first green push to `main` records the recovery.** `Report Audit Success` comments on the open issue. It closes the issue when it carries no triage state label and leaves it open when it carries one. That rule is the nightly E2E rot issue's `recoveryAction` ([ADR 0050](0050-e2e-runs-as-a-blocking-chromium-lane-and-a-nightly-rot-detector.md)), imported and not restated.
4. **A recovery is reported once.** `main` takes several pushes a day, and the nightly's shape would comment on a triaged issue at every one of them. Each report carries a marker naming the state it reported. A green push that finds the newest marker already says "recovered" does nothing.
5. **Only a push to `main` reports.** A pull request that fails the audit already shows its author the red check. A `workflow_dispatch` run and a release branch push do not open or resolve the issue.
6. **A failed audit still skips every job after it.** `Prepare Dependency Cache` needs `Secure Install Review`, so nothing is built or tested on `main` while the audit is red. Run 36808069553 shows it: every job after the audit was skipped. That stays. The tracked issue is what makes the stop visible.
7. **The response is a dependency bump.** Bump each reported package past its vulnerable range on a branch and run the `dep-sync` Skill. That pull request is audited, because it changes dependencies.

The decisions live in `tools/scripts/lib/npm-audit-issue.ts`. `yarn npm-audit:issue:test` covers them and asserts the workflow's triggers and permissions.

## Considered Options

- **Audit every pull request.** Rejected: it is what #284 removed. An unrelated pull request would go red on a day's advisory, and its author could not fix it in that pull request.
- **Add a scheduled audit.** Not done. An advisory published on a day with no push blocks nothing until the next push, and that push reports it. A scheduled run can call the same module later if earlier notice is wanted.
- **Let the build and test jobs run after a failed audit.** Rejected: it would report a green build and test run on a tree with a known high-severity advisory.
- **Share one module with the nightly rot issue.** Partly. The audit module imports the nightly module's recovery rule and issue matcher. The title, the report body and the once-only recovery are the audit's own.

## Consequences

- An advisory published while nobody is merging is reported at the next push, not the day it is published.
- Yarn reports a vulnerable range and no patched version. The report carries the range; the first version outside it is the fix.
- While the audit is red, every failing push adds a comment to the issue. The comments stop at the first green push.
- The two report jobs hold `issues: write`. `Secure Install Review`, which installs dependencies, does not.

## Amendment (2026-10-29)

Issue #1390, cut from the "Faster PR CI" PRD (#1387). `Secure Install Review` ran the script-free install and the frozen-lockfile check on every pull request, even one that changed no dependency — paying the prelude's cost on a pull request the audit itself would go on to skip. Item 6's hold-back (a failed audit skips every job after it) is unchanged; what moved is which pull requests pay for the install at all.

- **The dependency-manifest detector now gates the install and the lockfile check, not only the audit.** `Check whether dependency manifests changed` runs before `Install dependency metadata without scripts`, and that step, `Verify frozen lockfile` and `Run Yarn npm audit` now share one `if:`: a push (or any non-pull-request event) runs all three unconditionally; a pull request runs them only when the detector reports a dependency change or the detector itself errors.
- **A detector error still means the full review, not a skip.** The detector's `if ! result=...` branch writes `run_audit=true` on failure, the same flag a real dependency change sets, so an unreadable or crashing detector falls back to running everything rather than skipping it.
- **The pull request explains what it skipped.** `Explain skipped install review` (renamed from `Explain skipped npm audit`) writes to the step summary that the install, the lockfile check and the audit were all skipped, and why.
- **The job stays required and keeps its place in the chain.** `secure-install-review` is unchanged as a job: same `needs`, same outputs, same downstream `report-audit-failure` / `report-audit-success` wiring. Only the ordering and gating of its own steps moved.

`tools/scripts/ci/secure-install-review-workflow.test.ts` pins the ordering, the shared gate, the fail-open branch, and the skipped-review explanation.
