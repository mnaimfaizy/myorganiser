# Upstream-Owned Skills are project scope, and `skills-lock.json` is the registry

Three skills adapted from `mattpocock/skills` — `prototype`, `handoff`, `codebase-design` — are replaced by upstream installs. They become **Upstream-Owned Skills** (`CONTEXT.md`): bodies authored upstream, refreshed by the Skills CLI, listed in `skills-lock.json`, never hand-edited. `modern-web-guidance` was already this shape without a name for it.

They install at **project scope**, into `.agents/skills/`, and are committed. Personal scope (`-g`) would avoid the commits, but a personal-scope skill is absent from fresh clones and from CI, so nothing may route to it by name or link into it by path. Committing is the price of a skill that can be depended on, and the diff is a feature: an upstream change to prose our agents execute arrives as a reviewable diff with a content hash, not as a silent update on each machine.

Each fork was carrying no local requirement. `codebase-design` diverged from upstream by 3%, entirely Prettier reformatting. `prototype`'s "MyOrganiser constraints" restated three rules already always-on in `AGENTS.md` (lines 58, 185, 186), and the fork had drifted _behind_ upstream — losing a rule about capturing prototypes as primary sources. `handoff`'s only local content was an example list naming 8 of 35 skills, which was also the single line that made it a false hub in the skill atlas with eight phantom outbound edges.

`skills-lock.json` is the registry of upstream-owned directories. `check-skill-map.ts` reads it and skips those directories when extracting outbound edges, sub-agent references, and `/slug` invocations — their prose is someone else's writing, not this repo's routing configuration. Within a minute of the install, upstream prose produced a spurious dangling `/settings`; the exclusion removed it.

`EXTERNAL_SKILLS.md` tiers now name the **scope**, not the strength of the recommendation, because scope is what decides whether a skill may be routed to.

## Status

accepted

## Considered Options

- **Personal scope for these three** — rejected. It achieves the original goal (no commit per upstream version) but caps what can ever be externalised at soft on-ramps, since nothing may depend on a skill that is not in every clone. It also moves supply-chain review off the pull request and onto whoever happens to run `skills update`.
- **Keep the forks** — rejected. Every diff was our formatter, duplication of `AGENTS.md`, or a stale list. `prototype` demonstrates the cost directly: it had silently fallen behind upstream while nobody was reviewing it against the source.
- **Relocate the local customizations to `AGENTS.md`, or wrap each external in a thin repo-native skill** — rejected for these three. `prototype`'s rules are _already_ in `AGENTS.md` verbatim; a wrapper is a second file per skill that re-creates the coupling being shed. Wrapping stays on the table for skills with genuinely load-bearing local content — `diagnosing-bugs` (vault/JWT/SMTP redaction), `domain-modeling`, `code-review` — which are deliberately **not** in this batch.
- **Hard-code the upstream-owned directory names in the check** — rejected. That is the status quo (`modern-web-guidance` appeared twice by name) and it does not scale: any of the 22 sub-agent names can collide with upstream English, and those collisions would be found one red check at a time.
- **A separate hand-maintained list of externals in the check or in `EXTERNAL_SKILLS.md`** — rejected. That is the lockfile with manual synchronization, which is strictly worse than the lockfile.
- **A written evaluation per skill, matching the `modern-web-guidance` precedent** — rejected. That precedent was earned by properties these three lack: `modern-web-guidance` executes `npx modern-web-guidance@latest` at use time, ships 140 guide files, and sends telemetry, so it needed license review, scanner results, and a `DISABLE_TELEMETRY` note. These three are prose that executes nothing. Seven skills in this repo already derive from this publisher; externalising stops maintaining private forks of a supplier already in use rather than adding one.

## Consequences

- Approved set and install commands: [`.agents/skills/EXTERNAL_SKILLS.md`](../../.agents/skills/EXTERNAL_SKILLS.md). Glossary: **Upstream-Owned Skill** in [`CONTEXT.md`](../../CONTEXT.md).
- Refresh with `npx skills update -p`, review the diff, commit it. Never hand-edit a directory named in `skills-lock.json`; an edit is lost at the next update and the check will not warn you.
- A skill copied in by hand, bypassing the CLI, is absent from the lockfile, so the check treats it as repo-native and fails on its missing description. That is intended.
- `check-skill-map.ts` asserts that the project-scope tier and `skills-lock.json` name the same skills, in both directions — a document describing an install that did not happen is a lie the check now catches.
- Two config files must list every upstream-owned directory, and the check asserts both: `.prettierignore` (formatting re-forks upstream bodies) and `.gitattributes` (`linguist-generated=true whitespace=-trailing-space`). The `.gitattributes` rule must stay scoped rather than covering `.agents/skills/**` — marking the whole tree generated collapses the diffs of 31 hand-written instruction files in review, which is how it sat from #255 until it was noticed.
- Relative links from repo-native skills into upstream-owned directories are asserted to resolve. This is the one silent failure this change introduces: `improve-codebase-architecture` links `../codebase-design/DEEPENING.md`, and a future upstream rename would leave the skill loading fine while pointing at nothing.
- `skillToSkillEdgesRenderedCount` is retired from the atlas manifest. It existed only to express the gap created by `handoff`'s false hub; found and drawn now agree at 63.
- Each `mattpocock/skills` install also writes `agents/openai.yaml`, an upstream-authored harness manifest. It is inert here — no OpenAI harness reads this repo — and `yarn agents:sync:check` is unaffected, since that governs `.github/agents` → `.claude/agents`.
- Fresh clones and CI get project-scope skills from the commit. `npx skills experimental_install` restores them from the lockfile, but it is experimental and is not wired into any repo script.
