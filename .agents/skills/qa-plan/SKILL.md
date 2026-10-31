---
name: qa-plan
description: 'Use when work is complete and its Pull Request is open, and a human (or agent) needs to verify it before merge — normally a PRD Issue, occasionally a single issue. Compose mode writes a QA Plan that carries only the residue automation does not prove. Execute mode runs an existing plan (or compose-then-execute), records evidence, and signs off. Not for planning automated tests.'
---

# QA Plan

Write down what a human still has to prove. Nothing else. Then, when asked, **run** that plan.

The deliverable is a **QA Plan** (`CONTEXT.md`): the manual verification for work whose Pull
Request is open but unmerged. Its value is entirely in what it **leaves out** — a reader who
trusts it will skip everything it says is covered.

## Use This Skill When

- A PRD Issue's work is complete, its Pull Request is open, and it has not merged.
- A single issue's Pull Request is open and the change warrants manual verification.
- The user asks for a QA plan, a manual test plan, or how to verify something before merging
  (**compose**).
- The user asks to QA a PR, execute a QA plan, run the scenarios, or sign off
  (**execute**).

## Do Not Use When

- Planning Playwright specs or a Jest behavior matrix → `E2EPlanner`,
  `.agents/skills/playwright-e2e-workflow/SKILL.md`, or
  `.agents/skills/unit-test-delegation-workflow/SKILL.md`. Those design automation. This skill
  documents what automation cannot reach.
- Reviewing the diff for defects → `.agents/skills/code-review/SKILL.md`.
- **There is no open Pull Request, or no branch, for the subject.** A QA Plan verifies work that
  exists. Without a branch there is no diff, and without a Pull Request there is no pinned
  merge-base, so no coverage claim can be attributed. See the precondition in step 1.

## Operation modes: compose vs execute

Resolve **operation** from the user's phrasing (independent of PRD vs Issue routing below).

| Phrasing (examples)                                     | Operation                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| "write a QA plan", "QA plan for #N", "how to verify"    | **compose**                                                             |
| "QA the PR", "execute the QA plan", "run the scenarios" | **execute**                                                             |
| "QA the PR" + path to a plan, or "compose then execute" | **execute** (compose first if the plan is missing — see Remote handoff) |

One skill owns both. Do not invent a companion skill for execution — shared residue rules would drift.

## Subject modes (PRD vs Issue)

Resolve the subject mode from the issue the Pull Request closes. Everything in this skill applies to
both except where a step says otherwise.

|                   | **PRD mode**                                   | **Issue mode**                                |
| ----------------- | ---------------------------------------------- | --------------------------------------------- |
| Input             | A PRD Issue                                    | A single issue                                |
| Work is read from | Slice Issues, then the commits on each         | The commits on the branch                     |
| Composed in       | `tmp/QA-PLAN-prd-<number>.md`, gitignored      | `tmp/QA-PLAN-issue-<number>.md`, gitignored   |
| Published to      | A **QA Plan Issue** on GitHub, labelled `qa`   | Nowhere — the working copy is the deliverable |
| Sign-off          | Closing the QA Plan Issue                      | None — the file is consumed and discarded     |
| Execution record  | On the **QA Plan Issue** (ticks + evidence)    | In the `tmp/` working copy                    |
| Defects found     | Filed as issues, linked from the QA Plan Issue | Filed as issues                               |

If the Pull Request closes several issues, or closes none, ask which subject the plan is for rather
than guessing. If the input is a PRD Issue with no Slice Issues, read its commits directly and say
so in the plan.

**Both modes compose in `tmp/`.** The plan is a document before it is an issue, and it is revised
against the source while you write it. Under ADR 0041 that draft is a short-lived working file, and
`tmp/` is where those live. Write it there first in either mode. Never commit it. There is no
tracked `docs/qa/` (or similar) home for plans.

**Only PRD mode publishes.** A PRD is large, multi-slice work whose validation is worth a durable
record others can find, so its plan becomes a QA Plan Issue whose closure is the sign-off. A single
issue is verified once by one person, so its working copy is the whole deliverable. Do not publish
an Issue-mode plan to GitHub.

In PRD mode the working copy is scaffolding, not a second artifact. Once the QA Plan Issue exists,
that issue is the plan: it is what you link, what the tester ticks, and what closes as the sign-off.
The file can be discarded with the working tree. In Issue mode there is nothing to defer to, so the
file is the plan.

### Remote / Cloud Agent handoff

Issue-mode plans live only in gitignored `tmp/`, so a remote agent often **cannot see** a plan the
human composed locally. Operational consequence of ADR 0059 — not a reason to track plans in git.

When executing remotely:

1. Prefer the plan **pasted or attached** in the agent prompt, or a path that actually exists in the
   workspace.
2. If the plan is missing and the user asked to execute: **compose-then-execute**, and say so
   explicitly (you recomposed because the working copy was absent).
3. Never commit `tmp/`. Never invent a durable docs path for Issue-mode plans.

For Cloud Agent **service ports, Postgres, MailHog, and frontend `PORT=4200`**, follow
`AGENTS.md` → Cursor Cloud specific instructions. Do not duplicate those env facts here.

### QA Accounts

Sign in as a **QA Account** (`CONTEXT.md`). Do not register a User by hand, and do not keep
credentials in `tmp/`.

- `yarn qa:accounts:seed` creates the accounts in the local database, each a verified User whose
  Vault already exists. Run it first in every Setup; it changes nothing when they are already there.
- `yarn qa:accounts` prints each account's email, password, Vault passphrase and Recovery Key.
  Read the values from that output when you type them.
- `primary` is for ordinary scenarios. `secondary` is for a scenario that needs a second User.
- If the seed reports a Vault Blob as unreadable, or a scenario left the Vault in a state you cannot
  use, `yarn qa:accounts:seed --restore --account <id>` returns that Vault to empty. It deletes the
  account's vault data, so say so in the Execution record when you run it.
- Register by hand only when registration, verification, or first-time Vault creation is the thing
  under test.

## Core Rules

- **The residue rule.** Every line you keep must survive one question: _would a passing CI run
  establish this?_ If yes, delete it. A QA Plan that restates the test suite wastes the one
  resource it exists to protect — human attention.
- **Never assert coverage you have not observed.** Every claim in the coverage section is tagged
  `[observed]` (you ran it this session and saw the result) or `[reconstructed]` (inferred from CI,
  the diff, or issue history). A wrong `[observed]` tag is the worst defect this skill can ship.
- **Two points, always.** Run the suites at the branch **and** at the merge-base. A failure present
  at both is pre-existing and belongs in Expected Red Herrings, not in the scenarios. A failure
  present only at the branch is a regression and blocks the plan — report it and stop.
- **A green suite is not a proving suite.** For crypto, vault, auth, or ownership boundaries,
  optionally perturb the source so a test _should_ fail, and confirm it does. Record the result. A
  suite that passes against broken code proves nothing, and its coverage claims must be downgraded.
- **Read the UI, do not imagine it.** Steps name real button labels, field ids, and toast copy read
  from the components. A scenario a human cannot follow literally is not a scenario.
- **Do not delegate the body.** Compose it here. In PRD mode publish directly with `gh` — an
  intermediary that re-words load-bearing exclusions is a liability, and the ad-hoc issue template
  does not fit this shape. Same reasoning as `to-prd`.
- **Verify the work exists before planning to verify it.** An issue describing a defect that
  nobody has fixed yet has nothing to QA. Halt rather than producing a plan for code that does not
  exist — such a plan is speculation, and it is worse than none because it looks authoritative.
- **One QA Plan Issue per PRD Issue.** Search before creating.
- **This is invoked, never enforced.** Do not add a gate asserting that a Pull Request links a QA
  Plan — that is the "surface X changed, therefore doc Y must change" shape ADR 0043 deliberately
  does not build.
- Use `CONTEXT.md` vocabulary. Do not use its avoided terms.

## Workflow — compose

### 1. Check the precondition, then fix the anchors

**Before anything else, confirm the subject has work to verify.** Check for a branch and an open
Pull Request:

```sh
gh pr list --state open --json number,title,headRefName
git branch -a
```

**Halt immediately if either is missing.** Report which is absent, state that the subject has no
implemented work, and recommend the actual next step (implement it, or open the Pull Request).
Do not offer a partial plan, a provisional plan, or a plan "to use later" — a QA Plan asserts what
automation proves about a specific diff, and there is no diff.

Only once both exist, establish and state these. Do not proceed while any is unknown:

- the subject issue number, and whether it is a PRD Issue (→ PRD mode) or not (→ Issue mode)
- the Pull Request number
- the merge-base SHA (`git merge-base origin/main HEAD`)

The merge-base is what makes coverage attributable. Without it every pre-existing failure reads as
a regression.

### 2. Establish coverage empirically

Run the relevant suites at the branch and at the merge-base, and diff the results. Prefer the
narrowest command that covers the change's surface.

Record for each suite: passed, failed, and **which** tests failed at each point. Classify:

| At merge-base  | At branch | Meaning                                                 |
| -------------- | --------- | ------------------------------------------------------- |
| fails          | fails     | Pre-existing → Expected Red Herrings                    |
| passes         | fails     | **Regression → stop and report; do not write the plan** |
| passes         | passes    | Covered → excluded from the plan                        |
| n/a (new test) | passes    | Covered → excluded, and name what it proves             |

If the suite cannot run at the merge-base, say so and tag every coverage claim `[reconstructed]`.

### 3. Read the change and the decisions behind it

- **PRD mode** — read the PRD Issue, each Slice Issue, and the commits on each. Slices carry the
  acceptance criteria the PRD promised; unmet criteria are prime scenario material.
- **Issue mode** — read the issue and the commits on the branch. A single issue rarely states
  acceptance criteria, so derive the promise from the issue body and the diff.

In both modes read any ADR the change implements or depends on. You are looking for the promises
the change makes — those are what a human verifies.

### 4. Read the UI copy

Open the components the scenarios will touch and copy exact labels, ids, and messages. This is what
separates an executable plan from an abstract one.

### 5. Compute the residue

Subtract step 2 from step 3. What remains is the plan. Residue usually clusters as:

- **Real-world upgrade paths.** Automation synthesises prior state; it rarely produces it the way a
  released build did. State created by the _previous_ version and read by the new one is the single
  highest-value thing a human can test.
- **Cross-boundary claims nothing asserts.** Where the change promises isolation, ownership, or
  authorization, check whether any test actually proves it. If not, that is a scenario — and often
  also an issue worth filing.
- **Destructive and irreversible actions.** What survives a failed attempt, and what the blast
  radius of a successful one is.
- **Judgement.** Whether copy is honest, whether an error is actionable, whether a flow feels safe.
- **Design fidelity.** When the work builds to a design committed under `docs/design/` (ADR 0110),
  nothing automated compares the running app to it — the Sandcastle sandbox cannot run a device
  or show a screen (ADR 0111). That comparison is always residue: one scenario per page, walking
  its artboards on a real device or simulator (both platforms for the mobile app, light and dark),
  naming the artboard file each step is checked against.

When the residue includes something automation _should_ cover and does not, say so in the scenario
and file it, rather than silently converting a coverage gap into permanent manual labour.

If the residue is empty, say so and recommend merging without a QA Plan. An empty plan is a real
and good outcome; padding it to look substantial is the failure this skill exists to prevent.

### 6. Draft into the working copy

Write the plan to its `tmp/` path using the anatomy below — `tmp/QA-PLAN-prd-<number>.md` in PRD
mode, `tmp/QA-PLAN-issue-<number>.md` in Issue mode. Never commit it.

Apply **Vault / crypto scenario hazards** and **failure classes** when drafting scenarios that touch
Recovery Keys or other high-entropy secrets (see below).

Then show the user the draft and ask whether to proceed. **Nothing leaves `tmp/` before they
answer** — in PRD mode no issue is created, and in Issue mode the plan is not final and is not
handed over. Writing the working copy is not the decision point; delivering it is.

### 7. Deliver

- **PRD mode** — publish the working copy's body with `gh issue create`, labels `qa` plus the
  relevant area labels, title `[QA Plan] <PRD title>`. Link the PRD Issue and the Pull Request. Do
  not apply `ready-for-agent`; this is human work. Publish **once** — later revisions edit the
  existing issue, they do not create a second one.
- **Issue mode** — hand the working copy to the user. It is the deliverable; do not publish it.

### 8. Close the loop (compose)

Tell the user how it ends. In PRD mode: tick the boxes on the QA Plan Issue while testing, file each
defect as its own issue linked from it, and close the QA Plan Issue as the sign-off — the `tmp/`
file has served its purpose and needs no further attention. In Issue mode: file defects as issues;
the file needs no ceremony. If they want you to run the scenarios now, switch to **execute**.

## Workflow — execute

Preconditions: an open Pull Request and branch still apply. If you do not already have a plan:

- Use the pasted/attached plan, or the `tmp/` path if present.
- Otherwise **compose-then-execute** (steps 1–6 above), state that you recomposed, then continue.

### E1. Setup

Follow the plan's Setup exactly. For Cloud Agent environment facts, see Remote / Cloud Agent handoff
above.

Run `yarn qa:accounts:seed` before the first sign-in, whether or not the plan lists it (see QA
Accounts above).

If scenarios touch a Recovery Key or vault secret, obey **Vault / crypto scenario hazards** before
the first unlock attempt.

### E2. Run scenarios

Execute each scenario in order. Use real UI copy from the plan. Capture evidence per **Evidence**
below.

When a secret-touching scenario fails, consult its **If this fails, first rule out…** list before
treating the failure as a merge blocker.

### E3. Execution record

Fill an **Execution record** before declaring sign-off:

| Destination | Where it lives                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Issue mode  | Append to the `tmp/` working copy                                                                                                                                        |
| PRD mode    | Tick scenarios and attach evidence links on the **QA Plan Issue** (the durable record). Update `tmp/` only as scaffolding if useful; do not treat it as the audit trail. |

Each row: scenario id/name → PASS/FAIL → artifact path or link → notes (optional).

### E4. Defects and automatable residue

- File product defects as issues (linked from the QA Plan Issue in PRD mode).
- If a residue scenario is clearly something automation should own, **file a follow-up issue** (e2e
  or equivalent). Do **not** block sign-off of the current PR on that follow-up existing — sign-off
  still follows the residue scenarios themselves.

### E5. Sign-off

- Tick the Sign-off checklist (Issue mode: in `tmp/`; PRD mode: on the QA Plan Issue).
- Report the verdict: all PASS → safe to merge from QA; any Stop-and-do-not-merge outcome → block
  and file defects.
- In PRD mode, closing the QA Plan Issue remains the formal sign-off once humans agree.

## Vault / crypto scenario hazards

Inline hazards for plans that touch a Recovery Key, passphrase reset after recovery, or other
high-entropy vault secrets. Keep them next to Execute — do not invent a second fixture doc for these
rules.

- **Capture the Recovery Key from the DOM or Copy/Download**, never by visually selecting clipped
  text. Prefer `#acknowledgment-recovery-key` `inputValue()`, or the UI Copy / Download controls.
- **Assert length before use.** A minted Recovery Key is 44 Base64 characters (32 bytes). A shorter
  string is truncated copy, not a product unlock failure.
- **Do not rotate the Recovery Key** during a passphrase-reset QA plan unless the plan explicitly
  tests rotation. Rotation invalidates the previous key by design and looks like an unlock bug.
- **Soft-nav vs reload.** In-memory session signals (including Vault Unlock Secret) clear on full
  reload. Soft-navigate (e.g. sidebar **Vault**) when the plan requires keeping the current unlock.
- **Wrong-secret toasts are ambiguous.** "That recovery key didn't unlock this vault" is also what a
  truncated or retired key produces — see failure classes on the scenario.

## Failure classes on secret-touching scenarios

Any scenario that uses a Recovery Key or equivalent secret **must** include a short list:

> **If this fails, first rule out:** …
> (e.g. key length ≠ 44 → re-copy; key was rotated mid-session → restart with a fresh vault;
> passphrase unlock still works → wrapping may have moved intentionally)

Do not require that taxonomy on ordinary UI copy or judgement-only scenarios.

## Evidence

A QA Artifact is captured only where a written result would not be enough, and stays in
`tmp/qa/<subject>/` unless the person it was captured for chooses to publish it. To upload one, see
[Uploading QA Artifacts](../finish-standalone-runs/SKILL.md#uploading-qa-artifacts) and
[ADR 0142](../../../docs/adr/0142-a-standalone-runs-qa-is-run-by-agents-and-reported-on-its-pull-request.md).

QA-specific lines:

1. **One short demo video** covering residue scenarios only — start recording **after** Setup
   (login, vault mint, MailHog) is done.
2. **Screenshots** for assertions about presence/absence of fields or copy (e.g. no **Current
   passphrase** after recovery unlock).
3. **Never upload a video of a failed run.** Discard, fix, re-record.

## The Plan Anatomy

```
## Anchors
Subject issue, Pull Request, merge-base SHA, branch name.

## What automation already proves — do not re-test
Tagged [observed] or [reconstructed], one line each, naming the suite and what it establishes.
This section exists so the reader skips it, so it must be trustworthy.

## Expected red herrings
Table of failures and noisy signals the tester WILL encounter that are not this change's fault,
each with the reason and the tracking issue. Prevents hours lost to known breakage.

## Setup
Exact commands, ports, services, and accounts needed. Assume a cold machine.
Start with `yarn qa:accounts:seed` and name the QA Account each scenario signs in as.
Include vault/crypto capture steps when scenarios need a Recovery Key other than a QA Account's.

## Scenarios
Numbered. Each carries:
  - Why only a human can prove this — one sentence, the justification for its existence
  - Steps, using real UI copy
  - Expected result
  - What a failure means — whether it blocks the merge or is a follow-up
  - If this fails, first rule out… — required when the scenario uses a Recovery Key or
    other high-entropy secret

## Sign-off checklist
One checkbox per scenario, tickable while testing.

## Stop and do not merge if
The short list of outcomes that block the merge outright, stated as observable results.

## Execution record
(Filled by Execute — absent or empty after Compose.)
Table: scenario → PASS/FAIL → artifact path or link → notes.
Issue mode: in this file. PRD mode: authoritative copy lives on the QA Plan Issue.
```

## References

- `docs/adr/0048-a-qa-plan-carries-only-what-automation-does-not-prove.md` — the decision behind
  this skill: the residue rule, the two-point coverage run, the routing split, and why no gate
  enforces it.
- `docs/adr/0059-a-qa-plan-is-composed-in-tmp-before-it-is-published.md` — why both modes compose
  in `tmp/`, and why that does not contradict ADR 0048, which decides only where a plan is
  **published**. Extends ADR 0048; supersedes nothing. Remote paste/attach is an operational
  consequence of Issue mode publishing nothing.
- `docs/adr/0041-internal-notes-have-homes.md` — why the working copy is an uncommitted file in
  `tmp/`.
- `docs/adr/0043-gates-assert-facts.md` — the gate shape this repo does not build.
- QA Artifacts: Evidence above, [Uploading QA Artifacts](../finish-standalone-runs/SKILL.md#uploading-qa-artifacts),
  and [ADR 0142](../../../docs/adr/0142-a-standalone-runs-qa-is-run-by-agents-and-reported-on-its-pull-request.md).
- Issue #827 — grill decisions that added Compose/Execute, hazards, failure classes, and Execution
  record (skill-only; no new ADR).

## Completion Criteria

### Compose

- A branch and an open Pull Request were confirmed to exist before any planning began.
- The mode was resolved from the subject issue and stated explicitly.
- Every coverage claim is tagged `[observed]` or `[reconstructed]`.
- No scenario re-tests something the coverage section says is covered.
- Every scenario states why a human is required for it.
- Steps quote UI copy read from source, not invented.
- Secret-touching scenarios include failure-class preconditions.
- Pre-existing failures appear as red herrings, never as scenarios.
- The user confirmed the draft before it was published (PRD mode) or handed over (Issue mode).
- The plan was composed in `tmp/` and was not committed.
- In PRD mode a QA Plan Issue exists and carries the plan; in Issue mode nothing was published.

### Execute

- The plan source was stated (pasted/attached path, `tmp/` path, or compose-then-execute).
- Vault/crypto hazards were obeyed when applicable.
- Every scenario has an Execution record row with PASS/FAIL and evidence.
- Defects and automatable-residue follow-ups were filed as issues (follow-ups do not block sign-off).
- QA Artifacts follow the Evidence section and its three QA lines.
- Sign-off checklist is ticked at the correct destination (QA Plan Issue vs `tmp/`).
