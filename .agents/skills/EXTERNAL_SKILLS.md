# Approved Third-Party Skills

Third-party skills approved for use in MyOrganiser. They add fast-moving framework knowledge the repo should not duplicate.

**Project scope only.** A third-party skill is either committed here and stewarded like any other file, or it is not approved. Personal-scope recommendations were removed: this repo cannot update, review, or vouch for a skill living on one developer's machine, and an approval list nobody installs from decays silently — see [ADR 0032](../../docs/adr/0032-no-personal-scope-external-skills.md).

For fast-moving framework knowledge, use `upstream-brief`. It compares repo-owned instructions against official docs for the Ecosystems you name — anchored to the version actually installed — and proposes a HITL issue, which keeps the knowledge in this repo and under review rather than in a vendor's package.

`GoogleChrome/modern-web-guidance@modern-web-guidance` was verified against upstream documentation and a disposable install on August 15, 2026; see the [evaluation](../../docs/research/2026-08-15-modern-web-guidance-evaluation.md). The `mattpocock/skills` entries were verified by sandbox install on August 19, 2026.

## Project Scope — Upstream-Owned, committed

Installed into `.agents/skills/` and committed. These are **Upstream-Owned Skills** (`CONTEXT.md`): never hand-edit them, and refresh them only through the CLI. `skills-lock.json` is the registry — `check-skill-map.ts` reads it to decide which directories are ours.

- `GoogleChrome/modern-web-guidance@modern-web-guidance`
- `mattpocock/skills@codebase-design`
- `mattpocock/skills@diagnosing-bugs`
- `mattpocock/skills@domain-modeling`
- `mattpocock/skills@handoff`
- `mattpocock/skills@prototype`

Repo-native skills may route to these by name and may link into them by relative path; the check asserts those links still resolve after an update.

```sh
npx skills add GoogleChrome/modern-web-guidance --skill modern-web-guidance -y
npx skills add mattpocock/skills --skill codebase-design diagnosing-bugs domain-modeling handoff prototype -y
```

Refresh them, review the diff, and commit it:

```sh
npx skills update -p
```

## Deliberate Exclusions

Thirteen personal-scope approvals were removed in [ADR 0032](../../docs/adr/0032-no-personal-scope-external-skills.md) after four months in which nobody installed any of them and two died upstream. Do not re-add one without project-scope commitment and a stated trigger.

Specifically excluded, with reasons that outlive the tier:

- `vercel-labs/next-skills@*` — the package ships no valid skills, and `AGENTS.md` already pins `node_modules/next/dist/docs/` as the Next.js source of truth. A third-party opinion pack would compete with version-matched official docs.
- `wshobson/agents@tailwind-design-system` — conflicts with the Design Tokens section of `AGENTS.md`, which makes `tokens.json` the single source of truth and forbids hard-coded values.
- `vercel-labs/agent-skills@vercel-composition-patterns` — ComponentBuilder already mandates the compound/composition pattern, and ComponentReviewer enforces it.
- `wshobson/agents@nodejs-backend-patterns` — `backend-api-contract-change` plus the TSOA and Prisma conventions are more specific.
- Generic duplicate packs with weaker fit or lower-signal descriptions.
- `verification-before-completion` — the publisher choice was not as clear as the approved entries, and this repo already encodes strong verification guidance locally.
- `typescript-advanced-types` — useful but not central to this codebase's day-to-day work.
