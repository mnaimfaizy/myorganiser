# Antigravity replaces Gemini CLI as a supported Harness

## Status

accepted

## Context

Google migrated individual, AI Pro, and AI Ultra users from Gemini CLI to Google Antigravity (`agy` CLI, desktop app, and IDE). MyOrganiser does not run Gemini CLI on API-key usage billing.

Keeping the Gemini CLI harness carried ongoing maintenance cost with no active consumer: 33 generated files (synced sub-agent adapters, command wrappers, and settings), monthly catalog and pricing-page drift noise from scraping Gemini's public API pricing page, and an unguarded harness with no `PreToolUse` security hooks.

## Decision

Replace the `gemini` harness slot with `antigravity` via the committed workspace plugin under `.agents/plugins/myorganiser/`:

- `.agents/plugins/myorganiser/plugin.json` — workspace plugin manifest (`myorganiser`).
- `.agents/plugins/myorganiser/mcp_config.json` — registers the `myorganiser-graphify` MCP server over `graphify-out/graph.json`.
- `.agents/plugins/myorganiser/hooks.json` — wires `PreToolUse` security guardrails (`tools/scripts/copilot-hooks/secret-scan.ts` and `tools/scripts/copilot-hooks/pre-tool-use.ts`) with `--antigravity` across `run_command`, `write_file`, `edit_file`, and `read_file`.
- `.agents/plugins/myorganiser/agents/*.md` — synced sub-agent adapters generated from `.github/agents/*.agent.md`, using Antigravity's native tier pins (`flash_lite`, `flash`, `pro`, `inherit`), YAML `tools:` allowlists rendered from `tools/config/agent-tool-map.json`, and `inheritMcp: true` for MCP-enabled agents.

Keep `GEMINI.md` as the thin Antigravity Harness Adapter alongside `AGENTS.md` and `.agents/skills/`, both of which Antigravity discovers natively.

Retire `.gemini/` — that directory no longer exists in the repository — and remove the `gemini` harness entry across `tools/scripts/sync-subagents.ts`, `tools/scripts/sync-agent-models.ts`, `tools/config/agent-tool-map.json`, `tools/config/agent-model-policy.json`, and `tools/scripts/audit-agent-model-catalog.ts`.

This supersedes the Gemini CLI harness target in [ADR 0013](0013-bounded-subagent-model-governance.md), [ADR 0020](0020-one-instruction-file-one-skill-tree.md), and [ADR 0081](0081-sub-agent-tool-grants-are-derived-from-canonical-roles.md). GitHub Copilot's Gemini model pins in `tools/config/agent-model-policy.json` are unaffected and remain governed by ADR 0013.

## Considered Options

- **Keep both Gemini CLI and Antigravity harnesses** — rejected. Keeping an unused harness preserves 33 generated files, monthly Gemini API pricing-page drift alerts, and an unguarded tool surface alongside the product that replaced it.
- **Pass `--defer` to Antigravity `PreToolUse` hooks** — rejected. Antigravity's `PreToolUse` contract expects an explicit `"decision"` field (`"allow"` or `"deny"`) on stdout with exit code `0`; omitting `--defer` ensures every hook invocation returns an explicit decision.

## Consequences

- `yarn agents:sync:check`, `yarn gates:run`, and the contract tests (`tools/scripts/lib/harness-sections.test.ts`, `tools/scripts/lib/agent-tool-grants.test.ts`, `tools/scripts/copilot-hooks/pre-tool-use.test.ts`, `tools/scripts/copilot-hooks/secret-scan.test.ts`, and `tools/scripts/copilot-hooks/defer.test.ts`) enforce Antigravity parity across bodies, tool grants, model tiers, and guard hooks.
- Antigravity `PreToolUse` hooks emit explicit `{ "decision": "allow" }` or `{ "decision": "deny", "reason": "..." }` payloads and omit `--defer` in `.agents/plugins/myorganiser/hooks.json`.
- Antigravity pins abstract model tiers (`flash_lite`, `flash`, `pro`, `inherit`) rather than versioned Gemini API model IDs, removing the external Gemini pricing-page scrape from `yarn agents:models:audit`.
- Because Antigravity discovers `.agents/skills/` natively, per-skill TOML command wrappers are no longer maintained.
