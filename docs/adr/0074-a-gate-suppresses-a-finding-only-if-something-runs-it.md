# A gate suppresses a finding only if something runs it

## Status

accepted

## Context

[ADR 0071](0071-a-finding-blocks-only-on-evidence-and-a-verdict-is-computed-never-written.md)
item 1 states that "a finding a deterministic check would already fail is not reported; the report
counts what it suppressed under `suppressed.redundant`". That rule is correct in intent and
under-specified in fact: it tests whether a checker **would** fail, and never whether anything
**invokes** it.

[ADR 0043](0043-gates-assert-facts.md) already settled the opposite question
for the repository at large. `tools/scripts/check-gate-coverage.ts` — the Meta-Gate — asserts that
every checker in `tools/scripts/` is invoked by some hook or workflow, and names the ones that are
not. Its whole premise is that **a checker nothing runs is not a gate**. A checker that is
deliberately not a gate needs a written reason in `tools/config/gate-coverage-optout.json`; there
is no silent exemption.

So two parts of the same system disagreed about what "a gate covers this" means. The review side
counted an uninvoked checker as coverage; the Meta-Gate counted it as a hole.

That disagreement has a worked example in the golden set.
`release-bump-leaves-generated-client-stale` replays issue #408. At the case's head `8175cb6`,
`openapi:check` existed in `package.json` and was invoked by no `.husky` hook and no workflow. The
incident _was_ that `openapi:check` failed on `main` from that merge onward and nothing ran it.
Read literally, ADR 0071's rule directed the reviewer to suppress the one finding that mattered.

The opposite case is `groceries-ui-written-against-absent-roles`, retired 2026-09-08.
`tailwind:classes:check` is invoked by `.github/workflows/ci.yml`, genuinely fails on that range,
and suppressing its defect was correct. Distinguishing the two cases is the point.

Narrowing the rule in the review brief was measured and changed nothing:
[the 2026-09-09 brief](../research/2026-09-09-wired-gate-qualifier-replay.md) records that
`release-bump` missed in the first clean replay after the change. The rule is recorded here because
it is right, not because it moved a number.

Writing it down once also fixes a second problem the reviewer raised on the pull request that
introduced it. The rule had been paraphrased independently in seven places — the skill, `AGENTS.md`,
a code comment, a JSON reason string, two passages in the results record, and ADR 0071 itself. One
qualifier change had to hand-edit six of them and still missed the seventh. That is the fan-out
shape [ADR 0053](0053-a-fan-out-over-a-domain-enum-is-pinned-at-its-call-site.md) pins for code,
appearing in prose.

## Decision

1. **A `*:check` gate suppresses a finding only when it is wired.** A gate is wired when something
   at the reviewed head invokes it: a `.husky` hook, a `.github/workflows` job, or the
   `yarn gates:run` manifest, resolved one level of indirection as
   `gates:coverage:check` resolves it.

2. **A checker nothing runs is not a gate.** A defect it would have caught is a finding, and the
   fact that nothing runs the checker belongs in that finding. It is not counted in
   `suppressed.redundant`.

3. **This ADR is the canonical statement, and the rule has one author.** What is forbidden is
   re-authoring: stating the condition as though this document did not exist, so that a reader
   could act on the paraphrase without ever opening it. That is how the rule came to have seven
   copies free to drift apart, which is the whole reason this ADR exists.

   Two things are not re-authoring and are expected. A **gloss** — a clause that names this ADR in
   the same breath, telling a reader why the pointer is there — cannot become a competing authority,
   because it points at the authority as it speaks; analysis, a retirement reason, and a code
   comment all legitimately need one, and stripping them to a bare citation makes the surrounding
   argument unreadable without buying any protection. And the finding contract in
   [`.agents/skills/code-review/SKILL.md`](../../.agents/skills/code-review/SKILL.md) carries the
   operative sentence in full, with this ADR cited beside it, because it is pasted verbatim into
   sub-agent prompts that cannot follow a link.

   The test is therefore whether the passage stands alone as the rule. A paraphrase that does — or
   one that claims to be the rule's home while being a copy of it — is the defect.

4. **ADR 0071 item 1 is narrowed, not superseded.** Its structure — earned severity, computed
   verdict, a visible suppression count with invisible items — stands unchanged. Only the
   suppression condition is qualified, and ADR 0071 carries a pointer here rather than a rewrite.

## Consequences

- The reviewer stops suppressing defects covered by checkers that nothing runs, which is the class
  of defect most likely to reach `main` — nothing else is looking for it either.
- Determining wiredness is cheap and mechanical: grep `.husky/`, `.github/workflows/`, and the
  aggregate manifest at the reviewed head. It is the same question `gates:coverage:check` answers,
  so the two now agree by construction.
- A reviewer may now report a finding whose fix is to wire an existing checker rather than to change
  the diff. That is a legitimate finding and often the more durable one.
- The rule has one home. A future change to it edits this file, and the sites that reference it do
  not drift — the failure mode that produced this ADR.
- Nothing asserts the reference discipline mechanically. If the paraphrases return, a checker that
  fails on a restatement of the rule outside this ADR would be the natural gate, and by ADR 0043 it
  would itself have to be wired to count.
