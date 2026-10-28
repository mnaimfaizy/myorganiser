# An Upstream Brief is anchored to what is installed and accepted on checked evidence

## Status

accepted

Supersedes [ADR 0018](0018-upstream-brief-portable-instruction-audit.md).

## Context

ADR 0018 created the Upstream Brief. Three briefs have run since — Next.js (2026-08-16), Nx
(2026-08-21), React Native (2026-08-24) — and every one produced work that landed (#359; #420 → #424;
#500 → #737, #739). The skill finds real drift. What it cannot do is show that its output is right,
stay inside its own scope, or remember a previous run.

- **"Target version" meant three things.** `next@16` named a major while the repo sat at 16.2.6 and
  the fetched docs were 16.3.1. `nx@22.7.7` named a version already installed. `react-native@0.79.3`
  named the current version, and fifteen unrelated libraries were given the target "0.79.3 line".
  Meanwhile the guardrail required every source to describe "the named target version", which no
  Future-risk finding can satisfy: the Nx brief cited the Nx 23 notes, the React Native brief the 0.80
  notes. The rule and the finding type contradicted each other and no run noticed.
- **Current versions came from a document that drifts.** The adapter read `TECH_STACK.md`, which
  recorded Nx at 22.3.3 while `package.json` pinned 22.7.7, and which omits `@nx/eslint-plugin` — so an
  installed package failed closed.
- **The unit was a package, but upstreams release in trains.** Nx arrived as 17 subjects and React
  Native as 16. One worker per subject was never going to run.
- **Nothing accepted or rejected a claim.** The Nx brief carries two Correction blocks for three wrong
  claims: absence from the CLI reference read as removal, 22 executor targets that were 54, and a
  rename called deliberate that was not. Citations were paraphrased in one brief and quoted in another;
  local evidence cited `file:line` with no commit, inside a document frozen at its date. Code review had
  already solved the same problem ([ADR 0071](0071-a-finding-blocks-only-on-evidence-and-a-verdict-is-computed-never-written.md),
  [ADR 0078](0078-a-citation-that-does-not-match-its-source-is-a-fact-about-the-pipeline.md)).
- **Scope leaked.** The React Native brief recorded undeclared transitive dependencies and a stale
  mobile manifest — real defects that no upstream statement grounds. "Follow-on" became a catch-all.
- **Coverage was unauditable and runs were amnesic.** Workers read docs and sampled the repo, so an
  instruction nobody checked stayed invisible (`@nx/nest`, "The repo uses Nx 22"), and "none in scanned
  files" named no scanned files. Two briefs invented a "checked and clear" section the template lacked.
  An Nx plan item asked to "record the reasoning so the next audit does not re-derive it"; the skill
  reads no earlier brief.
- **The issue map was wrong.** `quality → qa` put `qa` on #359, a label
  [ADR 0049](0049-qa-and-grilling-are-orchestration-labels.md) reserves for QA Plan Issues.

## Decision

1. **Baseline and Horizon replace the target.** An Upstream Brief is anchored to each Ecosystem's
   **Baseline** — the version actually installed, read from the lockfile or installed packages, never
   from a document that records versions and never from a declared range. The human may name a
   **Horizon** to look ahead. Mismatch and Missed improvement cite documents matching the Baseline;
   Future-risk cites documents between Baseline and Horizon, or, with no Horizon, only deprecation and
   removal statements in the Baseline's own documents. Documentation a package ships for its own
   version outranks the website. The skill still never decides what "latest" is. A `TECH_STACK.md` that
   disagrees with the Baseline is a preflight note routed to DepSync, never a plan item.
2. **The unit is an Ecosystem.** A lead package plus the companions its upstream releases or defines
   compatibility against, discovered by prefix or declared in the adapter. The run lists each
   Ecosystem's members and asks once before research starts. One research worker per Ecosystem.
3. **Workers write structured Upstream Findings, and a validator accepts them before anything is
   rendered.** Each carries a URL, a verbatim quote, the version the page states, an urgency, and
   Evidence of kind `cited`, `executed`, `inferred`, or `absent` — the last meaning the matching
   documents were read and do not say it, which on its own never proves the repo wrong. Local evidence
   is `file` + `line` + literal text, checked against the commit the brief records. A finding the
   validator rejects moves to an **Unverified** list with the reason; the rest of the report stands.
   Re-fetching each URL to confirm its quote is an optional, advisory flag.
4. **A skeptic hop tries to disprove every `absent` or `inferred` finding** before the brief is written,
   by running the command, reading the installed types, or re-reading the page. A disproved finding is
   dropped and logged as checked and clear. `cited` findings are already checked by the validator.
5. **Urgency is `broken-now`, `removal-scheduled`, `deprecated`, or `advisory`, and orders the plan.**
   `broken-now` requires `executed` Evidence or is downgraded. `executed` Evidence may come only from
   commands that write no tracked file and install nothing; the brief records each command and its exit
   code. This is stated, not mechanically enforced.
6. **The audit runs in both directions.** Workers still read upstream documents for what changed, and
   also inventory every **Instruction Claim** the instruction globs make about the Ecosystem — commands,
   APIs, file conventions, version literals. Each ends as an Upstream Finding or as checked and clear,
   which is a template section, and the brief lists what it scanned.
7. **A finding needs an upstream statement.** A local defect no upstream statement grounds is an
   **Incidental Observation**: recorded in its own section, routed to its owner (DepAudit, Audit, or an
   ad-hoc issue), not counted, and never in the plan. Follow-on keeps its meaning — upstream-grounded
   application-code and vendor-skill items.
8. **At most three Upstream Opportunities per Ecosystem.** A technique the upstream documents, or an
   alternative the upstream itself names, that would improve code quality or performance where nothing
   is wrong today. It must be adoptable at the Baseline, or by the Horizon with its minimum version
   stated; it must name at least one local site, checked like any local evidence; and its benefit is the
   upstream's quoted statement, never an estimate. Zero is allowed and says what was considered.
9. **The proposed plan may touch** Instruction Files, Skills, hygiene and test scripts, commands an
   instruction teaches (the script definition behind them), and the adapter config. Nothing else.
10. **The structured report is committed beside the Markdown brief** in the brief directory, and a Wired
    Gate re-validates every committed report offline. Because local evidence is checked at the recorded
    commit, a frozen brief stays valid. The validator ships inside the skill directory as a
    dependency-free Node script; this repo wires it through a thin `tools/scripts/check-upstream-briefs.ts`
    so the Meta-Gate sees it.
11. **The latest committed report per Ecosystem is the ledger.** A new run reads it: a checked-and-clear
    claim whose recorded version range still covers the new Baseline, and whose quoted instruction text
    is unchanged, is carried forward without new research. The brief opens with a delta — new findings,
    earlier findings resolved, earlier findings still present. Frozen briefs are read, never edited.
12. **Declined Opportunities are remembered in the adapter** under `declined_opportunities`: identity
    (Ecosystem, upstream URL, local site path), a one-line reason, and the Baseline range declined at. An
    entry resurfaces only when the Baseline leaves that range or the upstream quote changes. The
    validator fails an entry whose Ecosystem or path no longer exists.
13. **Any Upstream Finding or Upstream Opportunity proposes one HITL issue**, filed only on confirm, with
    the labels `research` and `type:hitl`. The `quality` role is removed from the issue map.
14. **The dependency-sync hook suggests a run** when an Ecosystem's new Baseline leaves the range its
    latest brief recorded. It prints a line and never invokes the skill.

Retained from ADR 0018: one user-invoked, portable skill with a defaultable adapter; primary upstream
sources only; the brief applies nothing; installed vendor skills are never edited; no `dependencies`
role and no `ready-for-agent`; the human, not the skill, starts the grill; a failed hop still yields a
partial brief. It remains not an upgrade plan, not DepAudit, and not DepSync.

## Considered Options

- **Keep one target and define it better** — rejected. Any single version either forbids Future-risk
  or licenses sources the repo cannot use; the three runs each resolved the ambiguity differently.
- **Keep reading current versions from `TECH_STACK.md`** — rejected. It is a record of versions that
  DepSync maintains, and it had already drifted in the run that relied on it.
- **Free Markdown with stricter prose rules** — rejected. The Nx corrections were written by a careful
  run under the existing rules; a claim is checkable only if something checks it.
- **Reject the whole report on one invalid finding**, as code review does — rejected. Code review
  computes a verdict that one bad finding corrupts. A brief has no verdict, and losing an Ecosystem's
  valid findings to one bad citation costs more than listing the bad one as unverified.
- **Send validator errors back to the worker for a retry** — rejected. It opens the loop an Orchestrator
  Patch declines to open, for a report that already records what failed.
- **Validate at write time only and commit Markdown alone** — rejected. The brief would stop being
  checkable the moment the session ended, and a later run would have nothing structured to carry forward.
- **Put the validator in `tools/scripts/`** — rejected. It makes the skill unportable, which ADR 0018
  exists to prevent.
- **A living Instruction Claim Ledger** outside the brief directory — rejected. It restates what the
  instructions say, needs its own gate against drift, and the committed reports already hold the same
  claims with their citations.
- **Opportunities from anywhere, at any version** — rejected. A swap no upstream recommends has no
  primary source for "better", and "latest" is the guess ADR 0018 rejected and the Horizon replaces.
- **A quota of Opportunities per Ecosystem** — rejected. A quota fills quiet runs with suggestions nobody
  acts on, which cost the same attention whether or not they are right
  ([ADR 0079](0079-an-effective-false-positive-is-a-finding-nobody-acted-on.md)).
- **Measure precision now** — deferred. Three briefs and roughly twenty-five findings make a rate noise;
  the delta's "still present" count is the signal until there are about ten briefs.

## Consequences

- `CONTEXT.md` defines Ecosystem, Baseline, Horizon, Upstream Finding, Upstream Opportunity, Instruction
  Claim, and Incidental Observation, and extends Evidence with `absent`. "Subject" and "target" are no
  longer the skill's vocabulary.
- The invocation changes shape: an Ecosystem, optionally with a Horizon, instead of `subject@version`.
- `upstream-brief.config.yml` loses `current_versions.path` as a version source and `labels.quality`,
  and gains Ecosystem declarations and `declined_opportunities`.
- The three existing briefs predate the structured report and are not migrated. The first run per
  Ecosystem under this ADR has no ledger to carry forward and starts a fresh delta.
- `gates:run` and the Meta-Gate gain one checker. A brief directory with no structured reports passes.
- The checker re-validates every `*.json` at the top level of each brief directory, not a single named
  file, because a report that escaped the gate through a typo'd filename is the failure the Meta-Gate
  exists to prevent one level down — a name check would have to be perfect to make that the safe
  choice, and a directory scan does not need to be.
- It exits 1 on an invalid report, local evidence that no longer matches, or a declined entry pointing
  at nothing, and exits 2 on a recorded commit this clone does not have. The two are told apart
  deliberately: `git show` fails identically for a missing path and for an unresolvable ref, so a
  shallow clone would otherwise report every citation in the brief as a fabrication instead of as
  unverifiable.
