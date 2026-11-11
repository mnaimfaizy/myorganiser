# Harnesses: the four verbs

The `orchestrate` Skill speaks in four verbs only. This file says how each verb works on each Harness. The Skill body is the same everywhere.

| Verb      | Meaning                                                                             |
| --------- | ----------------------------------------------------------------------------------- |
| `spawn`   | Start an Executor for a Delegation, with its brief, in its own worktree             |
| `message` | Send a follow-up to an Executor that is running or has stopped                      |
| `await`   | Learn that an Executor stopped, without polling in a loop                           |
| `report`  | Read what the Executor left: `report.md`, `log.md`, its branch and its Pull Request |

The facts below were read from each Harness's documentation on 2026-11-11. An item marked **check before use** was not confirmed there. The first time a Chief of Staff relies on one, it runs `--help` or a dry run and records the result in its Activity Log. Update this file when a check settles it.

## Tiers

| Tier                  | Harnesses                                  | How the Chief of Staff works                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1: Live Sessions**  | Claude Code (desktop and CLI), OpenCode    | It can start, message and hear back from separate sessions natively.                                                                                                                                                             |
| **2: Start and poll** | Cursor, OpenAI Codex, GitHub Copilot       | It starts headless runs or cloud agents. It cannot message a run that is still working, so it resumes the session by id with the answer. It learns that a run ended from the process exiting, a status call, or the report file. |
| **3: Sequential**     | Gemini CLI, or any Harness without `spawn` | It uses `dispatch-agents` for AFK work and Sub-agents for the rest, one at a time in its own session, and says so in the Dispatch Plan.                                                                                          |

On every tier, a headless run cannot ask anything mid-run: a project `ask` rule refuses in a headless run ([ADR 0099](../../../docs/adr/0099-a-project-ask-rule-is-a-refusal-in-a-headless-run.md)). Its brief tells it to stop at a Decision Request, writing it to `report.md`. The Chief of Staff relays the question and resumes the run with the answer.

Every cloud Executor works from a clone of the remote, so it sees only pushed branches. Confirmed for Claude, Cursor and Copilot; **check before use** for Codex cloud. A PRD slice therefore needs the human's consent to push `feat/<prd-slug>` before a cloud Executor can take it ([ADR 0146](../../../docs/adr/0146-a-prd-integration-branch-may-be-pushed-for-one-run-with-the-maintainers-consent.md)). A cloud Executor cannot reach `tmp/`, so it reports on its branch or Pull Request instead.

## Finding the Skill

Every Harness except Claude Code reads `.agents/skills/` directly. Claude Code reaches it through the committed `.claude/skills` symlink. Gemini CLI also gets the thin command adapter every human-invoked Skill has, `.gemini/commands/orchestrate.toml`.

| Harness     | Invoke         | Notes                                                                               |
| ----------- | -------------- | ----------------------------------------------------------------------------------- |
| Claude Code | `/orchestrate` | Honours `disable-model-invocation` and `argument-hint`.                             |
| Cursor      | `/orchestrate` | `disable-model-invocation` makes it slash-only.                                     |
| Codex       | `$orchestrate` | A slash form does not work. Invoke it explicitly; it has no `agents/openai.yaml`.   |
| Copilot     | `/orchestrate` | VS Code agent mode; **check before use** for Copilot CLI.                           |
| OpenCode    | `@orchestrate` | No slash form for Skills. A thin `.opencode/commands/orchestrate.md` could add one. |
| Gemini CLI  | `/orchestrate` | Through `.gemini/commands/orchestrate.toml`.                                        |

## Claude Code

- `spawn`:
  - in the desktop app, the session tool that starts a separate session (it gets its own worktree);
  - in the CLI, `claude --bg "<brief>"` (worktree under `.claude/worktrees/`), or `claude -p "<brief>" --output-format json` from the Delegation's worktree, which returns its `session_id`;
  - a cloud session: `claude --cloud "<brief>"`, from pushed branches only.
- `message`:
  - `SendMessage` to the session's id or name, delivered over the local session socket;
  - `claude -p "<msg>" --resume <id>` for a stopped headless run;
  - `claude -p "<msg>" --cloud <id>` for a cloud session.
- `await`:
  - the desktop app continues the Chief of Staff when a started session ends its turn. Observed in the PRD #1507 run: that continuation sometimes arrives only with the human's next message, not as an event of its own, so to the human the Chief of Staff looks stuck. Tell the human once, in the Dispatch Plan, that a short "status?" wakes it. On waking, check every Delegation's report and branch before saying it is waiting;
  - otherwise `SendMessage` with `notify_when_idle` (one notice, local sessions only), `claude agents --json` (its `state`), or a headless run's exit code (0 is success).
- `report`: the Delegation's `report.md` and `log.md`, then its branch and Pull Request. `claude logs <id>` shows a background session's output.
- A message from another session cannot approve a permission prompt or change configuration. Never ask a Delegation to do what this session was refused.

## OpenCode

- `spawn`: run `opencode serve`, bound to localhost with `OPENCODE_SERVER_PASSWORD` set, then `POST /session`. `opencode run "<brief>"` also works; its `--session`, `--dir` and `--format` flags are **check before use**.
- `message`: `POST /session/:id/prompt_async`.
- `await`: `GET /session/status`, or the `GET /event` stream.
- `report`: `GET /session/:id/message`, then the report files.

## Cursor

- `spawn`:
  - locally, `agent -p "<brief>" --workspace <worktree>` (the binary may be named `cursor-agent`), or `-w <name>` for a Cursor-managed worktree;
  - in the cloud, the Cloud Agents API `POST /v1/agents`, from pushed refs only.
- `message`:
  - locally, `agent --resume <chatId>` (combining it with `-p` is **check before use**);
  - in the cloud, `POST /v1/agents/{id}/runs`, with `delivery: "steer"` for an active run.
- `await`: locally, the process exiting (exit codes are **check before use**); in the cloud, `GET /v1/agents/{id}` or its event stream.
- `report`: the report files, or in the cloud the run's pushed branch and Pull Request.

## OpenAI Codex

- `spawn`:
  - `codex exec -C <worktree> --sandbox workspace-write --json "<brief>"`;
  - `codex cloud exec`, whose clone semantics are **check before use**.
- `message`: `codex exec resume <id> "<msg>"`. `--worktree` cannot be combined with `resume`, so resume from inside the worktree.
- `await`:
  - the process exiting, with `turn.completed` or `turn.failed` in the `--json` stream (exit codes are **check before use**);
  - `codex cloud list --json` for cloud tasks.
- `report`: `-o <file>` writes the final message; then the report files.

## GitHub Copilot

- `spawn`:
  - `copilot -p "<brief>"` from the Delegation's worktree;
  - the cloud agent: assign an issue, use the CLI's delegate command, or the REST API. It opens one Pull Request per task, from pushed refs only.
- `message`:
  - the cloud agent can be steered from its session;
  - resuming a local CLI session by id is **check before use**.
- `await`: the cloud agent's Pull Request and session state through `gh`; no completion command was found.
- `report`: the Pull Request, and the report files for local runs.

## Gemini CLI

- `spawn`: `gemini -p "<brief>"` from the Delegation's worktree, through the shell. A worktree flag needs `experimental.worktrees`.
- `message`: `gemini -r <id> "<msg>"` resumes a stopped session. A running one cannot be messaged.
- `await`: the process exiting: 0 success, 1 error, 42 bad input, 53 turn limit.
- `report`: the report files.
- Gemini CLI reads `AGENTS.md` only when `context.fileName` lists it, as this repository's `.gemini/settings.json` does.

## Sources

- Claude Code: [Skills](https://code.claude.com/docs/en/skills), [Headless](https://code.claude.com/docs/en/headless), [Agent view](https://code.claude.com/docs/en/agent-view), [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging), [Cloud sessions](https://code.claude.com/docs/en/claude-code-on-the-web), [Desktop](https://code.claude.com/docs/en/desktop)
- OpenCode: [Skills](https://opencode.ai/docs/skills/), [Commands](https://opencode.ai/docs/commands/), [Server](https://opencode.ai/docs/server/), [CLI](https://opencode.ai/docs/cli/)
- Cursor: [Skills](https://cursor.com/docs/context/skills), [CLI parameters](https://cursor.com/docs/cli/reference/parameters), [Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints)
- Codex: [Build skills](https://learn.chatgpt.com/docs/build-skills), [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [Developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli), [Cloud](https://learn.chatgpt.com/docs/cloud)
- Copilot: [About agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills), [Run Copilot CLI programmatically](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically), [Start cloud agent sessions](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/start-copilot-sessions)
- Gemini CLI: [Skills](https://geminicli.com/docs/cli/skills/), [Headless](https://geminicli.com/docs/cli/headless/), [CLI reference](https://geminicli.com/docs/cli/cli-reference/)
