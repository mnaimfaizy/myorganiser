# A QA Plan's scenarios are scripted and run on the code before and after the change

## Status

accepted

Partly superseded by [ADR 0150](0150-a-screen-scenarios-qa-artifact-is-a-storyboard.md): decision 5 entirely, and what `video` and `screenshot` mean in decision 4.

Amends [ADR 0142](0142-a-standalone-runs-qa-is-run-by-agents-and-reported-on-its-pull-request.md) on how a QA session drives the app, which QA Artifacts may be uploaded, and how QA sessions start. Builds on [ADR 0048](0048-a-qa-plan-carries-only-what-automation-does-not-prove.md): its two-point coverage run now extends to the QA Plan's own scenarios.

## Context

The first Standalone Run QA under ADR 0142 (Pull Requests #1497 and #1500) showed five gaps.

- A passing scenario said nothing about whether it exercised the fix.
- A failure that `main` shares looked like a regression until someone re-ran it on the merge-base by hand.
- An API change had no QA Artifact at all.
- No run had recorded a video, because the choice was left to the runner mid-run.
- The QA sessions never started: the start came from a turn woken by a background task, which the app refuses.

The built-in browser could not load the local app either, so both plans ran as Playwright scripts.

## Decision

1. **Scenarios are scripted.** A web QA session writes a scenario script and runs it in real Chromium, then inspects every screenshot and frame it captured before trusting a result. The built-in browser is used only for judgement no script can make. It is reached through an attach configuration in `.claude/launch.json`. If it cannot load the app, the session judges from its captures, and what captures cannot show goes under Left for a person. The QA Report names the route used. Mobile plans keep the simulator and emulator.
2. **A fix runs Before and After.** Every scenario of a fix runs first on the Pull Request's merge-base, then on its head, with the same QA Account, data and viewport. The backend switches too, with migrations applied forward only. A feature runs After only, unless a scenario claims existing behaviour still works. Mobile follows the same rule, including a native rebuild when the change is native.
3. **A scenario has five results.**
   - **PASS.**
   - **FAIL: regression.** After fails where Before did not. It blocks the merge.
   - **FAIL: pre-existing.** It fails the same way on the merge-base. For a feature, the merge-base re-run happens after the failure. It always goes to the Maintainer's batched decision, and once filed it is written with its issue number and does not block.
   - **Not proven.** Before does not show the defect, or cannot run. After still runs, and the Maintainer decides whether to rewrite the scenario, accept it, or hold the Pull Request.
   - **Left for a person.** Unchanged.

   The QA Report headline is **QA passed** when every scenario passed, **QA passed, not proven or pre-existing items listed** when no scenario regressed, and **QA failed** otherwise.

4. **The plan names each scenario's QA Artifact.** Every scenario carries a `Capture:` line, fixed when the plan is composed:
   - **video** when the claim is about change over time: an ordered flow, timing, a transient state, or keyboard and focus movement
   - **screenshot** for a resting state
   - **transcript** for API residue
   - **none** when a text result says it all

   The runner always records, and keeps only what the line asks for. A failed scenario keeps its recording locally.

5. **Before and After are combined.** A screenshot pair becomes one labelled side-by-side image. A video pair becomes one side-by-side MP4 plus a GIF preview small enough to show inline. Only the combined file may be uploaded.
6. **Upload rules change.** These replace ADR 0142's "a failed run's QA Artifact stays local".
   - A Before that shows the defect is not a failed run, and may be uploaded.
   - A FAIL: regression's QA Artifact stays local.
   - A FAIL: pre-existing's may be uploaded, since it documents the filed issue.
   - Uploads stay the Maintainer's choice, none by default, and only QA Accounts may appear.
7. **An API change's QA Artifact is a Request Transcript.** It records the calls a scenario made and what came back, Before and After. Shared tooling redacts it mechanically, and the redactor refuses any field it does not recognise as safe. It goes inline in the QA Report inside a collapsed block, without an upload choice, because the Maintainer reviews the report's text before it is posted.
8. **QA sessions start from the Maintainer's turn.** Everything before the last session start runs in the foreground of the turn the Maintainer began. A start that is refused, or that falls in a later turn, such as each plan after the pilot, becomes a proposal card the Maintainer clicks. The orchestrator never runs a plan itself while separate sessions exist.
9. **Shared QA tooling is committed under `tools/qa/`, with tests.** It covers the stack, the Before and After runner, the combining, redaction and the attach configuration. A Pull Request's scenario script and the generated local environment stay uncommitted in `tmp/qa/`.

## Considered Options

- **The built-in browser as the primary driver, as ADR 0142 intended.** It cannot replay the same steps on two builds or record video, and in its first use it could not load the local app. ADR 0142 rejected scripting because a sub-agent scripts without seeing. A QA session that inspects its own captures does see.
- **Before and After only for scenarios that capture media.** A text-only scenario that passes on the merge-base proves nothing either.
- **Treating a scenario that does not reproduce on Before as PASS.** That defeats the point of running Before.
- **Committing the scenario scripts.** They would become a second, unreviewed end-to-end suite, against ADR 0048. A scenario worth keeping becomes a Playwright test through a follow-up issue.
- **Uploading Before/After QA Artifacts by default.** The repository is public, and the choice is one answer in a question already asked.
- **Starting every QA session at once and letting sessions wait on each other.** It breaks one holder per resource unless sessions coordinate among themselves.
- **Playwright trace files as API evidence.** They carry cookies and tokens.

## Consequences

- A fix's QA run takes one more build switch per plan, and a native mobile fix needs one more native build per platform.
- `qa-plan` and `finish-standalone-runs` change only when the `tools/qa/` piece they rely on lands, so neither points at a command that does not exist.
- A pre-existing failure no longer reads as a failed QA, but it is never silently passed: it always reaches the Maintainer's decision.
