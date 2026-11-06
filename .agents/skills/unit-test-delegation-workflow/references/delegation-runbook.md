# Jest Test Delegation Runbook

Use this runbook to build the **delegation brief** for the `TestScaffold` sub-agent — the
task-specific context only it can get from you.

The main failure mode to avoid is template-driven test generation: tests that assert ideal behavior, retry flows, concurrency, or error propagation that the implementation does not provide.

> **Do not restate standing rules in the brief.** Mock hygiene, scope limits, unsupported-scenario
> rules, and the review checklist are already in the agent prompts:
>
> - Authoring rules → `.github/agents/test-scaffold.agent.md`
> - Gate criteria → `.github/agents/test-reviewer.agent.md`
> - Per-project tooling and mocks → `docs/testing/projects/<project>.md`
>
> Repeating them here costs tokens on every delegation and creates two places to update.
> The brief carries **paths, the behavior matrix, and in/out of scope** — nothing else.

## Delegation Brief Template

Provide all of the following fields to `TestScaffold`:

1. **Goal**: one-line purpose of the test update.
2. **Test type**: `unit`, `Jest integration`, `React hook integration`, `component integration`, or another precise Jest scope.
3. **Project**: Nx project name and expected run command.
4. **Code under test**: exact source file paths.
5. **Target test files**: exact `*.spec.ts` / `*.test.ts` paths to edit or create.
6. **Implementation notes from main-agent read-through**:
   - public methods and state returned;
   - where errors are caught, swallowed, rethrown, or converted to state;
   - whether retry, timeout, cancellation, or concurrency exists;
   - important side effects and collaborators.
7. **Behavior matrix**:

   | Operation/flow | Input/precondition | Expected state/output | Side effects | Error behavior | Unsupported behavior |
   | -------------- | ------------------ | --------------------- | ------------ | -------------- | -------------------- |

8. **In scope**: the exact scenarios to test.
9. **Out of scope**: scenarios not to test, especially unsupported retry/concurrency/timing flows.
10. **Mocking boundaries**: what must be mocked and what must stay real, with the reason. The agent reads `docs/testing/projects/<project>.md` for the pattern itself.
11. **Acceptance checks**: concrete assertions that must exist.
12. **Focused run command**: the narrowest `--testPathPatterns` / `--testNamePattern` invocation. Do **not** ask for a full-project run or lint — `TestReviewer` owns `tsc`/`eslint` and `TestRunner` owns the authoritative run.
13. **Batch scope**: if splitting, identify this batch and the total plan.

## Prompt Pattern

```markdown
Goal: <why tests are needed>
Test type: <unit | Jest integration | React hook integration | component integration>
Project: <nx-project>, run with <command>
Source files: <paths>
Target tests: <paths>

Implementation notes:

- <actual error handling and state transitions>
- <collaborators and side effects>
- <unsupported behaviors to avoid>

Behavior matrix:
| Operation/flow | Input/precondition | Expected state/output | Side effects | Error behavior | Unsupported behavior |
| -------------- | ------------------ | --------------------- | ------------ | -------------- | -------------------- |
| ... |

In scope:

- <focused scenario>

Out of scope:

- <retry/concurrency/timing/etc. if unsupported>

Mocking boundaries:

- <module> mocked because <reason>
- <module/logic> remains real because <reason>

Acceptance checks:

- <specific assertion>

Validation:

- Focused run only: <command>
- Duplicate/syntax: inspect for duplicate helpers/describe blocks and invalid TS
```

## Sizing The Batch

Default to 8-15 focused tests for one integration suite. More requires an explicit
behavior-matrix reason. More than 20 tests or multiple files must be split — see
**Large Suite Split Pattern** below.

Mocking boundaries for the brief come from `docs/testing/projects/<project>.md`; name the
boundary and the reason, and let the agent read the file for the pattern.

## Review Standard

`TestReviewer` is the gate — it verifies the checklist, runs `tsc --noEmit` and `eslint`, and
returns APPROVED or REJECTED. The main agent does not re-run that checklist; it acts on the
verdict per the pipeline rules in `SKILL.md`.

## Security Prompts To Include When Relevant

- "Could unsafe input pass validation and alter behavior?"
- "Could auth/session or permission checks be bypassed?"
- "Could secrets/plaintext leak into logs or returned values?"
- "Could ciphertext-only rules be violated in vault-backed flows?"

## Refinement Prompt Pattern

When requesting a second pass, provide explicit gaps:

> Update `<test-file>` to add or fix assertions for `<missing behavior>`. Keep existing test style, keep mocks deterministic, do not add unsupported retry/concurrency/timing scenarios, and report the focused run plus duplicate/syntax check.

## Large Suite Split Pattern

When the full scope covers more than 20 tests or multiple files, split by logical group and record progress:

```text
Total planned: 22 tests across 1 file

Batch 1 (delegated): Load state + initial render (tests 1-5) - STATUS: PASS
Batch 2 (delegated): Mutation operations (tests 6-12) - STATUS: PASS
Batch 3 (pending): Async persist + side effects (tests 13-18)
Batch 4 (pending): Security + reachable edge cases (tests 19-22)
```

Do not start Batch N+1 until Batch N is verified passing and the main agent has reviewed coverage.
