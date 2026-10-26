# House Explainer Pages have a Designer and a mechanical gate

The `design-brief` skill has always said its deliverable is "a Markdown brief handed to a Designer agent". No Designer existed. Briefs went to `general-purpose`, which worked, and re-derived the house conventions from scratch on every engagement.

Issue #470 was filed after five explainer pages were built for the sandcastle system (`docs/sandcastle/{dispatch-map,waves,gates,logs,resume}.html`) across five independent dispatches. The exercise made the cost legible in three ways.

**A generalist shipped an accessibility defect as correct.** The first page placed `<title>` as the first child of a root `<svg role="img">` — textbook accessible-name practice, and wrong here, because browsers also render it as a native tooltip covering the entire 1264×1810 canvas. Every shape reported the same generic sentence. It shipped, and a user had to report it. The house-correct pattern is `aria-label` plus `aria-describedby` → `<desc>`, which renders no tooltip.

**The same conventions were re-taught every time.** The canonical `@font-face` block spliced rather than retyped; theme tokens in three states; `localStorage` wrapped in `try`/`catch` because these pages are read from opaque origins; motion collapsing fully under `prefers-reduced-motion`; self-containment; `.prettierignore` membership; an embedded manifest wired to a checker.

**The same waste recurred.** Three dispatches each brute-forced the font-block hash, because the brief quoted a hash without naming which bytes it covered. Each spent a pass on it, and each independently reported the discrepancy.

## Decision

A **House Explainer Page** is a self-contained HTML artifact under `docs/` written to the convention the sandcastle atlas established. Two things now own it.

**The `Designer` sub-agent** (`.github/agents/designer.agent.md`, T2) turns a brief into a page and verifies it. It owns the conventions; the brief owns the facts and the audience. Two rules in its body are there because their absence produced a specific failure: it must not claim a visual review, because the preview pane serves `file://` pages as static snapshots on a `data:` origin and pixel-level review is not possible — measuring programmatically and saying so is the honest substitute. And a source-vs-docs contradiction found while grounding a page is a deliverable, not something to quietly resolve; `sandcastle-subagent-trace.ts` claiming transcripts reach the host "verbatim" when they pass through `rewriteSessionCwd` was found exactly that way.

**`yarn design:hygiene`** is the mechanical half, an Assertion Gate in the sense of [ADR 0043](0043-gates-assert-facts.md): it compares artifacts and names the fact that is wrong. It asserts no `<title>` inside any `<svg>`; a bijection between `data-tip` shapes and `#note-*` entries; a `@font-face` block matching the canonical page; nothing fetched at load; theme tokens in all three states; guarded storage access; `.prettierignore` membership; a parseable embedded manifest; and that every relative ADR link resolves. `--print-font-block` emits the canonical block so the answer to "which bytes" is a command, not a hash to hunt.

**Scope is an explicit roster, not a glob.** `docs/**` holds three lineages of HTML page and only one is this convention. Every page under `docs/` is in `ROSTER` or in `LEGACY` with a written reason, and a page in neither fails the gate — so a new page cannot escape by being new.

## Considered Options

- **Keep dispatching briefs to `general-purpose`** — rejected. It works, and it costs a re-derivation per engagement plus the defects a re-derivation misses. The tooltip defect is the proof: nothing in the generalist's dispatch could have told it that the correct-everywhere pattern is wrong here.
- **Put the conventions in the brief instead of in an agent** — rejected. `design-brief` is explicit that the brief carries facts and constraints, not visual instruction, and that padding it with things the Designer chooses better is a failure mode. Conventions belong to whoever executes them.
- **Globbing every HTML page under `docs/` instead of keeping a roster** — rejected. Five of the eleven pages under `docs/` fail at least one rule today: two are Claude Design canvas exports whose bundled runtime carries CDN fallback URLs as strings, one carries no `@font-face` block, and two predate the three-state theme block. A gate that is red on `main` from its first commit teaches everyone to pass `--no-verify`. Retrofitting those pages is its own change; it is not a prerequisite for gating the six that already comply.
- **A roster with no coverage rule** — rejected. That is how a convention stops spreading: the next page is simply not added, nobody decides anything, and the gate slowly covers a shrinking fraction of the corpus. `unclassified-page` forces the decision once, in CI, where the whole tree is visible.
- **Pin the canonical font-block hash as a literal in the checker** — rejected. It reproduces the exact waste this ADR was filed about, one layer down: a literal hash is meaningless without its slicing convention, and the convention would then live in a comment rather than in code. `fontBlock()` is the single implementation, and the canonical page is named rather than hashed.
- **Fold the rules into `check-sandcastle-map.mjs`** — rejected. That checker asserts what the sandcastle pages _say_ against the orchestrator source. These rules are about how any house page is _built_, and belong wherever the next one lands.

## Consequences

- `design-brief` dispatches to Designer. Any agent producing an HTML explainer page should do the same rather than reaching for `general-purpose`.
- The roster starts at six pages: the five sandcastle pages and `docs/agents/orchestration-map.html`. The five `LEGACY` entries each carry the reason they are excluded, so an exclusion is a decision someone made rather than a gap nobody saw.
- Husky runs `design:hygiene --staged`, gated on `docs/**/*.html`, so an unrelated commit pays nothing. CI runs `--all`, which is the only place the roster-coverage rule can see the whole tree.
- Adding a page means adding it to `ROSTER` and `.prettierignore`. Forgetting either fails the gate with the specific fact that is wrong.
- The gate does not judge whether the hero is the right hero or whether the prose is true. That stays with review, exactly as ADR 0043 concedes for prose drift generally.
- `docs/agents/skill-atlas.html` and `docs/agents/orchestration-map.html` gain a twenty-third agent, and the counters both pages assert move with it.
