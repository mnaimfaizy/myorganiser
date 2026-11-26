# Google Antigravity

This file is a Harness Adapter for Google Antigravity (App, IDE, and `agy` CLI). Shared always-on policy lives in `AGENTS.md` (auto-discovered by Antigravity). Do not restate it here, and keep per-file rule documents within Antigravity's 24 KB rule cap.

## Skills

Repo Skills live in `.agents/skills/` and are auto-discovered. Load the Skill for a named workflow instead of copying its procedure into this file.

## Workspace Plugin

The MyOrganiser workspace plugin lives in `.agents/plugins/myorganiser/` and provides:

- The `myorganiser-graphify` MCP server (`.agents/plugins/myorganiser/mcp_config.json`).
- `PreToolUse` security hooks (`.agents/plugins/myorganiser/hooks.json`).
- Synced specialist subagents under `.agents/plugins/myorganiser/agents/`.

## Sub-agents

Generated Antigravity copies live in `.agents/plugins/myorganiser/agents/`. Canonical bodies are `.github/agents/*.agent.md`. After any Sub-agent change: `yarn agents:sync` then `yarn agents:sync:check`.
