# Pull Requests receive Surface Labels only

Issue Orchestration Labels (ADR 0002) are a machine contract for Issues and `dispatch-agents`. Copying them onto Pull Requests would mark a merged PR as `ready-for-agent`. Pull Requests get Surface Labels — a human kind/area taxonomy inferred from the diff — and the runner refuses anything else.

## Status

accepted

## Decision

- **Two vocabularies.** Issue Orchestration Labels stay on Issues. Surface Labels name kind (`bug`, `security`, `enhancement`, `documentation`, `tooling`, `maintenance`, `dependencies`, `research`, `qa`) and area (`backend`, `web-app`, `mobile-app`, `github-actions`). Issues may wear both. Pull Requests wear Surface Labels only.
- **One catalog.** `tools/config/github-labels.json` is the source of truth. `create-labels.ts` provisions both vocabularies. PrAuthor, IssueCreator, `ai:create-pr`, and branch-naming docs point at that file; they do not keep a third list. Do not add `frontend` or `database`.
- **How a PR is labelled.** PrAuthor infers from the combined diff (linked-issue Surface Labels are hints, kept only if the diff still justifies them). Stingy: typically one kind plus the areas the diff actually touches. Output `LABELS: a,b` after `TITLE:`. The main agent passes repeatable `--label` into `yarn ai:create-pr`. Default is unlabeled: omit `LABELS:` and pass no `--label`.
- **Runner.** `create-pr.ts` enforces the Surface Label allowlist. Names missing from GitHub, names not on the allowlist, and Issue Orchestration Labels all fail closed. On reuse, sync Surface Labels to the draft; leave non-allowlist labels (for example `needs-e2e-review`) untouched.
- **Out of scope for this decision.** `to-prd` / `to-issues` do not stamp Surface Labels. PrAuthor does not apply `needs-e2e-review` or `wayfinder:*`. No GitHub Actions auto-labeler.

## Considered Options

- **Copy linked-issue labels onto the PR** — rejected. A Slice Issue’s `ready-for-agent` / `type:afk` / `gate:*` labels are meaningless on a PR, and a sandcastle feature PR would inherit a union of every slice’s orchestration labels.
- **Extend ADR 0002** — rejected. 0002 answers how agents find work. This answers what humans (and `ai:create-pr`) may put on a Pull Request.
- **Existence-only checks** (`gh` accepts any label that exists on the repo) — rejected. `ready-for-agent` exists; the runner must still refuse it on a PR.
- **Fail if PrAuthor infers nothing** — rejected. That blocks PR creation for an awkward diff. Unlabeled is valid.

## Consequences

- Renaming or adding a Surface Label is a catalog change in `tools/config/github-labels.json`, then `yarn ai:create-labels`, then re-labelling. Do not teach agents a parallel list.
- `needs-e2e-review` may still be applied in the GitHub UI. `ai:create-pr` will not add it and will not strip it on reuse.
- Glossary: [CONTEXT.md](../../CONTEXT.md) — Issue Orchestration Label, Surface Label.
- Orchestration vocabulary remains [ADR 0002](0002-agent-orchestration-label-vocabulary.md).
