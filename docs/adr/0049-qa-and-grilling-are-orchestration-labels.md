# `qa` and `grilling` are Orchestration Labels, not Surface Labels

## Status

accepted

Amends [ADR 0025](0025-pr-surface-labels.md), which lists `qa` among the Surface Label kinds. That
listing is superseded by this decision; the rest of ADR 0025 stands unchanged.

## Context

ADR 0048 gave `qa` a precise meaning: an issue wearing it **is** a QA Plan Issue. Before that, the
label meant "quality work of some sort", and it had spread accordingly — 25 issues carried it, of
which exactly two (#191, #237) were QA-plan-shaped. The rest were failing suites, hygiene
enforcement, Storybook coverage, and instruction drift.

That new meaning does not fit the vocabulary `qa` lived in. ADR 0025 defines Surface Labels as a
kind/area taxonomy **inferred from a diff**, which is why Pull Requests may wear them. "This issue is
a QA Plan Issue" is not a property of any diff. It is a statement about what the document is —
structurally the same as `prd`, which has always been an Orchestration Label.

Separately, `grill-with-docs` sessions had no label at all. `wayfinder:grilling` exists but belongs
to Wayfinder, an approved external rather than a repo skill ([ADR 0029](0029-wayfinder-is-an-approved-external-not-a-repo-skill.md)),
and ADR 0025 already excludes `wayfinder:*` from repo tooling. Reusing it would blur a boundary two
ADRs drew on purpose.

## Decision

- **`qa` moves to the Orchestration vocabulary** and means exactly one thing: this issue is a **QA
  Plan Issue**. It is applied by the `qa-plan` skill and by nothing else.
- **`grilling` is added to the Orchestration vocabulary.** It marks an issue whose design must be
  stress-tested in a `grill-with-docs` session before implementation starts. Like `type:hitl`, it
  signals that `dispatch-agents` should not pick the issue up — but for a different reason: not
  "a human must decide something" but "the shape of the work is not settled yet".
- **Neither label may appear on a Pull Request.** This needs no new code: `create-pr.mjs` builds its
  allowlist from `surfaceLabelNames()`, which reads only `surface.kind` and `surface.area`, so
  moving `qa` out of `surface.kind` makes the runner reject it automatically.
- **Neither label participates in branch naming.** The `AGENTS.md` branch-type table maps Surface
  Labels to prefixes; both are removed from that mapping rather than given a prefix.
- **History is not retrofitted.** The six open issues wearing `qa` for the old meaning lose it. The
  nineteen closed ones keep it, as a record of what the label meant when they were filed.

## Considered Options

- **Keep `qa` as a Surface kind and only tighten its description** — rejected. It is the cheapest
  option and needs no ADR, but it leaves a "kind" that no diff can ever justify, which contradicts
  ADR 0025's own definition. It also leaves nothing preventing PrAuthor from stamping `qa` on a Pull
  Request, where under the new meaning it would be simply false.
- **Keep `qa` in surface and special-case it in the runner** — rejected. It buys the same protection
  by adding an exception to a rule instead of by placing the label where the rule already produces
  the right answer. The catalog is meant to be the single source of truth; a hand-maintained
  exclusion beside it is a second list.
- **Reuse `wayfinder:grilling`** — rejected. It costs nothing to apply, but Wayfinder is an external
  and its label vocabulary is not ours to extend. ADR 0025 explicitly keeps `wayfinder:*` out of
  repo tooling.
- **Make `grilling` a Surface kind** — rejected. It would flow into branch naming, which is wrong: a
  grilling session usually produces a decision, not a branch. And a Surface Label says nothing about
  readiness, so `dispatch-agents` would get no signal from it.
- **Strip `qa` from all 25 issues** — rejected. It would produce a perfectly consistent taxonomy by
  relabelling nineteen closed issues against a vocabulary that did not exist when they were filed,
  destroying the record of why they were grouped.
- **Apply the new meaning only to new issues** — rejected. `qa` would then mean two different things
  in the open issue list, which is the ambiguity this decision exists to remove.

## Consequences

- `yarn ai:create-labels` must be re-run to provision `grilling` and update `qa`'s description on
  GitHub. The catalog is the source; GitHub is the copy.
- ADR 0018 describes `upstream-brief` mapping a `quality` role to `qa`. That mapping is now wrong —
  an upstream-brief finding is not a QA Plan. The skill itself does not hardcode the label, so
  nothing breaks today, but the prose in ADR 0018 is stale and should be corrected when that skill
  is next touched.
- Nothing machine-reads `grilling` yet. It is a marker for humans and a hint to `dispatch-agents`;
  wiring it into the orchestrator's skip logic is deliberately left for when that is needed rather
  than built speculatively.
- The Surface Label kind list shrinks to eight. One place hardcoded the old list:
  `tools/scripts/lib/github-labels.test.ts` pinned the thirteen Surface Label names as an
  `ADR_0025_SURFACE_LABELS` array, and CI caught the mismatch. It has been retargeted, and now also
  asserts the property this decision turns on — that `qa` and `grilling` are provisioned, are not
  Surface Labels, and are rejected by `rejectedPrLabels`. The behaviour is therefore covered by a
  test rather than resting on the catalog's shape alone.
- That test was initially missed because the search for consumers looked for the label in prose
  form (backtick-quoted, in Markdown and scripts) and not as a bare string literal in an array.
  Worth remembering when moving any other catalog entry: the catalog is data, so its consumers cite
  it as data, not as prose.
- ADR 0048 records that `qa` "continues to mean several things historically". That remains true of
  closed issues and is now false of open ones.
