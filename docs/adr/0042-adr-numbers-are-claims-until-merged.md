# ADR numbers are claims until merged and facts afterwards

On 2026-08-22 the repository held two ADR 0037 files. Neither author skipped the
manual scan `AGENTS.md` asks for — the scan was correct in both cases, and the
collision was created anyway. We make the ordering rule explicit, forbid
renumbering a merged ADR, and assert uniqueness mechanically at the only place
that can see it.

## Status

accepted

## Context

The timeline matters, because the obvious diagnosis is wrong:

| time  | event                                                                         |
| ----- | ----------------------------------------------------------------------------- |
| 14:53 | `779386c` writes `0037-add-edit-forms-are-summoned-not-routed.md` on a branch |
| 15:20 | `1bb33d6` renumbers the CodeExplorer ADR to `0037` on a different branch      |
| 15:22 | `bc5964e` merges PR #453 — the first `0037` lands on `main`                   |
| 15:32 | `2cbc5d6` merges `main` into the renumber branch — the collision materialises |

At 15:20, `0037` was genuinely free on `main`. The author's scan was accurate.
What produced the duplicate was the merge twelve minutes later, and git had
nothing to object to: two files with different names never conflict.

Three consequences follow, and they shape the decision:

- **Prevention at authoring time is impossible.** A helper that allocated "the
  next free number" would have read the same tree and printed `0037` too. The
  fact that decides the answer — what other in-flight branches have claimed —
  does not exist in the working tree. Only the merge point knows.
- **A pre-commit hook cannot be the contract.** It runs against a base where the
  number is free, and the commit that created this collision was a merge commit,
  which does not fire `pre-commit` at all.
- **The enforcement scaffolding already existed and already ran.** `main` is
  protected with `required_status_checks.strict: true`, which is precisely what
  forced `2cbc5d6`. CI's `Test` job checks out `refs/pull/N/merge`. Both `0037`
  files were sitting in that checkout. Nothing read `docs/adr/`.

## Decision

**An ADR number is a claim until it is merged, and a fact once it is.**

- Two open pull requests may legitimately hold the same number. The first to
  merge keeps it. The second is blocked from merging while behind `main`, must
  update, and renumbers to the next free number. Merge order decides; no human
  adjudicates.
- **A merged ADR is never renumbered.** Its number is cited across the repo by
  filename and in prose. When a decision is revisited, supersede it — the
  pattern ADR 0007/0008 and ADR 0029 already demonstrate.
- **Gaps in the sequence are legal.** An abandoned pull request retires its
  number permanently. Contiguity is not asserted and must not be repaired.
- `yarn adr:numbering:check` asserts that every filename in `docs/adr/` carries
  a unique four-digit number and a lowercase-hyphen slug. Husky runs it on every
  commit; CI runs it in `Test`, on every pull request and push to `main` /
  `release/*`.

## Consequences

- The CI run is the contract; the Husky run is fast feedback. Pre-commit cannot
  see a concurrent branch and is not expected to. It catches the plain case of
  reusing a number already on your own base.
- The check is deliberately **pure** — a directory listing, no git. Renumbering
  onto a number that is already taken surfaces here as a duplicate, which is the
  failure that actually occurred. Renumbering onto a _free_ number is caught by
  review against this ADR, not mechanically. Machine-checking that would require
  diffing filenames against the merge base, making the script git-dependent and
  unrunnable outside a repository, for a failure mode that is harmless.
- The check is standalone rather than folded into `check-docs-notes.ts`. Every
  check script in `tools/scripts/` serves one decision, so a reader who opens an
  ADR finds exactly one script named after it. `check-docs-notes.ts` carries
  two rules, but both descend from ADR 0041.
- It runs ungated in `.husky/pre-commit`. Path-gating exists here for expensive
  checks like `skills:map:check`; the `git diff --cached` needed to decide
  whether to skip a 41-entry directory listing would cost more than the listing.
- A dot is allowed inside the slug, so `0024-elastic-license-2.0.md` stays as it
  is. Forcing a merged, cited ADR to be renamed for a version number would cut
  against the rule this ADR is establishing.

## Considered Options

- **An allocation helper (`yarn adr:next`).** Rejected. It would have produced
  this exact collision, with a tool's authority behind it.
- **A policy rule with no check.** Rejected. Immutability alone says nothing
  about two branches both opening a legitimately-free `0042`, which is the same
  clean merge and inevitable at any parallelism.
- **Asserting contiguity.** Rejected. Immutable numbers plus an abandoned pull
  request produce a gap by construction; asserting against it would turn a
  normal outcome into a red build.
- **Adding a `pre-merge-commit` hook.** Rejected. It would catch only what CI
  catches minutes later on the same push — a second gate for one failure, not a
  new guarantee.
