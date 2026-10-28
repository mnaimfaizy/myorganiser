---
name: unit-test-delegation-workflow
description: 'Use when a task requires creating or updating Jest unit tests, Jest integration tests, React hook/component integration tests, or specific Jest test cases in MyOrganiser. Delegate implementation to TestScaffold with a behavior matrix and review for correctness, scope, mock hygiene, duplicate output, and validation results.'
argument-hint: 'Requirement summary + source path(s) + test type + expected behaviors'
---

# Jest Test Delegation Workflow

Policy: [`docs/adr/0012-tiered-quality-gates.md`](../../../docs/adr/0012-tiered-quality-gates.md) — classify `gate:*` before delegating.

## Use This Skill When

- A feature, bug fix, or refactor requires new or changed Jest tests.
- Existing Jest unit or integration tests need to be updated for changed behavior.
- A React hook/component integration suite needs to verify local workflows, state transitions, and mocked collaborator calls.

Use `.agents/skills/playwright-e2e-workflow/SKILL.md` for Playwright specs in `apps/web-e2e`.

**Mobile App**: which Jest lane you are in is decided by the project, not by what the spec imports.

- **`libs/mobile/ui` renders.** It runs on `preset: '@react-native/jest-preset'` with `@testing-library/react-native` 14, which dropped the deprecated `react-test-renderer` peer that blocked this until #910. Mount a component, fire a press, read rendered output. Two things catch people out: **`render` is async** — `await` it — and the native modules are stubbed once in `libs/mobile/ui/jest.setup.ts` rather than per spec. See [the Mobile UI Agent Guide](../../../libs/mobile/ui/AGENTS.md).
- **`libs/mobile/core` and `libs/mobile/screens` run pure logic only.** Both use `testEnvironment: 'node'` with no renderer configured, so a spec in either must import no `react-native`, no `react`, no `@testing-library/react-native`, no library barrel, and no component. A type-only import of a React Native type is fine; it is erased before Jest sees it.

Logic worth asserting that needs no renderer still belongs in a pure module — that is why theme resolution and the Device Settings parsing are pure, and it keeps the cheapest lane open.

## Gate tier routing

| Gate                          | Path                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `gate:mechanical`             | Fixture/type retarget or rename only → main agent may edit + focused jest; **do not** run TestScaffold → Reviewer → Runner |
| `gate:standard` / `gate:full` | Behavioral assertion changes → full pipeline below                                                                         |

## Core Rules

- On `standard`/`full`, always delegate Jest test implementation to the `TestScaffold` custom agent.
- Send a complete requirement brief; never ask for generic "comprehensive tests".
- The brief must include a behavior matrix based on the actual implementation, not desired behavior from a template.
- After `TestScaffold` reports, delegate the output to `TestReviewer` — the static gate. It runs `node tools/scripts/check-test-hygiene.ts` for the mechanical items, `tsc`/`eslint` for the project, then a judgment pass over the source. After `TestReviewer` approves, delegate to `TestRunner` for **one** authoritative execution. Do not re-run the full suite in every hop.
- The review checklist belongs to `TestReviewer` alone. `TestScaffold` does not self-grade it and `TestRunner` does not echo it.
- Happy-path-only tests are not acceptable when reachable side effects, error paths, boundaries, or security-sensitive misuse paths exist.

## Workflow

1. Gather context from the changed behavior and owning files.
2. Read the full implementation under test, not only exported types or signatures.
3. Read neighboring tests and the owning project's `jest.config.ts`.
4. Build a delegation brief using [references/delegation-runbook.md](./references/delegation-runbook.md).
5. Include a behavior matrix with:
   - happy path;
   - error/validation path;
   - side effects and collaborator calls;
   - boundary/edge cases;
   - security-sensitive paths;
   - unsupported behavior to avoid testing.
6. Assess suite size before delegating:
   - 8-15 tests is the default upper range for one focused integration suite.
   - More than 15 tests requires a reason tied to the behavior matrix.
   - More than 20 tests or multiple files requires logical batches.
7. Delegate one focused batch to `TestScaffold` with explicit requirements:
   - test type (`unit`, `Jest integration`, `React hook integration`, etc.);
   - source and target test paths;
   - project name and run command;
   - mocking boundaries;
   - in-scope and out-of-scope scenarios;
   - acceptance checks and validation commands.
8. After `TestScaffold` reports back, delegate the full output to `TestReviewer` with the test file path and project name.
9. Handle `TestReviewer` verdict:
   - **APPROVED** → proceed to step 10.
   - **REJECTED** → send a targeted revision brief back to `TestScaffold` listing the specific failing checklist items (counts as one retry; max 2 reject-cycles total before escalating to the main agent with full history; ADR 0017).
10. Delegate the `TestReviewer`-approved output to `TestRunner`.
11. Handle `TestRunner` verdict:
    - **PASS** → accept; report to main agent.
    - **FAIL(test_wrong)** → send diagnosis back to `TestScaffold` as a revision brief (retry counter applies; max 2 total). A Reviewer PASS then Runner FAIL is a Pipeline Incident.
    - **FAIL(code_broken)** → escalate to main agent with full report; do not retry.
    - **ESCALATE** → escalate to main agent with full context.
    - **NEEDS_HUMAN_REVIEW** → relay PR comment and `needs-e2e-review` label action; accept result.
12. For multi-batch suites, complete one full batch (TestScaffold → TestReviewer → TestRunner PASS) before delegating the next batch.

## Integration-Test Scope Guardrails

Scope rules (what to cover, what is off-limits without implementation evidence) live in
`.github/agents/test-scaffold.agent.md` Steps 3-4 and are enforced by
`.github/agents/test-reviewer.agent.md`. Do not restate them in the brief.

The main agent's job here is sizing only: 8-15 tests per focused suite, >15 needs a
behavior-matrix reason, >20 or multi-file must be split.

## Large Suite Splitting

When the full scope covers more than 20 tests or multiple test files:

1. Identify logical groups such as load/init, mutations, async side effects, failure paths, and security/edge cases.
2. Delegate one group at a time, usually 5-8 tests per session.
3. Wait for the group to be implemented, verified passing, and reviewed before starting the next group.
4. Keep a running tally of completed vs. remaining groups.

Example split for a hook with 22 justified tests:

| Session | Group                           | Tests |
| ------- | ------------------------------- | ----- |
| 1       | Load state + initial render     | 1-5   |
| 2       | Mutation operations             | 6-12  |
| 3       | Async persist + side effects    | 13-18 |
| 4       | Security + reachable edge cases | 19-22 |

## Pipeline Chain & Retry Rules

```
TestScaffold → TestReviewer → TestRunner → main agent
     ↑              |
     └──────────────┘
      REJECTED: max 2 reject-cycles (ADR 0017)
     ↑
     └──── FAIL(test_wrong) also counts toward the same cap
```

**Retry cap**: Each `REJECTED` from TestReviewer or `FAIL(test_wrong)` from TestRunner that sends back to TestScaffold increments the retry counter. After **2 reject-cycles**, escalate to the main agent with the full chain history. Hitting the cap, a repeated FAIL, or a Reviewer PASS then Runner FAIL is a **Pipeline Incident** — comment `## Pipeline Incident` on the Slice Issue. `/code-review` runs once per Slice after checks are green, not after every hop.

**Escalate to main agent when**:

- TestRunner returns `FAIL(code_broken)` — the implementation needs fixing, not the test
- TestRunner returns `ESCALATE` — tests hung and one-at-a-time recovery failed
- Retry counter reaches 2 — recurring issues need human judgment; file a Pipeline Incident

**Accept and pass to main agent when**:

- TestRunner returns `PASS`
- TestRunner returns `NEEDS_HUMAN_REVIEW` — relay PR comment and `needs-e2e-review` label

## References

- `./references/delegation-runbook.md`
- `.github/agents/test-scaffold.agent.md`
- `.github/agents/test-reviewer.agent.md`
- `.github/agents/test-runner.agent.md`
- `.agents/skills/playwright-e2e-workflow/SKILL.md`
- `docs/testing/README.md` - project index + cross-project rules; per-project tooling lives in `docs/testing/projects/<project>.md`
- `AGENTS.md`
