# CI/CD and release process

This repo uses GitHub Actions for CI/CD.

## Repository name

The repository is `mnaimfaizy/myorganiser`. It was renamed from the old "-izer" spelling, and GitHub redirects the old slug's web URLs, issue links, Release downloads and git remotes to it.

**Never create a repository with the old spelling on this account.** A new repository at the old slug takes over those redirects, and every old link and remote would then point at it. See [ADR 0132](../adr/0132-one-product-name-aligned-while-there-were-no-users.md).

## Runner image

Every job sets `runs-on: ubuntu-24.04` (`yarn runner-image:check`). The floating `ubuntu-latest` label begins moving from Ubuntu 24.04 to Ubuntu 26.04 on 2026-10-19 and finishes by 2026-11-19 ([actions/runner-images#14748](https://github.com/actions/runner-images/issues/14748)). During that window the label is not one image, so the workflows pin the image they already run on.

Ubuntu 26.04 is not a drop-in replacement for this repo yet. `@playwright/test` is 1.57.0, and Playwright cannot install browser dependencies on Ubuntu 26.04 before 1.61 ([microsoft/playwright#40117](https://github.com/microsoft/playwright/issues/40117)). The e2e jobs in `ci.yml` and `nightly-e2e.yml` run `playwright install --with-deps`, so they would fail on the new image. The 26.04 image already has Docker, so the `postgres:16` service containers still start, and the OpenSSH client, so the deploy SSH steps still have a client. `ci.yml` installs Java 21 with `actions/setup-java` and does not use the image's default JDK. Code review and golden replay set `DATABASE_URL` so Prisma can load its config; both images ship PostgreSQL with the service disabled, and neither workflow starts it.

Move the pin to `ubuntu-26.04` only after Playwright supports that image, and before GitHub retires the `ubuntu-24.04` label.

## Branch strategy

- `main`
  - CI runs on every push.
  - **Staging** deploys from `main` once a day, and on a manual dispatch — not on every push ([ADR 0128](../adr/0128-the-web-app-is-hosted-on-the-same-site-as-its-api-and-staging-deploys-daily.md)).
    - The scheduled run deploys the newest `main` commit whose CI is green.
    - Web app and backend both go to **cPanel** via FTP/FTPS, on the same site.

- `release/*`
  - CI runs on every push.
  - A production deploy **run** starts automatically when the branch is created (see `dispatch-production-deploy.yml`), and can also be started by hand.
  - **No production deploy proceeds without approval.** The `production` Environment carries a required-reviewer rule, so every run pauses until a maintainer approves it. The approval — not the dispatch — is the ship decision. See [ADR 0028](../adr/0028-production-deploys-are-approval-gated-and-tags-are-receipts.md).
  - Both frontend and backend are deployed to **cPanel shared hosting** via FTP/FTPS.

## Workflows

- `.github/workflows/ci.yml` (name: `CI`)
  - **Lint and test.** A pull request runs `nx affected`; a push runs `nx run-many` over the whole tree, so the commit a release is cut from is linted and tested whole. It is not a per-commit guarantee — see `cancel-in-progress` below.
  - **The builds.** `build-backend` and `build-mobile` each run one `nx build <project>` and are selected by `needs.setup.outputs.affected_projects`, on a push as well as on a pull request — a push that affects none of them builds none of them. `build-frontend` only runs on a push, not a pull request: each E2E shard already runs `nx build web` itself, since `web-e2e` depends on `web` (issue #1396).
  - **Build Storybook** runs `yarn build-storybook` on every run, so a story that no longer compiles fails CI. Play functions (`test-storybook`) are not run in CI. See [ADR 0139](../adr/0139-chromatic-is-retired-storybooks-ci-checks-stand-alone.md).
  - Triggers on PRs to `main` / `release/*` and on pushes to `main` / `release/*`.
  - **Caching.** Two caches, both `actions/cache` with no write mode and no `pull_request_target` anywhere: the dependency cache (`<os>-node-22-deps-<lockfile digest>`, restored by exact key) and the Nx computation cache (`<os>-nx-22-<target>-<commit>`, restored through a `<os>-nx-22-<target>-` prefix). A pull request writes only into its own `refs/pull/<n>/merge` scope and reads `main`'s as a fallback, which is GitHub's own scoping and not something the workflow arranges.
  - **`cancel-in-progress` is on for every ref except `main`.** A cancelled run saves no cache — `actions/cache` writes in a job's post step — so a `main` that cancelled itself under a burst of merges left pull requests restoring from an old Cache Baseline. What it buys is that a `main` run already under way always finishes and saves its full baseline; GitHub still keeps only one run pending per concurrency group, so a third push cancels the run queued behind the one in progress and that commit is covered by the next run rather than by its own. Superseded entries are pruned afterwards by `cache-cleanup.yml` instead.

- `.github/workflows/cache-cleanup.yml` (name: `Cache Cleanup`)
  - Deletes the Actions cache entries nothing can restore from, so the repository stays under GitHub's 10 GB cache limit (past which useful entries are evicted within days).
  - Fires on `pull_request: closed` (that pull request's whole `refs/pull/<n>/merge` scope), on `workflow_run` when `CI` completes on `main` (the superseded dependency keys and the superseded Nx baseline for each target), and on `workflow_dispatch` with a `dry_run` input.
  - Selection is pure in `tools/scripts/lib/actions-cache-cleanup.ts` and never selects the newest entry of a Cache Family; `tools/scripts/ci/prune-actions-caches.ts` lists, deletes and reports. A read-only token — a fork's or Dependabot's on a closed pull request — is a warning, not a failure, because `pull_request_target` is deliberately not used.

- `.github/workflows/deploy-staging.yml` (name: `Deploy Staging`)
  - Runs on a daily schedule (`0 16 * * *`, 16:00 UTC) and on `workflow_dispatch`. It does not run after `CI` or on a push.
  - `select` picks the commit every later job checks out. A dispatch deploys the commit it was dispatched at. A scheduled run takes the newest `main` commit whose `CI` run is green and deploys it, unless it stops or fails first. It stops green when there is no such commit, when the commit predates the Staging web deploy, when the Staging web app already serves it, or when the web app or the backend holds a newer commit that a dispatch put there (the schedule never rolls Staging back). It **fails** when the Staging web address does not answer (or `WEB_ORIGIN` is unset), when Staging serves the commit but `/sw.js` lacks its two headers, when an earlier run already uploaded the commit but the web app is not serving it, or when the Actions API cannot be read. Nothing is uploaded on a stop or a failure. See [Web app on cPanel](CPANEL_WEB_HOSTING.md#how-a-staging-deploy-goes-live).
  - Packages backend via `yarn package:backend:api` and uploads `dist/deploy/backend-api/`.
  - `host-apply` runs on a dispatch only — see [Host Apply](#host-apply-staging--production).
  - `deploy-frontend` packages the web app via `yarn package:web`, uploads `dist/deploy/web/`, restarts the app by uploading `tmp/restart.txt`, and probes the running build — see [Web app on cPanel](CPANEL_WEB_HOSTING.md#how-a-staging-deploy-goes-live).

- `.github/workflows/deploy-production.yml` (name: `Deploy Production (manual)`)
  - `workflow_dispatch` only — started either by a person or by `dispatch-production-deploy.yml`.
  - Guarded so it only runs when the selected branch is `release/*`.
  - `deploy-backend` and `deploy-frontend` declare `environment: production`, so the run **pauses for required-reviewer approval** before either touches production.
  - Packages backend + frontend and uploads:
    - `dist/deploy/backend-api/`
    - `dist/deploy/web/`
  - `mark-feedback-release` runs last, after **both** `host-apply` and `deploy-frontend` succeed, and is skipped on an `apply_only` run. It marks the Feedback Reports this Release fixes — see [Release marking](#release-marking-production).

- `.github/workflows/dispatch-production-deploy.yml` (name: `Dispatch Production Deploy (latest release)`)
  - Fires on `create` of a `release/vX.Y.Z` branch, and on manual dispatch.
  - Finds the newest `release/v*` branch and dispatches `Deploy Production (manual)` against it. It does not deploy anything itself — the name says dispatch for that reason.
  - Because it fires on branch creation, the approval prompt can appear **before** CI has finished on the release branch. Check CI before approving.

- `.github/workflows/release-pr.yml` (name: `Release PR (auto)`)
  - Fires on push to `release/v*` and opens (or updates) a PR from `release/vX.Y.Z` → `main`.
  - Attempts to enable auto-merge on that PR; warns and continues if repository settings disallow it.

- `.github/workflows/publish-github-release.yml` (name: `Publish GitHub Release`)
  - Fires on push of a `v*.*.*` tag, or manual dispatch with a `tag` input.
  - Creates or updates the GitHub Release using the tagged commit's `RELEASE_NOTES.md` as the body. Idempotent.
  - Builds the standalone Escape Copy reader from the tagged commit (`yarn escape-copy-reader:build`) and attaches `myorganiser-escape-copy-reader.html` and `SHA256SUMS.txt` to the release, replacing either asset if it is already there. The reader on a release is therefore the reader that release's exporter produces envelopes for ([ADR 0064](../adr/0064-an-escape-copy-is-opened-by-a-tool-that-needs-nothing-of-ours.md), [feature doc](../features/escape-copy-reader.md)).

## Required GitHub secrets

Configure these in GitHub:

- At the **repository** level, define shared secrets used across all workflows (for example, build or tooling tokens).
- At the **environment** level, define deployment-specific secrets used only for that environment.

The exact secrets required for each environment are documented in the sections below:

- **Repository (CI tooling)**
- **Staging (main)**
- **Production (release/\*)**

### Repository (CI tooling)

These are **repository** secrets (Settings → Secrets and variables → Actions), not environment secrets. They are not staging vs production.

None at present.

## GitHub Environments

This repo uses two GitHub **Environments**:

- `staging`
- `production`

The deploy workflows are already configured to use them:

- Staging workflow uses `environment: staging`.
- Production workflow uses `environment: production`.

Why this matters:

- Staging and production keep **different secrets**.
- `production` carries **environment protection rules** — a branch policy and a required reviewer — which is what gates the deploy.

### How to create the environments

In GitHub:

1. Repo → **Settings** → **Environments**
2. Create environment: `staging`
3. Create environment: `production`

### Environment rules: restrict deployment branches

To avoid accidental deployments, configure **deployment branch rules** per environment.

In GitHub:

1. Repo → **Settings** → **Environments** → select `staging`
2. Find **Deployment branches**
3. Restrict deployments to `main`

Then:

1. Repo → **Settings** → **Environments** → select `production`
2. Find **Deployment branches**
3. Restrict deployments to branches matching `release/*`

This matches how the workflows are intended to be used:

- `Deploy Staging` runs for `main` (the schedule always runs there; dispatch it from `main`)
- `Deploy Production (manual)` should only be run from `release/*`

Required (already configured):

- `production` has a **required reviewer**. This is the ship gate — see the next section. Do not remove it.

### Manual approval (required reviewers)

**This is configured, and it is the only thing that makes production deploys manual.** Anything may
_start_ a production run — a person, or `dispatch-production-deploy.yml` on branch creation — but no
run reaches production without a human approving it here.

Behavior:

- When `Deploy Production (manual)` reaches `deploy-backend` or `deploy-frontend` (both declare `environment: production`), GitHub pauses and requires approval.
- Only after approval is granted does the job proceed to deploy.

Verify it is still in place:

```sh
gh api repos/mnaimfaizy/myorganiser/environments/production --jq '.protection_rules'
```

Expect a `required_reviewers` rule alongside the `branch_policy` rule. This lives in repo settings,
**not** in this repository — no pull request will show you if it is removed, and every workflow file
will still read exactly as it does today. Removing it, or removing `environment: production` from a
deploy job, silently turns branch creation into an unattended production deploy.

To re-create it if it is ever lost:

1. Repo → **Settings** → **Environments** → select `production`
2. Under **Deployment protection rules**, enable **Required reviewers**
3. Add one or more reviewers

### Where to put secrets

Prefer adding secrets at the **Environment** level:

- Repo → **Settings** → **Environments** → `staging` → **Environment secrets**
- Repo → **Settings** → **Environments** → `production` → **Environment secrets**

This avoids accidentally reusing production credentials in staging.

### Staging (main)

Backend (cPanel FTP/FTPS):

- `FTP_HOST`
- `FTP_USERNAME`
- `FTP_PASSWORD`
- `FTP_SERVER_DIR` (remote directory for backend app root)

Web app (cPanel FTP/FTPS, same `FTP_HOST`):

- `FTP_FRONTEND_USERNAME`
- `FTP_FRONTEND_PASSWORD`
- `FTP_FRONTEND_DIR` (remote directory for the web app root; must end with `/`, because the restart file is uploaded to `<FTP_FRONTEND_DIR>tmp/`)
- `WEB_ORIGIN` — the Staging web address, with scheme and no trailing slash. A secret, like `API_ORIGIN`, because the public tree names no Staging host ([ADR 0056](../adr/0056-ci-owns-host-apply-without-describing-the-jail.md)). The run reads it to decide whether Staging already serves a commit, to plan the deploy, and to probe the result; the package step also passes it to the build as `NEXT_PUBLIC_APP_URL`.
- `API_ORIGIN` — already set for Host Apply (below). The web job compares it with `WEB_ORIGIN` and fails when the two are on different sites.

Web app **build-time** (GitHub Environment **variable** on `staging`, not a secret):

- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — Vault Cloud Backup GIS client for Staging (the Testing-project client). Read at the `yarn package:web` step, as for Production. Empty leaves the vault page on _"Cloud backup is not configured"_.

### Production (release/\*)

Production cPanel FTP/FTPS:

- `FTP_PROD_HOST`
- `FTP_PROD_BACKEND_USERNAME`
- `FTP_PROD_BACKEND_PASSWORD`
- `FTP_PROD_BACKEND_DIR` (remote directory for backend app root)
- `FTP_PROD_FRONTEND_USERNAME`
- `FTP_PROD_FRONTEND_PASSWORD`
- `FTP_PROD_FRONTEND_DIR` (remote directory for frontend app root)

Frontend **build-time** (GitHub Environment **variables** on `production`,
not secrets — the value is public and inlined into the browser bundle):

- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — Vault Cloud Backup GIS client. Dedicated
  production Drive project (ADR 0091); not the YouTube production client
  from #848. Empty leaves the vault page on _"Cloud backup is not
  configured"_ (no availability switch). After first production enable the
  value is sticky: Drive `appDataFolder` is per OAuth application, so
  changing it hides existing Escape Copies. See
  [Vault Cloud Backup](../features/vault-cloud-backup-google-drive.md).

`deploy-production.yml` passes this variable into the
`yarn package:web` step. Setting it only on the cPanel Node.js
app does not change an already-built bundle.

### Release marking (Production)

Once a Release is live, the `mark-feedback-release` job marks every Planned
Feedback Report on the issues the Release closes as Fixed (Bug Report) or
Shipped (Suggestion), which sends their Fix Notices
([ADR 0133](../adr/0133-a-feedback-report-becomes-fixed-when-the-production-deploy-ships-its-tracking-issue.md)).
It collects the issue numbers from `Closes` / `Fixes` / `Resolves #N` in the
commits since the previous `vX.Y.Z` tag (`yarn feedback:release:mark`) and
posts them to `POST /api/v1/feedback/releases/mark`. It reads `API_ORIGIN`
(above) and one secret of its own:

| Secret                    | What it is for                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `FEEDBACK_RELEASE_SECRET` | Sent as `X-Deploy-Secret`; must equal the production backend's env var of that name. |

The job declares `environment: production`, so it waits for its own
required-reviewer approval after the deploy finishes.

**Operator setup (once, before the first Release that should mark reports):**

1. Generate a value, for example `openssl rand -hex 32`. Use a value distinct
   from `YOUTUBE_CRON_SECRET`.
2. Set it as `FEEDBACK_RELEASE_SECRET` in the production backend's cPanel
   Node.js app environment and restart the app — see
   [Backend on cPanel](CPANEL_BACKEND_HOSTING.md). While it is unset there,
   the endpoint refuses every request.
3. Add the same value as a `FEEDBACK_RELEASE_SECRET` secret on the
   `production` GitHub Environment (**Settings → Environments → production →
   Environment secrets**). Never commit it or paste it into an issue.

If the job fails, the Release stays live and its reports stay Planned. Fix the
cause (usually a missing or mismatched secret) and use **Re-run failed jobs**;
a re-run for the same tag marks nothing twice and sends no Fix Notice twice.

### Host Apply (Staging & Production)

After the backend bundle is uploaded, CI SSHs in to install, migrate, regenerate
the Prisma client, and restart — see [ADR 0056](../adr/0056-ci-owns-host-apply-without-describing-the-jail.md).
This is a public repository, so this table lists secret **names** only. Values
(host, port, user, home paths, the selector app identity) live only in the
`staging` and `production` GitHub Environments — never in git, workflow YAML,
or this document.

Same names in both environments:

| Secret                 | What it is for                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `SSH_HOST`             | Host to connect to for that environment's Host Apply.                                               |
| `SSH_PORT`             | SSH port for that connection.                                                                       |
| `SSH_USER`             | SSH account to connect as.                                                                          |
| `SSH_PRIVATE_KEY`      | Deploy key for that account (never the account password).                                           |
| `SSH_KNOWN_HOSTS`      | The host's public keys, in `known_hosts` format, that the runner must match.                        |
| `APP_ROOT`             | This environment's backend application directory on the host.                                       |
| `COUNTERPART_APP_ROOT` | The **other** environment's `APP_ROOT`, so this one can refuse to equal it.                         |
| `NODEVENV_ACTIVATE`    | Path to that environment's Node virtualenv `activate` script.                                       |
| `SELECTOR_APP_KEY`     | The one app identity Host Apply may load `DATABASE_URL` for from the host's Node.js selector store. |
| `API_ORIGIN`           | Base URL Host Apply's HTTP verification probes call after restart.                                  |

`DATABASE_URL` is never a GitHub secret in either environment. Host Apply loads
it on the host, for `SELECTOR_APP_KEY` only, and never prints it.

Setting these up on a real host — deploy key, host-key pin, Environment
values, and the first live apply on each environment — is
[Host Apply: operator setup and first live apply](HOST_APPLY_OPERATOR_SETUP.md).
Run `yarn host-apply:preflight <environment>` before trusting CI: it checks
every one of those against the real host, read-only, using the same guards
the CI job runs.

Two of those names extend the eight the PRD originally listed, because eight
left two holes. `COUNTERPART_APP_ROOT` is what makes the `APP_ROOT` guard mean
anything: a job scoped to `environment: staging` cannot read `production`'s
secrets to compare the two roots, so each environment carries the other's pin
and refuses to run when they match — without it the guard could only catch an
`APP_ROOT` that was unset, and a shared hosting account would let a Staging run
migrate Production. `SSH_KNOWN_HOSTS` replaces `StrictHostKeyChecking=accept-new`:
the runner is ephemeral and remembers nothing, so trust-on-first-use would have
meant trusting whatever answered, on every run. Both are host paths and public
keys, not credentials, but they stay Environment secrets because this repository
is public and they would describe the jail. A missing value fails the job closed.

Job wiring (issue #567): `host-apply` is a separate job in both
`deploy-staging.yml` and `deploy-production.yml` that `needs` the backend
upload job (`deploy-backend`) and declares that environment's `environment:`
name, so Production's Host Apply waits on the same required-reviewer approval
as the rest of that Environment. Each workflow also accepts a
`workflow_dispatch` input, `apply_only` (default `false` in both), that re-runs
`host-apply` alone without re-uploading the backend bundle.

**Staging Host Apply is operator-triggered, not automatic.** The daily schedule
uploads a Staging backend bundle on its own, but nothing applies it until
someone dispatches `Deploy Staging`. SSH shell access on the hosting account is
a manual toggle that reverts, so an apply chained to the upload would go red on
every night the shell happened to be off — and a red apply nobody reads is how
unapplied migrations shipped in the first place. This amends PRD #565 user
story 3; it means an uploaded Staging bundle is not a migrated Staging backend
until you say so. A scheduled upload writes a "Backend uploaded by the
schedule, not applied" notice to its job summary so a green run does not read
as a finished deploy. To apply it, dispatch `Deploy Staging` in full, not with
`apply_only`: `host-apply` checks out the tip of the dispatched ref, which may
not be the commit the schedule uploaded. And `release:cut` refuses any commit Staging has not both
uploaded and Host Applied — see [Release script notes](#release-script-notes)
and the
[ADR 0056 amendment](../adr/0056-ci-owns-host-apply-without-describing-the-jail.md#amendment-2026-09-14).

Host Apply is backend-only on both environments. The Staging web app's restart
is part of `deploy-frontend`, needs no shell, and is not Host Apply
([ADR 0128](../adr/0128-the-web-app-is-hosted-on-the-same-site-as-its-api-and-staging-deploys-daily.md)).

Staging splits its concurrency by whether a job writes to `APP_ROOT`.
`deploy-backend` and `host-apply` share `deploy-staging-apply` with
`cancel-in-progress: false`: a later run queues behind them rather
than cancelling an in-flight `prisma migrate deploy` — and rather than FTPing a
fresh bundle into a tree `npm ci` is still working in, which a group covering
only `host-apply` would have allowed. `deploy-frontend` has its own group,
`deploy-staging-web`, also with `cancel-in-progress: false`: it writes the web
app's tree over FTP, and a run cancelled halfway would leave half a bundle
under a process that may restart onto it. It is a separate group from the
backend's because the web app has its own root and may deploy beside a Host
Apply. Only `prepare-dependencies` keeps `deploy-staging` with
`cancel-in-progress: true`, since it touches nothing on the host. Production's
whole workflow already queues instead of cancelling, so it needs no such split.

The SSH step captures its output to a file instead of streaming it, and
`tools/scripts/scrub-host-apply-log.ts` decides whether that output may reach
the Actions log: a log carrying a connection string or a bare `DATABASE_URL=`
is withheld, and only the offending line numbers are printed. This repository
is public, so a streamed log would publish a leak before anything could grade
it.

A failed Host Apply fails the job with no automated rollback and no
restart-anyway; `deploy-frontend` does not depend on `host-apply`, so the two
may run side by side once the backend upload succeeds. On Staging the web app
has its own application root, so its upload and restart never touch `APP_ROOT`.

## How to cut a release

### Versioning

We follow semantic versioning (SemVer): `vMAJOR.MINOR.PATCH`.

- **MAJOR**: breaking changes (incompatible API/behavior)
- **MINOR**: new features / enhancements (backwards compatible)
- **PATCH**: bug fixes (backwards compatible)

Examples:

- `v1.1.0` → minor feature release
- `v2.0.0` → breaking-change release
- `v1.1.1` → bugfix-only release

When every commit since the last tag is `docs:`, `ci:`, or `chore:`, there is nothing to ship and the
`VersionBump` agent reports `NO_RELEASE`. That is advice, not a veto — cut anyway if you have a
reason, such as republishing a failed deploy.

Classify on the commit **type**, never on the word "deps". `fix(deps):` is how shipped security
advisories are remediated in this repo and counts as a PATCH; `chore(deps):` and `ci: bump …` never
reach the deployed app.

The agent-facing version of this process lives in
[`.agents/skills/release-and-deploy-workflow/SKILL.md`](../../.agents/skills/release-and-deploy-workflow/SKILL.md).

### Release branch naming

Use a versioned release branch so production deploys are unambiguous:

- `release/v1.2.3`

### Release steps

1. Ensure CI is green on `main`, and that a full `Deploy Staging` dispatch at the commit you will cut is green, including `host-apply`.
2. Create and push a release branch from `main`.

- Recommended (script):
  - `yarn release:cut --version v1.2.3 --push`
- Manual (git):
  - `git checkout main`
  - `git pull --ff-only`
  - `git checkout -b release/v1.2.3`
  - `git push -u origin release/v1.2.3`

3. Approve the production deploy (the ship decision):

- A run is usually already queued and waiting — pushing the branch in step 2 dispatches one.
- If you need to start one by hand: GitHub → **Actions** → `Deploy Production (manual)` → **Run workflow**, select the `release/v1.2.3` branch, run.
- Confirm CI is green on `release/v1.2.3`, then approve the run. The approval authorises Host Apply; nothing reaches production until you approve.
- Approval does not ship the version — Host Apply (the job that follows) must succeed. The tag receipt comes after Host Apply is green.

4. After production deploy succeeds, create and push the version tag:

- Recommended (script):
  - `yarn release:tag --version v1.2.3 --push`
- Manual (git):
  - `git tag -a v1.2.3 -m "Release v1.2.3"`
  - `git push origin v1.2.3`

  The tag is a **receipt**: `vX.Y.Z` existing means that version is live in production, which is why
  it is applied here and not earlier. `release:cut` has no way to create one.

5. That tag push triggers the `Publish GitHub Release` workflow, which creates the GitHub Release and attaches the Escape Copy reader plus its checksum.

- The workflow checks out the tagged commit and uses its `RELEASE_NOTES.md` as the release body.
- Re-running the workflow updates the existing release, so publishing is idempotent.
- To publish an existing tag manually, run the workflow with the `tag` input.

### Release checklist (copy/paste)

Replace `vX.Y.Z` with your version (example: `v0.1.1`).

1. Ensure `main` is healthy:

- CI is green
- **Staging has uploaded and Host Applied the commit you will cut, from a dispatch.** Neither happens by itself for a Cut: with the SSH shell toggled on, dispatch `Deploy Staging` in full (leave `apply_only` unticked) at that commit. A scheduled upload does not count, and **never use `apply_only` after one**: `host-apply` checks out the tip of the dispatched ref, which may not be the commit the schedule uploaded, and the Cut guard refuses a scheduled upload anyway because the run records no commit. `apply_only` is only the retry after a dispatched upload whose `host-apply` went red. `release:cut` checks this and refuses otherwise; ticking it here saves you the refusal.
- The same dispatch deployed the Staging web app at that commit; its probe is green.
- **Production Host Apply has been rehearsed**: `yarn host-apply:preflight production` passes its readiness checks. Do this before cutting, not during the release — see [the operator runbook](HOST_APPLY_OPERATOR_SETUP.md#step-8--production). Production Host Apply has never run, so the first release after this feature is the first time it will.

2. Cut the release branch (recommended):

- `yarn release:cut --version vX.Y.Z --push`

What this does:

- Creates `release/vX.Y.Z` from `main`
- Updates root `package.json` version to `X.Y.Z` and commits it (default)
- Updates `CHANGELOG.md` with generated release notes and commits it (default)
- Runs `yarn openapi:sync` and commits its outputs in the same commit — the OpenAPI spec and generated API client carry the package version, and the pre-commit `openapi:artifacts` gate refuses a commit where they differ. If the sync changes anything the commit would not carry (for example backend routes), the cut stops before committing: `main`'s generated output had drifted from its contract, and that fix belongs in its own pull request.
- If the cut stops after creating the branch (the sync or the staging fails, the drift check refuses, or the commit is refused), nothing is committed or pushed, but `release/vX.Y.Z` is left checked out with uncommitted changes — unstaged if the sync or the staging failed, staged if the drift check or the commit stopped it (the drift check also leaves the drifted files unstaged). The script prints the way back — `git checkout -f main`, `git branch -D release/vX.Y.Z`, then remove anything `git status` still lists — and a retry needs that clean tree.
- Use `--no-notes` to skip the `CHANGELOG.md` entry.

3. Production deploy:

- Creating the release branch dispatches a production run automatically; it waits for your approval.
- To start one by hand instead: GitHub → Actions → `Deploy Production (manual)` → Run workflow on `release/vX.Y.Z`
- Check CI is green on `release/vX.Y.Z`, then approve. The approval is the ship decision.

4. Tag the release after Production Host Apply has succeeded:

- Confirm the `Deploy Production (manual)` workflow has completed, including the `host-apply` job.
- A green `host-apply` already asserts migrate status and both probes; you are confirming the job passed, not re-running its checks by hand.
- If it went red, do not hand-fix on the host — the sequence is fail-closed and left it as it was. Fix the cause and re-run with `apply_only`; the bundle is already uploaded. [Runbook](HOST_APPLY_OPERATOR_SETUP.md#step-8--production).
- `yarn release:tag --version vX.Y.Z --push`

`release:tag` writes no files and creates no commits — the `CHANGELOG.md` entry was already committed by `release:cut`. The tag must name the exact commit that deployed.

The tag is a receipt: `vX.Y.Z` existing means that version is live in production with Host Apply verified.

Optional: write a rolling notes file

- `--notes-file` (no value) writes to `RELEASE_NOTES.md`
- `--notes-file <path>` writes to the provided path

Note: We intentionally avoid generating per-version `release-notes-v*.md` files since `CHANGELOG.md` is the source of truth.

### Release PR automation

`release-pr.yml` runs on every push to `release/v*` and automatically:

- Creates (or updates) a PR from `release/vX.Y.Z` → `main`
- Attempts to enable GitHub auto-merge so it merges after required checks pass

Auto-merge is the only optional part: it needs repository settings to allow auto-merge, and branch
protection rules that do not require manual approvals. If either is missing the workflow logs a
warning and the PR simply waits to be merged by hand.

Notes:

- If you need to skip bumping `package.json` version for any reason, pass `--no-version-bump`.
- The scripts enforce strict `vX.Y.Z` (no prerelease strings).

### Release script notes

The script lives at `tools/scripts/release.ts` and automates the git steps.

- It enforces `vX.Y.Z` format (no prerelease strings).
- It requires a clean working tree.
- `release:cut` requires you to be on `main` and up-to-date with `origin/main`.
- `release:cut` then refuses unless Staging holds that commit, Host Applied: the latest successful Staging `deploy-backend` uploaded it, and a green `host-apply` at that commit started after the upload landed, with no upload of another commit in between. An `apply_only` retry counts when the upload it applies was a dispatched one. The uploaded commit is read from each run's name (`run-name` in `deploy-staging.yml`). A dispatched run names its commit; a scheduled run names none, because the commit it deploys is chosen inside the run. The guard refuses an upload that names no commit, so a scheduled upload cannot be Cut — with or without an `apply_only` dispatch after it — until a full dispatch uploads and applies the commit ([ADR 0128](../adr/0128-the-web-app-is-hosted-on-the-same-site-as-its-api-and-staging-deploys-daily.md)). A run from before `run-name` existed can only refuse, for the same reason. It reads the recent `Deploy Staging` runs with `gh api`, so the GitHub CLI must be installed and authenticated. There is no flag to skip it — a break-glass SSH apply is invisible to CI, so it cannot satisfy the check ([ADR 0056 amendment](../adr/0056-ci-owns-host-apply-without-describing-the-jail.md#amendment-2026-09-14)). `--dry-run` runs the check too.
- It does **not** dispatch or approve any deploy. Pushing the release branch is what dispatches a production run (via `dispatch-production-deploy.yml`), and that run still waits for approval.
- `release:cut` **cannot** create a tag. Tagging is a separate command, run only after Production Host Apply succeeds — the tag is a receipt, not a trigger. See [ADR 0028](../adr/0028-production-deploys-are-approval-gated-and-tags-are-receipts.md) and [ADR 0056](../adr/0056-ci-owns-host-apply-without-describing-the-jail.md).

## cPanel notes (after upload)

Both deploy bundles are designed for cPanel shared hosting:

- Backend bundle includes a deploy-ready `package.json`, npm guardrail config, `prisma.config.cjs`, and `prisma/` folder.
  - It also includes a deploy-only `package-lock.json` generated during packaging.
  - An upload is not a deploy: Host Apply installs, migrates, regenerates the Prisma client, and restarts — see [Host Apply](#host-apply-staging--production). Do not run those steps by hand except through [Break-glass](HOST_APPLY_OPERATOR_SETUP.md#break-glass).
- Frontend bundle is a Next standalone-based deploy with a Linux-safe `server.js`. It ships without `node_modules`.
  - Production: after upload, click **Run NPM Install**, then **Restart**, in the Node.js app.
  - Staging: the run restarts the app itself, and fails asking for **Run NPM Install** and **Restart** when the bundle's dependency list differs from the one known to be installed, or when nothing is known yet (the first deploy to a host). See [Web app on cPanel](CPANEL_WEB_HOSTING.md#after-an-upload).

The deploy folders also contain `CPANEL_STARTUP.md` files with the exact startup file names.

What the host needs, and what differs between Staging and Production, is in
[Backend API on cPanel](CPANEL_BACKEND_HOSTING.md) and
[Web app on cPanel](CPANEL_WEB_HOSTING.md).
