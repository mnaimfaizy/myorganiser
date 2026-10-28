# Local Skills

This directory holds repo-local skills for MyOrganiser.

Committed first wave:

- `vault-feature-workflow`
- `backend-api-contract-change`
- `frontend-page-library-workflow`
- `release-and-deploy-workflow`

Committed second wave:

- `auth-session-workflow`
- `playwright-e2e-workflow`
- `youtube-integration-workflow`
- `prisma-migration-workflow`

Committed third wave:

- `nx-monorepo-workflow`

Committed fourth wave:

- `commit-change-workflow`
- `create-pull-request-workflow`

Committed fifth wave:

- `github-issue-creation-workflow`

Committed sixth wave:

- `unit-test-delegation-workflow`

Committed seventh wave:

- `prototype` (later returned upstream — now an Upstream-Owned Skill; see ADR 0030)
- `handoff` (later returned upstream — now an Upstream-Owned Skill; see ADR 0030)
- `ask-matt` (adapted from `mattpocock/skills`, tweaked for MyOrganiser routing)

Committed eighth wave:

- `my-triage` (adapted from Matt Pocock's `triage` in `mattpocock/skills`, with MyOrganiser's triage flow and dispatch contract)

Committed ninth wave:

- `implement` (adapted from `mattpocock/skills`, with MyOrganiser delegation, validation, and commit/PR conventions)
- `code-review` (adapted from `mattpocock/skills`, with MyOrganiser standards sources and GitHub issue fetching)

Committed tenth wave:

- `create-hooks` (multi-harness Copilot / Cursor / Claude agent hooks)

Committed eleventh wave:

- `component-builder` (ComponentBuilder → ComponentReviewer; Structured Spec lives here, not in `AGENTS.md`)

These skills capture project-specific workflows that are easy for agents to miss even after reading the general repo instructions.

Note: these are VS Code workspace skills stored in `.agents/skills`. They are intended for agent discovery inside the editor. They may not appear in `npx skills list`, which focuses on skills installed through the `skills` CLI.

Third-party skills come in two scopes, and the scope decides everything (ADR 0030).

**Project scope** installs into this directory and is committed — an **Upstream-Owned Skill**. Never hand-edit one; refresh it with `npx skills update -p` and commit the diff. `skills-lock.json` is the registry, and `yarn skills:map:check` reads it to tell upstream-owned directories from repo-native ones. Four skills are in this tier: `codebase-design`, `handoff`, `modern-web-guidance`, `prototype`.

**Personal scope** is no longer approved. A skill on one developer's machine cannot be updated, reviewed, or vouched for by this repo, and the thirteen personal-scope recommendations went four months with nobody installing any of them while two died upstream (ADR 0032). For fast-moving framework knowledge, run `upstream-brief` — it audits repo-owned instructions against official docs for the Ecosystems you name, anchored to what is installed, and keeps the result here, under review.

See `EXTERNAL_SKILLS.md` for the approved set.

See `EXTERNAL_SKILLS.md` for the approved project-scope third-party skill set.
