# GitHub labels as the coordination contract between planning tools and autonomous agents

We need a machine-readable signal that connects three systems: planning tools (`to-prd`, `to-issues`), GitHub Issues, and the sandcastle orchestrator (`dispatch-agents`). We chose GitHub labels as that contract rather than GitHub Projects, Milestones, or issue metadata fields.

The full label vocabulary:

| Label                | Meaning                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `ready-for-agent`    | Orchestrator may pick this issue up                                                                    |
| `complexity:low`     | Route to Sonnet, as medium — never the smallest model (ADR 0111)                                       |
| `complexity:medium`  | Route to Sonnet                                                                                        |
| `complexity:high`    | Route to Opus                                                                                          |
| `gate:mechanical`    | Mechanical path — no specialist chains (ADR 0012)                                                      |
| `gate:standard`      | Single-hop specialist path (ADR 0012)                                                                  |
| `gate:full`          | Full mandatory pipelines (ADR 0012)                                                                    |
| `type:afk`           | Agent can implement and merge without human interaction                                                |
| `type:hitl`          | Human decision required before agent can proceed — orchestrator skips                                  |
| `status:in-progress` | Agent has picked up the issue                                                                          |
| `status:blocked`     | Waiting on `## Blocked by` deps — orchestrator skips until unblocked                                   |
| `status:done`        | Agent finished; slice integrated into the local feature branch                                         |
| `ready-for-human`    | A person acts next — triaged so, a slice held open (ADR 0111), or a finished standalone run (ADR 0138) |

`to-issues` applies `ready-for-agent` + `type:*` + `complexity:*` + one `gate:*` at creation time, plus `status:blocked` when `## Blocked by` is non-empty. The orchestrator filters on `ready-for-agent` + `type:afk` (and excludes `status:blocked`), reads `complexity:*` for model size, and reads `gate:*` for pipeline depth (default `gate:standard` when missing). On successful completion, Sandcastle and `/implement` remove `status:blocked` from dependents whose blockers are all done. See `docs/adr/0012-tiered-quality-gates.md`.

## Considered Options

- **GitHub Projects** — supports custom fields and status columns, but requires Projects API; labels are simpler and visible on the issue list without navigating to a board.
- **GitHub Milestones** — groups issues but carries no machine-readable type or complexity signal.
- **Issue metadata / custom properties** — more structured, but not readable in the issue body and requires GitHub Enterprise for full support.

## Consequences

The label names are a shared contract. Renaming a label requires updating the orchestrator source (`dispatch-agents` filter logic) and re-labelling all open issues simultaneously. Do not rename labels without a migration script. The machine-readable copy is `tools/config/github-labels.json`.

These labels apply to Issues only. Pull Requests use Surface Labels ([ADR 0025](0025-pr-surface-labels.md)).
