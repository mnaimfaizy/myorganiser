# One Instruction File, one Skill tree, generated Sub-agent adapters

Harnesses cannot share one file as-is: Claude Code reads `CLAUDE.md`, Copilot still has `copilot-instructions.md`, Cursor rules ignore plain `.md`, and Sub-agent frontmatter schemas differ. Copying the same policy into every Harness Adapter is what drifted. We keep three different treatments — one human-edited Instruction File, one Skill tree plus a Claude symlink, and generated Sub-agent copies — because vendors load those artifacts for different reasons.

## Status

accepted

## Decision

- **Instruction File.** Repo-wide always-on policy lives in root `AGENTS.md`. Nested `apps/*/AGENTS.md` and `libs/*/AGENTS.md` stay location-scoped. `CLAUDE.md` `@`-imports `AGENTS.md` and keeps Claude-only bits. `GEMINI.md` does the same and `context.fileName` includes `AGENTS.md`. `.github/copilot-instructions.md` remains a short pointer (Copilot has no `@`-import and still treats that file as a distinct instruction type). The Instruction File may **choose** a Skill (which one to load when requests collide); it must not restate the Skill's procedure.
- **Skill tree.** Repo-native Skills and `npx skills` installs live in `.agents/skills/`. Claude Code discovers them via a committed directory symlink `.claude/skills` → `../.agents/skills`. Cursor workflow `.mdc` files and Claude workflow commands are deleted once that tree is in place. Gemini keeps thin `.toml` commands that `@`-include the Skill (`prompt = """…@{.agents/skills/<name>/SKILL.md}…"""`, plus a `description`). Gemini CLI loads only `.toml` files from `.gemini/commands/`, so a `.md` adapter there is silently never a command. `.github/skills/` is not a second content tree.
- **Sub-agents.** Canonical bodies stay in `.github/agents/*.agent.md`. `yarn agents:sync` remains the generator for `.claude/agents`, `.cursor/agents`, and `.gemini/agents`. Do not collapse Cursor copies onto `.claude/agents/` — model pins and tool names are not portable ([ADR 0013](0013-bounded-subagent-model-governance.md)).

Instruction File vs Skill: always-on constraints (vault, gates, branch naming, architecture, bans, **choosers**) belong in `AGENTS.md`. Named workflows belong in a Skill. A Skill's `description` and Core Rules must fence colliding requests (for example IssueCreator is not for PRD Issues). A ban such as “never `git commit` directly” can appear in both: the Instruction File owns the ban, the Skill owns the procedure.

## Considered Options

- **Zero-adapter “one paragraph, all Harnesses”** — rejected. No vendor documents it. Research: [docs/research/2026-08-17-multi-harness-instruction-ssot.md](../research/2026-08-17-multi-harness-instruction-ssot.md).
- **Keep `.github/skills/` as the Skill SSOT and symlink into Cursor/Claude** — rejected. Cursor does not document `.github/skills/` as a project path. Gemini’s `.agents/skills/` alias wins over `.gemini/skills/` when both exist, so a second tree either blinds Gemini or duplicates Skills for Copilot (which reads `.github/skills/` _and_ `.agents/skills/`).
- **`skills:sync` that copies Skill bodies into every Harness folder** — rejected. That recreates the Sub-agent generator for an artifact vendors already share via `.agents/skills/` and a symlink. If git symlinks fail on Windows/CI, add a check that the link exists, not a copy.
- **Collapse Cursor Sub-agents onto `.claude/agents/`** because Cursor also reads that folder — rejected. Cursor model ids (`composer-2.5` for CodeExplorer) and Claude aliases are not interchangeable. Duplicate listing in the Cursor UI is a verify-after item, not a reason to share one file.
- **MCP resources as the policy store** — rejected. MCP is for dynamic context, not version-controlled coding policy.
- **Delete `.github/copilot-instructions.md`** — rejected. GitHub documents it as a separate channel from `AGENTS.md`; both may apply. Fat duplication is the bug, not the file’s existence.

## Consequences

- A policy edit has one human write: `AGENTS.md`, a Skill under `.agents/skills/`, or a canonical Sub-agent under `.github/agents/`. Everything else is a Harness Adapter or generated output.
- Next.js API-shape claims stay in `AGENTS.md` ([ADR 0019](0019-nextjs-proxy-is-not-a-session-layer.md)); package versions stay in `TECH_STACK.md` ([ADR 0001](0001-tech-stack-single-source-of-truth.md)).
- Moving Skills off `.github/skills/` is a path-churn migration. Pointers in Instruction Files, commands, and docs must follow. Do not leave a populated second Skill tree behind.
- Glossary: [CONTEXT.md](../../CONTEXT.md) — Harness, Instruction File, Skill, Harness Adapter, Sub-agent.
