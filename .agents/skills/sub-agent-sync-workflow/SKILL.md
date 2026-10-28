---
name: sub-agent-sync-workflow
description: Keep sub-agent definitions synchronized across harnesses from the canonical `.github/agents` bodies. Use when adding, removing, renaming, or editing a sub-agent, or when `yarn agents:sync:check` reports drift.
---

# Sub-Agent Synchronization Workflow

Use this workflow whenever any sub-agent file changes in any harness directory.

## Goal

Keep these directories structurally synchronized with `.github/agents` as the canonical source of truth:

- `.github/agents` (canonical)
- `.claude/agents`
- `.cursor/agents`
- `.gemini/agents`

Synchronization means:

1. Every canonical agent exists in each target harness.
2. Agent body content in each target harness matches canonical body content.
3. Added or removed canonical agents are propagated to all target harnesses.
4. Tool grants in every harness match the canonical `tools:` roles, rendered through
   `tools/config/agent-tool-map.json`.
5. All other harness-specific frontmatter is preserved when the file already exists.
6. Missing files are created with rendered frontmatter.
7. Harness-specific **body** content lives in canonical, wrapped in `<!-- harness:... -->` markers.

## Harness-Specific Body Sections

The body is regenerated from canonical on every apply, so an instruction hand-written into a target
file does not survive the next sync. This is not hypothetical: the Graphify probation instrumentation
was added to `.claude/agents/explore.md` on 2026-06-19 and silently deleted on 2026-07-02 that way.

When an instruction genuinely applies to only some harnesses — MCP tool names are the usual case,
since the same server is `mcp__graphify__*` in Claude, `mcp_graphify_*` in Gemini, and `graphify/*`
in Copilot — put it in **canonical**, wrapped in a marker:

```markdown
<!-- harness:claude -->

Rendered only into .claude/agents/.

<!-- /harness -->

<!-- harness:claude,cursor -->

Rendered into both.

<!-- /harness -->
```

Rules:

- Valid harness names: `claude`, `copilot`, `cursor`, `gemini`. `copilot` means `.github/agents`.
- Unmarked content goes to every harness. Use markers sparingly — a shared body is the default.
- Markers must sit alone on their own line and must not nest. Violations, unknown harness names, and
  unbalanced markers are hard errors, not warnings: a marker that silently fails to apply
  reintroduces the bug the mechanism exists to prevent.
- `.github/agents` is canonical, not a render target, so Copilot reads the file with the markers
  still in it and sees every block. Keep block contents short and self-labeling
  (`**Claude Code —** ...`) so that reads as a reference table, not as contradictory instructions.
- Implementation and tests: `tools/scripts/lib/harness-sections.ts`, run with `node --test tools/scripts/lib/harness-sections.test.ts`.

## Tool Grants

Capabilities are declared once, by role, in the canonical body: `tools: [read, search, execute]`.
Never hand-edit `tools:` (or Cursor's `readonly:`) in `.claude/agents`, `.cursor/agents`, or
`.gemini/agents` — `yarn agents:sync:check` reports the edit as `toolDrift` and `yarn agents:sync`
overwrites it. See [ADR 0081](../../../docs/adr/0081-sub-agent-tool-grants-are-derived-from-canonical-roles.md).

- Roles: `read`, `search`, `edit`, `execute`, `web`, `todo`, `graphify/*`. An unknown role is a hard error.
- Claude and Gemini render an allowlist from the map. Cursor has no per-agent tool list and gets
  `readonly: true` unless the agent declares `edit` or `execute`.
- `--apply` prints each grant change with `WIDENED` apart from `narrowed`. Read the widenings before
  committing.
- If the vocabulary cannot express a grant, add an entry under `overrides` in the map, keyed by agent
  then harness, with a written `reason`. A recurring override should become a role instead.
- Implementation and tests: `tools/scripts/lib/agent-tool-grants.ts`, run with `node --test tools/scripts/lib/agent-tool-grants.test.ts`.

## Commands

- Check drift only:
  - `yarn agents:sync:check`
- Apply sync and prune extras:
  - `yarn agents:sync`
- Test the harness-section and tool-grant renderers:
  - `node --test tools/scripts/lib/harness-sections.test.ts tools/scripts/lib/agent-tool-grants.test.ts`
- Keep extra non-canonical files (rare):
  - `node tools/scripts/sync-subagents.ts --apply --no-prune`

## Source of Truth

- Canonical file body: `.github/agents/<agent>.agent.md`
- Canonical model assignment: `tools/config/agent-model-policy.json`
- Canonical tool grants: the `tools:` roles in `.github/agents/<agent>.agent.md`, translated by `tools/config/agent-tool-map.json`
- Body and grant sync: `tools/scripts/sync-subagents.ts`
- Model sync: `tools/scripts/sync-agent-models.ts`

Do not manually copy agent bodies across harnesses unless the script is unavailable.

## Model Assignment Policy

Model assignments come from `tools/config/agent-model-policy.json`. Agent bodies remain canonical in `.github/agents`; model frontmatter is canonical in the policy.

- GitHub Copilot (`.github/agents`): can define model priority lists.
- Claude (`.claude/agents`): uses one alias or model ID.
- Cursor (`.cursor/agents`): uses one model ID. `CodeExplorer` must use `composer-2.5`.
- Gemini (`.gemini/agents`): uses one model ID.

Assignment strategy:

1. Prefer low-cost fast models for exploration, triage, and repetitive workflows.
2. Use stronger models for generation, synthesis, planning, and judgment only when the role tier requires it.
3. Escalate repeated failures to the main agent or human; do not change pinned models automatically.
4. Run `yarn agents:models:audit` before accepting catalog or assignment changes.

## Required Triggers

Run this workflow after any of the following:

- Edit to any file in `.github/agents/**`
- Edit to any file in `.claude/agents/**`, `.cursor/agents/**`, or `.gemini/agents/**`
- Agent add/remove in any harness
- Model change in any agent frontmatter

## Validation Checklist

Before closing the task:

- `yarn agents:sync:check` returns exit code 0.
- `node --test tools/scripts/lib/harness-sections.test.ts tools/scripts/lib/agent-tool-grants.test.ts` passes if you touched the harness-section or tool-grant renderer, their markers, or `tools/config/agent-tool-map.json`.
- `CodeExplorer` in Cursor remains `model: composer-2.5`.
- Every harness model matches `tools/config/agent-model-policy.json`.
- No canonical agent exists only in `.github/agents`.
- No stale removed canonical agents remain in target harness directories (unless explicitly using `--no-prune`).
