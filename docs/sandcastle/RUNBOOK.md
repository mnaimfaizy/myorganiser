# Sandcastle dispatch — Runbook

The orchestrator (`yarn dispatch-agents` / `yarn dispatch-waves`) runs one Docker-isolated
agent per slice, one slice at a time. Each agent's dependencies are installed **inside the Linux container**
(`hooks.sandbox.onSandboxReady` → `corepack yarn install --immutable`), so native modules
(`bcrypt`, `prisma`, `@swc/core`) are always built for the container — correct on **macOS,
native Linux, and WSL2** alike. Yarn's content-addressable global cache is bind-mounted from
`.sandcastle/.yarn-cache` so installs are incremental across slices. See `docs/adr/0009`.

## The one hard requirement

**The repo (and therefore the slice worktrees under `.sandcastle/worktrees/`) must live on a
native filesystem** — ext4 on Linux/WSL2, APFS on macOS. The in-container install writes
`node_modules` to the bind-mounted worktree; on a native fs that's ~2 min, on a Windows-mounted
path (`/mnt/d`, drvfs/9P) it's ~29 min. This is the difference between a usable and an unusable
pipeline.

| Host             | Where to put the repo                            | How to run dispatch                  |
| ---------------- | ------------------------------------------------ | ------------------------------------ |
| **macOS**        | anywhere on local disk (APFS)                    | run `yarn dispatch-*` normally       |
| **native Linux** | anywhere on local disk (ext4/btrfs)              | run `yarn dispatch-*` normally       |
| **Windows**      | **inside a WSL2 distro** (`~/...`, NOT `/mnt/d`) | run from the WSL2 distro (see below) |

## Common setup (all platforms)

1. **Toolchain:** Node 22 + corepack (`corepack enable` → provides `yarn` pinned to 4.13.0).
2. **Docker:** a running Docker engine the dispatch shell can reach (`docker info` works).
3. **Auth:** `gh auth status` green and `git config user.name/.email` set, for the dispatch host.
4. **Secrets:** Prefer a 1Password Environment. The Environment CLI integration is
   currently beta and is not included in the stable Homebrew cask. Install the beta
   cask (it conflicts with the stable cask):
   ```bash
   brew uninstall --cask 1password-cli
   brew install --cask 1password-cli@beta
   op --version                         # should include -beta
   op environment --help
   ```
   Enable 1Password's desktop-app integration and copy the Environment ID from
   **Developer > View Environments**. Then run dispatch with `OP_ENVIRONMENT_ID`:
   ```bash
   export OP_ENVIRONMENT_ID=<your-1password-environment-id>
   corepack yarn dispatch-agents:1password --prd <issue-number>
   # or:
   corepack yarn dispatch-waves:1password --prd <issue-number>
   ```
   The CLI authenticates through the unlocked 1Password desktop app and injects the
   Environment variables only into the dispatch process. Do not put API keys in
   `.sandcastle/.env`. The legacy dotenv workflow remains available for local-only
   setups, but `.sandcastle/.env` is ignored and must never be committed.
5. The `sandcastle:myorganiser` image builds automatically on first run if missing. It
   already bakes in Claude Code, Cursor, and GitHub Copilot CLI so the `--agent` flag only
   switches which provider Sandcastle launches. Which Claude Code it carries is set in the
   environment, next to the other `SANDCASTLE_*` variables (see `.sandcastle/.env.example`),
   so changing it needs no commit:
   - `SANDCASTLE_CLAUDE_CODE_UPDATE=auto` (the default) follows the latest release. Each
     dispatch asks the installer's release channel for the current version.
   - `SANDCASTLE_CLAUDE_CODE_UPDATE=manual` with `SANDCASTLE_CLAUDE_CODE_VERSION=<x.y.z>`
     stays on that version. A version set on its own also means manual.

   Each Claude dispatch rebuilds the image when its `claude --version` differs from what the
   policy asks for, then prints the version. A Cursor or Copilot dispatch skips the check,
   since Claude Code never runs in it. Every Claude slice log names the version too, as
   `[#<issue>] Claude Code <version> (auto: latest release, sandcastle:myorganiser)`. The
   CLI's own auto-updater is off inside the image, so updates happen only at dispatch and the
   logged version is the one the agent ran. Offline, auto mode keeps the existing image.

The dispatch host does **not** need native build tools — compilation happens in-container.

## Windows-specific setup (WSL2)

Windows-native dispatch (from PowerShell, repo on `D:\`) works but is ~29 min/install — use WSL2.

1. **Docker Desktop → Settings → Resources → WSL Integration → enable your distro (e.g. `Ubuntu`)
   → Apply & Restart.** Verify in the distro: `docker info` prints a server version.
2. Install Node 22 in the distro (userland, no sudo):
   ```bash
   curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   exec bash && nvm install 22 && nvm alias default 22 && corepack enable
   ```
3. (Recommended) stop the Windows PATH leak so the Linux `node`/`yarn` win:
   ```bash
   sudo tee /etc/wsl.conf >/dev/null <<'EOF'
   [interop]
   appendWindowsPath=false
   EOF
   ```
   then from PowerShell: `wsl --shutdown`, reopen the distro.
4. `gh auth login` (or `export GH_TOKEN=...`) inside the distro.
5. **Clone onto ext4** and run from there:
   ```bash
   git clone git@github.com:mnaimfaizy/myorganiser.git ~/projects/myorganiser
   cd ~/projects/myorganiser
   ```
   Keep your `D:\` checkout for IDE editing; the WSL2 clone is only for dispatch. The feature
   branch is built **locally** in this clone (never pushed during dispatch), so `git fetch origin`
   keeps `main` current and, when a PRD is done, you open its PR from here with `ai:create-pr`,
   which pushes the feature branch.

## Running a dispatch

```bash
corepack yarn dispatch-agents --prd <issue-number>   # all ready AFK slices, one by one
corepack yarn dispatch-waves  --prd <issue-number>   # dependency-ordered across waves
corepack yarn dispatch-agents --prd <issue-number> --agent cursor
corepack yarn dispatch-agents --prd <issue-number> --agent copilot --model claude-sonnet-5
```

### Where the build gate runs

| Mode                           | Gate                                                                |
| ------------------------------ | ------------------------------------------------------------------- |
| **PRD** (`--prd`)              | **Once, at the end**, on `origin/main...feat/<slug>`. Never blocks. |
| **Standalone** (`--issue`)     | Per slice, fail-closed, as before — the branch is the deliverable.  |
| **Sweep** (`--all-standalone`) | Per issue, fail-closed.                                             |

Under `--prd`, slices integrate **unconditionally** and the assembled feature branch is gated once.
A red gate no longer strands the run: every slice stays integrated, every slice branch stays
intact, nothing is pushed, and the verdict is posted as a comment on the PRD issue so it reaches
you while you are away from the terminal. `dispatch-waves` no longer aborts on an incomplete wave
either — it records it and carries on. See
[ADR 0045](../adr/0045-a-prd-is-gated-once-on-the-assembled-feature-branch.md).

Gating the whole branch is also a _stronger_ check than the old per-slice gate: two slices that
break each other pass individually and only fail together, which is exactly what CI sees on the PR.

Re-gate a feature branch at any time, without dispatching anything and without an agent credential:

```bash
npx tsx .sandcastle/main.mts --prd <n> --gate-only
```

When a gate is red, the slice commits are in order on the branch:

```bash
git log --oneline origin/main..feat/<slug>
```

### Three dispatch modes

| Mode           | Invocation                                 | Base for the work branch         | Where finished work lands                     |
| -------------- | ------------------------------------------ | -------------------------------- | --------------------------------------------- |
| **PRD**        | `--prd <n>` (optionally `--issue <slice>`) | the local `feat/<slug>` head     | fast-forwarded into `feat/<slug>`             |
| **Standalone** | `--issue <n>` with **no** `--prd`          | `origin/main`, or `--base <ref>` | stays on `<type>/<n>-<slug>` — nothing moves  |
| **Sweep**      | `--all-standalone [--limit <n>]`           | `origin/main`, or `--base <ref>` | one `<type>/<n>-<slug>` per issue, all remain |

Work branches are named `<type>/<issue>-<slug>` with the type derived from the issue's labels
(`bug` → `fix/`, `enhancement` → `feat/`, and so on — see **Branch naming** in `AGENTS.md`). PRD
slices keep `slice/<n>-<slug>`, which signals that the branch fast-forwards into a feature branch
and closes its issue on success.

**Preview any run before it spends anything:**

```bash
corepack yarn dispatch-agents --prd 42 --dry-run
corepack yarn dispatch-agents --all-standalone --dry-run
```

`--dry-run` resolves the whole plan — selected issues, branch names, routed model per issue, base
ref, integration target — then exits. It creates no worktree or container, writes nothing to
GitHub, does not create the PRD feature branch, and does not build the sandbox image. It also does **not**
require a Claude credential: it prints `auth: NONE FOUND` in the run header instead of exiting, so
you can preview a plan on a machine where the 1Password injection is not set up. A real run still
refuses to start without one.

**One slice of a PRD:** add `--issue` to a PRD run. It still creates/reuses `feat/<slug>`,
gates, and fast-forwards — just for that one slice.

```bash
corepack yarn dispatch-agents --prd 42 --issue 45
```

**A one-off issue with no PRD** — a bug fix, a chore, anything created straight from the
`github-issue-creation-workflow` skill. Same Docker isolation, same in-container install, same
gate; only the integration step differs:

```bash
corepack yarn dispatch-agents --issue 57              # off origin/main
corepack yarn dispatch-agents --issue 57 --base feat/some-branch
```

Standalone specifics:

- **No label gate.** Naming `--issue` explicitly _is_ the authorization — `ready-for-agent` and
  `type:afk` are not required. `type:hitl`, `status:blocked`, and `status:in-progress` print a
  warning and the run proceeds, so a mistyped issue number is still visible.
- **No `## Blocked by` ordering** and no dependent unblocking — that vocabulary belongs to a PRD.
- **The branch is the deliverable.** `<type>/<n>-<slug>` is left exactly as the agent committed it.
  Nothing is fast-forwarded anywhere and nothing is pushed, per `docs/adr/0010`.
- **The issue stays open** and is **not** labelled `status:done`. The orchestrator only removes
  `status:in-progress` and comments with the branch name and gate verdict — marking it done would
  claim work that exists solely on an unpushed local branch. Close it when the PR merges.
- Branch namespaces are separate (`<type>/` vs `slice/`), so a standalone run and a later PRD run
  of the same issue can never collide on a branch, worktree, or gate path.
- Re-running an issue whose labels changed since last time also cleans up the branch and worktree
  from the previous run, even though it was filed under a different type prefix.

### Sweep mode

Dispatches every open issue that is agent-ready and **not** part of a PRD — the ad-hoc backlog:

```bash
corepack yarn dispatch-agents --all-standalone --dry-run   # always look first
corepack yarn dispatch-agents --all-standalone --limit 3
```

An issue is eligible when it is open, labelled `ready-for-agent` **and** `type:afk`, carries none
of `type:hitl` / `status:blocked` / `status:in-progress`, and has no `PRD: #<n>` reference. PRD
slices are excluded on purpose: `--prd` orders them by `## Blocked by` and integrates them, and
sweeping them one-off would strand each on a branch with no integration target.

Each selected issue is then handled exactly like a standalone run — own branch, own worktree, own
gate, nothing pushed, nothing closed. `--all-standalone` cannot be combined with `--prd` or
`--issue`.

Two guard rails, because this is the only mode where no human named the work:

- **The label gate is enforced, not warned about.** Standalone treats naming `--issue` as the
  authorization; a sweep has no such signal, so the labels are the only gate there is.
- **The selection is confirmed before the first container starts.** The full set is printed with
  each issue's routed model, and the run waits for `y`. `--yes` skips the prompt; on a
  non-interactive stdin the run fails rather than proceeding unattended.

⚠️ On `SANDCASTLE_CLAUDE_AUTH=subscription`, a sweep draws on the same 5-hour window as your
interactive Claude Code sessions, and any `complexity:high` issue routes to `claude-opus-5`. Check
the `--dry-run` output before committing to a large batch.

Provider switching is optional: the default agent can live in `.sandcastle/.env` as
`SANDCASTLE_AGENT=claude|cursor|copilot`. Per-provider model defaults can also live there
(`SANDCASTLE_CLAUDE_MODEL`, `SANDCASTLE_CURSOR_MODEL`, `SANDCASTLE_COPILOT_MODEL`), and
`--model` always overrides them for a single run. Claude keeps the existing complexity-based
model routing when no override is set.

After a dispatch, summarize loop and token usage:

```bash
corepack yarn agents:usage:report
corepack yarn agents:usage:report -- --prd <issue-number>
```

Model defaults are governed by `tools/config/agent-model-policy.json`; check current provider
catalogs with `corepack yarn agents:models:audit`.

With 1Password Environments, put the same variable names in the Environment instead. For
example, use `SANDCASTLE_AGENT`, `SANDCASTLE_CLAUDE_MODEL`, and the provider credential
(`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`, `CURSOR_API_KEY`, or `COPILOT_GITHUB_TOKEN`) as
Environment variables. 1Password Environments are currently beta functionality, and 1Password
notes that `op run --environment` may take longer to start on Apple silicon Macs.

## Claude auth: subscription vs API key

The Claude Code agent in the sandbox authenticates one of two ways. The orchestrator forwards
**exactly one** credential into the container and prints which in the run header.

| Mode           | Variable                  | Billing                                                     |
| -------------- | ------------------------- | ----------------------------------------------------------- |
| `subscription` | `CLAUDE_CODE_OAUTH_TOKEN` | Your Pro/Max plan — **the same quota as your own sessions** |
| `api`          | `ANTHROPIC_API_KEY`       | Metered per token, isolated from the plan quota             |

To use your plan instead of the API, mint a long-lived token on the **host** (not in the
container) and store it in your 1Password Environment as `CLAUDE_CODE_OAUTH_TOKEN`:

```bash
claude setup-token
```

Resolution rules:

- The OAuth token wins when both are present, and `ANTHROPIC_API_KEY` is then **not forwarded at
  all**. Which credential Claude Code prefers when it sees both is version-dependent, so leaving a
  stale API key alongside a valid token could otherwise bill the API while you believe you are on
  the plan.
- `SANDCASTLE_CLAUDE_AUTH=subscription|api` forces one mode and fails immediately if the matching
  credential is missing.
- With `--agent claude` and neither variable set, dispatch fails **before** building the sandbox
  image or any worktrees.

**Quota warning.** Subscription auth shares the 5-hour window with your interactive Claude Code
sessions, and `complexity:high` slices route to `claude-opus-5`
(`tools/config/agent-model-policy.json`). A long AFK batch can throttle you at the keyboard — send
big batches to `SANDCASTLE_CLAUDE_AUTH=api` and keep the plan for short runs.

Host credential files (`~/.claude/.credentials.json`) are deliberately **not** bind-mounted: the
container would write token refreshes back into your host credential store, and the file does not
exist at all on macOS (Keychain). `claude setup-token` is the supported headless path.

**Integration is local-only** (see `docs/adr/0010`). The feature branch `feat/<slug>` is created
from `origin/main` **locally and is never pushed**. Slices run **one by one**: each branches off
the _current_ local feature head (so it sees every earlier slice's work) → the agent container
installs the slice's exact deps in-container (sharing the cache) → the agent implements and commits
locally → the host runs the **gate** (a Docker container that installs the slice's tree and runs
`nx lint` on the changed projects) → gate green → the host **fast-forwards the local feature branch**
onto the slice. No per-slice push, no per-slice PR.

GitHub is touched only to **read** the PRD/slice issues and **write** status labels + a completion
comment back to each slice, then **close** each integrated slice whose run ended clean (reason:
completed). A slice whose agent did not signal completion, or listed anything as `OUTSTANDING:`, is
integrated and marked `status:done` but **held open** as `ready-for-human` with that list as a
comment, and the slices that depend on it stay blocked until you resolve it and close it
([ADR 0111](../adr/0111-a-prd-slice-closes-only-on-a-clean-outcome.md)). The PRD issue stays open
until you merge the manual PRD PR.

Standalone runs follow the same rule with the last step removed: agent → commit → gate → **stop**.
There is no integration branch to fast-forward into, so the work branch is the deliverable and the
issue is left open.

When the run finishes, **you** finish the loop by hand:

```bash
git switch feat/<slug>                 # QA the integrated branch locally
corepack yarn ai:create-pr             # push it and open ONE PR; CI runs here; merge it on GitHub
```

`ai:create-pr` with no flags uses its commit-subject fallback, which is for a person at the
keyboard. An agent opening the PR goes through the create-pull-request-workflow Skill instead, so
`PrAuthor` drafts the title, body, Surface Labels, and merge base.

For a standalone run, substitute the `<type>/<n>-<slug>` branch the summary printed.

### Tunables

| Env var                   | Default           | Purpose                                                                                                                               |
| ------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `SLICE_GATE`              | (on)              | `off` skips the gate entirely (integrates without verification).                                                                      |
| `SLICE_GATE_TARGETS`      | `lint test build` | Space/comma-separated Nx targets the gate runs (e.g. `lint` for a fast check).                                                        |
| `SLICE_GATE_DATABASE_URL` | (unset)           | Use this database instead of the throwaway Postgres the gate starts for `backend:test`. Migrations are not applied to it — see below. |
| `SLICE_GATE_JEST_WORKERS` | `2`               | Jest worker cap for the gate's `test` invocation. Raise only with more Docker VM memory.                                              |

#### What the gate verifies, and at what scope

The default targets mirror what CI enforces on the eventual PR, so a gate-green slice is not one
that fails the moment it is pushed. Only `mobile` has a `typecheck` target, so the gate does not
run one — `build` is what typechecks a slice here, and it is the step that catches a slice whose
types do not compile against its consumers. The workspace-wide compile is `yarn typecheck:check`,
which CI runs.

#### The gate database

When `backend:test` is in the gate's test scope, the gate gives it the database CI's Test job
has, so a database-backed suite (for example `backfillUserCreatedAt.int.test.ts`) fails here only
when it would fail on the PR:

1. It creates a private Docker network and starts `postgres:16` on it, with the same user, trust
   auth and database name as the `services:` block in `.github/workflows/ci.yml`. No port is
   published to the host.
2. It waits up to 60s for the server to accept TCP connections.
3. After `yarn install`, the gate container runs CI's "Apply Prisma migrations and check schema
   drift" step: `prisma migrate deploy`, then `prisma migrate diff … --exit-code`. A migration
   that fails to apply, or schema drift, fails the gate as it fails CI.
4. Tests run with `DATABASE_URL=postgresql://postgres@<container>:5432/myorganiser`.
5. The container and network are removed when the gate finishes, pass or fail.

If the database cannot be started, the gate **fails closed** and says so with "no database for
`backend:test`" — an environment failure, not a verdict on the code. Check Docker and that
`postgres:16` can be pulled, then re-run with `--gate-only`.

With no backend tests in scope, no database is started. The container still gets the placeholder
`postgresql://localhost:5432/myorganiser`: several backend modules construct a `PrismaClient` at
module scope, so a suite importing one throws on import when the variable is absent.

Setting `SLICE_GATE_DATABASE_URL` skips all of this and hands that URL to the container as-is;
the gate neither starts a database nor applies migrations to yours. The URL must be reachable from
inside the gate container, so `localhost` means the container, not your machine.

A run killed outright (for example `kill -9`) skips the cleanup. Every gate database and network
carries the `sandcastle.gate-db=1` label, so remove leftovers with:

```bash
docker rm -f $(docker ps -aq --filter label=sandcastle.gate-db=1)
```

```bash
docker network prune --filter label=sandcastle.gate-db=1
```

`test` runs as its own `nx run-many` invocation so it can carry `--maxWorkers`, which the build
executors must not see. Jest sizes its pool from the CPU count visible inside the container — the
host's, typically 12 on a dev Mac — while the Docker VM's memory is a fraction of the host's. The
default pool exhausts it and workers return as `signal=SIGKILL`, which reads like a test failure
and is not one. CI does not hit this because its runner has 4 CPUs. Capping costs nothing: the
backend suite goes from 7 SIGKILLed suites in 312s to 30 passing suites in 27s.

The gate runs each target at the scope its blast radius calls for:

| Target(s)       | Scope                                     | Why                                                                                                         |
| --------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `lint`          | projects whose **own files** changed      | Lint is per-file. An upstream change cannot introduce lint errors in an unchanged downstream file.          |
| `test`, `build` | **affected** (changed + their dependents) | A lib change routinely breaks an unchanged consumer's compile or suite. Scoping to changed files misses it. |

The affected set is resolved on the **host**, not in the gate container: the gate bind-mounts only
the worktree directory, and a linked worktree's `.git` is a file pointing at the parent repo's git
dir, so `--affected` cannot resolve refs inside the container. The resolved list is passed to nx as
an explicit `--projects=` argument. If the project graph cannot be read, the gate **fails closed**.

Budget accordingly: with `build` in the target list a slice gate runs install + lint + test + a
Next.js production build, and the container timeout is 60 minutes.

Slices run **serially** (one by one), so there is no concurrency knob — each slice's ~2.6GB
`node_modules` worktree exists one at a time during its run.

### Tracing sub-agent work

A slice's agent commonly spawns its own sub-agents (`TestReviewer`, `ComponentBuilder`, and so
on). By default the flat slice log shows their tool calls inline, typographically identical to
the top-level agent's — there is no marker for where a sub-agent's work starts or ends. See
[ADR 0036](../adr/0036-sub-agent-work-is-auditable-and-gate-commands-are-derived.md) for why that
made a real gate failure (slice #397) invisible.

```bash
npx tsx .sandcastle/main.mts --prd <n> --trace-subagents
```

Sandcastle captures every sub-agent's session transcript to the host automatically — this flag
just relocates and summarizes what was already captured, to
`.sandcastle/logs/subagents/<issue>/`:

- `agent-<id>.jsonl` — the sub-agent's own captured session, unmodified.
- `index.md` — one entry per sub-agent: its type (`TestReviewer`, `ComponentBuilder`, ...), turn
  count, peak context tokens, summed per-turn token usage, and tool-call counts.

Without the flag, output stays byte-for-byte what it is today — one flat log per slice. A slice
that spawned no sub-agents writes nothing under `subagents/` either way.

## Recovering an interrupted run

A slice whose agent dies mid-run — most often by exhausting the provider's usage window — is an
**Interrupted Slice**. Its work is preserved automatically as a **Slice Checkpoint** on its slice
branch, and re-running **resumes** from it.

See [ADR 0035](../adr/0035-interrupted-slices-resume-from-git-and-destruction-is-deliberate.md)
for why it works this way.

### Two kinds of resume

A branch with commits on it resumes either way, but the reason differs and so does what the next
agent is told. The orchestrator names it:

```
resuming from interrupted run at <sha>                  # agent was killed mid-thought
resuming from completed run whose gate failed at <sha>  # agent finished; the host gate rejected it
```

The second is **not** unchecked work: its pipelines ran and its commit passed husky. A resumed
agent is told so, and told to fix what the gate reported rather than re-run those pipelines. The
two are distinguished by the `wip/<n>-checkpoint` tag, which only the crash path writes.

Both briefs carry the previous run's `HANDOFF:` markers — one line per completed hop, printed as
work lands and read back out of the slice log. Treat them as the previous run's own claim about
itself, not as proof. See [ADR 0044](../adr/0044-a-resumed-slice-is-told-what-the-previous-run-did.md).

### The short version

```bash
npx tsx .sandcastle/main.mts --prd <n>          # resumes any interrupted slice
```

That is the whole recovery for the normal case. Read on only when it does not behave as expected.

### What happens automatically

- The crash path commits whatever the agent left uncommitted onto the slice branch and tags it
  `wip/<issue>-checkpoint`. The tag keeps the commit reachable even if the branch is later deleted.
- The crash report prints the tail of the slice log next to the thrown error, because the thrown
  error carries whatever was last on stderr and is frequently not the cause.
- The next dispatch resumes from the checkpoint instead of recreating the branch, and hands the
  agent an audit-first brief: inventory what the checkpoint contains, report it, then continue.

### When a slice is skipped as stale

```
⚠ #<n> slice/<n>-<slug> carries a checkpoint based on a superseded head — skipping.
```

Slices stack — each is cut from the live feature head. If later slices integrated while this
checkpoint sat around, it is based on a head no longer in the feature branch's history, so it can
neither fast-forward nor be safely built on. The orchestrator will not guess: it leaves the branch
alone. Rebase it onto the current feature head and re-run, or discard it deliberately.

### Discarding an attempt

Only when you have looked at the work and judged it worthless:

```bash
npx tsx .sandcastle/main.mts --prd <n> --issue <slice> --fresh
```

`--fresh` must name its slice in PRD mode and is refused in sweep mode — it destroys preserved
work, so it never applies to a set you have not inspected. The wave driver refuses it outright:
discard the one slice with `dispatch-agents`, then re-run the waves.

Inspect before discarding:

```bash
git show --stat slice/<n>-<slug>
```

### Waiting out a usage limit

```bash
npx tsx .sandcastle/dispatch-waves.mts --prd <n> --wait-for-quota
```

Opt-in. On a recognised usage limit with a readable reset time, the run parks until the reset
(plus a short margin) and then **resumes** the slice from its checkpoint. Capped at two waits per
run — a third turns one PRD into more than a day of wall clock.

It deliberately does **not** wait when:

- the reset time cannot be read — a guessed sleep either wastes hours or wakes into the same wall;
- the provider's limit format is unknown to us. Only Claude Code has an observed format today;
  `cursor` and `copilot` classify as `unknown` and always preserve-and-exit instead. That is
  intended, not a gap — adding a matcher for a message we have never seen risks parking a run for
  hours on a failure that was never a limit.

Most valuable under the wave driver, which aborts the entire remaining PRD when one slice does not
complete.

### Reviewing before you resume

An interrupted agent stops mid-thought, so its output is unreviewed by construction:

- Generated test files in a checkpoint have **not** been through `TestScaffold → TestReviewer →
TestRunner`. A spec file existing in the tree is not evidence a pipeline ran — the resume brief
  tells the agent this explicitly, but check it yourself before trusting a green run.
- Check `package.json` and `TECH_STACK.md`: a slice that added a dependency did not necessarily go
  through `dep-sync`.
- **Findings you write down must go under a `## Maintainer Review` heading to travel.** The
  orchestrator interpolates only the issue _body_ into a prompt, so an ordinary comment is
  invisible to the next agent. A comment containing that heading has everything below it appended
  to the brief and marked binding. Anything above the heading is dropped, and a comment without
  it is ignored entirely — that is what keeps sandcastle's own status comments out of the prompt.
  The issue's latest `## Agent Brief` comment (the `my-triage` Skill) travels the same way, placed
  before the notes. Both count only from the repository's owner, members, or collaborators: the
  repository is public, and a stranger's comment must not become an agent's instructions
  ([ADR 0137](../adr/0137-an-issue-is-specified-by-its-body-and-its-trusted-triage-brief.md)).

- **Nothing in a checkpoint has been linted, type-checked, or tested.** The preservation commit uses
  `--no-verify` on purpose, so husky never reformats half-written work — which also means the build
  gate is the first thing to look at it. Expect a resumed slice to fail the gate on errors the
  interrupted run left behind, not on anything the resuming agent did.

### The `dispatch-waves` label trap

`dispatch-waves` gates each wave by rewriting `ready-for-agent` across every slice in the PRD and
**does not restore those labels when the run ends**. Whichever wave the run finished on, the other
waves' slices have had `ready-for-agent` stripped.

Consequence: recovering with a plain `dispatch-agents --prd <n>` sees **only the last wave**; the
rest are invisible. Re-run `dispatch-waves --prd <n>` instead — it recomputes the gating from
scratch and skips completed waves via `status:done`.

The driver no longer aborts on an incomplete wave ([ADR 0045](../adr/0045-a-prd-is-gated-once-on-the-assembled-feature-branch.md)),
so this bites less often than it did — but the labels are still left mid-rewrite, so the rule
stands: recover with the wave driver, not with a bare dispatch.

### If you integrate a slice by hand, unblock its dependents

`status:blocked` is cleared by `unblockDependents`, which runs **only** on the orchestrator's
integration path. Integrating a slice yourself — fast-forwarding the feature branch, labelling
`status:done`, closing the issue — skips it, and the next wave then finds nothing to dispatch:

```
Error: No open AFK slice issues found for PRD <n>.
```

The slices are there; they are excluded because `main.mts` filters out `status:blocked`. Clear it
on every dependent whose `## Blocked by` entries are now done or closed, and only those:

```bash
gh issue view <dependent> --json body --jq '.body' | grep -A 5 -i '^## Blocked by'
gh issue edit <dependent> --remove-label status:blocked
```

Leave the rest blocked — the orchestrator will clear them as their blockers integrate.

### Salvaging by hand

Only needed for a checkpoint created before this behaviour landed, or when the crash path itself
failed:

```bash
W=.sandcastle/worktrees/slice-<n>-<slug>
git -C "$W" add -A
git -C "$W" commit --no-verify -m "wip(slice): checkpoint interrupted #<n> agent run"
git tag wip/<n>-checkpoint
```

`--no-verify` is deliberate: husky would lint and format half-finished code and corrupt the
evidence being preserved.

### An orphaned slice worktree

**Symptom.** A slice that printed its completion promise is reported as crashed with
`WorktreeError: fatal: '.sandcastle/worktrees/slice-<n>-<slug>' is not a working tree`. The
directory is still there, but `git worktree list` does not show it, and `.git/worktrees/` has no
entry for it.

**Cause.** `git worktree prune` ran inside the sandbox. Each worktree's admin entry names a host
path the container cannot see, so prune deletes the slice's own registration — and any other
worktree's — while leaving the files. Sandcastle's end-of-run cleanup then fails on the first git
call in the directory. Slice #1207 of PRD #1206 hit this after finishing its work.

**What prevents it.** The brief forbids the command, and the image installs a `git` shim that
refuses `git worktree prune`. The image is built only when it is missing, so pick up a Dockerfile
change by removing it first:

```bash
docker image rm sandcastle:myorganiser
```

**What recovers it.** Before any git call in a slice worktree — the success-path finalize, the
crash checkpoint, and the resume or fresh rebuild — the orchestrator re-registers an orphaned
directory on its slice branch and rebuilds its index from the branch tip, keeping uncommitted
edits. When the only failure is sandcastle's own cleanup and the agent's last iteration printed
the completion promise, the slice is finalized and integrated as a completed run instead of being
reported as crashed. Otherwise re-running is enough:

```bash
npx tsx .sandcastle/main.mts --prd <n>
```

If it reports that the worktree "could not be re-registered" (the slice branch is gone, or the
`.git` file points outside `.git/worktrees/`), compare the directory with the branch before you
delete it, since the files may hold work no commit has:

```bash
W=.sandcastle/worktrees/slice-<n>-<slug>
GIT_INDEX_FILE=$(mktemp -u) sh -c "git read-tree <branch-or-tag> && git --work-tree=$W diff --stat && git --work-tree=$W ls-files --others --exclude-standard"
```

Empty output means the directory matches; remove it with `rm -rf "$W"` and re-run.

## Guardrails inside the sandbox

The repo's `PreToolUse` hooks run in the container too — the image pre-accepts the workspace
trust dialog, so `.claude/settings.json` loads. Those hooks split into two categories, and only
one of them applies in here.

**Workflow guards are lifted.** The blocks on generated and tool-owned paths — the API client,
the synced spec, generated Swagger, generated design tokens, Prisma migrations — exist to stop a
hand-edit during chat or local development. In a disposable container they protect nothing and
actively cause harm: in the run on issue #408 they rejected every `git restore` the agent tried
after a botched regeneration, so it was left holding a deletion it could not undo and committed
it instead. The image sets `MYORGANISER_SANDBOX=1`, which
`tools/scripts/copilot-hooks/pre-tool-use.ts` reads to skip them.

**Secret guards stay active.** Reads and writes of `.env`, credentials, and key material are
still blocked. The container's filesystem is disposable, but the transcript is not — it is
written to `.sandcastle/logs/` on the host and fed back into model context, so that is where a
leaked credential would end up.

Because the marker is read by the shared hook script rather than by harness config, all three
harnesses (Claude, Cursor, Copilot) inherit this without separate wiring. Behavior in both modes
is pinned by `tools/scripts/copilot-hooks/pre-tool-use.test.ts`.

To reproduce the sandbox behavior locally: `node --test tools/scripts/copilot-hooks/pre-tool-use.test.ts`;
its `sandbox mode` cases set the marker on the hook process themselves.

## Maintenance & gotchas

- **The image ships a JRE.** `openapi-generator-cli` is a Java tool, so `yarn openapi:sync` and
  `yarn openapi:check` need one. Before `default-jre-headless` was added, an agent asked to
  resync the API client got `java: not found` partway through and could not finish.
- **Disk:** `.sandcastle/.yarn-cache` (shared CAS cache, ~2GB) + the active slice's `node_modules`
  (~2.6GB; one at a time since slices run serially) + a transient gate worktree. Check headroom
  (`df -h .`).
- **First run is cold:** the first dispatch on a fresh checkout warms `.sandcastle/.yarn-cache`
  (downloads once); subsequent runs are incremental.
- **The feature branch is local:** `feat/<slug>` lives only in this clone until `ai:create-pr`
  pushes it for the PRD PR. If you delete the local branch you lose the integrated work — open
  the PR (or push it) first.
- **Retire the old cache:** delete `.sandcastle/node_modules_linux_cache/` if present — it's no
  longer used (the seed step and lockfile-hash invalidation were removed).
- **Rebuild the sandbox image after any `.sandcastle/Dockerfile` change:**
  `ensureSandboxImage()` only builds `sandcastle:myorganiser` when the image is missing or, on a
  Claude dispatch, its Claude Code differs from what the `SANDCASTLE_CLAUDE_CODE_*` policy asks for, so any
  other change leaves an existing image silently on the old contents. Force a rebuild with
  `docker image rm sandcastle:myorganiser` before the next dispatch. See `docs/graphify.md` for
  why this matters for the mounted graphify graph.
- **The sandbox image's Node is pinned to a Node 22 minor (22.23) — do not float it to `node:22`.**
  It must be 22.18 or later, because ADR 0135 runs `tools/scripts` `.ts` files with a bare
  `node script.ts`. The previous 22.16 pin guarded a recursive `fs.cpSync` onto a Docker Desktop
  bind mount, which Node 22.17+ once failed with `EACCES`; the retired `@nx/next:build` executor
  made that copy, and every slice's build gate failed with
  `NX EACCES, Permission denied 'dist/apps/web/public'` after a clean compile and typecheck. A
  re-check on 2026-10-26 (Docker Desktop 29.9.2) found the copy works on 22.16.0 and 22.23.4 alike,
  and nothing in the gate's build path makes it any more. A passing test suite does not exercise
  the copy, so repeat that check before moving the pin. See the comment on `FROM` in
  `.sandcastle/Dockerfile` for the details.
- **Never put the repo on `/mnt/d`** (or any drvfs/9P mount) for dispatch — that's the ~29 min
  trap.
- **`Could not fetch from origin (reusing worktree at … as-is, …)` is expected — ignore it.** It
  comes from `@ai-hero/sandcastle`'s `fastForwardFromOrigin`, which tries `git fetch origin <branch>`
  on the work branch. Sandcastle work branches are local-only by design (`docs/adr/0010`), so that
  fetch can never succeed; the library logs this and correctly reuses the worktree as-is. It fires
  on every run in both modes and does not indicate a failed dispatch.
