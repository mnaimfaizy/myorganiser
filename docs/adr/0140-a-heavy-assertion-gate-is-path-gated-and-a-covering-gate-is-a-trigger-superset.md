# A heavy Assertion Gate is path-gated, and a Covering Gate is a trigger superset

## Status

accepted

## Context

Measured over 100 pull request runs (2026-10-17 → 10-29), a successful CI run took 11.3 min at the
median and 17.1 min at p90 even when the pull request touched a single library. The `Test` job was
7.4 min of that, and the affected Jest tests were 14s of the 7.4. Most of the rest was spent on
checks the change could not break: the `tools:test` Contract Suites at about 122s of CI step time on
every pull request (the same glob runs in about 34s locally, which is the figure
[the command reference](../agents/command-reference.md) quotes), `openapi:check` at about 44s plus a
Java toolchain setup, and the Upstream Brief and checker contract suites.

[ADR 0043](0043-gates-assert-facts.md) settles what a gate is: it compares two artifacts and fails
on a factual mismatch. It says nothing about when CI should pay for one, and the implicit answer
has been "always, on every pull request, over the whole tree". For a cheap file-reading checker
that is the right answer — roughly 350ms of work, and nothing to gain from deciding whether to run
it. For a suite that takes half a minute, or a drift check that regenerates an OpenAPI spec with a
Java tool, it is minutes per pull request spent on inputs the pull request did not touch.

The obvious implementation is a marketplace path-filter action and a per-step `if:` expression.
That was rejected for two reasons. First, it spreads one decision across as many `if:` expressions
as there are heavy steps, which is the fan-out shape
[ADR 0053](0053-a-fan-out-over-a-domain-enum-is-pinned-at-its-call-site.md) pins for code and
[ADR 0074](0074-a-gate-suppresses-a-finding-only-if-something-runs-it.md) item 3 pins for prose.
Second, and decisively, those globs are not private to the workflow — a second gate has to read
them, for the reason below.

[ADR 0074](0074-a-gate-suppresses-a-finding-only-if-something-runs-it.md) establishes that a gate
suppresses a review finding only when something runs it, and that the reviewer settles the question
by _reading_: it greps the `.husky` hooks, the `.github/workflows` jobs, and the `yarn gates:run`
manifest at the reviewed head for the gate's script name.
[ADR 0098](0098-a-covering-gate-is-part-of-the-site-not-the-answer.md) makes the gate a property of
the trigger rather than of the answer, so each trigger path in
`tools/config/review-obligations.json` names its own `coveringGate`.

Path-gating breaks the reading. The step exists. The workflow does invoke it. Its `if:` was false.
A reviewer would record `wiredBy: .github/workflows/ci.yml`, truthfully and with a correct
citation, and suppress the finding — which is
`release-bump-leaves-generated-client-stale` (issue #408, ADR 0074's worked example) reintroduced
through a trigger glob instead of a missing hook line. Worse than the original, because this time
the grep says the gate is there.

## Decision

1. **Heavy suites are path-gated from one config.** `tools/config/gate-triggers.json` holds, per
   heavy suite, the gate name, the job step it is, the reason for its globs, and its trigger
   globs. `Setup Affected Context` resolves the config against the pull request's changed paths and
   outputs one `run_<suite>` flag per entry; each suite's step runs when that flag or `run_all` is
   set. A heavy suite is added to that config, never as an `if:` expression written by hand. A
   suite's step lives in `Test` by default; an optional `job` field names a different job instead,
   for a suite whose cost is worth skipping a whole job for rather than one step in it — the
   Postgres service `prisma:migration:drift` needs, moved out by [#1394](https://github.com/mnaimfaizy/myorganiser/issues/1394). That suite's condition sits on the job itself, not on its
   step: a job's `services:` start whenever the job runs, whatever a step's own `if:` says, so only a
   job-level condition actually skips the Postgres start.

2. **The Gate Trigger resolver is our own code.** `tools/scripts/ci/resolve-gate-triggers.ts`, over the pure
   decision in `tools/scripts/lib/gate-triggers.ts`, with a Contract Suite in temporary git
   repositories. No third-party path-filter action: these globs are an artifact two gates read, and
   the glob→RegExp compiler is the repository's one copy (`tools/scripts/lib/glob.ts`).

3. **The fallback is always to run more.** Three rules, in this order:
   - A change to a **shared input** — a workflow file, `package.json`, `yarn.lock`,
     `tsconfig.base.json`, `nx.json`, or the gate-trigger config itself — sets every flag. No
     per-suite glob can bound a change with repo-wide reach.
   - A **resolver error** sets every flag. A failure the resolver can describe prints `run_all=true`
     and exits 0; the one it cannot — a config it cannot parse, so it does not know the flag names —
     exits non-zero and the workflow step writes `run_all=true` itself.
   - A **push** (and a manual run) sets every flag. `main` keeps its whole-tree guarantee, so a
     release branch is still cut from a commit every heavy suite passed.

4. **A path-gated Covering Gate's triggers are a superset of its obligation's triggers.** For every
   trigger path in `tools/config/review-obligations.json` whose `coveringGate` names a suite in the
   gate-trigger config, that suite's own triggers — or a shared input — must cover the obligation's
   glob. `yarn covering-gates:check` asserts it, naming the gate, the obligation, and the uncovered
   glob, and runs inside `yarn gates:run` through the gate manifest. A Covering Gate named only
   through a non-path trigger (`guardedEnums`, which fires on an enum rather than on a path) has no
   trigger path to compare against and must therefore not be path-gated at all.

   Coverage is decided conservatively: the same glob, `**`, or a literal directory prefix `dir/**`.
   A pair it cannot _prove_ covering is reported as uncovered. `dir/*` deliberately does not cover
   `dir/**` — one level against every level is the near-miss a substring comparison gets backwards,
   and the cost of a false pass here is exactly the suppression this item exists to prevent.

5. **Skipping a suite never skips a gate.** What a path gate may skip is a Contract Suite, which
   proves a checker works, or a drift check whose inputs the pull request did not touch. The cheap
   file-reading Assertion Gates keep running over the whole tree on every pull request. A gate whose
   inputs a path gate could skip, and which a review obligation names, is covered by item 4.

6. **A path-gated step is still a Wired Gate.** The Meta-Gate matches by exact script name
   (ADR 0043), so a step carrying an `if:` is invoked as far as `gates:coverage:check` is concerned
   and nothing about that changes. That is precisely why item 4 is needed: name-matching cannot see
   a false condition, so the trigger-superset rule is what closes the hole rather than a change to
   the Meta-Gate.

## Consequences

- Java 21 is set up in `Tool Suites` exactly when `openapi:check` runs, rather than on every run.
- On a pull request touching one web library, every heavy suite is skipped: `tools:test`,
  `upstream:briefs:test` and `openapi:check` (so the whole `Tool Suites` job),
  `typecheck:tools-scripts` (a step of `Typecheck`), and `prisma:migration:drift` (the
  `Prisma Migration Gate` job).
- The heavy suites gated here are the ones that are their own CI step or job, named by `ciStep`
  and `job` in `tools/config/gate-triggers.json`. The staging deploy
  contracts are Contract Suites under `tools/scripts`, so `tools:test`'s glob is what runs them
  and `docs/deployment/**` is one of its triggers; they are not a separately gated step.
- Prisma migration drift is path-gated in its own job by
  [#1394](https://github.com/mnaimfaizy/myorganiser/issues/1394), and the cheap gates collapse into
  one `yarn gates:run` step by
  [#1389](https://github.com/mnaimfaizy/myorganiser/issues/1389). Both read the same config and the
  same resolver; neither changes the rules above.
- A new heavy suite costs one config entry, one step (in the job its `job` field
  names, `test` by default) whose `if:` names its flag, and one `setup` job output. `tools/scripts/ci/gate-trigger-workflow.test.ts` drives itself from the
  config, so an entry added without that wiring fails.
- `yarn covering-gates:check` asserts only what it can: a suite in the config that no obligation
  names is not a defect, whether a gate is invoked at all stays with `gates:coverage:check`, and
  whether a `coveringGate` names a real npm script stays with the obligation catalogue's own
  validation (ADR 0085's rule that an artifact asserts what it claims — the checker's header states
  each omission and why).
- [ADR 0074](0074-a-gate-suppresses-a-finding-only-if-something-runs-it.md) is extended, not
  superseded: its rule, its reading method, and its single-author clause stand unchanged. This ADR
  adds the condition under which a gate found by reading its name may still not have run, and makes
  that condition a checked fact rather than something the reviewer is asked to reason about.
- Issue: [#1388](https://github.com/mnaimfaizy/myorganiser/issues/1388). PRD:
  [#1387](https://github.com/mnaimfaizy/myorganiser/issues/1387).
