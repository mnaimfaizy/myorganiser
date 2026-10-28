# A built House Explainer Page is its own source

## Status

accepted

## Context

`docs/vault/README.md` told readers the vault pages "are generated from dc-runtime design
exports" and printed the command to regenerate them. Nobody could run it. No `.dc.html` export has
ever been committed to this repository, and the `<export-dir>` the command names does not exist
([#534](https://github.com/mnaimfaizy/myorganiser/issues/534)).

The claim was not invented; it was true of a workflow that has since been replaced.

Four pages carry dc-runtime traces and came from canvas exports imported in August 2026:
`docs/agents/agent-journey.html`, `docs/authentication/session-lifecycle.html`,
`docs/vault/lifecycle.html`, and `docs/vault/trust-boundary.html`. Everything authored afterwards —
the five sandcastle pages, `docs/deployment/release-pipeline.html` — was written directly to the
house convention by the `Designer` sub-agent from a brief, which is the workflow
[ADR 0046](0046-house-explainer-pages-have-a-designer-and-a-gate.md) records. The import path was
never deprecated; it was simply stopped being used, and the README describing it was not revisited.

The cost was paid in full during [#511](https://github.com/mnaimfaizy/myorganiser/issues/511). Its
Remediation Notes stated the page "cannot be hand-edited", citing that README, and concluded the
correction had to go through a design export. It could not, because none exists. The page was
edited in place instead, and the repository was left documenting one workflow while practising
another.

`tools/scripts/build-agent-map.mjs:24` had already recorded the same discovery about
`docs/agents/orchestration-map.html` in August — that its source export no longer existed and the
page was not reproducible. The observation stayed in a script header where no reader of the
documentation would meet it.

## Decision

**A built House Explainer Page is the source. There is nothing behind it.**

1. **An existing page is changed by editing it**, briefed through the `design-brief` skill and
   executed by `Designer`, per ADR 0046. That is already the only workflow the repository actually
   runs; this makes it the only one it claims.

2. **`build-agent-map.mjs` is a one-time importer, not a rebuild path.** It remains the way a _new_
   canvas export becomes a page, and `tools/assets/dc-runtime/` remains load-bearing for the pages
   that carry the runtime. Neither is deleted, and neither is a route back to an existing page.

3. **Re-importing an old export is a regression, not a rebuild.** Every page in the export lineage
   has been corrected in place since import, against source constants, under
   `yarn vault:pages:check` and `yarn auth:pages:check`. Regenerating `trust-boundary.html` from
   its original export would silently revert the owner-scoped storage-key correction that
   [ADR 0051](0051-a-pinned-value-does-not-notice-that-its-meaning-moved.md) was written about.

4. **A documented command is an assertable claim.** `yarn docs:commands:check` reads every fenced
   shell block in every tracked Markdown file and fails when a path it names does not exist. That
   is an Assertion Gate in the sense of [ADR 0043](0043-gates-assert-facts.md) — two artifacts
   compared, the wrong one named — and it fails on `main` before this change and passes after.

Point 4 is what stops this recurring. The stale paragraph survived nine days and two pull requests
touching the very pages it described, because prose is not executed and nothing read it. The gate
reads it.

## Considered Options

- **Commit the `.dc.html` exports so the documented command runs** — rejected, and not merely
  unchosen: the exports live in a design tool rather than the repository, and the pages have moved
  on from them. Making the command runnable would mean bringing four exports forward by hand to
  match corrections already in the built pages, to buy a regeneration path whose only use would be
  to discard those corrections. This is the option the issue listed first and the evidence
  eliminated.
- **Delete `build-agent-map.mjs` and the vendored runtime** — rejected. The runtime is inlined into
  three shipped pages, and the importer is still the cheapest way to bring in a new canvas design.
  Deleting a working importer because it is not a rebuild path confuses "misdescribed" with
  "unused".
- **Record provenance per page in `design-page-roster.ts`** (the issue's third option) — rejected
  for now. The roster's `LEGACY` reasons already say "Canvas export" where it matters, and a
  provenance field nothing asserts is a second place for the same fact to rot. If a checker ever
  needs to branch on lineage, that is when the field earns its existence.
- **Fix the README and add no gate** — rejected on the evidence of how the claim survived. ADR 0043
  concedes prose drift to review; this was not prose drift but a command with a checkable argument,
  which is the assertable half of the same problem.
- **Fail the checker on placeholders like `<export-dir>`** — rejected. A placeholder is a hole for
  the reader, not a claim about a file, and failing them would make every usage example unwritable.
  The `.dc.html` argument next to it was the real claim, and it is the one that failed.

## Consequences

- `yarn docs:commands:check` joins the aggregate (`yarn gates:run`, now 14 checkers) and CI. It
  asserts 39 documented paths across 448 Markdown files today, so it is not a gate that only ever
  guards one line.
- A path git ignores is skipped as a build output. `libs/web/ui/storybook-static` is documented and
  legitimately absent from a clean tree; deferring to `.gitignore` keeps that judgement in one
  place rather than in an opt-out list someone must remember to prune.
- `run-assertion-gates.test.mjs` stops hand-listing the checkers and their count, reading both from
  `GATE_MANIFEST`. Adding the fourteenth checker failed a test that was asserting its own copy of
  the roster — the same mirror-rot the roster module's own header describes.
- The four export-lineage pages are now formally editable in place. They remain in the
  `design-page-roster` `LEGACY` map for the theme rules they predate; this decision does not
  retrofit those, and doing so stays its own change.
- The vault README's "Rebuilding" section becomes "Changing them", and says plainly that these two
  files are the source. A future contributor looking for the generator will find the reason there
  is none.
