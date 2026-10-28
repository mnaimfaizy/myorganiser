# `/wayfinder` is an approved external skill, not a repo skill

`ask-matt/SKILL.md:43` has routed "huge / foggy effort" to `/wayfinder` since the skill was adapted from `mattpocock/skills`, qualified only by "if installed globally." No such directory exists under `.agents/skills/`, so the skill atlas recorded it as the repo's one dangling skill reference. The route is kept and made honest: `mattpocock/skills@wayfinder` is added to **Optional Add-Ons** in `EXTERNAL_SKILLS.md`, installed per-developer with `npx skills add` rather than vendored, and `ask-matt` now names the seam instead of the install mechanism.

The seam is the **PRD goal sentence**. `/wayfinder` runs while you still cannot write the sentence "this work is done when \_\_\_"; `/to-prd` takes over the moment you can. Without a stated seam, two skills that both "explore a fuzzy effort" collapse into each other and the router picks arbitrarily.

`check-skill-map.ts` reads the approval list from `EXTERNAL_SKILLS.md` when scanning for dangling `/slug` references. Approving an external must not fail the check on the very reference the approval legitimises.

## Status

superseded by [ADR 0032](0032-no-personal-scope-external-skills.md)

The `/wayfinder` route it preserved is gone, along with the personal-scope tier that made the approval possible. This ADR rejected removing the route because doing so "would remove a capability to silence a warning" — but nobody ever installed `wayfinder`, so the route pointed at nothing throughout. The approval legitimised a dangling reference instead of fixing it. What survives is the general rule below, and the reasoning about seams between overlapping skills.

## Considered Options

- **Remove the `/wayfinder` route from `ask-matt`** — rejected. The gap it fills is real: an effort too foggy for a PRD has no other on-ramp, and `/grill-with-docs` presumes a plan to grill. Deleting the route would remove a capability to silence a warning.
- **Vendor `wayfinder` into `.agents/skills/`** — rejected. `README.md` states third-party skills are not vendored by default; `modern-web-guidance` is the one exception and was vendored only after a written [evaluation](../research/2026-08-15-modern-web-guidance-evaluation.md). Nothing about `wayfinder` needs repo-local adaptation, and a vendored copy would freeze at the version it was copied at.
- **Adapt it into a repo-native skill, as with `triage` and `implement`** — rejected. Those were adapted because MyOrganiser's issue labels, gate tiers, and delegation chains had to be written into them. `wayfinder` has no such coupling: it explores an effort and produces a shape. Adapting it would buy divergence with no local requirement behind it.
- **Add it to the Default Install Set** — rejected. It is useful only when an effort is genuinely foggy, which is a minority of work here. Optional Add-Ons is the honest tier.
- **Keep the check's dangling scan ignorant of externals and permanently allow-list `wayfinder`** — rejected. A hard-coded exception would not generalise to the next approved external and would drift out of sync with `EXTERNAL_SKILLS.md`. Reading the approval list makes the check follow the decision automatically.

## Consequences

- Approved externals: [`.agents/skills/EXTERNAL_SKILLS.md`](../../.agents/skills/EXTERNAL_SKILLS.md).
- A backticked `/slug` in a skill now resolves against repo skill directories **and** the approved-external list. A route to an unapproved external still fails `yarn skills:map:check` — approve it in `EXTERNAL_SKILLS.md` or drop the route.
- **Superseded in part by [ADR 0030](0030-upstream-owned-skills-are-project-scope.md).** This ADR asserted that externals are installed per-developer and are therefore absent from a fresh clone. That is true of _personal_ scope only, and it was already false when written: `modern-web-guidance` was installed at project scope and committed. The rule stands for `/wayfinder`, which is personal scope — no skill may hard-depend on it, as a hop in a chain or by relative file path — but it is a property of the scope, not of externals in general. ADR 0030 settles which scope means what.
- Every skill must now carry `name:` and `description:` frontmatter. `check-skill-map.ts` asserts this against the source rather than against the atlas manifest, so recording the defect faithfully on the page no longer keeps the check green.
