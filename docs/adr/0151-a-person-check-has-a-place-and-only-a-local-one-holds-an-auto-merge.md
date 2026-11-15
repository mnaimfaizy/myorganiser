# A Person Check has a Place, and only a `local` one holds an Auto-merge

## Status

accepted

Amends [ADR 0148](0148-the-merge-train-auto-merges-only-on-facts-it-reads-for-the-head-it-merges.md) decision 3 (the QA Report fact) and decision 7 (the QA Report's fixed form). Builds on [ADR 0048](0048-a-qa-plan-carries-only-what-automation-does-not-prove.md), [ADR 0142](0142-a-standalone-runs-qa-is-run-by-agents-and-reported-on-its-pull-request.md) ("an agent never marks them passed") and [ADR 0147](0147-a-qa-plans-scenarios-are-scripted-and-run-on-the-code-before-and-after-the-change.md). Later slices of PRD #1585 implement the parts marked below and cite this ADR; amending ADR 0142 for the continuous run is a separate change.

## Context

A QA Report lists what it leaves for a person. ADR 0148 made every such item hold an Auto-merge. But some items can only be made on Staging, or in Production after a Release, so they can never be made before merge. In the 2026-11-15 batch, three of the four held Pull Requests were held only by checks that needed Staging. Once a Pull Request merges, such a check sits in a closed Pull Request's comment and is lost.

## Decision

1. **Every Person Check names one Place: `local`, `staging` or `production`.** The QA Plan picks it, the QA Report carries it, and the Maintainer may change it in the batched decision before the report is posted. See `CONTEXT.md` for **Person Check** and **Sign-off Issue**.
2. **The QA Report header gains an optional deferred count**, and the lines under "Left for a person" gain a Place:

   ```
   QA Report: result=passed|failed; commit=<40-hex>; left-for-person=<local n>; deferred=<staging+production n>
   ```

   `no manual QA needed; commit=<40-hex>` is unchanged. Under the `### Left for a person` heading each Person Check is **one top-level list item** in exactly this grammar:

   ```
   - [<place>] <text>
   ```

   `<place>` is `local`, `staging` or `production`, lowercase, in square brackets; there is a single space after the dash, and a single space after the bracket; `<text>` is non-blank. This is the contract the Merge Train reads and later renders from. It is read by **allow-list**: a top-level list item (`-`, `*`, `+` or numbered, in column 0) under the heading that is not exactly this form makes the whole report unparseable. Any indented line is a continuation and is ignored, as are lines inside code fences and non-list prose (so `None.` is fine when both counts are 0). The section ends at the next heading; a second `### Left for a person` heading is unparseable. A missing section is no checks.

3. **The counts must equal the lines**: `left-for-person` is the number of `local` lines and `deferred` is the number of `staging` plus `production` lines. A mismatch is unparseable, and an unparseable report holds the merge, as under ADR 0148.
4. **A header without `deferred=` is a legacy header**: every counted check is `local`, the lines are not read (they carry no Place), and the parsed check list is empty. An old report therefore never lets an unchecked item merge, and nothing deferred is copied from it.
5. **The Auto-merge hold narrows.** The QA Report row of ADR 0148 decision 3 reads "no `local` Person Check left for a person". `left-for-person > 0` holds; a `deferred` count never holds. The plain train still reads no QA Report, and a merge the Maintainer starts stays unblocked by Person Checks (ADR 0048, ADR 0148).
6. **The train adds the rest at an actual merge** _(implemented by a later slice)_. When the Merge Train actually merges a Pull Request, from the shared merge path, it adds that Pull Request's `staging` and `production` Person Checks to the one open Sign-off Issue (found by the `qa` label and a fixed marker), as checkboxes with links to the Pull Request and its QA Report. A `shadow` pass adds nothing. Lines are keyed by Pull Request and check so a re-run never adds one twice; the issue is created when first needed; a failed write is reported in the train's result alongside the existing comment failures and does not undo the merge.
7. **The Sign-off Issue freezes at the Cut** _(later slice)_. `release:cut` retitles the open issue with the version and freezes it; later merges open a fresh one. Unfinished checks of a Cut that never deploys are carried into the next issue.
8. **The production deploy is gated**. A step in `dispatch-production-deploy.yml` refuses while any of the Cut's `staging` checks is neither ticked nor waived, naming each; the workflow gains `issues: read`, and the deploy-pipeline checker pins the step so removing it fails CI. The issue closes once every `production` check is ticked or waived after the Release.
9. **Only the Maintainer signs off.** Ticks and waivers count only from the Maintainer's login (OWNER association); those from any other login are ignored. A waiver is a comment `waive: <check> — <reason>`; one without a reason does not count. An agent never ticks a Person Check or writes a waiver, which keeps ADR 0142's rule across environments. A Person Check that fails on Staging is filed as its own bug, linked from the check, and the check holds the deploy until ticked or waived.

## Considered Options

- **Read the Place by deny-list** (anything not recognised as deferred counts as `local`). Rejected: a report is untrusted text, and a typo such as `[Staging]` would silently change what holds. The allow-list errs toward holding.
- **Infer the Place from the check's prose.** Rejected for the same reason: the train would act on a model's reading of prose.
- **Keep holding on every item.** Rejected: checks that cannot be made before merge hold merges they can never unblock.
- **Drop deferred checks.** Rejected: they would be lost in a closed Pull Request.

## Consequences

- An auto-merge is held only by checks that can be made before merge; `staging` and `production` checks reach the Sign-off Issue instead of blocking.
- The QA Report header and line grammar are a contract: the train's parser and the Sign-off Issue's renderer share it, and the `finish-standalone-runs` Skill defines it once, and `qa-plan` links to it for the grammar.
- A report written before this change holds exactly as before.
- GitHub cannot update an issue body only if it is unchanged, so a tick made in the second before the train writes the Sign-off Issue can be lost; two open Sign-off Issues are reported and written to neither, never combined.
- The production gate (decision 8) trusts a tick only when the issue's edit history shows the owner's login made it, and a waiver only from a never-edited, not-minimised owner comment every line of which is `waive: <pr>:<key> — <reason>`, `<pr>:<key>` being the check line's id and the dash an em dash, en dash, `--` or `-`. It finds the Cut's issue by a frozen line the owner wrote in any revision, and with none holds on any unfrozen Sign-off Issue's open `staging` checks, open or closed; a check that was `staging` in any revision stays `staging`, a removed line holds until waived, and a history it cannot read whole holds the deploy. Trust is by login, and the Merge Train and an agent acting for the Maintainer write as that login too, so provenance cannot tell them apart: "an agent never ticks" is enforced by the train's insert-only write never flipping a box, and by the rule itself, not by the gate. Removing the `qa` label or the marker from the Cut's issue hides it from the gate; that is a visible edit, and accepted. Edits are ordered as GitHub lists them, checked against their one-second `editedAt`, so two edits in the same second are trusted to come back in the order they were made. A history the gate cannot read holds every deploy and cannot be repaired; the Maintainer's way out is to close the issue and remove its `qa` label after checking it by hand.
- The gate runs only in the dispatcher. The Maintainer can still dispatch `Deploy Production (manual)` directly, the way a merge they start stays unblocked; it is their escape hatch, and an agent never takes it.
- The close in decision 8 reads "after the Release" as the Release's tag being on `origin` and the issue being frozen for that version, not as a time on each tick, so `release:signoff-close` closes only then; it also waits for any `staging` check still open, since only a deploy past the gate or the Maintainer's escape hatch can leave one and a sign-off must not be closed over it. An earlier issue whose checks the Cut carried forward stays open with a comment saying where they went, and only the owner's unedited comment counts as that marker. Closing is a command the Maintainer runs after each tick or waiver, not an automatic step, and a Cut run again after it froze (before its push) finds its issue already frozen for that version and writes nothing.
