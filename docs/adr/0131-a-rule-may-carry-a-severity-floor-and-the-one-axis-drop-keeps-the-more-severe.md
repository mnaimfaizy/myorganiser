# A rule may carry a severity floor, and the one-axis drop keeps the more severe

## Status

accepted

## Context

In the seeded-defect run of issue #1140, a planted `curl -fsSL "$WEB_ORIGIN/login"` step could print
the Staging hostname into the public Actions log. GitHub's masking does not hide it: masking matches
the exact secret value, and `curl`'s resolution error prints the bare host. ADR 0056 says logs must
not dump connection values, and ADR 0086 names a host as an Operator Fingerprint. The Spec axis
reported the step as a `nit` (`spec-behaviour-not-asked-for`). The Standards axis reported nothing.

Three gaps let that happen.

1. `standard-operator-fingerprint-in-source` covered only the tracked tree. A value printed at
   runtime fit neither it nor `standard-secret-committed`, which ADR 0086 keeps deliberately
   separate.
2. The rule catalogue could cap a severity (`maxSeverity`, enforced in
   `tools/scripts/review/schema.ts`) but had no floor. Brief text asking for a minimum severity
   cannot be checked, and the run that called this a nit had read its brief.
3. The code-review Skill's one-axis rule (PR #819) dropped any Standards finding whose lines
   overlapped a Spec finding. Had Standards raised a should-fix on the `curl` line, assembly would
   have dropped it and kept the Spec nit.

## Decision

1. **`standard-operator-fingerprint-in-source` also covers a public log.** Its title becomes "An
   Operator Fingerprint is written into the tracked tree or printed to a public log". Its id is
   unchanged, so finding identity carries across runs and ADR 0079 keeps measuring one
   false-positive budget for one concern. The Standards brief says that on a public repository a
   workflow's log is public.
2. **A catalogue rule may declare `minSeverity`.** It is enforced exactly as `maxSeverity` is: a
   finding below the floor makes the report invalid, and the axis is re-run once under the existing
   retry rule. Nobody raises the severity on the reviewer's behalf. Severity stays the sub-agent's
   judgement (ADR 0071), and the catalogue bounds it from both sides.
   `standard-operator-fingerprint-in-source` and `standard-secret-committed` declare
   `minSeverity: should-fix`.
3. **When a Standards finding and a Spec finding overlap, assembly keeps the more severe one, and
   keeps the Spec finding on a tie.** The one-axis rule exists so that the author does not answer
   one defect twice. It was never meant to trade a should-fix for a nit. This is still a drop and
   never an edit: the kept finding goes into the report field for field.

## Considered options

- **Brief text only.** Rejected: it cannot be checked (item 2 of Context).
- **A separate id, `standard-fingerprint-logged`.** Rejected: one ADR 0086 concern would be split
  across two ids and two false-positive budgets.
- **Raise an under-floor finding's severity in the validator.** Rejected: the validator computes a
  verdict from findings and never edits one (ADR 0071). Raising a severity would be the first
  exception.
- **Keep "Spec wins" and add the Standards severity to the Spec finding.** Rejected: that edits a
  returned finding, which ADR 0123 item 4 makes a failure of `Agent Review Ran`.

## Consequences

- The overlap rule in `.agents/skills/code-review/SKILL.md`, step 5, changes for every overlapping
  pair, not only fingerprints. Where a Standards should-fix and a Spec nit overlap, the author now
  sees the Standards finding.
- A reviewer that reports a fingerprint or a secret as a `nit` gets one retry. A second under-floor
  reply rejects the report, and the Pull Request goes to `review:human`, the same path as any
  rejected report.
- The seeded hostname-in-log case (ADR 0130) is caught only by a should-fix-or-higher finding, so
  the Spec nit the seeded run returned scores as a miss.
