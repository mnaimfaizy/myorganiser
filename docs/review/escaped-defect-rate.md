# Escaped-defect rate

**Kept current.** This is the running record for the reviewer's trust
measurement, and the sibling of
[`golden-replay-results.md`](golden-replay-results.md). It records what the
reviewer **misses**; what it **costs** is the other half, and lives in
[`effective-false-positive-rate.md`](effective-false-positive-rate.md)
([ADR 0079](../adr/0079-an-effective-false-positive-is-a-finding-nobody-acted-on.md)).
Neither number is quoted as the other. Append a measurement
per run and keep the ledger honest; do not freeze it at a date.
Interpretation — why a number is what it is, what a change to the reviewer
did to it — belongs in a dated Research Brief under `docs/research/`, which is
frozen and never edited ([ADR 0041](../adr/0041-internal-notes-have-homes.md)).
The numbers live here because they must stay current; the reasoning lives
there because it must not.

What the number means, and every separation it rests on, is
[ADR 0077](../adr/0077-an-escaped-defect-is-one-the-reviewer-saw-and-passed.md);
this file carries the measurements, not the decisions. The reasoning behind
the first entry is
[the 2026-09-11 brief](../research/2026-09-11-the-escaped-defect-denominator-is-empty.md).

## The question

**Of the Pull Requests the reviewer passed, what fraction does a later fix
name as root cause?**

That is the number a human needs before relying on a passing review, and
nothing else in this repository measures it. Golden recall measures whether
the reviewer catches curated historical defects — a regression signal, and
explicitly not a trust measure: the cases are hand-picked, they are the same
cases every run, and a score on them says nothing about the next diff.

The archaeology behind the golden set already runs in one direction — a
merged defect is traced back to the Pull Request that introduced it. This
measurement turns it around and walks the repository's own fix history.

## What the script does

```bash
yarn review:escaped:measure --days 60
```

`tools/scripts/review/measure-escaped-defects.ts` gathers; the classification
and the arithmetic are pure, in `tools/scripts/review/escaped-defects.ts`,
and covered by `yarn review:test`.

- **The population** is every merged fix Pull Request in the window: a `fix/`
  head branch, or — for a squash merge or a reserved branch prefix, where the
  branch name is gone — a `fix` Conventional Commit title.
- **The attribution** is read from the issue the fix closes, then its Pull
  Request body, then its commit messages, in that order. The vocabulary is
  short and written down in `ROOT_CAUSE_MARKERS`, each entry carrying the
  reason it counts as attribution: `root cause`, `introduced in/by`,
  `caused by`, `regression from/in/by`, `broke in/by`, and a last-ranked
  `has had it since` / `dates back to`. A closing keyword is never
  attribution — `Closes #721` names the ticket the fix resolves, not the
  change that caused it. The short vocabulary is the deliberate trade: a
  wrong attribution corrupts the numerator permanently, while phrasing
  nothing recognises lands in `unattributed`, which every report counts.
- **The convention** that feeds the attribution is
  [ADR 0100](../adr/0100-a-fix-names-what-introduced-it-in-its-commits.md):
  a fix branch's commits carry `Introduced in #<pull request>`, or
  `Introduced in unknown: <why>` when nothing can be named, and
  `yarn fix:attribution:check` fails a fix Pull Request that carries neither.
  A declared-unknown origin is counted in its own class, `origin-unknown`,
  apart from `unattributed`, which means only that the fix said nothing.
  There is no backfill; the population carries the line from the day the
  gate landed (2026-09-23).
- **The review status** of the named Pull Request is read back out of the
  publisher's own sticky comment, using the same heading helper the renderer
  writes it with, and the report carries the verdict itself and not only the
  bucket. A Pull Request merged before the reviewer's workflow landed is
  `unreviewed` from the repository's own history, with no lookup at all.

## What the number means

The denominator is the Pull Requests the reviewer **passed** inside the
window — `approve` and `comment` both, because `Agent Verdict` fails only on
`request-changes` ([ADR 0073](../adr/0073-a-required-check-is-a-fact-about-the-pipeline-not-a-judgment-about-the-diff.md)),
so a `comment` verdict is work the reviewer let through. The numerator is the
distinct Pull Requests among them that a later fix names as root cause.

Three separations decide whether the number means anything, and every one of
them is a way the measurement could have flattered the reviewer:

1. **A Pull Request the reviewer never saw is not an escape.** It is reported
   as `unreviewed`, separately, and never in the numerator.
2. **Blocked is not escaped.** If the reviewer asked for changes and the work
   merged anyway, the reviewer did its job and a human overrode it.
3. **An unattributable fix is counted, not dropped.** Every fix in the window
   lands in exactly one class, so the denominator is auditable rather than
   whatever survived a filter.

An empty denominator reports as **not measurable**, never as 0%. Zero would
read as "the reviewer passed work and none of it broke", which is the
opposite of "the reviewer has passed nothing yet".

## Measurements

Newest last. "Fixes" is the population; "attributed" is how many of them named
a root cause at all.

| Date       | Window                   | Fixes | Attributed | Denominator | Escaped | Rate               |
| ---------- | ------------------------ | ----: | ---------: | ----------: | ------: | ------------------ |
| 2026-09-11 | 2026-07-13 to 2026-09-11 |    57 |          0 |           0 |       0 | **not measurable** |
| 2026-09-28 | 2026-07-29 to 2026-09-27 |    89 |          9 |         102 |       1 | **1.0%**           |

### The first measurement (2026-09-11)

Taken on `slice/721-code-review-trust-escaped-defect-rate` with git evidence
only — the sandbox has no authenticated `gh`, so Pull Request bodies, issue
bodies, and review comments were not read, and the report says so in its
evidence block.

**The rate is not measurable, and both halves of the fraction say why.**

- **The denominator is empty.** The reviewer's workflow landed on 2026-09-06,
  five days before the window closes. Twenty-four Pull Requests merged after
  it, and this run could not read a verdict for any of them; none is counted
  as a pass. The other 294 Pull Requests on `main` predate the reviewer
  entirely and are `unreviewed` as a matter of history, not of lookup.
- **The numerator has no candidates.** All 57 fixes in the window are
  `unattributed`: not one names the change that caused the defect in a form
  the parser reads. Widening the window to 120 days adds four fixes and no
  attributions.

Nothing here is evidence about the reviewer. It is evidence about the
apparatus: the measurement needs fixes that name their root cause, and this
repository's fix commits describe root causes in prose — "Root cause was a
stale pin" — while naming the Pull Request only in passing, in changes that
are not fix branches. The interpretation, and what would have to change, is
in the frozen brief.

### The second measurement (2026-09-28)

The first taken with an authenticated `gh`, so Pull Request bodies, issue
bodies and review summaries were all read. Taken for issue #925; the parser
it ran with is the one #928 corrected, and re-running over the same gather
gives the same result.

- **One escape: #902, root cause #745.** #902's commit carries
  `Introduced in #745`. The reviewer passed #745 with `comment` on three
  findings about its ADR status and its migration, none about the YouTube
  page refresh #902 fixed.
- **Nine fixes name a root cause and two declare it unknown.** Of the nine,
  seven name a Pull Request merged before the reviewer went live (#77, #159
  twice, #287, #297, #357, #573) and are `unreviewed`, and one (#905) names
  itself and is `not-earlier`.
- **78 of 89 fixes name nothing.** Nearly all merged before
  `fix:attribution:check` landed on 2026-09-23 (ADR 0100); of the twelve
  fixes merged since, nine name an origin or declare it unknown.
- The saved gather is kept out of the tree for size (about 1 MB); see #925.

The interpretation is in
[the 2026-09-28 brief](../research/2026-09-28-the-first-trust-measurements-with-gh.md).

## Reproduce

```bash
yarn review:escaped:measure --days 60 --out tmp/escaped.md --json tmp/escaped.json
```

Useful flags: `--since` / `--until` for an explicit window, `--base` for a
branch other than `main`, `--reviewer-since` to override the date the
reviewer went live, `--no-github` to force the git-only measurement, and
`--save-gather` / `--gathered` to record the evidence once and re-measure
from it.

The script is **not a gate** — it measures merged history, has nothing to
fail on for the commit in front of it, and reaches the network. It carries a
written opt-out in `tools/config/gate-coverage-optout.json`, which
`yarn gates:coverage:check` enforces the existence of.
