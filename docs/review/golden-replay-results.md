# Golden replay results

**Kept current.** This file is the running record ADR 0071 asks for. It was
started to answer one question — whether the agent verdict had earned a place
in the ruleset — and that question is now closed:
[ADR 0073](../adr/0073-a-required-check-is-a-fact-about-the-pipeline-not-a-judgment-about-the-diff.md)
makes the verdict advisory permanently, because a check may assert a fact about
the pipeline and not a judgment about the diff. No number in this file reopens
it.

What the record is for now is the reviewer itself: whether a brief change helped,
which cases are worth replaying, and what a replay costs. That is worth knowing
whether or not anything gates on it, and it is the reason the numbers below are
still collected. Append a row per replay run and keep the tier table honest; do
not freeze it at a date. Interpretation —
why a case missed, what a brief change did — belongs in a dated Research Brief
under `docs/research/`, which is frozen and never edited
([ADR 0041](../adr/0041-internal-notes-have-homes.md)). The numbers live here
because they must stay current; the reasoning lives there because it must not.

The first entry's reasoning is
[the 2026-09-07 baseline](../research/2026-09-07-golden-replay-baseline.md).

**Recall is not trust.** Every number here is scored against curated
historical defects, which makes it a regression signal and nothing more: it
says whether a change to the reviewer moved cases the reviewer has already
seen. Whether a human can rely on a passing review is a different question
with its own running record —
[`escaped-defect-rate.md`](escaped-defect-rate.md), which asks what fraction
of the Pull Requests the reviewer passed a later fix names as root cause.

## What the numbers mean

Recall is matched expected findings over expected findings, scored by
`tools/scripts/review/score-golden-case.mjs` against the validated report of
one reviewer run per case. A pattern case passes at or above its `minRecall`.
The reviewer is stochastic: a single run of a single case is not a
measurement, which is why the baseline reports five runs of the same three
cases and why a case's tier is read from its last ten scored runs.

A clean-diff case (issue #933) is the opposite measurement: a known-good
merged pull request that carries `expectsNoBlocking: true` in place of
`expected` and `minRecall`, and passes only when the report carries no
Blocking finding. It has no recall — `scoreCase` reports it as `clean-pass`
or `clean-fail`, never as a recall number, and the results record does the
same (`OUTCOMES` in `tools/scripts/review/golden-results.mjs`). It measures
false alarms rather than recall, and is selected by the same tier filter as
every other case.

## Tiers

A case's tier decides how often it is replayed
([ADR 0072](../adr/0072-a-golden-case-earns-its-replay-frequency.md)).
Since 2026-10-01 a case stands where its catch rate over its **last ten
scored runs** puts it
([ADR 0116](../adr/0116-a-golden-case-stands-on-its-catch-rate-over-its-last-ten-scored-runs.md)):
**eight or more** catches at `guard`, **five or fewer** at `frontier`, six or
seven where it was. Under ten scored runs nothing moves and the tier the set
declares holds. A void is not a scored run. The table below is generated from
the set and the [results record](golden-replay-results.jsonl) by
`tools/scripts/review/golden-standing.mjs`, asserted by
`yarn review:golden:results:check`, and is what the replay's tier filter
reads.

<!-- GENERATED:golden-standing:START -->

<!-- prettier-ignore-start -->
| Case | Declared tier | Scored runs | Caught of last ten | Rate | Stands at | Why |
| --- | --- | --- | --- | --- | --- | --- |
| `groceries-blob-type-without-fanouts` | `guard` | 0 | 0 of 0 | — | `guard` | declared; under 10 scored runs, so nothing moves |
| `export-envelope-drops-tasks` | `frontier` | 0 | 0 of 0 | — | `frontier` | declared; under 10 scored runs, so nothing moves |
| `release-bump-leaves-generated-client-stale` | `frontier` | 0 | 0 of 0 | — | `frontier` | declared; under 10 scored runs, so nothing moves |
| `signup-password-wrapper-inside-formcontrol` | `guard` | 0 | 0 of 0 | — | `guard` | declared; under 10 scored runs, so nothing moves |
| `import-confirm-is-bare-window-confirm` | `guard` | 0 | 0 of 0 | — | `guard` | declared; under 10 scored runs, so nothing moves |
| `mail-test-setup-assigns-undefined-to-env` | `guard` | 0 | 0 of 0 | — | `guard` | declared; under 10 scored runs, so nothing moves |
| `npm-advisory-rekey-lands-clean` | `frontier` | 0 | 0 of 0 | — | `frontier` | declared; under 10 scored runs, so nothing moves |
| `escaped-defect-negation-fix-lands-clean` | `frontier` | 0 | 0 of 0 | — | `frontier` | declared; under 10 scored runs, so nothing moves |
| `trust-measurement-docs-land-clean` | `frontier` | 0 | 0 of 0 | — | `frontier` | declared; under 10 scored runs, so nothing moves |
| `youtube-run-refresh-gated-on-polled-liveness` | `frontier` | 0 | 0 of 0 | — | `frontier` | declared; under 10 scored runs, so nothing moves |
| `e2e-export-download-read-through-download-path` | `frontier` | 0 | 0 of 0 | — | `frontier` | declared; under 10 scored runs, so nothing moves |
| `staging-schedule-rollback-guard-and-unreachable-host` | `frontier` | 0 | 0 of 0 | — | `frontier` | declared; under 10 scored runs, so nothing moves |
| `seeded-1140-ancestor-args-swapped` | `frontier` | 0 | 0 of 0 | — | `frontier` | declared; under 10 scored runs, so nothing moves |
| `seeded-1140-hostname-in-public-log` | `frontier` | 0 | 0 of 0 | — | `frontier` | declared; under 10 scored runs, so nothing moves |
| `seeded-1140-restart-while-install-owed` | `guard` | 0 | 0 of 0 | — | `guard` | declared; under 10 scored runs, so nothing moves |
| `seeded-1140-same-site-continue-on-error` | `guard` | 0 | 0 of 0 | — | `guard` | declared; under 10 scored runs, so nothing moves |
<!-- prettier-ignore-end -->

<!-- GENERATED:golden-standing:END -->

Before that, promotion to `guard` took three consecutive catches and demotion
to `frontier` took one miss. The history below was written under that rule
and is kept as written: it is where each declared tier came from.

| Case                                             | Tier       | Since      | History                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------ | ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `groceries-blob-type-without-fanouts`            | `guard`    | 2026-09-07 | caught in every run, now eleven of eleven (34345667427, 34351285079, 34582767531, 34591297535); void in 34441162698 (turn ceiling), which neither extends nor breaks the streak; caught in 35076286069 and 35156450789                                                                                                                                                                                                                                                                                                                                                                                                             |
| `export-envelope-drops-tasks`                    | `frontier` | 2026-09-22 | promoted on four catches, demoted on the miss in run 34105977391; missed again in 34171728640; caught again in 34215499508, the first run after retirement; caught in 34344266006, missed in 34345667427, 34351285079 and 34441162698; caught in 34591297535, 34663295486 and 34673097908 — **three consecutive, promoted a second time**; caught in 35076286069 and 35156450789; void in 35716439899 (prevented: refused every write to its own report path after a `cd`, issue #880), which is not a miss; **missed in 35723129169 — demoted a second time**, a clean miss ending a five-run streak; missed again in 35800528309 |
| `release-bump-leaves-generated-client-stale`     | `frontier` | 2026-09-07 | caught once, in 34171728640; missed in 34344266006 and 34345667427; void in 34351285079 (rate limit); caught in 34441162698; missed in 34591297535; caught in 34663295486, 34673097908, 35076286069, 35156450789, 35723129169 and 35800528309 — **six consecutive, promotion earned and still not taken**: the no-empty-arm reason lapsed on 2026-09-22 when `export-envelope-drops-tasks` was demoted back to `frontier`, so the arm now holds another case and promotion is available; taking it is out of scope for #734                                                                                                        |
| `signup-password-wrapper-inside-formcontrol`     | `guard`    | 2026-09-12 | missed in 34345667427; **first catch** in 34351285079, the first run with an obligation firing on its site; missed in 34441162698; caught in 34591297535, 34663295486 and 34673097908 — **three consecutive, promoted**; void in 35076286069 (five-hour rate limit, six turns); caught in 35156450789                                                                                                                                                                                                                                                                                                                              |
| `import-confirm-is-bare-window-confirm`          | `guard`    | 2026-09-12 | first catch in 34345667427; void in 34351285079 (rate limit), which neither extends nor breaks the streak; missed in 34441162698; caught in 34591297535, 34663295486 and 34673097908 — **three consecutive, promoted**; void in 35076286069 (five-hour rate limit, one turn); caught in 35156450789                                                                                                                                                                                                                                                                                                                                |
| `mail-test-setup-assigns-undefined-to-env`       | `guard`    | 2026-09-12 | missed in 34345667427; void in 34351285079 (rate limit); **first catch** in 34441162698, then 34591297535 and 34663295486 — **three consecutive, promoted**; void in 35076286069 (five-hour rate limit, one turn); caught in 35156450789                                                                                                                                                                                                                                                                                                                                                                                           |
| `npm-advisory-rekey-lands-clean`                 | `frontier` | 2026-09-30 | clean-diff case (issue #933), added from PR #922; not yet replayed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `escaped-defect-negation-fix-lands-clean`        | `frontier` | 2026-09-30 | clean-diff case (issue #933), added from PR #928; not yet replayed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `trust-measurement-docs-land-clean`              | `frontier` | 2026-09-30 | clean-diff case (issue #933), added from PR #931; not yet replayed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `youtube-run-refresh-gated-on-polled-liveness`   | `frontier` | 2026-09-30 | added from the fix attributed to PR #745 (issue #934); the only escaped defect in the 2026-09-28 measurement — the reviewer saw #745 and passed it — so the case starts from a recorded miss on the live pull request, not from a replay; not yet replayed                                                                                                                                                                                                                                                                                                                                                                         |
| `e2e-export-download-read-through-download-path` | `frontier` | 2026-09-30 | added from the second fix attributed to PR #77 (issue #934); shares that pull request's range with `export-envelope-drops-tasks` for the reason its incident line gives, and no review ever saw the diff — #77 merged before the reviewer went live; not yet replayed                                                                                                                                                                                                                                                                                                                                                              |

The tier and the evidence that earned it are in
`tools/config/review-golden-set.json`, asserted by `yarn review:golden:check`.
`export-envelope-drops-tasks` was kept in the narrowed six for the opposite
reason to the one that now moves it: it flickered near half, and a case that
always passes or never passes carries less information per run than one in the
middle (ADR 0072's Alternatives considered, repeated in its 2026-09-11
amendment). Three consecutive catches promoted it anyway on 2026-09-12. The
rule does not read intent, and the case is no longer flickering — but the
paragraph is left standing rather than deleted, because the reason it was kept
is the reason to watch it: one miss demotes it straight back.

It did, on 2026-09-22: run 35723129169 missed it cleanly and the case is
`frontier` again, then 35800528309 missed it again, putting it at 9 of 17
lifetime. The flicker was the durable fact and the five-run streak was not,
which is the whole argument for a one-miss demotion.

Two misses in a row is **not** evidence that the change under test hurt it. The
same arithmetic that makes promotion take three consecutive catches applies in
reverse: a case sitting near half misses twice running about one time in five.
What can be said about that change specifically is narrower and checkable — on
this case's own range the ADR 0098 catalogue selects **five** obligation sites
where the previous one selected seven, at three answer fields rather than four,
so the reviewer was asked for less here, not more.

**Retired.** `groceries-ui-written-against-absent-roles` was retired on
2026-09-08 as unwinnable rather than hard: the gate ADR 0065 added as the fix
for that incident fails on the case's own range, and a wired gate's defect is a
suppressed count and not a finding
([ADR 0074](../adr/0074-a-gate-suppresses-a-finding-only-if-something-runs-it.md)).
It stays in the set under `retired`, with its reason and its id reserved, so
nothing re-adds it — the workings are below.

**Parked.** `sync-bookmarks-without-restore-or-meta-push` was parked on
2026-09-11 (issue #722), never caught in any run above and never covered by
the gate its own incident named (`enum:fanout:check` passes cleanly at its
head). That is a different claim than retirement's: this case is hard, not
unwinnable, and filing it as unwinnable would be a lie in the field that
state exists to keep honest ([ADR 0072](../adr/0072-a-golden-case-earns-its-replay-frequency.md),
item 7). It stays in the set under `parked`, id reserved the same way, with a
`reentryCondition` in place of a `reason`: it returns to the replayed set the
day the matching entry in `docs/review/REVIEW_CHECKLIST.md`'s Deferred
candidates — "New persisted state has an inverse" — is promoted into
`tools/config/review-obligations.json`. Three more candidates joined it on
2026-09-30, traced from attributed fixes under issue #934 and parked rather
than added, each for a reason written into its own `reentryCondition`:

- `mobile-native-program-declares-dom` (PR #159, fixed by #894 and #901) and
  `youtube-sync-failure-collapsed-before-logging` (PR #357, fixed by #893)
  are parked for the same reason, and it is the one
  [ADR 0102](../adr/0102-a-golden-replay-reviews-the-case-tree-with-the-pull-requests-harness.md)
  item 2 creates: the defect is in the diff and citable, but no document at
  either head names the rule, so there is no standard the range could have
  broken and a replay would score the apparatus rather than the reviewer.
  That ADR's Consequences name the way back — carry the lesson in the
  harness — so each returns the day an obligation names its defect with a
  `goldenCase` pointing at it. Both ranges are also far larger than any the
  replay has scored inside its 80-turn ceiling, which is recorded beside the
  condition so promotion checks the budget first.
- `todos-removal-waiver-reraised-as-blocking` (PR #852) is the false-alarm
  loop PRD #925 recorded: a precondition waived in ADR 0003 rather than in
  the spec, raised as Blocking in seven wordings across eleven runs. The
  pull request's own review data, read on 2026-10-01, bears that out: eleven
  runs, the waived precondition Blocking under seven titles in runs 4 to 10,
  and no Blocking finding in the last run at `7e01e9d`. It wants the
  clean-diff shape. The two conditions it was parked on now hold — slice #938
  put the waiver clause in the Spec brief, and the merged head's review raised
  nothing Blocking — and it stays parked on a third: every case in the set
  carries no spec source, so a replay would never reach the clause it
  measures. Its entry says what returns it.

The trace's sixth candidate gained no entry of its own and is not dropped
either: PR #907 is the third fix attributed to PR #573, and its defect — a web
write path for an array-shaped Vault Blob Type that recorded no deletion — is
the same missing inverse `sync-bookmarks-without-restore-or-meta-push` already
holds that range for. Its attribution went into that entry's incident line, and
the reason a second case on the range is not warranted went into its
`reentryCondition`: one trigger returns both, and the range is the largest in
the set at 122 files.

**Eight pattern cases remain**: four guard and four frontier — the two issue
#934 added, plus `export-envelope-drops-tasks`, demoted a second time on
2026-09-22, and `release-bump-leaves-generated-client-stale`, which has earned
promotion without taking it for the reason recorded under Runs. (This sentence
read "five guard, one frontier" until 2026-09-30; it had not been recounted
since that demotion.) **Three clean-diff cases** (issue #933) join them, all
`frontier` and not yet replayed.

## Authorship

Each case's incident line already names the pull request that introduced its
defect. Read against `git log` for that PR, five are human-authored and three
are agent-authored — and the three agents are not all the same model family,
which matters for the reviewer's own family (Claude, `claude-sonnet-5` by
default per `CODE_REVIEW_MODEL`). Issue #934's two additions moved both
counts by one, and the Claude side of the split is now two cases rather than
one; the catch-rate table below is unchanged, because neither has been
replayed. The reasoning and the run-by-run ledger
these two tables summarize are in
[the 2026-09-11 authorship brief](../research/2026-09-11-the-same-family-test-has-one-data-point.md),
which is frozen at that date. These two tables are not: like the rest of this
file, update them as new runs land or a case's classification needs
correcting.

| Case                                             | Introduced by                                                  | Author | Family                                                    |
| ------------------------------------------------ | -------------------------------------------------------------- | ------ | --------------------------------------------------------- |
| `groceries-blob-type-without-fanouts` (guard)    | PR #101                                                        | human  | —                                                         |
| `export-envelope-drops-tasks`                    | PR #77                                                         | human  | —                                                         |
| `release-bump-leaves-generated-client-stale`     | PR #379 (`yarn release:cut`, run by a human)                   | human  | —                                                         |
| `import-confirm-is-bare-window-confirm`          | PR #40                                                         | human  | —                                                         |
| `signup-password-wrapper-inside-formcontrol`     | PR #215 (`Co-authored-by: Cursor <cursoragent@cursor.com>`)    | agent  | Cursor (Composer)                                         |
| `mail-test-setup-assigns-undefined-to-env`       | PR #415, carrying interrupted slice #396's TestScaffold output | agent  | Claude (Haiku 4.5, `test-scaffold` on the Claude harness) |
| `e2e-export-download-read-through-download-path` | PR #77, the same range as `export-envelope-drops-tasks`        | human  | —                                                         |
| `youtube-run-refresh-gated-on-polled-liveness`   | PR #745 (every commit `Co-Authored-By: Claude Opus 5`)         | agent  | Claude (Opus 5)                                           |

Catch rate by authorship, across every valid replay of each case recorded in
this file through Run 49 (2026-09-12). "Valid" excludes void runs (rate limit,
turn exhaustion) and the 2026-09-09 run `34344266006`, which the record itself
says not to read as evidence (confounded mid-flight, see the "wired-gate
qualifier" run above).

| Case                                                       | Author        | Catches | Valid runs |    Rate |
| ---------------------------------------------------------- | ------------- | ------: | ---------: | ------: |
| `groceries-blob-type-without-fanouts` (guard)              | human         |      11 |         11 |    100% |
| `export-envelope-drops-tasks`                              | human         |       9 |         15 |     60% |
| `release-bump-leaves-generated-client-stale`               | human         |       4 |         10 |     40% |
| `import-confirm-is-bare-window-confirm`                    | human         |       4 |         10 |     40% |
| **Human total**                                            |               |  **28** |     **46** | **61%** |
| **Human, frontier only** (`release-bump` alone, at Run 49) |               |   **4** |     **10** | **40%** |
| `signup-password-wrapper-inside-formcontrol`               | agent, Cursor |       4 |         11 |     36% |
| `mail-test-setup-assigns-undefined-to-env`                 | agent, Claude |       3 |          8 |     38% |
| **Agent total**                                            |               |   **7** |     **19** | **37%** |

## Cadence

**When it runs** is [ADR 0109](../adr/0109-a-golden-replay-runs-on-a-schedule-and-on-request.md)
since 2026-09-28: weekly on `main` when a reviewer input moved (frontier that
week, every case in the first week of a month), on a Pull Request when the
`golden-replay` Request Label is added, and by `workflow_dispatch`. It no
longer runs on a push, and `[skip replay]` is retired. The three weeks before
it — 108 runs, 228 reviewer sessions, $531 billed-equivalent, 88% of it from
Pull Request pushes — are the record that decision rests on (issue #925).

The replay's own strategy now runs at **parallelism one**
(`.github/workflows/review-golden-replay.yml`): cases replay one at a time
within a dispatch instead of four at once. That is a direct response to what
the budget section below records — `max-parallel: 4` locked the maintainer
out of their own five-hour subscription window once, and a replay competes
with the maintainer for that same window rather than a separate budget.

One `workflow_dispatch` is **one repetition** of the tier requested, not
three. Three repetitions, dispatched one at a time on separate days, cost the
same total reviewer-minutes as three run back to back, without ever holding
the window at the moment the maintainer needs it.

**A single run is not a measurement, and a score moves nothing on its own.**
The reviewer is stochastic — a single run of a single case never was a
measurement, which is why the baseline above took five runs of the same three
cases before drawing any conclusion. What changes here is only how the
repetitions are spread out: three dispatches, read together once all three
have landed, are what this record treats as one measurement. A single
run no longer moves a case's tier: since ADR 0116 a scheduled run is one
scored run of the ten a standing is read over, and a label or dispatch run is
not committed to the record at all, so it moves no tier. No narrative
conclusion in this file ("the brief helped," "the cadence fixed it") should
rest on one dispatch alone. See ADR 0072, item 8.

The **scheduled** replay is the exception to one repetition: it runs each
frontier case three times in one run, still one session at a time
(ADR 0116). A guard runs once.

## Runs

Newest last. "Cases" is the tier replayed, not the whole set.

| Date       | Model               | Cases          | Result                      | Reviewer change under test                    |
| ---------- | ------------------- | -------------- | --------------------------- | --------------------------------------------- |
| 2026-09-07 | `claude-sonnet-5`   | 3 (pre-tier)   | 1 of 3                      | none — first measurement                      |
| 2026-09-07 | `claude-sonnet-5`   | 3 (pre-tier)   | 2 of 3                      | none — same skill, re-run                     |
| 2026-09-07 | `claude-sonnet-5`   | 3 (pre-tier)   | 2 of 3                      | reach-through checks added to Standards brief |
| 2026-09-07 | `claude-sonnet-5`   | 3 (pre-tier)   | 2 of 3                      | reach-through checks, re-run                  |
| 2026-09-07 | `claude-sonnet-5`   | 7 (pre-tier)   | **2 of 7**, 2 of 8 findings | reach-through checks, full set                |
| 2026-09-07 | `claude-sonnet-5`   | 8 (all tiers)  | **1 of 8**, 1 of 9 findings | consequence checks added to Standards brief   |
| 2026-09-07 | `claude-sonnet-5`   | 8 (all tiers)  | **2 of 8**, 2 of 9 findings | consequence checks reverted                   |
| 2026-09-08 | `claude-sonnet-5`   | 8 (all tiers)  | **2 of 8**, 2 of 9 findings | none — same brief, on `main` as base          |
| 2026-09-08 | `claude-sonnet-5`   | 7 (`frontier`) | **void** — rate-limited     | none — first tier-selected run                |
| 2026-09-08 | `claude-sonnet-5`   | 6 (`frontier`) | **1 of 6**, 1 of 6 findings | none — first run after the retirement         |
| 2026-09-09 | `claude-sonnet-5`   | 7 (all tiers)  | **2 of 7**, 2 of 8 findings | wired-gate qualifier on the suppression rule  |
| 2026-09-09 | `claude-sonnet-5`   | 7 (all tiers)  | **2 of 4 scorable**, 3 void | obligation worklist live (pre-fix triggers)   |
| 2026-09-10 | `claude-sonnet-5`   | 7 (all tiers)  | **2 of 6 scorable**, 1 void | corrected triggers; first dispatched run      |
| 2026-09-11 | `claude-sonnet-5`   | 1 (`guard`)    | **1 of 1**                  | reviewer containment and the allowlist check  |
| 2026-09-11 | `claude-sonnet-5`   | 6 (all tiers)  | **5 of 6**                  | PRD #713 integrated, on pull request #733     |
| 2026-09-12 | `claude-sonnet-5`   | 5 (`frontier`) | **5 of 5**                  | same branch, dispatched deliberately          |
| 2026-09-12 | `claude-sonnet-5`   | 4 (`frontier`) | **4 of 4**                  | third dispatch; the measurement #722 defines  |
| 2026-09-22 | `claude-sonnet-5`   | 6 (all tiers)  | **5 of 6**                  | ADR 0098 — `coveringGate` leaves the answer   |
| 2026-09-23 | `claude-sonnet-5`   | 6 (all tiers)  | **5 of 6**                  | same, plus the review response on #879        |
| 2026-09-23 | `claude-sonnet-5`   | 2 (`frontier`) | **1 of 2**                  | none — #884 touches only the measurement      |
| 2026-10-02 | `claude-sonnet-5-5` | 11 (all tiers) | **5 of 8**, 3 clean passes  | enum fan-out obligation (#895), dispatched    |
| 2026-10-03 | `claude-sonnet-5-5` | 11 (all tiers) | **6 of 8**, 3 clean passes  | same, export case re-pointed at #126's range  |
| 2026-10-05 | `claude-sonnet-5-5` | 11 (all tiers) | **6 of 8**, 3 clean passes  | same, trigger generated from the checker list |

Cost of the seven-case run: roughly $14 across seven reviewer sessions of 40
to 60 turns each. Run 46 was one guard case: 56 turns of an 80-turn budget, 26
permission denials, $2.93. Its reasoning is
[the 2026-09-11 containment brief](../research/2026-09-11-the-guard-came-back-with-the-refusals-intact.md).

### Run 45 (2026-09-10), the first deliberately dispatched replay

`release-bump` and `mail-test-setup` caught — the latter for the first time in
any run. `signup-password-wrapper`, `import-confirm`, `export-envelope` and
`sync-bookmarks` missed. `groceries-blob-type-without-fanouts` is **void, and
its `guard` tier does not move**: it stopped at `error_max_turns` after 80
turns with 26 permission denials, and the rate-limit detector correctly
reported `rate_limited=false`. Turn exhaustion is a third outcome the
apparatus had no word for, and scoring it as a miss would demote a case the
reviewer never failed. The detector now reports it separately.

The two obligation-covered misses were read from their transcripts and are the
subject of a frozen brief:
[2026-09-10](../research/2026-09-10-the-answer-sheet-is-inert.md). The short
version is that the obligations fired on exactly the right lines, were
answered at every site, and two of those answers were false while a third was
true and ignored — so a written answer is not a verified answer. That brief
also retracts this record's earlier reading of run 37's `signup` catch.

### What the consequence checks measured

Run [34105977391](https://github.com/mnaimfaizy/myorganiser/actions/runs/34105977391).
The consequence checks did not work. Recall fell from 2 of 7 to 1 of 8, and the
case that changed direction changed the wrong way.

- **None of the five cases the checks were written from moved.**
  `groceries-ui-written-against-absent-roles` (check 1),
  `sync-bookmarks-without-restore-or-meta-push` (check 2),
  `release-bump-leaves-generated-client-stale` (check 3),
  `import-confirm-is-bare-window-confirm` (check 4) and
  `signup-password-wrapper-inside-formcontrol` (check 5) all still miss.
  Writing an instruction at a miss did not produce a catch.
- **`export-envelope-drops-tasks` regressed.** It had been caught four times
  running under the reach-through brief alone; here it missed, while producing
  four other findings. It is demoted to `frontier` by the rule.
- **The held-out case missed too.** `mail-test-setup-assigns-undefined-to-env`
  turns on a language semantic inside the hunk, and the reviewer did not raise
  it. So the miss is not confined to the reach-through class of defect.
- Every failing case produced a **valid report with other findings in it**, two
  to eight of them. None of these is a rejected report or a scoring artefact,
  and none is the incident.

Two readings survive this run, and one run cannot separate them. **Dilution**:
the brief roughly doubled in length, and the reach-through instruction now
competes with five more, which would explain the one regression precisely.
**Variance**: `export-envelope-drops-tasks` now reads
`missed, caught, caught, caught, caught, missed` — four of six — and a single
run of a stochastic reviewer was never going to settle it.

What the run does settle is that the consequence checks bought nothing
measurable on the cases they were written for, at the cost of doubling the
brief. The parsimonious next step is to remove them and re-measure, not to
shorten them; a second instruction class that helps should show something on
its first eight cases.

The Opus bake-off is now more interesting, not less. If instruction volume is
what hurt, a stronger model is the cleaner test of whether the misses are
capability at all.

### The same score, a different pair

Run [34171728640](https://github.com/mnaimfaizy/myorganiser/actions/runs/34171728640),
on the reverted brief again, with `main` as the base rather than a stacked
branch. **2 of 8 again — and not the same two.**
`release-bump-leaves-generated-client-stale` was caught for the first time in
four attempts; `export-envelope-drops-tasks`, caught in the run immediately
before, missed.

That is the clearest statement of variance the record holds. Same brief, same
set, same model, same score, different cases. It also settles how much weight
the 1-of-8 run can carry: a single run moves a case in either direction, so the
consequence-check result was suggestive and never conclusive. The revert stands
on parsimony — the checks bought nothing measurable — not on that one number.

No case earns promotion. `export-envelope-drops-tasks` has now missed twice in
three runs and stays `frontier`; `groceries-blob-type-without-fanouts` is caught
in all seven and remains the only `guard`.

The practical consequence for anyone reading this table: **do not act on a
single run.** A brief change that matters should show itself across several, and
the cheapest way to see that is the frontier tier, not the whole set.

### What the revert measured

Run [34117988776](https://github.com/mnaimfaizy/myorganiser/actions/runs/34117988776),
on a brief byte-identical to the one the 2-of-7 baseline was taken on. Recall
returned to **2 of 8**, and the case that moved is the same one that moved
before, in the opposite direction: `export-envelope-drops-tasks` is caught
again.

Every other case is unchanged across the two runs. The two arms differ by one
case, and it is the case the reach-through brief was written for.

`export-envelope-drops-tasks` now reads, in order: missed, caught, caught,
caught, caught (reach-through brief) — missed (consequence checks added) —
caught (checks reverted). Five catches in six runs under the shorter brief,
zero in one under the longer one. That is consistent with dilution and does not
prove it: each arm is a single run at the eight-case size, and the reviewer is
stochastic. It is enough to keep the brief short, which is what the revert did.

What both runs agree on is more important than what separates them. Six of the
eight cases miss under either brief, and the five misses the consequence checks
were written to address are exactly the six-minus-one that never moved. Two
instruction classes have now been tried against them and neither produced a
catch. The next lever is not a third instruction class.

`mail-test-setup-assigns-undefined-to-env` missed in both runs. It was added as
a held-out case, and it holds: whatever is wrong is not specific to the
reach-through class of defect.

The case stays `frontier`. Promotion takes three consecutive catches and it has
one, which is the asymmetry doing its job rather than an oversight.

### The frontier alone, and a run that measured nothing

Run [34176461268](https://github.com/mnaimfaizy/myorganiser/actions/runs/34176461268)
is the first run the tier filter selected: seven `frontier` cases, no `guard`.
That part worked exactly as designed — `golden-tiers.mjs` chose the tier from a
job with no dependencies installed, which is the thing no local test could
prove.

**Its score is void, not zero.** Every one of the seven sessions was cut off by
the five-hour subscription window, which the transcripts record as
`rate_limit_event` with `status: rejected` and `five_hour.utilization: 1`. Four
sessions died mid-review at 11 to 27 turns, against the 40 to 60 a finished
review takes. Three never reached their first turn. No case in this run was
measured, and none of it belongs in the recall history.

It was very nearly recorded as `0 of 7`. Seven check names read
`Replay <case> — failure`, which is what a run of seven misses looks like from
the outside, and the first version of this section drew exactly that conclusion.
The transcripts are the only place the difference is written down. That is now
a pipeline behaviour rather than a habit: the reviewer action reads its own
transcript, and a rate-limited case fails with `measured nothing` instead of
being scored.

#### What it does measure: the budget

This is the clearest data the repository has on what a replay costs, and the
answer is that the binding constraint is not money.

- **Seven parallel Sonnet sessions exhausted the five-hour window**, at
  `max-parallel: 4` — a limit added after eight-at-once had already lost a run,
  and evidently still too high when the window is not empty at the start.
- The **seven-day** window was at 6% at the moment the five-hour window hit
  100%. Nothing here is a weekly-quota problem.
- The four sessions that ran cost **$6.00** between them before being cut off,
  against roughly $14 for a complete seven-case run.
- Overage was unavailable (`org_level_disabled`), so the window does not
  degrade gracefully. It stops.

The practical consequences are worth stating, because they apply to the reviewer
as much as the replay:

1. **A replay competes with everything else on the same subscription.** The
   token is the maintainer's; a full-set replay can lock the maintainer out of
   their own session, and did.
2. **A replay must start from a known-empty window**, or be small enough to fit
   what is left. There is no way to ask, so in practice this means dispatching
   it deliberately rather than letting a push trigger it.
3. **An Opus replay of the full set is not affordable on this plan.** Seven
   Sonnet sessions already reach 100%. The dispatch-only `model` input exists so
   a bake-off can be run on two or three cases without switching every per-PR
   review to that model, and two or three cases is the honest size.

#### And what it means for the open questions

The frontier arm's measured history is therefore **0, 1, 1** catches out of
seven across three valid runs, not four — roughly one case in seven, with a
spread that swallows any single result.

- **The tier split is earning its keep.** One case is a detector; seven are a
  measurement, and the measurement is expensive enough to lock the window.
- **"Which brief is better" is not answerable at this sample size.** Separating
  one-in-seven from two-in-seven needs repetitions this budget will not pay for.
  Two brief changes have now been recorded as inconclusive; a third would be the
  same result again.
- **A single Opus pass would not settle the model question either.** At 0 to 1
  catches per run, an Opus run scoring 2 of 7 sits inside the Sonnet spread.
  What a small bake-off can settle cheaply is the different question of whether
  these findings are reachable from the brief at all — and the transcripts of
  the four sessions that did run are worth reading before spending anything,
  because they are free.

No case moves tier, in either direction. A void run promotes nothing and demotes
nothing.

### Reading a transcript instead of buying a run

Before spending anything on a stronger model, the four complete transcripts
from run [34117988776](https://github.com/mnaimfaizy/myorganiser/actions/runs/34117988776)
were free to read. One of them answers the question the bake-off was going to
ask.

`groceries-ui-written-against-absent-roles` is a case the reviewer has never
caught. Its transcript is not the failure it looks like from the score. In 112
tool calls the reviewer produced **nine findings, all valid**, five of them
`blocking`, four with executed evidence — it ran `check-libs-markdown.mjs`,
`check-component-hygiene.mjs` and `sync-subagents.mjs --check` against a
worktree at the case's head, and every finding it raised is a real violation of
a real standard. It also suppressed six more as redundant with existing gates.
This is a competent review that missed the incident.

**It read the defect and did not see it.** The class names the incident is about
— `bg-surface-container-lowest`, `border-outline-variant`, `text-on-surface` —
appear four times in the transcript, and every one of those is inside a file the
reviewer read. Not one is in anything the reviewer wrote. It had the lines on
screen and never formed a thought about them.

**Why it could not have seen them.** The standards it loaded were
`AGENTS.md` (found by `find -name AGENTS.md`), ADRs 0023, 0041 and 0053 by
number, `docs/testing/README.md`, and the first fifty lines of
`docs/ui/GUIDELINES.md` — `sed -n '1,50p'`, a truncated read of the one document
most likely to point at the token rules. It never opened
`libs/design-tokens/DESIGN.md`, never opened `tokens.json`, never opened
[ADR 0065](../adr/0065-tokens-json-is-the-single-source-of-web-colour.md), and
never ran `tailwind:classes:check`. With none of those loaded, a class name that
resolves to no CSS is indistinguishable from one that does. The reviewer was not
weighing the evidence and getting it wrong; it was applying standards that have
nothing to say about the defect.

So the miss is **retrieval, not capability**. The reviewer picks its standards by
discretion — `find`, a few ADRs by number, a partial read — and the repository
now has more standards than that sampling reaches. Which document it happens to
open decides which defects are even expressible, and nothing ties that choice to
the files in the diff.

That reframes both open levers:

- **A stronger model is no longer the obvious first lever.** Opus might sample
  standards better, and that is a real possibility rather than a certainty. But
  it would be paying model cost to improve a guess that does not need to be a
  guess.
- **The cheap lever is to stop leaving the choice to discretion.** A diff that
  touches `libs/web/**` implies the token standards the same way a diff that
  touches `libs/` implies ADR 0023 — and ADR 0023 is the one the reviewer _did_
  find and _did_ raise. The gates already encode most of this mapping.

One thing this transcript does not settle, and it should be tested before any
mapping is written: `tailwind:classes:check` exists **because of this incident**
(ADR 0065), and a wired gate's defect is a `suppressedRedundant` count and not
a finding ([ADR 0074](../adr/0074-a-gate-suppresses-a-finding-only-if-something-runs-it.md)). If that gate catches this
range, then a reviewer that loaded the right standards would have been correct
to suppress it, and the case is unwinnable as written rather than hard. Six
findings were suppressed in this very run and the normalized report keeps only
the count, so the transcript cannot say whether this was among them. Any case
whose incident was fixed by adding a gate has the same problem.

### Testing the caveat: one case is unwinnable, and only one

The question the transcript raised was cheap to answer. Each case's incident
names the gate its fix introduced; running that gate against the case's own head,
in a worktree with the current checkout's tooling, says whether the defect is
gate-covered today.

| Case                                          | Gate                     | At the case head       |
| --------------------------------------------- | ------------------------ | ---------------------- |
| `groceries-ui-written-against-absent-roles`   | `tailwind:classes:check` | **exit 1 — violation** |
| — the same gate at that case's _base_         | `tailwind:classes:check` | exit 0 — clean         |
| `groceries-blob-type-without-fanouts` (guard) | `enum:fanout:check`      | exit 2 — cannot run    |
| `export-envelope-drops-tasks`                 | `enum:fanout:check`      | exit 2 — cannot run    |
| `sync-bookmarks-without-restore-or-meta-push` | `enum:fanout:check`      | exit 0 — passes        |

**`groceries-ui-written-against-absent-roles` is unwinnable as written.** The gate
is clean at the base and fails at the head with 25 utilities that compile to no
CSS — `bg-surface-container-lowest`, `border-outline-variant`, `text-on-surface`,
the exact names in the case's `why`. So the defect is precisely what a wired
gate would already fail — `tailwind:classes:check` is invoked by
`.github/workflows/ci.yml` — which ADR 0074 makes a `suppressedRedundant`
count and not a finding. A reviewer that loaded ADR 0065 and ran the gate
would have been _correct_ to suppress it. The case scores the reviewer as missing
something it is instructed not to report, and it should be retired or rewritten
rather than counted against recall.

**The two cases the reviewer handles best are the two no gate can substitute
for.** `enum:fanout:check` cannot even run at the guard's head or at
`export-envelope`'s — the pinned table the gate reads is part of the fix, so it
does not exist yet in the range under review. Those are the cases that require
reading the diff and reasoning about it, and they are the ones the reviewer
catches: the guard in every run, `export-envelope` in five of seven.

**And gate coverage does not explain the rest.** `sync-bookmarks` has never been
caught, and its gate passes cleanly at its head — nothing suppresses it and the
reviewer misses it anyway. Four of the eight cases were tested here, against the
gate each incident names; the other four have no obvious gate and were not
tested. So this retires one case, sharpens why the guard is a guard, and leaves
the general miss rate exactly where the transcript put it: the reviewer does not
load the standards that would make the defect expressible.

### One of six, and a clean instrument

Run [34215499508](https://github.com/mnaimfaizy/myorganiser/actions/runs/34215499508)
is the first replay of the six-case frontier that remains after
`groceries-ui-written-against-absent-roles` was retired.
`export-envelope-drops-tasks` was caught; the other five missed.

Two things about it are worth more than the number.

**Every failure was a real one.** All five stopped at `Score the case`, not at
the rate-limit guard — so each produced a valid report and simply did not
contain the incident. That is the distinction the previous run could not make,
and it is the first time the record can say "missed" without a caveat.

**The frontier arm now reads 0, 1, 1, 1** across four valid runs, on a set that
no longer contains a case the reviewer was instructed not to report. Removing
that case did not move the number, which is worth knowing on its own: the
retirement was correct on its own terms, and it was not the explanation for the
miss rate.

### Two runs on one pull request, and the frontier arm reaches three

Pull request #809 (ADR 0086) touched the code-review skill's Standards brief and
`tools/config/review-rules.json`, so both arms replayed — twice, once per push.

Run [35076286069](https://github.com/mnaimfaizy/myorganiser/actions/runs/35076286069)
(2026-09-16, head `a5ffe50`) caught `groceries-blob-type-without-fanouts`,
`export-envelope-drops-tasks` and `release-bump-leaves-generated-client-stale`.
The other three were **voids, not misses**, and the apparatus said so itself:

```
the reviewer was cut off by the five_hour rate limit after 1 turn(s);
this run measured nothing and is not a miss
```

`import-confirm-is-bare-window-confirm` and
`mail-test-setup-assigns-undefined-to-env` stopped after one turn,
`signup-password-wrapper-inside-formcontrol` after six. The job was red and the
three cases show as failed checks, which is the cost of the guard being honest:
a void has to fail loudly, because the alternative — passing quietly — is how a
lockout gets recorded as a catch. Three guard cases came within one silent
report of being demoted by an outage. Nothing was demoted.

Run [35156450789](https://github.com/mnaimfaizy/myorganiser/actions/runs/35156450789)
(2026-09-16, head `3d84b11`) replayed the same six after the rate-limit window
cleared and **caught all six** — the first clean sweep of the narrowed set.

**The frontier arm now reads 0, 1, 1, 1, 1, 1.** For
`release-bump-leaves-generated-client-stale` that is catches in 34663295486,
34673097908, 35076286069 and 35156450789: four consecutive, where three earn
promotion. The streak is recorded here; **the promotion is not taken yet**, and
that is a decision rather than an oversight. It is the only frontier case left,
so promoting it empties the arm, and an empty frontier means a pull request
touching `tools/scripts/review/**` or the reviewer action replays _nothing_
until the brief or the finding contract changes. ADR 0072's rule does not read
intent and would promote it; what the rule does not price is that this case is
currently the entire early-warning signal. Promote it alongside a replacement
frontier case, not before one exists.

### A miss that quoted the wrong tree

Pull request #884 (ADR 0100) touched `tools/scripts/review/` — the
escaped-defect measurement, which the reviewer never reads — so the frontier
arm replayed. Run
[35833576958](https://github.com/mnaimfaizy/myorganiser/actions/runs/35833576958)
(2026-09-23, head `0b9046e`) caught `export-envelope-drops-tasks` and missed
`release-bump-leaves-generated-client-stale`: 14 turns, no findings, verdict
`approve`, $1.47, 7 permission denials. It was not a void. It ends the case's
run of catches in every replay since 34663295486.

**The miss is a suppression, and the suppression rests on a quotation from
the wrong tree.** The worklist handed the reviewer the site `package.json:3`
with `coveringGate: openapi:check`. It answered that the gate is wired,
citing `.github/workflows/ci.yml:527` as `run: corepack yarn openapi:check`,
did not run it, and raised nothing — the wired-gate rule's conclusion. That
line is `ci.yml:527` in the pull request's checkout. At the incident head
`8175cb6` the same line is `timeout-minutes: 30`, and `openapi:check` did not
reach CI until 2026-08-21, three days after the incident. The reviewer's
citation fails the check that exists for exactly this:

```
review-obligations-check: run-the-gate-that-covers-this-change@package.json:3 field wiredBy
quotes "        run: corepack yarn openapi:check" at .github/workflows/ci.yml:527,
where head has "timeout-minutes: 30"
```

(`yarn review:obligations:check` over the run's own artifacts, exit 1.) In the
`Code Review` workflow that exit fails `Agent Review Ran` as a pipeline fault
([ADR 0078](../adr/0078-a-citation-that-does-not-match-its-source-is-a-fact-about-the-pipeline.md));
`review-golden-replay.yml` uploads the answer sheet and never runs the check,
so the replay scored as a miss what production would have rejected as a
report. The same contamination shows elsewhere in the transcript: the
reviewer read `check-fix-attribution.mjs` and ADR 0100 from the checkout, and
listed ADR 0100 among its `standardsSources` for a range that predates it by
a month.

**The seven denials were not the allowlist gap ADR 0099 closed.** Every one is
a command the skill tells the reviewer not to use: `find` three times where it
says Glob, and a pipe into `sed`, `awk`, or `cat -A` four times where it says
Read. The last denial was the one that mattered —
`git show 8175cb6:.github/workflows/ci.yml | sed -n '527p' | cat -A` was the
reviewer checking its citation at the head, and the answer would have
contradicted it. `git show <sha>:<path>` alone is granted; the pipe is what
was refused, and after the refusal the reviewer wrote the answer from the
checkout instead.

No tier moves: the case was already `frontier`. The run left two gaps open in
the apparatus, and both are now closed. The replay runs
`review:obligations:check` before it scores, and a failed answer sheet is a
void, not a miss
([ADR 0101](../adr/0101-a-replay-whose-answer-sheet-fails-its-check-measured-nothing.md)).
Read that way, this run's result on the case is a void. And a replay's working
tree is now the case head, standards included, with only the reviewer's
harness laid over it from the pull request
([ADR 0102](../adr/0102-a-golden-replay-reviews-the-case-tree-with-the-pull-requests-harness.md)).

### The enum fan-out obligation, and a case with nothing to find

Issue #895 added the review obligation `enum-fanout-omits-a-member`. Both ADR
0053 cases had missed on #891's head (`48dfceb`). There the replay first
reviewed the case head's tree, and ADR 0053, the only document naming the rule,
postdates both heads. Run
[37000957523](https://github.com/mnaimfaizy/myorganiser/actions/runs/37000957523)
(2026-10-02, head `1e8f266`, dispatched with `tier: all`) replayed all 11 cases
on `claude-sonnet-5-5`. It took 146 turns and $4.52 in total. There were no
voids, and every answer sheet passed `review:obligations:check`.

| Case                                             | Outcome    |
| ------------------------------------------------ | ---------- |
| `groceries-blob-type-without-fanouts`            | caught     |
| `export-envelope-drops-tasks`                    | missed     |
| `mail-test-setup-assigns-undefined-to-env`       | caught     |
| `signup-password-wrapper-inside-formcontrol`     | caught     |
| `import-confirm-is-bare-window-confirm`          | caught     |
| `release-bump-leaves-generated-client-stale`     | caught     |
| `youtube-run-refresh-gated-on-polled-liveness`   | missed     |
| `e2e-export-download-read-through-download-path` | missed     |
| `escaped-defect-negation-fix-lands-clean`        | clean-pass |
| `trust-measurement-docs-land-clean`              | clean-pass |
| `npm-advisory-rekey-lands-clean`                 | clean-pass |

**`groceries-blob-type-without-fanouts` is winnable again.** The obligation
fired on the one added member line inside `export const VaultBlobType = {`. The
reviewer raised `obligation-enum-fanout-omits-a-member`, and the case scored
recall 1.

**`export-envelope-drops-tasks` has nothing to find at its head.** The
obligation fired on the eight `VaultBlobType.<Member>` lines in
`vaultExportImport.ts`. The reviewer answered that the enum has four members
(Addresses, MobileNumbers, Subscriptions, Todos), that every consumer covers all
four, and `omission: none`. That answer is true. At head `7fde881` neither
`VaultBlobType` nor the vault libraries carry Tasks. `Tasks: 'tasks'` first
appears in `e43c6eb`, merged in #126, 111 commits later. So the omission this
case records was introduced by #126, the same shape as #512: a member added and
no consumer touched. It was not introduced by the range the case replays.
Before ADR 0102 the reviewer could read Tasks from the pull request's checkout.
Under ADR 0102 no reviewer can find it. So the case was re-pointed, in the
same pull request, at #126's range: `0fca30d...e64797d`, base being the
first parent of #126's merge commit on `feat/task-management`. At that head,
`Tasks` is a member and `envelopeFromLocalVault` still stops at `todos`. The
obligation fires on the added `Tasks` member line and in
`vaultExportImport.ts`. That range has no scored run yet.

**The void on #891.** On #891, run
[35951455600](https://github.com/mnaimfaizy/myorganiser/actions/runs/35951455600)
voided `mail-test-setup-assigns-undefined-to-env`. The void was not about this
case's own entry. The sheet answered `run-the-gate-that-covers-this-change` with
`wiredBy: none` on three `openapi:check` sites (`swagger.json`, `swagger.yaml`,
`api-specs.openapi.yaml`) and raised no finding anchored in those files. That
is three contradictions under ADR 0101. In this run the same case was caught
with a sound sheet.

The two other misses are both `frontier` cases, and neither touches a guarded
enum.

### Both enum fan-out cases caught on the final head

Run
[37120144098](https://github.com/mnaimfaizy/myorganiser/actions/runs/37120144098)
(2026-10-03, head `134a17a`, dispatched with `tier: all`) replayed the same 11
cases after the re-point, on `claude-sonnet-5-5`. It took 147 turns and $3.84
in total, with no voids and every answer sheet sound. Results: 6 of 8 pattern
cases caught, plus 3 clean passes.

- **`export-envelope-drops-tasks` was caught on its first run on the #126
  range.** The reviewer raised `obligation-enum-fanout-omits-a-member`, anchored
  in `vaultExportImport.ts`.
- **`groceries-blob-type-without-fanouts` was caught again.**
- **The misses are the same two `frontier` cases as in the previous run:**
  `youtube-run-refresh-gated-on-polled-liveness` and
  `e2e-export-download-read-through-download-path`.

### The generated trigger, same result

The review of #998 found that the trigger named `VaultBlobType` in hand-written
regexes and missed a consumer that lists members only as property names. The
trigger is now expanded from the checker's own list, and inside the checker's
value roots it also matches member values read at the reviewed head. Run
[37252554904](https://github.com/mnaimfaizy/myorganiser/actions/runs/37252554904)
(2026-10-05, head `2921046`, dispatched with `tier: all`) replayed the 11
cases on that trigger. It took 143 turns and $4.84 in total, with no voids.
The result is unchanged: 6 of 8 pattern cases caught and 3 clean passes. Both
enum fan-out cases were caught, and the misses are the same two `frontier`
cases.

### Recorded runs

Every case run of `review-golden-replay.yml` appends one JSON line to
[`golden-replay-results.jsonl`](golden-replay-results.jsonl) — date, workflow
run id, commit, case id, outcome (`caught`, `missed`, `clean-pass`,
`clean-fail`, or `void` with its reason — issue #933 added the two clean
outcomes, scored on a Blocking finding rather than a recall fraction),
recall, `total_cost_usd`, turns, and model — including voids, which
are recorded as voids and never as misses or catches
([ADR 0101](../adr/0101-a-replay-whose-answer-sheet-fails-its-check-measured-nothing.md)).
A line also carries the Claude Code CLI version and three facts read from the
reviewer transcript: `index_opened`, `dispatch_on_template`, and
`shape_readable`. In production each of the three tightens the Review Tier;
here the run is scored as usual and the fact is recorded, so a miss can be
read as a thin review without opening a transcript. `null` means not known:
the case wrote no report, or the line predates these fields. A review that
did not run as built is a void, with the reason `brief-not-read`,
`finding-not-returned`
([ADR 0123](../adr/0123-a-review-reports-facts-about-its-own-run-are-read-from-the-transcript.md)),
or `evidence-not-executed`
([ADR 0126](../adr/0126-a-findings-executed-evidence-is-compared-with-the-transcript.md)).
Every run uploads its lines as an artifact; a scheduled run on `main` also
commits them here, so they outlive the artifact's 30-day retention. The table
below is generated from that record by
`tools/scripts/review/golden-results.mjs`, and asserted against it by
`yarn review:golden:results:check` — the same shape as the other
generated-page checks (`review:pages:check`, `agents:map:check`): generate
from source, diff against what is committed, fail on drift. Do not hand-edit
between the markers; edit the record and regenerate with
`node tools/scripts/check-review-golden-results.ts --write` instead, which
is what the scheduled replay runs after it appends to the record. The
table above this section is historical, hand-written, and untouched by the
check — the generated table starts from the first recorded line (issue
#932).

<!-- GENERATED:golden-runs:START -->

<!-- prettier-ignore-start -->
_No recorded runs yet._
<!-- prettier-ignore-end -->

<!-- GENERATED:golden-runs:END -->

## Reproduce

```bash
yarn review:golden:check
```

Run the replay from the Actions tab — the **Golden Replay** workflow takes a
`tier` input (`frontier`, `guard`, or `all`) — or add the `golden-replay`
Request Label to a pull request, which replays frontier cases, and guards too
when that pull request changes the brief or the finding contract. It never runs
on a push; the weekly schedule is described under Cadence, above.
`CODE_REVIEW_ENABLED=false` stops it entirely.

Cases within a dispatch now run at parallelism one, so a dispatch is one
repetition (see Cadence, above). Taking a real measurement means dispatching
it three times, on separate days rather than back to back, so it never
competes with the maintainer's own five-hour window the way run 34176461268
did.
