---
name: storybook-delegation-workflow
description: 'Use when adding, editing, reviewing, or refactoring Storybook stories (`*.stories.tsx`) for MyOrganiser UI components. Delegate implementation to StorybookCurator, require requirement analysis first, and review for completeness, accessibility, and UX quality.'
argument-hint: 'Requirement summary + component path(s) + story file path(s) + expected states'
---

# Storybook Delegation Workflow

Policy: [`docs/adr/0012-tiered-quality-gates.md`](../../docs/adr/0012-tiered-quality-gates.md)

## Use This Skill When

- A task asks to create Storybook stories for a new UI component.
- A task asks to update existing stories after component behavior changes.
- A Storybook file needs UX-focused improvement (states, controls, docs clarity, edge scenarios).

## Gate tier routing

| Gate                          | Path                                                     |
| ----------------------------- | -------------------------------------------------------- |
| `gate:mechanical`             | Rename / import-path only → main agent may edit directly |
| `gate:standard` / `gate:full` | New or behavioral story updates → StorybookCurator       |

## Core Rules

- Story patterns live in [`docs/ui/STORYBOOK-PATTERNS.md`](../../../docs/ui/STORYBOOK-PATTERNS.md) — the single home for the compound-component wrapper pattern, controlled primitives, Radix portals, `play` functions, required coverage, and the anti-pattern table. `StorybookCurator` reads it. Do not restate those patterns in a brief.
- On `standard`/`full`, always delegate Storybook implementation to the `StorybookCurator` sub-agent.
- Do not create or edit `*.stories.tsx` directly in the main agent context when this workflow applies (except mechanical).
- The sub-agent must analyze requirement quality first (completeness, ambiguity, conflicts) before touching files.
- If requirements are incomplete, the sub-agent must stop and return targeted clarification questions.
- The sub-agent may disagree with the requested implementation when it would reduce quality (accessibility gaps, misleading stories, missing critical states, anti-patterns).
- The main agent acts as reviewer and may request a refinement pass when coverage quality is weak.
- If recurring Storybook mistakes are discovered, update references or docs so the same mistake is not repeated.

## Workflow

1. Build a delegation brief using [references/delegation-runbook.md](./references/delegation-runbook.md).
2. Delegate to `StorybookCurator` with explicit scope:
   - target component path(s)
   - target story path(s) or expected new file path
   - requirement summary
   - reference stories or design/system constraints
   - boundaries for creativity vs strict fidelity
3. Review the sub-agent output:
   - requirement analysis completed first?
   - gaps/clarifications surfaced clearly?
   - critical states represented?
   - a11y and UX concerns called out?
4. If needed, run a refinement delegation with concrete missing scenarios.
5. Finalize only when story coverage meaningfully supports component behavior and developer UX.

## Review Checklist (Main Agent)

- Does the story set cover the applicable rows of the required-coverage table (`STORYBOOK-PATTERNS.md` §8)? Long-content and empty states are the two most often skipped.
- Did the curator pick the right pattern for the component shape — `args` for a single component with variants, a wrapper for a compound one, `render` + state for a controlled one?
- Are controls/args realistic and useful for exploration?
- Is accessibility represented (labels, disabled states, keyboard-relevant scenarios)? Icon-only controls must have an accessible name.
- Did the sub-agent challenge weak or risky requirements where appropriate?
- Did the output include specific clarification questions when requirements were incomplete?

## References

- `./references/delegation-runbook.md`
- `.github/agents/storybook-curator.agent.md`
- `docs/ui/STORYBOOK-PATTERNS.md` — authoring patterns (single home; link, do not copy)
- `docs/storybook/README.md` — setup, commands
- `libs/web/ui/AGENTS.md`
- `AGENTS.md`
