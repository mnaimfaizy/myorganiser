# No personal-scope external skills

Thirteen third-party skills were approved for personal-scope install and none was ever installed. `~/.claude/skills` on the approver's own machine holds one unrelated skill; `skills-lock.json` holds only the six project-scope entries. The tier is removed. A third-party skill is either committed at project scope and stewarded like any other file in this repo, or it is not approved.

The reason is stewardship, not quality. This repo cannot update, review, or vouch for a skill living on one developer's machine. There is no diff when it changes, no lockfile hash, no CI, and nothing the `skills:map:check` guard can reach. `EXTERNAL_SKILLS.md` said "verified April 26, 2026"; by August 19 the `vercel-labs/next-skills` package shipped **no valid skills at all**, and nothing in the repo had noticed or could have.

"Personal scope, recommended" was also a contradiction on its own terms. A skill recommended to everyone belongs at project scope so everyone actually has it, in CI and in fresh clones; a skill for a particular task is situational and needs a stated trigger. The middle is where an approval sits unowned.

For the need the tier was meant to serve — fast-moving framework knowledge the repo should not duplicate — `upstream-brief` is the repo-owned answer. The human names an Ecosystem, optionally with a Horizon; it compares repo-owned instructions against official docs at the installed Baseline ([ADR 0084](0084-an-upstream-brief-is-anchored-to-what-is-installed-and-accepted-on-checked-evidence.md)); and it proposes a HITL issue. The knowledge lands in this repo, under review, rather than in a vendor's package on one laptop.

## Status

accepted

Supersedes the `/wayfinder` route decision in [ADR 0029](0029-wayfinder-is-an-approved-external-not-a-repo-skill.md). Builds on [ADR 0030](0030-upstream-owned-skills-are-project-scope.md).

## Considered Options

- **Prune the dead entries and keep the tier** — rejected. It preserves the incoherence and schedules the same decay for next quarter, with no mechanism to catch it: the check cannot reach the network, so an entry can die upstream and stay approved indefinitely.
- **Promote the worthwhile ones to project scope** — rejected on the evidence. Four months, zero installs, by the person who approved them. Project scope costs context for every request and should be earned by use, not by intention. Every candidate also overlapped something the repo already owns more specifically: `vercel-composition-patterns` against ComponentBuilder's compound-pattern mandate, `nodejs-backend-patterns` against `backend-api-contract-change`, `tailwind-design-system` against the `tokens.json` SSOT rule in the Design Tokens section of `AGENTS.md` — which it would have contradicted, not supported.
- **Keep `wayfinder` as the sole exception**, since `ask-matt` routed to it — rejected. ADR 0029 kept that route on the grounds that removing it would remove a capability, but the capability never existed: nobody installed `wayfinder`, so the route pointed at nothing before and after we approved it. We legitimised a dangling reference rather than fixing it.
- **Build a repo-native replacement for `wayfinder`** — rejected. That is writing a skill for a gap nobody has hit in the months the route was dead. If it appears, a grill will specify it better than a guess made now.
- **Keep the Next.js skills** — rejected twice over. The package ships nothing, and `AGENTS.md` already pins `node_modules/next/dist/docs/` as the Next.js source of truth precisely because training data goes stale. A third-party opinion pack would have competed with version-matched official docs.

## Consequences

- `EXTERNAL_SKILLS.md` has one approval tier. `check-skill-map.ts` fails if a `## Personal Scope` heading reappears, so the tier cannot return without superseding this ADR.
- `ask-matt` routes a foggy effort to `/grill-with-docs` instead of `/wayfinder`. That is the on-ramp that was doing the work anyway: interview until the abstractions have edges, then `/to-prd` once the goal sentence is writable.
- The skill atlas loses **Tier 3** entirely. It existed to draw approved-but-not-installed externals, and no such thing remains — every approved external is project scope and already drawn as an Upstream-Owned node in Tier 1.
- The reasons for specific exclusions are kept in `EXTERNAL_SKILLS.md` rather than deleted with the entries. A future reader proposing `tailwind-design-system` should find out it conflicts with the tokens rule without rediscovering it.
- Approving a third-party skill now means committing it, adding it to `.prettierignore` and `.gitattributes`, and accepting `npx skills update -p` diffs. That is a deliberately higher bar than editing a list.
