# A PRD slice closes only on a clean outcome, and says what it could not do

## Status

accepted

Amends [ADR 0045](0045-a-prd-is-gated-once-on-the-assembled-feature-branch.md) on when a PRD slice is closed; its integration rule and the meaning of `status:done` are unchanged. Adds one rule to the review contract of [ADR 0071](0071-a-finding-blocks-only-on-evidence-and-a-verdict-is-computed-never-written.md).

## Context

[The Mobile v1 investigation](../research/2026-09-30-mobile-v1-agents-built-without-the-approved-design.md) found that the design never reached the sandbox ([ADR 0110](0110-an-approved-design-is-committed-to-the-repo.md) fixes where it lives). It also found that nothing between an agent and a closed issue listened to what the agent said about its own work:

- **A slice closed on any commit.** In PRD mode `gatePassed = hasWork`, so every slice that committed anything was closed as completed and released the slices behind it. #913 wrote "## Not delivered — keep-awake" and was closed; #918 then built a keep-awake toggle with nothing to switch.
- **COMPLETE was printed over open blockers.** #909, #910, and #913 each finished with a blocking review finding unresolved, because the prompt's completion rule was a checklist the agent ticked for itself.
- **Caveats did not survive.** #909's first iteration wrote "check these against the sheet — they are my reading"; its second, a cold restart, wrote "matches the approved sheet exactly". Explorer sub-agents' "requirements unclear" went nowhere.
- **The sandbox could not read the PRD.** It has no `gh` credentials, so a slice that relied on #908 for its copy, its colours, and its offline rule had none of them.
- **A decided requirement was downgraded.** #912's review quoted ADR 0108 decision 1 — "an unattended unlocked session must not be enough" — as a `should-fix` spec finding, and the implementer shipped a two-minute window instead.
- **The weakest model got a security-bearing slice.** Account (#918) was `complexity:low`, so it ran on Haiku, and it dropped explicit requirements and stalled asking a question nobody could answer.

The review verdict itself turned out not to be the signal. The review runs once, before its findings are fixed, so its handoff reads request-changes on a slice that then fixed everything (#912: "request-changes (10 findings …, all addressed)") exactly as on one that left a blocker open (#913). Which of the two happened is only in what the agent says next.

## Decision

1. **The brief carries what the sandbox cannot fetch.** The orchestrator reads the slice's parent PRD on the host and adds it to the prompt as background, and the prompt tells the agent where an approved design lives (`docs/design/`, ADR 0110), that hosted designs and GitHub cannot be opened from the sandbox, never to claim fidelity to a source it did not read, and that anything needing a device or a visual check is not met there.
2. **An agent lists what it did not do or could not verify.** Before `<promise>COMPLETE</promise>` it prints one `OUTSTANDING:` line per item: a blocking review finding it did not fix, an acceptance criterion it did not deliver, a device-only check, a source it could not read, a disagreement between the slice, its PRD, and the design. An honest list is not a failure; a list with an item missing is.
3. **A slice closes only on a clean outcome.** The orchestrator judges the last iteration of the run (`sandcastle-outcome.ts`): clean means the agent signalled completion and listed nothing outstanding. A clean slice is closed and releases its dependents, as before. A slice that is not clean is still integrated and marked `status:done` — ADR 0045's integration and re-run idempotency are untouched — but stays **open**, swaps `ready-for-agent` for `ready-for-human`, gets a comment listing every item, and **does not satisfy its dependents** until a person resolves it and closes it. The wave driver reports held slices and exits non-zero while any remain.
4. **A Spec finding against an accepted ADR decision is blocking.** When a Spec-axis finding with executed or cited evidence names an ADR under `docs/adr/` as its source, and is anchored so that it may block at all — a diff location, or a quoted spec line — the review validator rejects any severity below `blocking`. A floor on a finding that cannot be blocking would leave it no valid severity. The decision was already made; changing it takes another ADR, not a quieter finding.
5. **Implementer slices do not run on the smallest model.** `complexity:low` routes to the same model as `complexity:medium`. Complexity describes the size of a slice, not its risk, and the one slice routed to the smallest model was the one carrying the biometric toggle.

## Considered Options

**Hold a slice whenever the last review verdict is request-changes** was tried first and rejected against the real logs: it held #912 and #917, which had fixed their findings, as readily as #913, which had not. The review runs before the fixes by design, so its verdict describes the diff it saw, not the one that was committed.

**Leave the slice open and not `status:done`** — ADR 0045's rejected option — stays rejected for the reason it gave: a re-run would dispatch a slice whose commits are already in the feature branch. Holding keys on a second label instead, so "integrated" and "finished" can differ without either lying.

**Feed the outstanding list back to the agent for another iteration** was rejected for the reason ADR 0045 rejected it for gate failures: iterations are cold restarts at full price, and most items — a device check, an unreadable source, a disagreement to settle — are not things another agent run in the same sandbox can resolve.

**Make every ADR-cited finding blocking, on either axis** was rejected. A Standards finding citing a coding-standard ADR (an enum fan-out, a naming rule) is often a judgement about how well the diff follows a standard, and several of those standards have their own gates. The Spec axis is where an ADR is a requirement the diff was asked to meet.

**Route by a risk label as well as complexity** was considered and deferred: no label marks security-bearing slices today, and #918 would not have carried one. Removing the smallest model from implementation is the rule that would have applied.

## Consequences

- An AFK PRD run can now end with slices held for a person, and the slices behind them not dispatched. That is the point: Mobile v1 stacked Account on a Groceries slice that had not shipped what Account needed.
- The outcome is only as honest as the agent's list. A run that omits an item it knew about still closes clean; #918's printed PASS after a FAIL would not be caught here. What this adds is that an agent's own caveats now reach a person and hold the work, where before they were read by nobody.
- A run whose log cannot be read judges as held: a run nobody can read is not one anybody can call finished.
- Reports that grade an ADR contradiction below blocking are rejected, so `Agent Review Ran` fails until the reviewer re-grades it. None of the six golden cases expects such a finding, so no expected severity moves.
- Implementation cost rises for `complexity:low` slices by the price difference between the two models.
- Device and visual fidelity still has no automated gate: the sandbox cannot run the app. It stays a human QA step before a PRD's pull request merges ([`qa-plan`](../../.agents/skills/qa-plan/SKILL.md)), now with the committed design to check against.
