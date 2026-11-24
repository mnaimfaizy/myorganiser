# Unattended Codex runs use reviewed guard hooks

## Status

accepted

## Context

A Sandcastle Standalone Run or PRD Slice can edit the repo hooks that govern the agent. Codex skips changed project hook definitions until they are reviewed and trusted. If a run takes its guard hooks from the worktree it can edit, a change to a definition or to a script it invokes can change the enforcement during that run. [Codex hook trust](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks)

## Decision

Sandcastle uses a maintainer-reviewed snapshot of the Codex guard hook definitions and the code they invoke. It selects the snapshot before launch, keeps it outside the agent's writable workspace, and uses it for the whole run, including a resume after a quota wait. If Sandcastle cannot confirm that the reviewed hooks will run, dispatch stops before starting Codex.

Work that changes a guard hook tests the proposed version separately. The change becomes eligible to govern later runs after maintainer review. Interactive Codex sessions use Codex's normal hook review and trust flow. The existing rule for [headless refusals](0099-a-project-ask-rule-is-a-refusal-in-a-headless-run.md) still applies.
