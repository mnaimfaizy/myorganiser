# Effective-false-positive rate

**Kept current.** This is the running record for what the reviewer _costs_,
and the sibling of [`escaped-defect-rate.md`](escaped-defect-rate.md), which
records what it misses. Append a measurement per run and keep the ledger
honest; do not freeze it at a date. Interpretation — why a number is what it
is, what a change to the reviewer did to it — belongs in a dated Research
Brief under `docs/research/`, which is frozen and never edited
([ADR 0041](../adr/0041-internal-notes-have-homes.md)). The numbers live here
because they must stay current; the reasoning lives there because it must not.

What the number means, and every separation it rests on, is
[ADR 0079](../adr/0079-an-effective-false-positive-is-a-finding-nobody-acted-on.md);
this file carries the measurements, not the decisions. The reasoning behind
the first entry is
[the 2026-09-11 brief](../research/2026-09-11-inaction-needs-a-stable-identity.md).

## The question

**Per rule, what share of the findings it raised were still there on the next
push?**

A finding nobody acts on costs attention whether or not it was correct, and
"was it correct?" cannot be answered without a human labelling every comment.
So inaction is the signal, and correctness is deliberately not the question.
The term is Google's: an issue is an _effective_ false positive "if developers
did not take some positive action after seeing the issue".

This is not a measure of whether the reviewer is right. Nothing here records
that. It is a measure of whether the reviewer is worth reading.

## What the script does

```bash
yarn review:noise:measure --days 30
```

`tools/scripts/review/measure-noise.ts` gathers; the classification and the
arithmetic are pure, in `tools/scripts/review/noise.ts`, and covered by
`yarn review:test`.

- **The evidence** is the review's own stored artifacts. Every run of the Code
  Review workflow uploads the normalized report it validated
  (`code-review-normalized`, `retention-days: 30`), so a branch's review
  history is a sequence of reports, one per reviewed push.
- **The unit** is an observation: one finding, at one push, compared against
  the next push's report. A finding still there across three pushes is two
  ignored observations, because it cost attention on both.
- **One push, not one run.** The review runs again on the same head whenever
  somebody asks it to — the `agent-review` label, a `/code-review` comment, a
  re-dispatch — and two runs at one head have no push between them. The newest
  run at a head wins; pairing them would compare a report with itself and read
  every finding in it as ignored.
- **Every observation lands in exactly one class.** `acted-on` and `ignored`
  are the fraction; `pending`, `unreadable`, and `incomparable` are set aside
  by name and counted, so the denominator is auditable rather than whatever
  survived a filter.

## The opt-out marker

A line in a commit message takes one finding out of the numerator:

```
Review-ack: 4f2a91c0b8de — real, deferred to the follow-up issue
```

It is **optional and never required** — the measurement works with nobody ever
typing it, which is the point of reading inaction instead of asking for a
label. It is for the case where the author read the finding, agrees it is
real, and is deliberately not acting on it now: that inaction is not silent,
and counting it as noise would penalise a rule for working.

- It names the **finding id** the report prints under every finding, never a
  rule id. An id can only have come from the finding itself; a rule id would
  excuse findings the author never saw.
- It must start a line, like `Closes #N`. A sentence mentioning the marker is
  prose, not an acknowledgement.
- The commits read are the ones **between the two pushes** — the push that
  answered the review.
- It is written **once**. An acknowledgement holds for every later push the
  finding survives, so nothing has to be re-typed; it never reaches backwards,
  so inaction already observed stays observed.
- An acknowledged observation is set aside from the denominator too. The
  marker can only ever remove evidence about a rule, never create it.

## The budget

**10% effective false positives per rule**, judged only once a rule has **10
observations**.

The number and the definition are both borrowed from Google's Tricorder, where
producing "less than 10% effective false positives" is one of the criteria an
analyzer must meet to be on by default (Winters, Manshreck & Wright,
_Software Engineering at Google_, O'Reilly 2020, ch. 20 "Static Analysis"; the
ecosystem is Sadowski et al., "Tricorder: Building a Program Analysis
Ecosystem", ICSE 2015). It is the only noise threshold in the published
literature that arrives with a mechanism attached rather than as an opinion,
and borrowing the definition while inventing a different number would be worse
than borrowing both.

The two numerators are not identical. Google's is narrower — a "Not useful"
click means somebody read the finding — and this one is broader, because a
finding still present on the next push counts even if nobody opened it; it is
narrower in one respect, since an acknowledged finding is set aside here and
has no counterpart there. Which way the bias runs is unmeasured. That is
exactly why the budget is a marker to read the rate against and not a
threshold anything acts on.

The ten-observation floor is arithmetic, not taste: below ten observations a
single ignored finding is already more than ten percent, so a rule with nine
observations cannot be within budget for any reason except how few findings it
happened to raise. Under the floor a rule is reported as
`insufficient-evidence`, which must not be read as `within-budget`.

**No rule is disabled on this number.** Not automatically, and not by anything
built in this slice. The automatic disable needs a month of data before its
threshold means anything; it is the follow-up slice this one blocks
([ADR 0079](../adr/0079-an-effective-false-positive-is-a-finding-nobody-acted-on.md)
item 6).

## Measurements

Newest last. "Observations" is the denominator — findings paired against a
next push — and "ignored" is the numerator.

| Date       | Window                   | Pushes | Observations | Ignored | Rate               | Rules over budget |
| ---------- | ------------------------ | -----: | -----------: | ------: | ------------------ | ----------------- |
| 2026-09-11 | 2026-08-12 to 2026-09-11 |      0 |            0 |       0 | **not measurable** | —                 |
| 2026-09-28 | 2026-08-28 to 2026-09-27 |    124 |           67 |       6 | **9.0%**           | `standard-other`  |
| 2026-10-05 | 2026-09-05 to 2026-10-05 |    605 |          281 |      27 | **9.6%**           | four — see below  |

### The first measurement (2026-09-11)

Taken on `slice/729-code-review-trust-effective-false-positi`, where there is
no authenticated `gh`: no workflow run was listed and no stored report was
read, and the report says so in its evidence block.

**The rate is not measurable, and it would not have been measurable with `gh`
either.** An observation needs two stored reports at the same report schema
version, and the current version is the one that carries `ruleId` in the
identity tuple (issue #724) — which lands with this measurement. Every pair in
CI history today is therefore `incomparable` by construction rather than by
accident.

That is worth recording rather than working around. Run over the history that
does exist, this measurement would have reported a **perfect 0% for every
rule**: while identity was free-form prose, the persisting count was zero in
38 of 38 consecutive reports (issue #718), so every finding's id changed on
every push and every finding looked acted on. The most flattering number this
measurement can produce is also the one a broken identity produces. The
interpretation is in the frozen brief.

### The second measurement (2026-09-28)

The first taken with an authenticated `gh` and the first with a stable
finding identity (issue #724), so observations could be paired at all.
Taken for issue #925.

- **9.0% overall**: 94 findings observed across 124 reviewed pushes on 27
  branches; 67 counted, of which 61 were acted on and 6 ignored; 1
  acknowledged with `Review-ack`; 8 pending and 18 unreadable (the next
  push produced no report).
- **One rule over budget: `standard-other`**, 2 ignored of 12 (16.7%).
  `spec-requirement-implemented-wrong` sits exactly at the budget (1 of 10).
  `smell-duplicated-code`, the most frequent rule, is within it (1 of 15).
  Every other rule is under the ten-observation floor.
- **The window may be incomplete**: the run listing hit its limit of 200
  runs, and 45 of the 124 pushes carry no stored report.
- The saved gather is kept out of the tree for size (about 0.6 MB); see #925.

The interpretation is in
[the 2026-09-28 brief](../research/2026-09-28-the-first-trust-measurements-with-gh.md).

### The third measurement (2026-10-05)

Taken for issue #940, and the last at report schema version `3`.

- **9.6% overall**: 520 findings observed across 605 reviewed pushes on 140
  branches; 281 counted, of which 254 were acted on and 27 ignored; 9
  acknowledged with `Review-ack`.
- **Four rules over budget**: `spec-requirement-missing` (9 of 35),
  `spec-requirement-implemented-wrong` (4 of 31), `standard-other` (3 of 26),
  and `smell-duplicated-code` (6 of 59).
- **The window may be incomplete**: 362 of the 605 pushes carry a stored
  report, and nine pushes' commit messages could not be read.
- The saved gather is kept out of the tree for size; see #940.

**Read this number as an overstatement.** Every id that survived a push in
this window was read by hand: of 36, 15 labelled a different defect the second
time — a defect fixed and another raised under the same rule in the same file.
Fourteen were counted here as ignored and one as acknowledged. By those labels the rate is about 4.6%, and only
`spec-requirement-missing` is over budget. The same bias is in the second
measurement and was not measured there.

It is the last measurement it applies to. From report schema version `4` an
id is carried forward only onto a finding of the same axis, rule, and file
whose lines overlap the earlier one's
([ADR 0071](../adr/0071-a-finding-blocks-only-on-evidence-and-a-verdict-is-computed-never-written.md)
item 6), and every pair stored before that is `incomparable`, so the next
entry starts from an empty ledger. The interpretation is in
[the 2026-10-05 brief](../research/2026-10-05-a-finding-id-is-carried-not-rederived.md).

## Reproduce

```bash
yarn review:noise:measure --days 30 --out tmp/noise.md --json tmp/noise.json
```

Useful flags: `--since` / `--until` for an explicit window, `--branch` to
measure one branch, `--limit` for how many workflow runs to list, `--workflow`
for a workflow other than `code-review.yml`, `--no-github` to force the
evidence-free run, and `--save-gather` / `--gathered` to record the evidence
once and re-measure from it.

**Save the gather.** The artifacts expire after 30 days, so a window that has
passed cannot be gathered again; a saved gather is the only durable record of
it.

The script is **not a gate** — it measures weeks of other branches' pushes,
has nothing to fail on for the commit in front of it, and reaches the network.
It carries a written opt-out in `tools/config/gate-coverage-optout.json`,
which `yarn gates:coverage:check` enforces the existence of.
