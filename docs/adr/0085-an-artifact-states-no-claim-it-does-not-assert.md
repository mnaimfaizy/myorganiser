# An artifact states no claim it does not assert

## Status

accepted

## Context

[ADR 0043](0043-gates-assert-facts.md) established the Assertion Gate: a gate compares two artifacts and fails on a factual mismatch. Its corollary — a gate that runs nowhere asserts nothing — is enforced by `gates:coverage:check`. Its Consequences also concede, in the first line, that **prose drift is not caught**, because "here is how the cron is wired" has no machine-comparable form and review is the only defence.

That concession has been read wider than it was written. It covers claims that are unassertable _in principle_. It has been taken to cover claims that are simply unasserted — facts about the tree that an extractor could have read, sitting in artifacts whose surrounding machinery looks rigorous enough that a reader trusts them. `CONTEXT.md` now names this an **Unasserted Claim**.

Two issues were opened months apart and stress-tested together, because they are one question on two surfaces.

**On a House Explainer Page** ([#503](https://github.com/mnaimfaizy/myorganiser/issues/503)). `docs/deployment/release-pipeline.html` stated that CI runners pin `'22'` at 14 `setup-node` steps. The count is 18; four were added over roughly two weeks and nothing noticed (#726). The substantive claim — that they _all_ pin `'22'` — was gate-backed the whole time and remained true, because the extractor asserts sameness across every match regardless of how many exist. Only the count was prose, and only the count was wrong. The same page cited source lines into the workflows it describes; 19 of those were stale (#771). `docs/agents/skill-atlas.html` carries three edge counts, one asserted by nothing (#711).

**In a checker** ([#712](https://github.com/mnaimfaizy/myorganiser/issues/712)). A sweep found six gates claiming more than they check. `check-readme.ts` states "drift runs both ways"; one direction is implemented (#710). `check-skill-map.ts` says the classified set "sums to what its manifest claims"; a subset is asserted (#711).

The shape is identical on both surfaces: the gap between what an artifact **states** and what it **asserts**. It appeared a third time while this decision was being designed — the House Explainer Page roster's `LEGACY` map exempts a page from _every_ rule on the strength of one written reason, and not one of those five reasons is about being wrong. Four concern styling — a missing or non-canonical `@font-face` block, dark tokens defined in the wrong state — and the fifth concerns self-containment, a bundled canvas-export runtime carrying CDN fallback URLs the rule cannot distinguish from a real load. All five are mechanical hygiene; none is a reason to stop checking whether the page describes the tree.

## Decision

**An artifact states no claim it does not assert; where it cannot assert, it states less.**

This does **not** overturn ADR 0043's concession, and a reader who takes it that way will build the wrong thing. Unassertable prose stays review-only. The rule is "do not state assertable facts you do not assert" — never "assert everything". ADR 0043 rejected gating narrative text on the grounds that a guard failing on wording gets turned off, and that rejection stands.

Where a fact is assertable and stating it is worth the extractor, the manifest asserts it. Where it is assertable and not worth an extractor, **prefer a universally-quantified claim to a counted one wherever a gate already proves the universal**. "Every `setup-node` step pins `'22'`" is stronger than "14 `setup-node` steps pin `'22'`", needs no new manifest key, and is already covered by the existing extractor. The counted form was the weaker claim and the one that drifted. `tools/scripts/check-sandcastle-map.ts` reached this conclusion independently — its header already says to "prefer a value that pins behaviour over one that pins a number" — and this ADR generalises it.

### Consequence for pages

Source citations — a `file:line` naming a location in the tree — become a gated category. Resolving a citation is **necessary and not sufficient**: all 19 stale citations in #771 pointed at lines that exist, so a rule that parses `file:line` and range-checks it catches none of them. The gate compares each citation against an expected-content anchor, and a citation carrying no anchor is itself a finding.

The rule is generic, living with the shared page-scanner rules rather than any one page's checker, and finds citations in every markup form a page uses. A sweep reading only the `cite`/`src` span classes finds 7 of #771's 19.

The anchor block is held to the same rule in the other direction (#822). An entry that keys no citation the gate reads is never compared against anything, so it is a claim the page states and nothing asserts; it fails as `citation-anchor-orphan`. The anchor baseline does not suppress it: the baseline is a migration hatch for an anchor that is _absent_, and an orphan is about what the block itself asserts — a page owes nothing it has not written, so there is nothing to migrate. A continuation line written without its leading colon (`main.mts:153, 205`) is the shape that made orphans invisible, and fails as `citation-continuation-unparsed`. A citation rendered from script data is read like one in the markup (#982): the gate scans the string literals of every non-JSON `<script>`, under a narrower grammar than markup — a name counts only with a known file extension, and a bare `:line` inherits only a file cited earlier in the same string — because script code is full of `name:digit` shapes that are not citations. What that grammar does not read (a script comment, a bare line in a string that names no file) is a claim this gate does not check, and must not be anchored. A `citation-anchors` block the gate cannot read fails as `citation-anchor-block-invalid` rather than passing as though the page had none.

Rules are classified by kind. Factual-assertion rules run over `ROSTER` and `LEGACY` pages alike; mechanical-hygiene rules continue to honour the exemption. A font-block exemption is not a licence to be wrong about the tree.

### Consequence for checkers

A checker header declares which direction(s) it asserts and why any omitted direction is omitted — and a contract test proves the checker actually fails on the drift that header claims to catch. **Neither half works alone.** The header is the specification; the test is what makes it true. This mirrors the page surface exactly: the manifest states, the extractor asserts.

Contract-test coverage is recorded as a shrink-only baseline rather than a written-reason opt-out
list, deliberately: unlike the Meta-Gate's wiring opt-out, "is this checker worth testing" is a
per-checker judgment call, and a written-reason list is exactly the discretion the baseline exists to
remove. The same shape governs citation anchoring — pages whose citations are not yet anchored sit in
a shrink-only `tools/config/citation-anchor-baseline.json` with no written-reason opt-out either, and
a page whose citations are all anchored fails as a stale entry. An anchor whose own `file` cannot be
read, or whose cited line is past that file's end, fails as `citation-anchor-unreadable` rather than
passing unverified — an unreadable citation is not evidence the claim is true.

## Considered Options

**"State your direction" as a convention on its own** — rejected, on evidence rather than principle. ADR 0043 already contains the clause: "The direction is recorded in the checker's header, not here." Only 5 of 35 non-test checkers follow it. But `check-readme.ts` is one of the 5, and states its direction in exactly the fixed form the convention asks for — "Drift runs both ways — a stale entry and a missing one are both wrong" — over code that implements one direction. **The checker that best followed the convention is one of the six that got it wrong.** Writing a direction down does not make it true; it adds a second artifact that can drift, and a more dangerous one, because a reader who checks the header stops there. ADR 0043's own reasoning applies to its own clause: a claim nothing asserts is a claim that rots.

**A gate over every number in a page's prose** — rejected on measurement. On `release-pipeline.html`, roughly 47 distinct unasserted numeric tokens sit against 23 manifest values, and four successive passes at separating claims from markup — tags, numeric entities, ADR references, issue numbers, version strings, citation spans — did not produce a clean set. Such a gate fires on SVG coordinates and axis labels, which is the noisy check ADR 0043 names as its own non-goal. A maintainer who learns to ignore a gate has lost more than the gate was worth.

**A marking convention that visually distinguishes gate-backed values in the rendered page** — rejected, and ADR 0043 rejected its shape already: "a doc that forgets the marker passes by being invisible." Under the rule adopted here there is also nothing left for it to protect a reader from, because there is no unasserted tier.

**Requiring every number to become a manifest key** — rejected. It demands extractors for facts nobody would act on, and it has no answer for a number that is not a fact about the tree at all. Preferring the universal removes the claim instead of grading it.

**Two ADRs, one per surface** — rejected. The two issues are the same sentence about different artifacts, and deciding them apart risks a page convention and a checker convention that disagree about the same boundary. They implement as separate work; they are one decision.

## Consequences

**ADR 0043's marker objection has a boundary, and it must be stated or the page gate cannot exist.** The objection holds when the marker is what makes a claim _findable_: a document that omits it becomes invisible and passes. It does not hold when the claim is already self-identifying and the marker only makes it _checkable_. A citation's `file:line` syntax cannot be dropped without it ceasing to be a citation, so a citation carrying no anchor is detectable and can be failed. Without this distinction a future reader holding only the blanket rejection will conclude the citation gate contradicts ADR 0043. It does not.

Anchoring roughly 150 existing citations on `release-pipeline.html` is real work, and the page gate is therefore sequenced expand → migrate → contract. The expand step is deliberately a weak gate that catches none of the known drift. It must not be mistaken for the finished article; shipping it alone would be shipping an unasserted claim about the page.

A citation is a claim about a line number, and line numbers re-break on the next insertion above them. This ADR makes that drift _visible_, not impossible. A page author who finds the churn unacceptable should cite less precisely — a job name rather than a line — which is the same "state less" move the rule prescribes elsewhere.

Two evidence claims in the source issues are stale and should not be carried forward: #712 states that `check-agent-map.mjs` has no test file, which was true when filed and was fixed as part of #476; and the claim that no page carries a marking convention is right repo-wide but wrong for `release-pipeline.html`, which invented two that no other page uses.

The `LEGACY` split is a behaviour change to pages nobody has looked at in a while. Bringing `skill-atlas.html` into factual scope is the point — it is where #711's unasserted count lives — but other legacy pages may fail on first contact, and those failures are findings rather than regressions.

Thirteen of thirty-five checkers have no contract suite on the day this is written. The baseline records that as debt with a direction of travel. It does not pay it down, and an entry that stops covering anything fails as stale.
