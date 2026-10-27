# A golden case stands on its catch rate over its last ten scored runs

## Status

accepted

Supersedes item 2 of
[ADR 0072](0072-a-golden-case-earns-its-replay-frequency.md) — promotion on
three consecutive catches, demotion on one miss — and the "one repetition" of
its item 8 for the scheduled replay only. The tiers themselves, `parked` and
`retired`, the rule that promotion may not empty the frontier, and item 8 for
a label or a dispatch all stand.

## Context

ADR 0072 moved a Golden Case between `frontier` and `guard` by streak: three
consecutive catches promote, one miss demotes. The asymmetry was deliberate,
and it was written when the set had eight cases and a few runs each.

The record since says what a streak rule does to a case near half
(issue #925, measured 2026-09-28):

- **`export-envelope-drops-tasks` was caught 19 times and missed 19.** Under
  the streak rule it was promoted twice and demoted twice. Each move was the
  rule applied correctly, and none of them was information: a coin lands
  heads three times running one time in eight.
- **One run per case decides nothing.** ADR 0072 item 8 already says a single
  run is not a measurement, and then lets a single run demote a case.
- **The streak could not be read from anywhere.** It lived in a hand-written
  history column and in `tierEvidence`, so a promotion was a person noticing
  one. `release-bump-leaves-generated-client-stale` reached six consecutive
  catches and stayed `frontier` because nobody took the promotion.

What was missing was a record to read a rate from. Issue #932 added one:
`docs/review/golden-replay-results.jsonl`, one line per case run, voids
included.

## Decision

**A Golden Case stands where its catch rate over its last ten scored runs puts
it, read from the results record.**

1. **The window is the last ten scored runs.** A scored run is a `caught` or
   `missed` pattern case, or a `clean-pass` or `clean-fail` clean case; a
   clean pass counts as a catch. A void is not a scored run — it measured
   nothing ([ADR 0101](0101-a-replay-whose-answer-sheet-fails-its-check-measured-nothing.md)).
2. **Eight or more catches of ten: the case stands at `guard`.** A case the
   reviewer catches half the time reaches eight of ten about one window in
   eighteen.
3. **Five or fewer of ten: the case stands at `frontier`.** A case the
   reviewer catches nine times in ten falls that low about one window in six
   hundred.
4. **Six or seven of ten: the case stays where it was.** One cut-off at eight
   would demote a nine-in-ten case about one window in fourteen, which is the
   flicker this decision removes. The band is what makes a move mean
   something.
5. **Under ten scored runs, nothing moves.** The case stands at the `tier` the
   set declares. A rate over three runs is the streak rule again.
6. **The tier filter follows the record.** `golden-tiers.ts` selects by where
   a case stands, so the weekly replay picks up a move with nobody editing the
   set. The declared `tier` is where a case starts; the ledger's standing
   table, generated from the set and the record and asserted by
   `yarn review:golden:results:check`, shows each case's rate, its number of
   scored runs, and where it stands.
7. **Promotion still may not empty the frontier.** When the record would leave
   no case at `frontier`, the promoted case with the fewest catches in its
   window stays there, and the table says so.
8. **The weekly scheduled replay runs each frontier case three times.** A
   guard runs once. A label or a dispatch stays one repetition per case, as
   ADR 0072 item 8 decided. `yarn review:golden:check` asserts the count.
9. **A regression is a move, not a run.** A reviewer change is judged to have
   hurt a case when the case's standing falls to `frontier`, and to have
   helped when it rises to `guard`. A single red or green replay is one
   scored run of ten.

The thresholds were decided by the maintainer on 2026-10-01 in issue #937.

## Consequences

A case no longer changes tier on one run. The price is latency: a real
regression takes several scored runs to show as a move, where the streak rule
showed it — and every false one — after a single miss.

Standing spend rises. ADR 0109 put the weekly run at one session per frontier
case; it is now three. With seven cases at `frontier` that is 21 reviewer
sessions in a week the reviewer moved, at about $2.54 a session
(ADR 0109's figure), against the subscription's five-hour window. They still
run one at a time, at 03:00 UTC on a Monday. A session the window cuts off is
recorded as a void and does not count toward any window of ten.

Windows fill slowly. Only the scheduled replay commits to the record, and it
runs only in a week a reviewer input moved. At three runs a week a frontier
case takes at least four such weeks to reach ten; a guard, at one run a
month, takes most of a year. Until then the declared tier holds, so the
declared tiers and their `tierEvidence` stay worth reading.

The scheduled replay now commits two files, the record and the ledger it
regenerates from it. Committing the record alone would fail
`review:golden:results:check` on `main` for a drift no pull request made.

The set's behaviour now depends on a file as well as on the set. ADR 0072
rejected that once, for want of a scoreboard CI could write and a reviewer of
the set could see. The record is that scoreboard, it is committed, and the
table generated from it sits in the ledger next to the tier history.

## Alternatives considered

- **Keep the streak and require more catches.** Rejected. Any streak rule
  demotes on one miss or it is not a streak rule, and one miss is the noise.
- **One cut-off, no band.** Rejected for the arithmetic in item 4.
- **A longer window.** Rejected for now. Twenty runs would tighten the rate
  and take twice as long to fill, and ten already takes a month.
- **Compute the standing and leave the move to a person.** Rejected. The
  streak rule had exactly that step, and an earned promotion sat untaken. A
  status that needs a follow-up edit is a status nobody edits
  ([ADR 0097](0097-an-adr-is-authored-accepted.md) removed the same step for
  the same reason).
- **Three repetitions on a label or a dispatch too.** Rejected. Those are
  asked for by a person who is usually waiting, and ADR 0072 item 8 spreads
  their repetitions over separate days to keep the five-hour window free.
