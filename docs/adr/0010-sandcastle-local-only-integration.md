# Sandcastle integration: local-only feature branch, slices integrated by fast-forward (no per-slice PRs)

`dispatch-agents` previously coupled tightly to GitHub for _integration_: it created the
feature branch **on origin**, **pushed** every slice branch, opened a **PR per slice**, ran the
gate against `origin/<slice>`, then **squash-merged** each PR into the feature branch on GitHub.
That is a lot of remote round-trips, a lot of throwaway PRs, and it forced parallel slices to
branch off a frozen base (they never saw each other's work — the whole reason `dispatch-waves`
existed).

We are reducing GitHub's role to the minimum: **read** the PRD + slice issues, and **write**
status labels + a completion comment back to each slice (and **close** each slice once it
integrates). Integration becomes entirely local.

## Decision

- The feature branch `feat/<slug>` is created **locally** from `origin/main` and is **never
  pushed**. It is the integration target for the whole PRD and lives only in the dispatch clone.
- Slices run **one by one**. Each slice branch is cut from the **current local feature head**, so
  a slice sees every previously-integrated slice's work.
- The agent commits locally in its credential-less sandbox. The host then runs the gate against
  the **local** slice branch and, on green, **fast-forwards the local feature branch** onto the
  slice (`git branch -f`). Serial execution guarantees the slice is a pure descendant, so the
  fast-forward never conflicts and adds no merge commit.
- **No per-slice push, no per-slice PR, no `gh pr merge`.**
- On successful integration the orchestrator **closes the slice issue** (reason: completed) in
  addition to labelling it `status:done`. `status:done` + closed makes re-runs idempotent — both
  `main.mts` (open + `type:afk` filter) and `dispatch-waves` (which fetches `--state all` and treats
  a closed slice as done) skip an already-integrated slice. The PRD issue stays open until the
  manual PRD PR merges.
- After the run, the human QAs the local feature branch, then pushes it once and opens **one** PR
  to `main` so CI runs there and the PRD lands as a single review unit.

### Amendment: standalone (no-PRD) dispatch

`dispatch-agents --issue <n>` with no `--prd` runs a single issue that belongs to no PRD. It keeps
every property above and simply has **no integration step**:

- The work branch `issue/<n>-<slug>` is cut from `origin/main` (or `--base <ref>`) and **is** the
  deliverable. There is no `feat/<slug>`, so there is nothing to fast-forward into.
- Naming the issue explicitly is the authorization: no `ready-for-agent` / `type:afk` requirement,
  no `## Blocked by` ordering, no dependent unblocking. Human-oriented labels (`type:hitl`,
  `status:blocked`) warn but do not stop the run.
- The issue is **not** closed and **not** labelled `status:done` — only `status:in-progress` is
  removed, plus a comment naming the branch and gate verdict. Closing would assert completion of
  work that exists only on an unpushed local branch; the PR merge is what completes it.
- Nothing is pushed, so the "safer by default" property below is unchanged.

## Status

accepted. Amended by [0045](0045-a-prd-is-gated-once-on-the-assembled-feature-branch.md): in PRD mode the gate no longer runs per slice and no longer blocks integration. Slices integrate unconditionally and the assembled feature branch is gated once, against `origin/main`. Standalone runs keep the fail-closed per-slice gate described here. Amended by [0146](0146-a-prd-integration-branch-may-be-pushed-for-one-run-with-the-maintainers-consent.md): a Chief of Staff may push `feat/<slug>` for one run, with the Maintainer's consent, so a cloud Executor can take a slice.

## Why

- **Fewer moving parts / failure modes.** The old flow could fail at push, PR-create, gate, or
  merge — each a remote call with its own error handling and partial-state recovery. The new flow
  fails only at the gate or a local fast-forward.
- **Slices compose.** Serial cut-from-live-head means slice N builds on slice N−1 automatically.
  This is what `dispatch-waves` previously bought with extra runs; now ordering is the only thing
  waves add, and the common single-wave PRD needs no special handling.
- **No PR spam.** One PR per PRD (manual) instead of one per slice. CI runs once, on the unit that
  actually ships.
- **Safer by default.** Nothing reaches origin until a human pushes. A bad batch is discarded by
  deleting a local branch.

## Considered options & evidence

**Keep the per-slice PR + squash-merge flow (rejected).** Correct, but it is exactly the GitHub
coupling we set out to remove, and it cannot give slices visibility into siblings without the
re-branch-per-wave dance.

**Parallel slices + serialized local merges (rejected).** Keeps wall-clock down but reintroduces
the "siblings branch off a frozen base" problem (parallel agents cut from the same head), so
merges conflict and slices don't compose. Serial cut-from-live-head avoids both. The cost is
wall-clock — accepted deliberately ("one by one").

**`--no-ff` merge commits per slice in a dedicated feature worktree (rejected — unnecessary).**
Robust to any history shape, but serial execution already guarantees a clean fast-forward, so a
persistent feature worktree (extra checkout, extra cleanup) buys nothing. `git branch -f` on the
un-checked-out feature ref is enough.

## Consequences

- **The feature branch is local and unpushed.** Deleting it loses the integrated work — push
  before deleting. Documented in `docs/sandcastle/RUNBOOK.md`.
- **The gate operates on local refs** (`baseRef`, `sliceBranch`) — no `git fetch origin
<slice>` before gating. Still fail-closed: no integration without a green gate (or `SLICE_GATE=off`).
  `baseRef` is the feature branch in PRD mode and `origin/main` (or `--base`) standalone.
- **`dispatch-waves` still works** unchanged in behavior — it gates the `ready-for-agent` label
  per wave and calls `main.mts`; each wave's integrated output (local feature branch) is the next
  wave's base. Its role narrows to _ordering_ by `## Blocked by`.
- **Serial execution removes `SLICE_CONCURRENCY`.** One slice's `node_modules` worktree exists at
  a time.
- **Code** (`.sandcastle/main.mts`): removed origin feature-branch creation, `pushSliceBranch`,
  `gh pr create`, `gh pr merge`, and the parallel `Promise.allSettled` + semaphore. Added local
  feature-branch creation, a serial slice loop that cuts each branch from the live feature head,
  `finalizeSliceBranch` (capture stray changes, confirm work), and `integrateSlice` (local
  fast-forward). The gate now uses local refs. `dispatch-waves.mts` header + final messages and
  `docs/sandcastle/RUNBOOK.md` updated to the local model.
- **Relationship to [0009](0009-sandcastle-yarn-cache-mount-architecture.md):** orthogonal. 0009
  governs _how dependencies are installed_ (in-container, shared Yarn cache); this ADR governs
  _how slice output is integrated_ (local fast-forward). Both stay in force.
