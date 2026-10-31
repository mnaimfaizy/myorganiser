# Outcome Check

What an agent checks on finished dispatched work before opening its Pull Request. The `finish-standalone-runs` Skill applies it to each Standalone Run's branch, and the `create-pull-request-workflow` Skill applies it to a PRD's slices. It is not a code review: the CI code review reads the diff once the Pull Request is open.

## Check

A Run Outcome is the run's own claim, so check it instead of repeating it.

1. **Outstanding items.** Read each `OUTSTANDING` item from the issue's latest handoff comment. On a PRD, include every slice held open as `ready-for-human` ([ADR 0111](../adr/0111-a-prd-slice-closes-only-on-a-clean-outcome.md)).
2. **Flagged decisions.** Note anything the commits, the comment or the run log say the agent chose on the Maintainer's behalf. Logs are in `.sandcastle/logs/` and may be gone in a later session.
3. **Named paths.** Confirm that each file or test the Run Outcome or the commits name exists at the branch tip, including a bare file name given without its directory.
4. **Local tests.** Run the affected Jest projects at the branch tip. A run's own gate result does not cover a later merge from `main`.
5. **Merge conflicts.** For a batch, run `git merge-tree --write-tree --quiet` on each branch pair, and against `origin/main`.

## Resolve

Every item ends as exactly one of these, and the Maintainer picks in one batched decision:

- **Fix on the branch.**
- **File a follow-up issue**, through the `github-issue-creation-workflow` Skill.
- **Accept**, recorded under the Pull Request's known gaps with the reason.

Finish with a recommended merge order and the reason for it. Conflicting branches go last, and work that needs the Maintainer's own review goes after work that does not.
