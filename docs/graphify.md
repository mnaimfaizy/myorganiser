# Graphify structural index (opt-in agent supplement)

Graphify builds an AST-based code knowledge graph of the monorepo and serves it to agents
over MCP. We adopted it for **one narrow, proven win**: fast, free, in-package answers to
_"what directly calls / imports / consumes this symbol?"_ plus a god-node orientation map.
It is a **supplement to `CodeExplorer`/grep and `nx affected`, not a replacement.**

See issue #158 for the full evaluation. Scope was deliberately
limited because of measured blind spots (below).

## What it's good for

- `get_neighbors <symbol>` — direct callers/importers/consumers within reach (instant). It lists
  **one edge per calling function, not per call site**, and an import edge cites the first line of the
  import statement, so grep is still what produces a complete list of call lines.
- `god_nodes` — most-connected nodes; good first orientation in an unfamiliar area.
- `query_graph "<question>"` — broad "what relates to X" context.
- The labeled `graphify-out/GRAPH_REPORT.md` — a navigable, domain-named community map for onboarding.

## What it must NOT be used for

- **Cross-package / cross-HTTP-boundary impact** ("what breaks if `VaultController` changes").
  The graph is AST-only and has no edge across the OpenAPI/codegen seam. **Use `nx affected
--files=<path>` instead** — it is authoritative for cross-project impact.
- **PR/slice review-priority ranking.** Graphify's `triage_prs` blast-radius counts a changed
  file's own community span, not its dependents, so it _inverts_ risk for hub/barrel files.
  Use `nx affected` for PR scoping.
- **TypeScript type-reference blast radius** (type usages aren't edges) or any symbol whose
  name appears in more than one file (it can't disambiguate).
- **Database schema questions** ("what reads this table?", "what does this migration affect?").
  `**/*.sql` is excluded by design — see "SQL is excluded on purpose" below. The current schema
  lives in `apps/backend/src/prisma/schema`; use that and `nx affected`.

Always confirm a graph result against the actual file before trusting it — the graph can be stale.

### From a linked worktree

`.mcp.json` starts the server on `graphify-out/graph.json`, a path relative to the session's working
directory. A linked worktree has no `graphify-out/` — the graph belongs to the primary checkout — so
every tool call answers `graph.json not found`. Pass `project_path` with the primary checkout's
absolute path on the call and it answers from that graph. `CodeExplorer` is told to retry this way;
remember that the graph then describes the primary checkout's branch, not the worktree's.

## Measured extraction limits

Numbers from issue #292, measured 2026-08-11 by parsing every `.ts`/`.tsx` file under `apps/` and
`libs/` with the same `tree-sitter-typescript` grammar graphify uses. Recorded here so the question
does not get re-litigated from stale guesses.

### SQL is excluded on purpose

The 10 Prisma migrations under `apps/backend/src/prisma/migrations/` are **not** in the graph, and
that is deliberate — `**/*.sql` is in `.graphifyignore`. Installing `graphifyy[sql]` would make them
parse, but it would not make them useful:

- graphify's SQL extractor resolves table names **within SQL only**. There is no extractor edge from
  a SQL table to TypeScript, and the backend reaches the database through Prisma models
  (`prisma.user.…`), never through SQL identifiers. Graphing migrations therefore cannot answer
  "what reads this table?" — it would only stop the graph from _looking_ blind there.
- Its `_ref_stub` mints sourceless bare-name nodes that `_rewire_unique_stub_nodes` collapses onto
  "the unique real definition" by name. Migration tables are quoted PascalCase (`"User"`,
  `"VaultItem"`) — the same names as Prisma model types in TS. That is a plausible route to **false**
  edges, which is worse than an honest absence.
- Migrations are append-only history, not current state. The authoritative schema is `schema.prisma`,
  which graphify has no extractor for at all.

### Parse errors: none left in authored code

A full scan of 535 files finds **2** that the grammar cannot parse, both generated and gitignored
(`apps/backend/src/prisma/prisma-client/*.d.ts`). They contribute **0 nodes** to the graph either
way, so nothing is lost.

Previously there were 6. The 4 authored ones were all Playwright specs that hit a genuine
`tree-sitter-typescript` bug — `Parameters<import('@playwright/test').Page['goto']>[1]`, an
import-type in type-argument position — in a `gotoStable` helper duplicated verbatim across 7 specs.
Extracting it to `apps/web-e2e/src/e2e/helpers/navigation.ts` removed the duplication and
cleared the parse errors as a side effect.

Two caveats worth keeping:

- **The grammar bug is real and unfixable from here.** `tree-sitter-typescript` 0.23.2 is the newest
  release on PyPI, so there is nothing to upgrade to and no upstream bump to request. Confirmed
  failing patterns: import-types in type-argument position; a bare `&` in JSX text; an inline
  import-type in a `.tsx` parameter. Plain `page: import('x').Page` in a `.ts` file and
  `typeof import('react')` both parse fine — which is why ~27 remaining inline-import annotations in
  the E2E specs are harmless and were deliberately left alone.
- If a future file reintroduces one of the failing patterns, graphify reports it as
  "partially extracted" — an unknown subset of that file's symbols goes missing while the file still
  _looks_ covered. Re-run the scan before trusting the graph in a newly-touched area.

## Graduated from probation — 2026-08-12

Probation is over. Graphify is a **permanent tool with a hard, narrow scope**: `get_neighbors` for
"who calls / imports / consumes X", and `god_nodes` for orientation. Everything under "What it must
NOT be used for" above is a standing ban, not a caution.

Two things settled it.

**The cost side collapsed.** The original kill argument rested as much on
maintenance — manual rebuilds, staleness — as on capability. #293 made the graph refresh on commit
and #292 confirmed extraction is complete for authored `.ts`/`.tsx`. What is left costs close to
nothing.

**The capability side is unchanged, and was re-measured rather than assumed.** The original bar
questions were re-run against the live graph on 2026-08-12 (2,853 nodes / 5,350 edges, 99%
EXTRACTED):

| Bar question                               | 2026-06-19         | 2026-08-12                                                    |
| ------------------------------------------ | ------------------ | ------------------------------------------------------------- |
| R3 — `get_neighbors saveEncryptedData`     | 🟢 degree 20       | 🟢 17 edges with `file:line`, ~1s, $0                         |
| `god_nodes` hub map                        | 🟢                 | 🟢 `cn`, `Button`, `useToast`, `requireUserId`, `UserService` |
| R1 — `get_node EncryptedBlob`              | 🔴 no unique match | 🔴 **silently returned `EncryptedBlobV1`**, degree 1          |
| R5 — `VaultController` → `serverVaultSync` | 🔴 no path         | 🔴 "No directed path found"                                   |

**The R3 row stopped reproducing, measured 2026-10-02.** `saveEncryptedData` became a method on the
owner-bound vault handle ([ADR 0047](adr/0047-vault-access-is-obtained-through-an-owner-bound-handle.md)),
and methods are not nodes. `get_neighbors saveEncryptedData` now returns the neighbours of
`mockSaveEncryptedData` — one edge, no warning — which is the R1 failure on the tool's own showcase
symbol. The good half still holds for a symbol that is a function: `get_neighbors saveVaultRecords`
returned 15 edges with `file:line` the same day, every one confirmed by grep.

The shape of the tool is therefore settled and will not improve: the good half is reliable, and the
bad half fails **silently**. R1 is the sharp case — asking for one symbol returns a _different_ one
with no ambiguity warning. That is why the ban list is written into the agent as a table of question
shapes rather than as general advice.

**What this replaces.** The earlier probation required CodeExplorer to log a `helped` / `redundant` /
`wrong-missed` verdict in a `Graphify Usage` block on every run. That instrumentation never actually
ran: it was added 2026-06-19 and deleted 2026-07-02 by `yarn agents:sync`, because it lived only in
`.claude/agents/explore.md` while the sync script regenerates every target body from canonical
`.github/agents/`. It is **not** being restored — it charged a per-run token cost on a Haiku agent to
keep re-deciding a question the table above answers.

The scoping rules now live in canonical `.github/agents/explore.agent.md`, so they survive the sync.
The harness-specific parts (tool names) use the `<!-- harness:... -->` mechanism documented in
`.agents/skills/sub-agent-sync-workflow/SKILL.md`.

## Harness registration

Registered in all four harnesses. The MCP server itself is harness-agnostic — plain stdio JSON-RPC —
so only the registration differs, and the formats are **not** interchangeable. Each was checked
against that harness's own docs rather than copied from `.mcp.json`.

| Harness           | MCP config                              | Top-level key | Agent tool grant                                         |
| ----------------- | --------------------------------------- | ------------- | -------------------------------------------------------- |
| Claude Code       | `.mcp.json`                             | `mcpServers`  | `mcp__graphify__*` in `.claude/agents/explore.md`        |
| Copilot / VS Code | `.vscode/mcp.json`                      | `servers`     | `graphify/*` in `.github/agents/explore.agent.md`        |
| Cursor            | `.cursor/mcp.json`                      | `mcpServers`  | none — Cursor subagents inherit the parent agent's tools |
| Gemini CLI        | `.gemini/settings.json` (project scope) | `mcpServers`  | `mcp_graphify_*` in `.gemini/agents/explore.md`          |

Two caveats:

- The Gemini entry uses `includeTools` to allowlist the same five read-only tools the other harnesses
  grant, so `triage_prs` and `get_pr_impact` — which invert risk for hub and barrel files — are not
  reachable there at all.
- Gemini CLI has an open bug where subagents do not always receive MCP tools
  (google-gemini/gemini-cli#17005, #19599). CodeExplorer is told to fall back to Glob/Grep and note
  it under Scope, so this degrades rather than breaks.

All four share the same local prerequisite: `uv tool install "graphifyy[mcp]==0.9.43"` plus one
manual graph build (below). Without it a harness simply has no graphify tools, which is the
documented fallback path, not a failure.

## Build / refresh

The graph is **not committed** (it's generated and goes stale). Build it once locally; the
`graphify` MCP server in `.mcp.json` then serves `graphify-out/graph.json`.

Prerequisite: `uv tool install "graphifyy[mcp]==0.9.43"` (provides `graphify` + `graphify-mcp`).
The version is the one pinned in `.sandcastle/Dockerfile`; see "Sandboxed agents" below for why the
two move together. The `mcp` extra is **required** — without it `graphify-mcp` crashes with
`ModuleNotFoundError: No module named 'mcp'` and the MCP server in `.mcp.json` won't start, while the
`graphify` CLI and the refresh hooks keep working, so the graph goes on refreshing and nothing looks
broken. That happened here from 2026-08-15 to 2026-10-02.
Installing it via the `[mcp]` extra records `extras = ["mcp"]` in the uv receipt, so a later
`uv tool upgrade graphifyy` keeps it. Installing plain `graphifyy` drops the extra and silently
re-breaks the MCP server — the symptom in Claude Code is
`graphify: … ✘ Failed to connect — MCP error -32000: Connection closed`.

### Resync the skill after any version change

The `/graphify` skill under `~/.claude/skills/graphify/` is written by the CLI and is
**pinned to the version that wrote it**. Upgrading the package does not update it, so the two
drift apart and the CLI starts every command with:

```
warning: skill is from graphify 0.9.16, package is 0.9.37. Run 'graphify install' to update.
```

After **any** install, upgrade, or reinstall of `graphifyy`, resync it:

```pwsh
graphify install --platform claude   # rewrites ~/.claude/skills/graphify/{SKILL.md,references/}
```

This is a per-developer machine setup step, not a repo change — nothing here is committed.
Verify the whole chain with `graphify --version` (should match the warning-free CLI output)
and `claude mcp list` (should report `graphify: … ✔ Connected`).

### Build the graph

```pwsh
# Full rebuild (per-package extract + merge + cluster + label), zero external egress.
# Uses --backend claude-cli, which routes doc/image semantic extraction through the local
# Claude CLI (billed to your plan, no API key). Config files are excluded via .graphifyignore.
$env:GRAPHIFY_OUT="graphify-out"
graphify extract apps --backend claude-cli
graphify extract libs --backend claude-cli
graphify merge-graphs apps/graphify-out/graph.json libs/graphify-out/graph.json --out graphify-out/graph.json
graphify cluster-only . --no-viz
graphify label . --backend claude-cli      # domain names for communities + GRAPH_REPORT.md
```

Incremental refresh after code changes (much faster — reuses the content-hash cache):

```pwsh
graphify extract apps --backend claude-cli   # re-extracts only changed files
graphify extract libs --backend claude-cli
graphify merge-graphs apps/graphify-out/graph.json libs/graphify-out/graph.json --out graphify-out/graph.json
```

## Automatic refresh on commit and on merge

Two hooks run the incremental refresh above in the background whenever
`.ts/.tsx/.js/.jsx/.mjs/.cjs` under `apps/` or `libs/` changes. The triggering git command returns
immediately; progress goes to `~/.cache/graphify-rebuild.log`.

| Hook                 | Fires on                       | "Changed" means                                 |
| -------------------- | ------------------------------ | ----------------------------------------------- |
| `.husky/post-commit` | `git commit`                   | the files in `HEAD`                             |
| `.husky/post-merge`  | `git merge`, and so `git pull` | `git diff ORIG_HEAD HEAD` (fallback `HEAD@{1}`) |

`post-merge` exists because `post-commit` genuinely does not cover pulls: `git merge` never fires
`post-commit` — not for a fast-forward, where no commit is created at all, and not for a merge
commit, which `git merge` writes directly. Without it, pulling other people's merged work left the
graph a step behind until your own next local commit happened to touch `apps/` or `libs/`.

Everything except the definition of "changed" lives in `.husky/graphify-refresh.sh`, which both
hooks source, so the guards below cannot drift apart between them.

It is a **no-op unless you have opted in** by installing graphify and building the graph once by
hand, so it costs nothing for contributors who do not use it. Specifically, it exits early when:

| Condition                                        | Why                                                                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `graphify` is not on `PATH` or in `~/.local/bin` | Most contributors never install it                                                                                                |
| `graphify-out/` does not exist                   | The first build needs an LLM pass — keep it manual                                                                                |
| No `apps/`/`libs/` source changed                | Doc and image changes must never trigger an LLM call from a hook                                                                  |
| You are in a linked worktree                     | `graphify-out/` belongs to the primary checkout; rebuilding from a worktree writes a rogue delta-only graph and races the primary |
| A rebase, merge, or cherry-pick is in progress   | A rebuild mid-sequence leaves unstaged output and blocks `--continue`                                                             |
| `GRAPHIFY_SKIP_HOOK=1` is set                    | Explicit opt-out                                                                                                                  |

Two environment settings in the shared script are load-bearing, so do not drop them when editing it:

- `PYTHONHASHSEED=0` — networkx's louvain clustering iterates string-keyed sets whose order is
  randomised per process. Unpinned, repeated no-op refreshes were observed drifting
  (2,965 → 2,967 → 2,968 nodes); pinned, consecutive no-op refreshes hold steady at the same node
  and edge count. Without it you cannot tell a real change from clustering noise.
- `--backend claude-cli` — pinned on purpose. Without it graphify selects "whichever API key is
  set", and with `ANTHROPIC_BASE_URL` exported that would send source to an external endpoint.
  `claude-cli` keeps the rebuild local.

> **Maintenance reality:** the hooks only cover **code**. Docs, images, community clustering, and the
> domain names in `GRAPH_REPORT.md` still need the manual `cluster-only` + `label` pass above.
> Rebuild by hand before relying on the report for a fresh area of the code.
>
> Branch switching is still uncovered: `git checkout` fires neither hook, so the graph reflects
> whichever branch last triggered a rebuild. Confirm any graph result against the file, which the
> agent rules already require.

## Sandboxed agents (Sandcastle)

A sandboxed `CodeExplorer` runs inside a Docker container built from `.sandcastle/Dockerfile`,
which has no `graphify-out/` of its own and, until #413, no `graphify`/`graphify-mcp` binaries
either — every sub-agent transcript in the first `--trace-subagents` run (#398) showed
`MCP servers: none invoked`. Three pieces close that gap without changing `.mcp.json`:

- **The graph is bind-mounted read-only from the host, conditionally.** `.sandcastle/main.mts`
  mounts `graphify-out` (host) onto `graphify-out` (sandbox worktree root) only when
  `graphify-out/graph.json` exists on the host at dispatch time — sandcastle's mount validation
  fails sandbox creation for a missing `hostPath`, so an unconditional mount would turn this
  documented opt-in supplement into a hard requirement for anyone who has never built a graph.
  `MountConfig`'s relative-path resolution (`hostPath` from `process.cwd()`, `sandboxPath` from
  the worktree root) lands the mount exactly where `.mcp.json`'s `args: ["graphify-out/graph.json"]`
  already expects it — no MCP config change needed.
- **Only ever the primary checkout's snapshot.** `.husky/graphify-refresh.sh` exits early for any
  linked worktree on purpose, so a Sandcastle worktree (itself a linked worktree) never races the
  primary checkout with its own rebuild. What gets mounted into every slice's container is always
  whatever the primary checkout last refreshed to — never the slice's own in-progress state. That
  is tolerable because every sanctioned graphify question (`get_neighbors`, `god_nodes`) is about
  code that already exists, and `CodeExplorer` runs before the slice writes anything.
- **Provenance is injected into the slice prompt, not left in this doc.** Graphify records no
  commit sha of its own, so `.sandcastle/main.mts`'s `graphifyProvenance()` approximates "built at"
  from `graph.json`'s mtime against the dispatch base ref's history (not HEAD — the primary
  checkout may be sitting on an unrelated branch), then reports how many commits the slice branch
  has moved past that point — e.g. _"Built at approx. `<sha>`, N commit(s)
  behind `<branch>` — files changed since are not in it."_ A rule in this document is not something
  a sub-agent reliably reads (see #396); the prompt is the one channel it demonstrably does.

The container's `graphify`/`graphify-mcp` binaries are installed via `uv tool install
"graphifyy[mcp]==0.9.43"` in the Dockerfile, pinned to the exact version that built the graph
currently on the primary checkout's host — not PyPI latest. Nothing guarantees graphify's on-disk
graph format is stable across its (pre-1.0, 148-release) version history, so bumping this pin and
rebuilding the host graph is one coordinated change, not two independent ones. The `[mcp]` extra is
mandatory for the same reason it is on a developer machine (above): without it `graphify-mcp`
crashes with `ModuleNotFoundError: No module named 'mcp'`. The `/graphify` skill resync (above) is
explicitly a per-developer step and is **not** needed in the image — the sandbox uses only the MCP
server, never the skill.

**The sandbox image must be rebuilt after any Dockerfile change here.** `ensureSandboxImage()` in
`.sandcastle/main.mts` only builds `sandcastle:myorganiser` when the image is missing or, on a
Claude dispatch, when its Claude Code differs from the `SANDCASTLE_CLAUDE_CODE_*` policy. Any
other change leaves an existing image silently on whatever it had before — delete it first
(`docker image rm sandcastle:myorganiser`) to force a rebuild on the next dispatch.

Whether the mount is worth its staleness cost is measured, not assumed: `.sandcastle/main.mts`
already prints `MCP servers: graphify` or `none invoked` per sub-agent (derived from `mcp__<server>__<tool>`
call names), giving a per-run comparison against the 1.7m-cache-read Read/Glob/Grep baseline from
#398.
