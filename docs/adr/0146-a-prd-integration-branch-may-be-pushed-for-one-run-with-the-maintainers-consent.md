# A PRD's integration branch may be pushed for one run with the Maintainer's consent

## Status

accepted. Amends [0010](0010-sandcastle-local-only-integration.md).

## Context

[ADR 0010](0010-sandcastle-local-only-integration.md) keeps `feat/<prd-slug>` local and never pushed. The integrated work lives only on the Maintainer's machine until the PRD's one Pull Request.

The `orchestrate` Skill ([ADR 0145](0145-a-chief-of-staff-owns-the-plan-and-the-human-channel-and-never-builds.md)) can hand a slice to a cloud Executor. Every cloud Executor documented on 2026-11-11 works from a clone of the remote: Claude cloud sessions, Cursor cloud agents and the Copilot cloud agent. None of them can see a local branch.

## Decision

`feat/<prd-slug>` stays local by default. A Chief of Staff may push it only after the Maintainer says yes to a Decision Request for that run. The request names the slice, and the cloud Executor that needs the branch. The consent covers that run and that branch only.

Everything else in ADR 0010 stands:

- slices are cut from the live feature head;
- slices integrate in plan order;
- the PRD reaches `main` through one Pull Request.

## Considered Options

- **Exclude cloud Executors from PRD slices.** Simple, but it rules out a whole class of Executor even when the Maintainer would accept a pushed branch.
- **Always push the integration branch.** Gives up ADR 0010's "nothing reaches origin until a human pushes" without asking.

## Consequences

- A pushed `feat/<prd-slug>` is visible on the public remote, and it stays there until it is deleted after the PRD merges.
- `dispatch-agents` is unchanged. It still never pushes.
