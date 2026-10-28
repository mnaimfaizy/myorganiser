# An escaped defect is one the reviewer saw and passed

## Status

accepted

## Context

Nothing in this repository measures whether a human can rely on a passing
code review. Golden recall
([ADR 0072](0072-a-golden-case-earns-its-replay-frequency.md)) scores the
reviewer against curated historical defects, which makes it a regression
signal: it says whether a change to the reviewer moved cases the reviewer has
already been shown. It cannot say anything about the next diff, and
[the results record](../review/golden-replay-results.md) has said so from its
first entry.

The trust question is the other direction, and the archaeology for it already
exists in one form: the golden set grows by tracing a merged defect back to
the Pull Request that introduced it. Turned around and run over the fix
history, the same work yields a rate.

A rate is only worth publishing if its denominator is auditable, and there are
several ways to compute a number here that would flatter the reviewer without
anybody noticing. This ADR fixes the definitions before the numbers accumulate
against them.

## Decision

1. **The escaped-defect rate is the trust measure, and golden recall is not.**
   The rate is: of the Pull Requests the reviewer **passed** inside a window,
   what fraction a later fix names as root cause. Both records stay —
   [`golden-replay-results.md`](../review/golden-replay-results.md) for
   recall, [`escaped-defect-rate.md`](../review/escaped-defect-rate.md) for
   trust — and neither number is quoted as the other.

2. **Passed means not blocked: `approve` and `comment` both.** `Agent Verdict`
   fails only on `request-changes`
   ([ADR 0073](0073-a-required-check-is-a-fact-about-the-pipeline-not-a-judgment-about-the-diff.md)),
   so a `comment` verdict is work the reviewer let through, and a defect
   surviving it is exactly as escaped as one surviving an `approve`. The
   report names the verdict as well as the bucket, because which of the two it
   was is what a reader judges the miss by.

3. **Seen and passed is separated from never seen, and from blocked.** A Pull
   Request merged before the reviewer existed, or whose review produced no
   usable report, is not an escape — nothing passed it. A `request-changes`
   that a maintainer merged anyway is the reviewer working and a human
   overriding it. Each is reported in its own class and never in the
   numerator.

4. **An unattributable fix is counted, never dropped.** Every fix in the
   window lands in exactly one class, including the ones that name no root
   cause, that name one nothing can resolve, or that name one which cannot be
   causal. A denominator is only worth reading if nothing was filtered out of
   it silently.

5. **An empty denominator reports `not measurable`, never 0%.** Zero reads as
   "the reviewer passed work and none of it broke", which is the opposite of
   "the reviewer has passed nothing yet" — and the second is the true state
   until enough Pull Requests have been through the pipeline.

6. **The attribution vocabulary is short, written down with reasons, and
   narrowed by measurement rather than by argument.** A wrong attribution
   corrupts the numerator permanently; unrecognised phrasing lands in
   `unattributed`, where it is visible in every report. When the evidence says
   a marker fires on ordinary prose, the marker goes.

7. **The measurement is not a gate.** It reads months of merged history and
   the network, and has no fact to assert about the commit in front of it, so
   it carries a written opt-out in `tools/config/gate-coverage-optout.json`
   under the Meta-Gate's own rule
   ([ADR 0043](0043-gates-assert-facts.md)) —
   a declared non-gate with a reason, not a silent exemption.

## Consequences

- The number this measures cannot be reported yet: the reviewer went live on
  2026-09-06 and the first measurement's denominator is empty
  ([the 2026-09-11 brief](../research/2026-09-11-the-escaped-defect-denominator-is-empty.md)).
  That is a fact worth recording rather than a reason to wait before defining
  the terms.
- **A fix that names no root cause measures nothing.** The rate depends on
  archaeology this repository does not currently write down: its fix commits
  describe root causes in prose without naming the change. A line —
  `Introduced in #415` — in a fix's issue, body, or first commit is what turns
  a fix into evidence.
- The vocabulary and the classes are code, in
  `tools/scripts/review/escaped-defects.ts`, covered by `yarn review:test`.
  Changing what counts as an escape means changing a pinned table whose
  fan-out is asserted at module load
  ([ADR 0053](0053-a-fan-out-over-a-domain-enum-is-pinned-at-its-call-site.md)),
  not editing prose.

## Alternatives considered

- **Fold the rate into the golden replay record.** Rejected: that file is the
  running record for replays, and a measurement with a different population, a
  different denominator, and a different meaning would have been read as
  another recall number.
- **Report 0% on an empty denominator.** Rejected: it is the one output that
  states the opposite of what is known.
- **Count every fix that names anything.** Rejected: the loose end of the
  vocabulary was measured firing once on real history, and that once was a
  neutral sentence, not a causal claim.
- **Make it a gate on some threshold.** Rejected: there is no threshold a
  single commit could cross, and a gate that reads the network fails for
  reasons that have nothing to do with the change in front of it.
