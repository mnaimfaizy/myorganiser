# A Covering Gate is part of the site, not part of the answer

Golden Replay run 47 missed `release-bump-leaves-generated-client-stale`
([#734](https://github.com/mnaimfaizy/myorganiser/issues/734)). The obligation
`run-the-gate-that-covers-this-change` fired on the correct site and was answered:

```
gate:      "deploy:pages:check"
command:   "not run"
exitCode:  "not run"
wiredBy:   ".github/workflows/ci.yml:705"
```

Every part of that is true. Line 705 does invoke `deploy:pages:check`; the citation added by
[#727](https://github.com/mnaimfaizy/myorganiser/issues/727) read the line back from the tree and
matched it; `defectWhen` correctly did not fire, because the gate **is** wired.

The incident is about a different gate. A version bump in `package.json` is embedded into the
OpenAPI spec and the generated client, so the gate over the invalidated artifact is
`openapi:check` — which at that head was invoked by no hook and no workflow. Name that gate and
`wiredBy` is `"none"`, the defect fires, and the case is caught.

Of the four answer fields, `wiredBy` was cited and `gate` was not — yet `gate` selects what the
other three are about. The one free choice in the entry was the one that decided the outcome.

## Status

accepted

## Decision

**A Covering Gate is named by the catalogue against the trigger, and is part of the site the
reviewer receives. It is not an answer field.**

`tools/config/review-obligations.json` gains two things:

1. An obligation may declare `siteFields` — answer-shaped facts the **catalogue** supplies and
   the selector carries into every site, rather than facts the reviewer writes. Every field named
   in `siteFields` is required on every entry in `trigger.paths`, and the loader fails an entry
   that omits one. A field cannot be in both `siteFields` and `answerFields`.
2. `run-the-gate-that-covers-this-change` declares `siteFields: ["coveringGate"]`, names a
   `coveringGate` on each of its six trigger paths, and drops `gate` from `answerFields`, which
   becomes `["command", "exitCode", "wiredBy"]`.

The mechanism, in one sentence: **an answer that names a wired gate which does not cover the
changed artifact can no longer be written, because the gate is no longer written by the
reviewer.**

## Why against the trigger, and not against the diff

The artifact at risk is usually **not in the diff**. The run 47 diff contained `package.json`;
`openapi:check` covers the OpenAPI spec and the generated client, and covers `package.json`
not at all. A map from _changed path_ to _the gate over that path_ would not have produced
`openapi:check`, and neither would enumerating every gate whose own trigger paths intersect
the diff.

So a Covering Gate answers a propagation question — _what does this change invalidate?_ — and
the trigger list is already half of that claim. An obligation's trigger entry asserts that a
documented failure mode lives at this path; naming the gate that would have caught it is the
same author, in the same file, completing the same sentence.

This is why the field lives **on the trigger entry** rather than in a sibling path-keyed config
in the style of `tools/config/review-tier-paths.json`. Two files can disagree, and this repo's
answer to a config that can disagree with another is a third checker. One line cannot disagree
with itself.

## Exactly one, and required

`coveringGate` takes a single script name. Not a list, and not optional with a sentinel for
"nothing covers this."

The consequence is deliberate. [#734](https://github.com/mnaimfaizy/myorganiser/issues/734)
raises the question of how a derived mechanism tells _"no gate covers this artifact"_ apart from
_"no map entry exists"_ — which are not the same fact. Requiring the field makes the second state
**unrepresentable**: a trigger without a Covering Gate is rejected by the loader, so the only
state left is the first, which is the obligation's existing job and is spelled `wiredBy: "none"`.

The price is that an artifact with no gate at all cannot be expressed. An author who cannot name
the gate that would have caught the failure mode must either build that gate or drop the trigger.
That is the intended forcing function, and it fired on the first authoring pass — see
`design-tokens:check` below.

## The six

| Trigger                                       | Covering Gate             |
| --------------------------------------------- | ------------------------- |
| `package.json`, on an added `"version":` line | `openapi:check`           |
| `libs/api-specs/**`                           | `openapi:check`           |
| `apps/backend/src/swagger/**`                 | `openapi:check`           |
| `libs/app-api-client/**`                      | `openapi:check`           |
| `apps/backend/src/prisma/migrations/**`       | `prisma:migrations:check` |
| `libs/design-tokens/src/tokens.json`          | `design-tokens:check`     |

Three gates across six triggers. The map is bounded by the obligation's own trigger list, not by
the repository's checker set, so it goes stale when a **trigger** is added — on the lines directly
above it — and not when a gate is.

Two of the six were not clean, and both are recorded rather than smoothed over.

**The Prisma trigger narrowed** from `apps/backend/src/prisma/**` to
`apps/backend/src/prisma/migrations/**`. `prisma:migrations:check` covers the migration _history_;
per [ADR 0094](0094-a-prisma-migration-is-gated-on-the-tree-and-against-a-database.md) the
schema-versus-database question is a different artifact answered by `prisma migrate deploy` and
`prisma migrate diff --exit-code` in the `Prisma Migration Gate` job — which is a job step, not a
`*:check` script, and so is not nameable here. Rather than let one trigger point at a gate covering half of it, the
trigger was narrowed to the half the named gate actually covers. A bare `schema/` edit no longer
fires this obligation; it is gated by ADR 0094 tier 2, which is where that question was already
decided to live.

**`design-tokens:check` did not exist.** `libs/design-tokens` declared one target, `build-tokens`,
and nothing asserted that `src/generated/` matches `tokens.json` — a token whose value changed
without a rebuild was caught by nothing. The only script reading the tokens file is
`tailwind:classes:check`, which covers _consumption_ (a utility naming a theme value that compiles
to no CSS, [ADR 0065](0065-tokens-json-is-the-single-source-of-web-colour.md)) and not
regeneration. Naming it would have been a truthful answer about a gate that covers something
adjacent — precisely the defect this ADR exists to remove. So the gate was built, in
`api-specs:check`'s shape: rebuild, then assert the tree did not move.

## Alternatives rejected

**Cite `gate` as well**, requiring the line in `package.json` that defines the named script.
Rejected. It proves the named gate exists; it does not prove the named gate covers the changed
artifact, which is the entire failure. Run 47's answer would have survived it unchanged —
`deploy:pages:check` is defined in `package.json` and citable. It narrows nothing that matters
while making the field _look_ verified, which is worse than leaving it visibly free.

**Answer every candidate gate** whose own trigger paths intersect the diff, with the defect firing
if any is `"none"`. Rejected on correctness rather than cost: `openapi:check` has no trigger path
intersecting the run 47 diff, so this shape is structurally unable to catch the case that
motivates it. It enumerates gates over the changed path, and the failure is always about an
artifact somewhere else.

## Relationship to ADR 0078

This **extends** [ADR 0078](0078-a-citation-that-does-not-match-its-source-is-a-fact-about-the-pipeline.md)
and supersedes nothing in it.

ADR 0078 governs **truthfulness**: a citation that does not match the tree at head is a fact about
the pipeline, and gates. This ADR governs **aboutness**: which thing the answer is a claim
regarding. Run 47 is the proof they are different properties — a perfectly truthful, correctly
cited, correctly non-defecting answer about the wrong subject. No citation rule can see that,
because a citation proves a claim about the thing named and says nothing about whether the right
thing was named. ADR 0078's rule is untouched and still holds over `wiredBy`.

## What is not done here

The other three obligations in the catalogue are not migrated. `siteFields` is written to
generalise — it is declarative, and any obligation with a field the catalogue can supply better
than the reviewer can choose may use it — but whether any of them has such a field is a separate
question and is not answered by this ADR.

## Consequences

- `design-tokens:check` itself — the Covering Gate for the `tokens.json` trigger — rebuilds
  `libs/design-tokens/src/generated` from `tokens.json` and asserts the tree did not move, the same
  shape as `openapi:check` for the same reason: a generated tree and its source can silently
  disagree, and nothing before this ADR asserted the two agreed. It runs in CI rather than the
  pre-commit aggregate for the reason [ADR 0043](0043-gates-assert-facts.md)
  gives generally: it runs a build, which is too slow for Husky.
- `gate` leaves the reviewer's answer sheet. `docs/review/REVIEW_CHECKLIST.md` entry 1 changes its
  answer-field list and its question prose, and `yarn review:checklist:check` holds the two in
  agreement.
- The reviewer does one less thing per site and has one less way to be wrong. The turn it spent
  choosing a gate is returned to the budget tracked in
  [#732](https://github.com/mnaimfaizy/myorganiser/issues/732).
- A new trigger path costs a judgment it did not cost before: its author must name the Covering
  Gate, or build one.
- **The golden case is not the completion signal, and must not be used as one.** The defect is a
  variance widener rather than a deterministic dead end — re-running the case draws from a
  distribution, and it was caught repeatedly while the gap was open. The signal is instead a
  contract suite over the mechanism: run 47's actual answer is frozen as a fixture and asserted to
  be **inexpressible**, the loader is asserted to reject a trigger with no Covering Gate, and the
  selector is asserted to carry the gate into every site.
