# Component pipeline guardrails: script the shape rules, compile the importers

An audit of `ComponentBuilder` and `ComponentReviewer` found the component pipeline paying frontier-model rates for checks a script settles once, while lacking the one gate that would have caught real breakage.

Three concrete findings:

1. **A ~23.4k-token floor per component.** Both agents opened `TECH_STACK.md` (23.4 KB) and `docs/ui/GUIDELINES.md` (15.4 KB) "in full" as a mandatory first step — 9.7k tokens of foundation reading, twice, before either agent looked at a component. `TECH_STACK.md` is a dependency-version table spanning Prisma, metro, and CI; a component author needs about six rows of it.
2. **ComponentReviewer's §1–§7 checklist restated `docs/ui/GUIDELINES.md` §1–§7.** The agent read the guidelines in full and then re-read them paraphrased inside its own prompt, giving every rule two copies to drift apart.
3. **No compile check anywhere.** `ComponentBuilder` had `tools: [read, edit, search, todo]` and `ComponentReviewer` had `[read, search]`. Neither could execute. A component could be written, reviewed, and accepted having never been typechecked — while the Jest pipeline next door had three enforcement layers.

The importer scan was the worst of both problems: ComponentReviewer was told to search for the component's exported name and _read every file that matched_. `Button` is referenced in 78 files. That step could cost more than the rest of the review combined, and it was approximating — badly — a question the compiler answers exactly.

## Status

accepted — retry cap amended by [ADR 0017](0017-gated-pipeline-cap-and-slice-code-review.md) (3 → 2 reject-cycles)

## Considered Options

**Upgrade the reviewer's model.** Rejected for the same reason as in [ADR 0004](0004-test-runner-pipeline.md): it pays per-run for checks a script settles once, and a smarter model still cannot tell from one file whether a `'use client'` boundary exists three imports up.

**Delete the mechanical checks and rely on ESLint.** Rejected. ESLint owns the rules it has (`no-explicit-any`, unused vars, hook deps) and those stay with it, but the rules that matter most here are repo conventions — barrel export, `cn()` merging, `displayName` on every compound sub-component — and writing nine custom ESLint rules is a heavier lift than one script that also runs standalone in a pre-commit path.

**Split by decidability** (chosen). Each check goes to the layer that can actually decide it.

## Decision

| Layer                         | Owns                                                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check-component-hygiene.mjs` | Shape rules: `forwardRef`/`displayName`, `cn()` merging, barrel export, deep imports, `useCallback` on handler props, inline props types, effect cleanup, generic names, oversized JSX. |
| `tsc --noEmit` + `eslint`     | Type correctness, **importer compatibility**, `any`, unused vars, hook dependency arrays.                                                                                               |
| ComponentReviewer             | Judgment: composition pattern, scope placement, concern mixing, client boundary, Radix-vs-hand-rolled, accessibility beyond the shape rules.                                            |

`tsc` over the owning project **is** the importer check. It resolves every consumer of the changed export and fails with a file and line, which strictly dominates reading 78 files and guessing.

`ComponentReviewer` gains `execute`, for `tsc`, `eslint`, and the hygiene script only. Every judgment item must now cite a line, so a verdict without evidence is visibly incomplete.

### The model tier stays T2

ADR 0004 moved `TestReviewer` to T0 after scripting its checklist, and the same move was evaluated here and **declined**.

The difference is what survives the split. `TestReviewer`'s residual work is genuinely deterministic. `ComponentReviewer`'s residual work — is the compound split right, is this component mixing too many concerns, should this have been Radix, does a primitive secretly know about the domain — is design judgment, and it is exactly the class of question ADR 0004 warned a cheap model answers with an unearned PASS. Requiring a cited line raises the cost of a bogus PASS but does not manufacture the reasoning needed to spot a bad abstraction.

The economics also do not favour it: the gate runs once per component, and its input is already down from ~11.9k to ~4k tokens, so a tier change saves little against an asymmetric risk of waving through design regressions. `tools/config/agent-model-policy.json` keeps `component-reviewer` at T2.

What did change is that the T2 model no longer spends its pass re-deriving `displayName` and barrel exports.

Neither agent reads `TECH_STACK.md` in full. The rules that govern a component live in `docs/ui/GUIDELINES.md`; version lookups are section-scoped.

### Two checks deliberately left out of the script

Both were implemented, run against the codebase, and removed after producing only false positives:

- **`any` detection** — all four hits in the repo carried an `eslint-disable-next-line @typescript-eslint/no-explicit-any` directly above. ESLint already owns the rule and honours its own suppressions; a second implementation that ignores them reports violations the project has consciously accepted.
- **`'use client'` placement** — flagged nine files that are children of components already inside a client boundary. Next.js inherits the boundary through the import graph, so this is not decidable from a single file. It moved to ComponentReviewer as a judgment item.

This mirrors ADR 0004's removal of _"tests would fail if the implementation were broken"_: a check that cannot be decided at the layer holding it is worse than no check, because it produces confident wrong answers.

## Calibration

Rules were tuned against the whole codebase before landing, not designed in the abstract. The original baseline over 140 components was **0 errors, 68 warnings** (41 inline props types, 20 unmemoized handler props, 7 oversized JSX blocks). At that point errors gated while warnings were advisory and justified `PASS_WITH_WARNINGS`, never `FAIL`.

A zero-error baseline meant the script could gate immediately while the 68 warnings were tracked as pre-existing guideline drift. Issue [#288](https://github.com/mnaimfaizy/myorganiser/issues/288) subsequently removed that drift without changing the rules, scan roots, or 150-line oversized JSX threshold.

### Zero-warning enforcement

The repository now maintains a **0 error, 0 warning** full-scan baseline:

- CI runs `component:hygiene --all --max-warnings=0` and fails on any error or warning.
- Pre-commit runs `component:hygiene --staged --max-warnings=0` for staged paths under the existing component roots.
- Targeted local scans continue to report warnings without failing, preserving the diagnostic workflow during component development.
- Contract tests cover strict warning exits, JSON output, staged additions and modifications, rename destinations, deletions, scope filtering, and Git failures.

The staged strict check was benchmarked with one modified UI primitive and one modified feature component using a copied Git index. Five warm runs completed in **0.48–0.50 seconds**, below the agreed one-second pre-commit threshold without mutating the developer's index.

The cleanup was deliberately split by risk: named props-interface extraction was mechanical; handler memoization required dependency review; oversized JSX findings required behavior-preserving, feature-private decomposition. Strict enforcement landed only after those changes established the zero-warning baseline.

## Consequences

- New: `tools/scripts/check-component-hygiene.mjs`, `yarn component:hygiene`, and `tools/scripts/lib/source-scan.ts` — shared lexical helpers now used by both hygiene scripts (the test script was refactored onto it with byte-identical output).
- `ComponentReviewer` gains `execute`; its tool grant must stay `[read, search, execute]` across all four harnesses.
- `docs/ui/GUIDELINES.md` §8 documents the three-layer split; the agents no longer paraphrase §§1–7.
- Targeted scans remain useful during development, while CI and staged pre-commit checks enforce the zero-warning baseline explicitly.
- **2026-08-17 addendum**: Issue #354 hit the gap this left open — `ComponentReviewer` graded hygiene warnings as advisory (`PASS_WITH_WARNINGS`) on both review cycles, then pre-commit's `--max-warnings=0` staged check hard-failed on the identical finding, costing a mechanical fix outside the counted reject-cycle budget. `--max-warnings=0` was already mode-agnostic (works with explicit file paths, not only `--all`/`--staged`) but neither agent's documented invocation used it, and the usage string's examples implied otherwise. `ComponentBuilder`'s self-check and `ComponentReviewer`'s Tier 1 gate both now run `--max-warnings=0` on every pass, so a warning that will fail pre-commit is caught during review — using the normal 2-cycle budget (ADR 0017) — instead of surfacing for the first time at `git commit`. "Targeted local scans" above still means ad hoc runs without the flag; the specialists are no longer in that category.
- **2026-09-12 addendum**: Issue [#290](https://github.com/mnaimfaizy/myorganiser/issues/290) closed the other half of the same failure. Once the Vault UI Component scope (ADR 0026) was wired into `scopeOf()`, the scan roots grew. The checker scope is deliberately **wider than the category GUIDELINES §1 names**: it is every `.tsx` under `libs/web/vault-ui/src/lib/`, so `session`, `vaultGate` and `reconcileRunner` are checked even though §1 lists them as not Vault UI Components. That section excludes them from _needing stories_, which is a question about presentational purity; whether an effect cleans up after itself and whether an import goes through the barrel are not questions about purity, and they are the last questions to leave unasked in the files that gate the vault. The narrowing that does apply is the rule list: the `vault-ui` scope omits the primitive-only rules. `.ts` modules in the same flat directory stay out, because a hook reporting PASS as a component is the same false clean this scope was added to remove. Re-baselined, the full scan is **207 files inspected, 0 errors, 0 warnings** (120 stories and test files skipped) — the zero-warning baseline above still holds, over a wider corpus. The 140-component figure under Calibration is the original pre-#288 measurement and is left as recorded history. The exit-code contract gained a case: **a run in which every input fell out of scope now exits 1**. Previously such a run printed `0 error(s), 0 warning(s)` and exited 0, indistinguishable from a clean pass, which is precisely how `libs/web/vault-ui` sat unchecked behind a checker that looked green — a skip that reads as a pass is worse than no check. `0` now means checks ran and passed, never that there were no checks to run. A mixed run is unaffected and still exits on the merits of the files it did check, because there a skip is the scope filter working rather than an invocation mistake; `--staged` with nothing staged still exits 0, because that is a legitimate state. Contract tests cover the new scope, its flat-barrel path resolution, and the all-skipped exit code in both text and JSON modes.
