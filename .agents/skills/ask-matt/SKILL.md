---
name: ask-matt
description: Ask which MyOrganiser skill or workflow to run next. Use when the right path is unclear and you need a routing recommendation.
disable-model-invocation: true
---

# Ask Matt

Adapted from `mattpocock/skills` (through v1.2.3 ideas), adjusted to MyOrganiser's skill set and workflows.

Use this as a **router** when you are unsure which workflow to run.

Always recommend a **gate tier** first (`gate:mechanical | standard | full` — ADR 0012 / `.claude/checklist.md` Step 0) when the next step is implementation.

## Main MyOrganiser flow: idea → ship

1. **`/grill-with-docs`**  
   Start here to sharpen a feature/problem statement against domain language and existing decisions.

2. **If the idea needs runnable validation first**  
   Use **`/prototype`** for throwaway validation (logic or UI), optionally bridged across sessions using **`/handoff`**.

3. **Planned feature path (multi-slice work)**
   - `/to-prd` → publish PRD issue
   - `/to-issues` → split into slice issues (assign `gate:*` + `complexity:*` + blocking edges)
   - then run `yarn dispatch-agents --prd <issue-number>` for AFK slices

4. **Ad-hoc or single-shot implementation (ticket optional)**
   - Classify gate tier (no ticket required for mechanical/standard fixes).
   - If the user wants a tracked bug/enhancement issue: `/github-issue-creation-workflow`
   - If they want it built now: **`/implement`**, which should drive **`/tdd`** at pre-agreed seams, then **`/code-review`** when the gate warrants it.

   Reach for **`/tdd`** alone when you only want one behaviour built test-first without a full PRD. Reach for **`/code-review`** alone to review a branch/PR against a fixed point.

### Context hygiene

Keep grilling → PRD → issue slicing in **one unbroken context** when possible. Each `/implement` (or Sandcastle slice) should start fresh from the ticket.

## On-ramps

- **Bugs and requests piling up** → **`/my-triage`** (incoming/raw issues only — not slices `/to-issues` already made agent-ready).
- **Something's broken** → **`/diagnosing-bugs`** (hard bugs, flakes, regressions). Refuse theories until there is a tight red-capable feedback loop; hand off to **`/improve-codebase-architecture`** when the finding is a missing seam.
- **Huge / foggy effort (cannot yet write the PRD's goal sentence)** → **`/grill-with-docs`**. Interview until the abstractions have edges; the moment you _can_ write that sentence, switch to **`/to-prd`**.

## Codebase health

- **`/improve-codebase-architecture`** — survey deepening opportunities; feed chosen ideas into `/grill-with-docs`.
- Design the chosen shape with **`/codebase-design`** vocabulary.

## Vocabulary underneath

- **`/domain-modeling`** — sharpen domain language; keep `CONTEXT.md` a clean glossary; ADRs when warranted.
- **`/codebase-design`** — deep-module vocabulary (module, interface, depth, seam, adapter, leverage, locality). `/tdd` and `/improve-codebase-architecture` speak it.

## Quality and delivery routing

- Jest unit/integration tests → `/unit-test-delegation-workflow` (or mechanical direct edit per checklist)
- Playwright E2E work → `/playwright-e2e-workflow` (skip E2EPlanner for selector-only + unchanged matrix)
- Storybook story changes → `/storybook-delegation-workflow`
- API Contract / Prisma for a public HTTP surface → `/backend-api-contract-change` (PrismaWriter → ApiWriter → ApiSync; one-shot, ADR 0015)
- Prisma runbook only (PrismaWriter reads it) → `/prisma-migration-workflow`
- Release/deploy preparation → `/release-and-deploy-workflow`
- Review branch or WIP changes → `/code-review` (optional for `gate:mechanical`)
- Stale instruction truth vs official docs → `/upstream-brief`

## Session transitions

- Use **`/handoff`** when changing sessions or branching work into a fresh context.
- Keep one unbroken context for tightly coupled planning phases when possible (grilling → PRD → issue slicing), then split implementation into fresh sessions if needed.

## Rule of thumb

If the work is:

- **New planned feature** → `/to-prd`
- **Something's broken (hard bug)** → `/diagnosing-bugs`
- **Incoming raw request to track** → `/github-issue-creation-workflow` or `/my-triage`
- **Ad-hoc fix now, no ticket** → classify gate → `/implement` (with `/tdd` when appropriate)
- **Test-heavy behavioral change** → matching test workflow at `standard`/`full`
- **Architecture/terminology uncertainty** → `/grill-with-docs` (and `/domain-modeling` when updating glossary/ADRs)
- **Stale framework or library instruction truth** → `/upstream-brief` (human names Ecosystems, each optionally with a Horizon; writes an Upstream Brief against what is installed; does not bump packages)
- **Words/shape are the problem** → `/domain-modeling` or `/codebase-design`
