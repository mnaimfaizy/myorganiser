# Agent Hooks Reference

Quick matrix for MyOrganiser multi-harness hooks. Prefer the shared scripts in
`tools/scripts/copilot-hooks/` and the workflow in [SKILL.md](SKILL.md).

## Config Sources

| Host                 | Loads                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| GitHub Copilot CLI   | `.github/hooks/*.json`, `~/.copilot/hooks/`, `.claude/settings.json`                           |
| GitHub Copilot cloud | `.github/hooks/*.json` only (Linux; `bash` / `command`)                                        |
| Cursor IDE / CLI     | `.cursor/hooks.json`, `~/.cursor/hooks.json`, Claude settings (if third-party enabled)         |
| Cursor cloud         | `.cursor/hooks.json` (command hooks; subset of events)                                         |
| Claude Code          | `.claude/settings.json`, plus a local-only `.claude/settings.local.json` that is not committed |
| VS Code Copilot Chat | `.github/hooks/*.json` + `.claude/settings.json` (format bridging)                             |

## Event Name Mapping

| Copilot / Cursor     | Claude / VS Code PascalCase |
| -------------------- | --------------------------- |
| `preToolUse`         | `PreToolUse`                |
| `postToolUse`        | `PostToolUse`               |
| `sessionStart`       | `SessionStart`              |
| `sessionEnd`         | `SessionEnd`                |
| `preCompact`         | `PreCompact`                |
| `stop` / `agentStop` | `Stop`                      |
| `subagentStop`       | `SubagentStop`              |

Cursor-only extras: `beforeShellExecution`, `afterShellExecution`,
`beforeReadFile`, `afterFileEdit`, `beforeSubmitPrompt`, `afterAgentResponse`.

## Per-Hook Command Fields

| Field                     | Copilot                     | Cursor                                      | Claude                           |
| ------------------------- | --------------------------- | ------------------------------------------- | -------------------------------- |
| `type: "command"`         | yes                         | optional (default)                          | yes                              |
| `command` (single string) | yes (fallback)              | **required**                                | yes                              |
| `bash` / `powershell`     | yes                         | no                                          | no                               |
| `args` array              | **no**                      | **no**                                      | Claude-only; **do not use** here |
| `cwd`                     | yes                         | no (project root)                           | no                               |
| `timeoutSec` / `timeout`  | `timeoutSec`                | `timeout`                                   | `timeout`                        |
| `matcher`                 | optional regex on tool name | string / regex by event                     | Claude matcher syntax            |
| `failClosed`              | no                          | yes (only with explicit `allowTool()` JSON) | no                               |

## Tool Names (lowercased in scripts)

| Host         | Shell                | Edit / write                           | Create                       | Delete       |
| ------------ | -------------------- | -------------------------------------- | ---------------------------- | ------------ |
| Copilot CLI  | `bash`, `powershell` | `edit`                                 | `create`                     | `delete`     |
| Cursor       | `Shell`              | `Write`                                | `Write`                      | `Delete`     |
| Claude       | `Bash`               | `Edit` / `Write`                       | `Write`                      | —            |
| VS Code Chat | `runTerminalCommand` | `editFiles` / `replace_string_in_file` | `createFile` / `create_file` | `deleteFile` |

## Output Fields Emitted by `lib.ts`

### Allow (`allowTool`)

```json
{
  "permissionDecision": "allow",
  "permission": "allow",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow"
  }
}
```

Exit `0`.

### Deny (`denyTool`)

```json
{
  "permissionDecision": "deny",
  "permissionDecisionReason": "<reason>",
  "permission": "deny",
  "user_message": "<reason>",
  "agent_message": "<reason>",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "<reason>"
  }
}
```

Exit `2`.

### Context (`emitAdditionalContext`)

```json
{
  "additionalContext": "<message>",
  "additional_context": "<message>",
  "systemMessage": "<message>",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "<message>"
  }
}
```

Exit `0`.

## Docs

- Copilot hooks: https://docs.github.com/en/copilot/concepts/agents/hooks
- Copilot reference: https://docs.github.com/en/copilot/reference/hooks-reference
- Cursor hooks: https://cursor.com/docs/hooks
- Cursor third-party (Claude): https://cursor.com/docs/reference/third-party-hooks
- VS Code agent hooks: https://code.visualstudio.com/docs/copilot/customization/agent-hooks
