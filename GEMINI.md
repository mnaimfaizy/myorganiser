@AGENTS.md

# Gemini CLI

This file is a Harness Adapter. Shared always-on policy lives in `AGENTS.md`. Do not restate it here.

## Context

`.gemini/settings.json` lists `AGENTS.md` in `context.fileName` so this Harness loads the Instruction File.

## Commands

Thin `.toml` files under `.gemini/commands/` point at Skills: a `description` and a `prompt` that `@{...}`-includes the Skill's `SKILL.md`. Gemini CLI loads only `.toml` command files ([Custom commands](https://geminicli.com/docs/cli/custom-commands/)), so a `.md` adapter there is never a command. Put procedures in `.agents/skills/`, not in the command file.

## Sub-agents

Generated copies live in `.gemini/agents/`. Canonical bodies are `.github/agents/*.agent.md`. After any Sub-agent change: `yarn agents:sync` then `yarn agents:sync:check`.
