# Test Execution Pipeline: TestReviewer + TestRunner agents

Sandbox agents were silently hanging during `yarn nx test` — the Bash tool blocks until the command returns, so a slow yarn install or a hung test caused the agent to go idle, enter polling loops, and eventually die with exit code 137. Adding TestReviewer and TestRunner as explicit pipeline stages, owned by the `unit-test-delegation-workflow` skill, gives each stage a single focused job with clear contracts, a structured retry cap, and guardrails against infinite loops.

## Status

accepted — retry cap amended by [ADR 0017](0017-gated-pipeline-cap-and-slice-code-review.md) (3 → 2 reject-cycles)

## Considered Options

**Agent-calls-next** — each agent invokes the next one in its own instructions. Rejected: distributes control flow across three definitions, making the retry logic and escalation path hard to audit or change.

**Skill-owns-chain** (chosen) — `unit-test-delegation-workflow` skill orchestrates `TestScaffold → TestReviewer → TestRunner`. Agents are stateless; they receive a contract checklist and return a verdict. Control flow, retry cap, and escalation live in one place. Cap is **2** reject-cycles ([ADR 0017](0017-gated-pipeline-cap-and-slice-code-review.md); originally 3).

## Pipeline contract

Each stage hands off a structured markdown report:

1. **TestScaffold → TestReviewer**: generated test file + behavior matrix + mock boundary map + focused-run result
2. **TestReviewer → TestRunner**: verdict + hygiene-script output + `tsc` / `eslint` results + notes for execution
3. **TestRunner → main agent**: test run results + verdict (PASS / FAIL / ESCALATE)

The review checklist is owned solely by TestReviewer. TestScaffold does not emit a
self-graded copy (an author grading its own gate carries no information) and
TestRunner does not echo the annotated copy forward.

## Key guardrails

- **Hung test detection**: after 1 min of no stdout, TestRunner checks `ps aux` to distinguish "yarn still installing" (wait) from "test process hung" (kill, retry one-at-a-time with `--testNamePattern`)
- **Retry cap**: 2 cycles of TestReviewer-rejects-back-to-TestScaffold before escalating to the orchestrator ([ADR 0017](0017-gated-pipeline-cap-and-slice-code-review.md)). Hitting the cap is a Pipeline Incident.
- **E2E never executes autonomously**: E2E test files get `tsc --noEmit` + `eslint` only; TestRunner posts a PR comment and applies `needs-e2e-review` label; enforced in both TestRunner and E2EPlanner

## Model assignments

- **TestReviewer**: Haiku — well-defined static analysis task, no judgment required
- **TestRunner**: inherits session model — needs judgment (hung vs slow, test wrong vs code broken)

Keeping TestReviewer on Haiku is only sound if its checklist really is mechanical.
It was not: items like _"tests would fail if the implementation were broken"_ need
mutation testing, and a cheap model marks them PASS every time. The checklist is
therefore split — `tools/scripts/check-test-hygiene.ts` decides the mechanical
items deterministically, unverifiable items were removed, and the residual judgment
items each require a cited line. The alternative, upgrading the reviewer's model,
was rejected: it pays per-run for checks a script settles once, and leaves the
unverifiable items unverifiable at any model size.

## Consequences

`unit-test-delegation-workflow/SKILL.md`, `playwright-e2e-workflow/SKILL.md`, `e2e-planner.agent.md`, `CLAUDE.md`, `copilot-instructions.md`, and `checklist.md` all need updating. Seven new agent definition files must be created (`.github/agents/`, `.claude/agents/`, `.gemini/agents/`). The 22-item review checklist previously owned by the main agent moves entirely to TestReviewer.
