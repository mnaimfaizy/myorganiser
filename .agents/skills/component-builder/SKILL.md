---
name: component-builder
description: 'Use when creating or editing a React component in libs/web/ui/ or libs/web/pages/. Classify gate tier, build a Structured Spec, and delegate to ComponentBuilder then ComponentReviewer.'
---

# Component Builder Workflow

Policy: [`docs/adr/0012-tiered-quality-gates.md`](../../../docs/adr/0012-tiered-quality-gates.md) — classify `gate:*` before delegating.

Use this when creating or editing any React component in `libs/web/ui/` (UI Primitives) or `libs/web/pages/<route>/` (Feature Components).

## Gate tier routing

| Gate                          | Path                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `gate:mechanical`             | Rename / import path / dead delete only → main agent may edit; run `yarn component:hygiene <path>` (ADR 0014) |
| `gate:standard` / `gate:full` | Follow the chain below. Do not write component code in the main agent.                                        |

## Workflow

### Step 1 — Build a Structured Spec

Before delegating, construct the following spec from the user's request and the surrounding codebase context. If it is incomplete (missing `Target Path` or `Props Interface`), gather the missing information first.

```
## Structured Spec

### Component Name
<PascalCase name>

### Target Path
<exact relative path — ComponentBuilder infers scope from this>

### Action
create | edit

### Scope
UI Primitive | Feature Component
(omit to let ComponentBuilder infer from the target path)

### Props Interface
<TypeScript interface or prose description of props>

### State Ownership
<local useState / React Hook Form / custom hook / server>

### Zod Schema
<schema definition, or "none">

### Composition
<list of sub-components if compound, or "single component">

### Guidelines to Enforce
all

### Additional Context
<anything ComponentBuilder needs to know>
```

### Step 2 — Delegate to ComponentBuilder

Pass the Structured Spec to the `ComponentBuilder` sub-agent (canonical `.github/agents/component-builder.agent.md`). Wait for the **ComponentBuilder Report** before proceeding.

### Step 3 — Delegate to ComponentReviewer

Required on `gate:standard` and `gate:full` after ComponentBuilder. Pass the ComponentBuilder Report to `ComponentReviewer` (canonical `.github/agents/component-reviewer.agent.md`). Skip Builder/Reviewer only for `gate:mechanical` rename/import/dead-delete.

ComponentReviewer runs `check-component-hygiene.ts`, `tsc --noEmit`, and `eslint`, then judges composition, scope placement, concern mixing, the client boundary, Radix usage, and accessibility. `tsc` over the owning project is the importer check — nobody reads importer files one by one.

### Step 4 — Handle the Verdict

- **`PASS`** — accept the component; note any warnings to the user.
- **`PASS_WITH_WARNINGS`** — accept the component; surface the warnings to the user for awareness.
- **`FAIL`** — relay `Required Revisions` to ComponentBuilder and repeat from Step 2. **Max 3 FAIL cycles**, then escalate to the main agent/human with a diagnosis. Prefer short reviewer reports (`PASS|FAIL` + ≤5 bullets) unless detail is needed after a rejection.

### Step 5 — Storybook and Tests (after review passes)

- New UI Primitives always need a Storybook story → `.agents/skills/storybook-delegation-workflow/SKILL.md`.
- Any component with testable behaviour → `.agents/skills/unit-test-delegation-workflow/SKILL.md`.
- On `gate:standard`, add stories/tests only when behavior warrants them.

ComponentBuilder does not write stories or tests — those go to StorybookCurator and TestScaffold after the review passes.

## Key Rules

- Do not invent component conventions. ComponentBuilder and ComponentReviewer enforce `docs/ui/GUIDELINES.md`, which is the single copy of those rules — the agents read it rather than restating it.
- Neither agent reads `TECH_STACK.md` in full; it is a version lookup table, not a component briefing.

## Key References

- `docs/ui/GUIDELINES.md`
- `docs/adr/0012-tiered-quality-gates.md`
- `docs/adr/0014-component-pipeline-guardrails.md`
- `.github/agents/component-builder.agent.md`
- `.github/agents/component-reviewer.agent.md`
