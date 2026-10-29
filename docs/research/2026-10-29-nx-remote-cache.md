# Remote caching for Nx on GitHub Actions (2026-10-29)

Research date: **2026-10-29**. Ticket [#1378](https://github.com/mnaimfaizy/myorganiser/issues/1378), map [#1373](https://github.com/mnaimfaizy/myorganiser/issues/1373). Pinned Nx: **22.7.12** (`package.json`, `TECH_STACK.md`). Sources are nx.dev, the GitHub Advisory Database, GitHub Docs, the installed `@nx/js` source, and this repo's live Actions cache API. A claim no primary source confirms is marked **unknown**.

## Question

What are the options for sharing Nx computation results across PRs and `main` on free GitHub-hosted runners, and what does each cost? Compare Nx Cloud's free tier, Nx's self-hosted remote cache options at Nx 22.7.12, and tuning the current `actions/cache` of `.nx/cache`. Include whether TypeScript typecheck can be an Nx-cached target.

---

## TL;DR

- **Nx Cloud Hobby does not fit our volume.** Each CI run costs 500 credits, and Hobby gives 50,000 a month, so about 100 runs. CI ran **552 times** in the last 30 days (374 `pull_request`, 178 `push`), which needs about 276,000 credits. On Hobby, Nx Cloud switches off once the credits run out. Team ($29 a month) would cost about **$150 a month** at this volume (estimate). No open-source plan is published.
- **Nx Cloud is the only managed option that scopes writes by trust.** A read-only token reads the shared cache and writes only to a cache for its own branch. Fork PRs get no secrets, so whether they can use the cache depends on the workspace's anonymous-access setting. It defaults to **read-write**, and Nx tells public repos to change it.
- **The self-hosted bucket packages are out.** `@nx/s3-cache`, `@nx/gcs-cache`, `@nx/azure-cache` and `@nx/shared-fs-cache` were deprecated on 2026-05-21 for CREEP (CVE-2025-36852), and Nx says the flaw cannot be patched. The remaining self-hosted route is a server we write against Nx's OpenAPI spec. Nx 22.7.12 already has the fix for that client's zip-slip (CVE-2026-71476), but we would have to build and host the server, and for free.
- **The `actions/cache` scoping we have now is already trust-safe.** `pull_request` runs write only to `refs/pull/N/merge` and read from `main`. Only `push` runs can write to `main`'s scope. The weakness is how well the cache works: `main`'s `.nx/cache` entries are only **0.3–0.5 MB**, because a push to `main` runs `nx affected` against the commit before it. That means a new PR restores an almost empty cache. On top of that, the repo is over its **10 GB** cache limit (10.41 GB in 171 entries, about 9 GB of it `node_modules`), so least-recently-used eviction is churning through the entries.
- **Typecheck can be cached, but not as it runs now.** `tools/scripts/check-typecheck.ts` runs outside Nx, so Nx never caches it. To get caching it has to become per-project Nx targets: either inferred by `@nx/js/typescript`, which needs workspaces plus project references (no `paths` aliases), or hand-written `cache: true` command targets.

---

## 1. Nx Cloud free tier (Hobby)

| Claim                                                                                                                                                                       | Source                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Hobby: free, no credit card, **50,000 credits a month**, resets monthly, 5 contributors, 10 concurrent CI connections                                                       | [Nx pricing](https://nx.dev/pricing)                                                   |
| Team: $29 a month including $29 of usage; $5.50 per 10,000 extra credits; $19 per extra contributor                                                                         | [Nx pricing](https://nx.dev/pricing)                                                   |
| One CI Pipeline Execution (one GitHub Actions workflow run) = **500 credits**. Linux agents (only used with distributed execution): 5 credits a minute (small), 10 (medium) | [Credit pricing](https://nx.dev/docs/reference/nx-cloud/credits-pricing)               |
| On Hobby, when the credits run out, "Nx Cloud features turn off" until the monthly reset                                                                                    | [CI features](https://nx.dev/docs/features/ci-features)                                |
| An open-source plan is asked about in the pricing FAQ, but no answer is published                                                                                           | [Nx pricing](https://nx.dev/pricing) — **unknown**                                     |
| Whether cache hits or uploads cost credits on their own is not stated                                                                                                       | [Credit pricing](https://nx.dev/docs/reference/nx-cloud/credits-pricing) — **unknown** |

**This repo's usage** (`gh api …/workflows/ci.yml/runs`, 2026-09-29 to 2026-10-29): 552 CI runs, so 552 × 500 = 276,000 credits, about 5.5 times the Hobby allowance. On Team the estimate is $29 + (276,000 − ~52,700 included) / 10,000 × $5.50 ≈ **$152 a month**, before any per-contributor charges. These are my calculations, not quoted prices. Cutting the CI churn the map describes, where every merge to `main` re-runs CI on open PRs, would lower this.

### What gets uploaded

Nx Cloud stores task outputs, meaning the files listed in a target's `outputs` plus its terminal output, along with the run metadata. For data handling, the CI features page refers to the [Nx Cloud privacy policy](https://nx.app/privacy). Whether a cached output can hold a secret depends on the target: a Jest/ESLint log does not, unless a test prints one, but a Next.js build that inlines `NEXT_PUBLIC_*` env vars could. Vault plaintext never reaches CI, because vault data is client-side encryption only. Under the map's constraint, the cached targets should be lint, test and typecheck. Production builds that read secrets should stay out of the remote cache.

### Trust model and fork PRs

| Claim                                                                                                                                                                                          | Source                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| A read-only token "can only read from the global remote cache"; what its tasks produce is stored "in an isolated remote cache accessible _only_ by that specific branch in a CI context"       | [Access tokens](https://canary.nx.dev/docs/guides/nx-cloud/access-tokens)                                                                 |
| Read-write tokens "allow full write access"; Nx recommends read-write only on protected branches. Set them with `NX_CLOUD_ACCESS_TOKEN`, which overrides `nx.json`                             | [Access tokens](https://canary.nx.dev/docs/guides/nx-cloud/access-tokens)                                                                 |
| By default, anyone who clones the repo gets **read-write** access through the committed workspace ID. It can be changed to `read-only` or `none`, and Nx recommends that for open-source repos | [Personal access tokens](https://nx.dev/docs/kb/personal-access-tokens)                                                                   |
| Nx Cloud is not exposed to CREEP: protected branches write the shared cache, and feature branches write only to their own branch scope                                                         | [CREEP post, 2025-06-12](https://nx.dev/blog/cve-2025-36852-critical-cache-poisoning-vulnerability-creep)                                 |
| Nx recommends giving "untrusted and fork pipelines" read-only access at most, and gating the write token behind a protected GitHub environment                                                 | [Can you trust your build cache?, 2026-06-16](https://nx.dev/blog/can-you-trust-your-build-cache)                                         |
| On `pull_request` from a fork, "secrets are not passed to the runner" (except `GITHUB_TOKEN`), and `GITHUB_TOKEN` is read-only                                                                 | [GitHub: events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) |

What this means for us: fork PRs never see `NX_CLOUD_ACCESS_TOKEN`, so they fall back to anonymous access through `nxCloudId`. With the setting at `none`, fork PRs get no remote cache. With `read-only`, they read `main`'s cache and write only to their own branch scope. The default `read-write` must not be left in place on a public repo.

The undeclared-inputs risk from the "trust your build cache" post applies to every option, `actions/cache` included. A file that a task reads but that is not in its hash can carry a poisoned result into `main`. The post lists the usual culprits: shared tsconfig, env files, generated code, and global tool config.

## 2. Self-hosted remote cache at Nx 22.7.12

| Claim                                                                                                                                                                                                                                                                                                                                                          | Source                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `@nx/s3-cache`, `@nx/gcs-cache`, `@nx/azure-cache` and `@nx/shared-fs-cache` were deprecated on **2026-05-21** for CREEP (CVE-2025-36852). "The flaw is in their design and cannot be patched": one read-write credential, and no record of which branch produced an artifact. Nx's advice is Nx Cloud, a self-built OpenAPI server, or disabling remote cache | [Deprecated self-hosted cache packages](https://nx.dev/docs/reference/deprecated/self-hosted-cache-packages) |
| Self-hosted server: implement `GET`/`PUT /v1/cache/{hash}` (binary tar, bearer auth). `PUT` must return 409 for an existing record and 403 for a write with a read-only token. Configure it with `NX_SELF_HOSTED_REMOTE_CACHE_SERVER` and `NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN`                                                                           | [Self-hosted caching](https://nx.dev/docs/kb/self-hosted-caching)                                            |
| The custom-server option has existed since Nx 20.8                                                                                                                                                                                                                                                                                                             | [21.nx.dev self-hosted caching](https://21.nx.dev/docs/guides/tasks--caching/self-hosted-caching)            |
| CVE-2026-71476 (GHSA-vp3h-ghgh-jr7g): zip-slip in Nx's self-hosted remote cache client, affecting nx ≥ 20.8.0 and < 22.7.7. Fixed in **22.7.7**, so 22.7.12 is patched. The local cache and Nx Cloud are not affected                                                                                                                                          | [GitHub Advisory](https://github.com/advisories/GHSA-vp3h-ghgh-jr7g)                                         |

Cost: no licence is needed, but there is nowhere free to host the server. A free-tier host is possible, but we would own its uptime, storage and auth. To match Nx Cloud's protection, the server would also have to give `main` a read-write token and PRs a read-only one. The spec defines the 403 for that but leaves the enforcement to whoever writes the server. Its trust model then rests on secrets, which fork PRs do not receive. A fork PR would either have no cache, or the server would have to allow anonymous reads.

## 3. Tuning the current `actions/cache` of `.nx/cache`

### What CI does today

The Lint and Test jobs in `.github/workflows/ci.yml` (lines 662–669 and 991–998) and the E2E jobs (1061–1067 and 1288–1294) use:

```yaml
key: ${{ runner.os }}-nx-22-<job>-${{ github.sha }}
restore-keys: |
  ${{ runner.os }}-nx-22-<job>-
  ${{ runner.os }}-nx-22-
```

CI runs on `pull_request` and on `push` to `main`/`release/**`. On `push`, `nx affected` uses `--base=${{ github.event.before }}`. The Setup Affected Context job is at lines 585–601.

### GitHub rules that apply

| Claim                                                                                                                                                                                                                                                                     | Source                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| A run restores from its own ref, then the base branch, then the default branch. PR caches are scoped to `refs/pull/N/merge` and can be restored only by re-runs of that PR. Sibling branches cannot share caches                                                          | [Dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching) |
| Lookup order: exact `key`, then a prefix match on `key`, then each `restore-keys` entry in order, on the current ref first and then the default branch. When several entries match, the newest one wins                                                                   | same                                                                                                                  |
| Caches are immutable. A key that already exists is not saved again                                                                                                                                                                                                        | same                                                                                                                  |
| Low-trust triggers (`pull_request_target`, `issue_comment`, `workflow_run`) get read-only access to default-branch caches. Writing needs `cache-mode: write`, which "reintroduces cache-poisoning risk." Only trusted triggers such as `push` write to the default branch | same                                                                                                                  |
| 10 GB per repo by default (more is billed). Entries not accessed for 7 days are evicted; over the limit, the least recently used go first. Rate limits are 200 uploads and 1,500 downloads a minute                                                                       | same                                                                                                                  |

### What the live cache shows (`gh api repos/…/actions/caches`, 2026-10-29)

- Total: **10.41 GB in 171 entries**, which is over the 10 GB default. By family: `node-22-deps` has 20 entries totalling 9,056 MB (453 MB each); `nx-22-e2e` 18 entries, 543 MB; `nx-22-test` 61 entries, 308 MB; `nx-22-lint` 75 entries, 23 MB. The oldest entry was created 2026-10-19, so entries are being evicted after about 10 days.
- `main`'s Nx entries are tiny: `nx-22-test-<sha>` is about 0.47–0.49 MB and `nx-22-lint-<sha>` about 0.34 MB. A push to `main` only runs the projects affected since the previous commit, so `main`'s cache holds few task results. On its first run, a PR restores that nearly empty entry through the `nx-22-<job>-` prefix and gets cache hits only on its own re-runs.

### Tuning options (none applied; planning only)

1. **Fill `main`'s cache.** Run the full set of cacheable targets on `push` to `main` (`nx run-many`, not `affected`) so the entry PRs restore holds every project's lint and test results. Wall-clock is unchanged on PRs, and the extra minutes go on `main`, where the map already requires whole-tree runs. Only `push` writes `main`'s scope, so this does not add a poisoning path.
2. **Stop saving from PRs, or save only on a miss.** PR entries help only re-runs of the same PR, but they push `main`'s entries toward eviction. Splitting `actions/cache` into `actions/cache/restore` on PRs and `actions/cache/save` on `push` keeps the budget for `main`. This trades away PR re-run hits, so measure first.
3. **Shrink the dependency cache.** At 453 MB × 20 entries it is about 87% of the quota. Each lockfile change adds a new key on every ref. Fewer copies (no saves from PRs, or `restore-keys`) would leave room for the Nx cache.
4. **Bound `.nx/cache`.** It is restored and then saved whole under a new key, so it grows without limit. Nx's on-disk cache size limit option (`maxCacheSize`) is **unknown** for 22.7.12: it is not in the installed `nx-schema.json`, so check the docs for this pin before relying on it.
5. **Keep the trigger set.** Do not add `pull_request_target` or `cache-mode: write` for Nx caches. Fork PRs today read `main`'s cache and write only to their own PR scope, which matches what Nx Cloud's read-only token does.

## 4. Can TypeScript typecheck be an Nx-cached target?

Yes, but not as it runs today. CI runs `corepack yarn typecheck:check "$NX_GRAPH_FILE"` (`ci.yml:812–813`), which is `node tools/scripts/check-typecheck.ts`, a workspace script outside Nx's task runner, so Nx never caches it. Its header says it was written as a script on purpose so as not to prejudge issue #420 (executor targets versus inferred targets). The only `typecheck` target declared today is the one in `apps/mobile/project.json`.

| Route                               | Facts                                                                                                                                                                                                                                                                                                               | Source                                                                                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inferred `@nx/js/typescript` plugin | Adds a `typecheck` target with `cache: true` and inputs computed from the tsconfig. In the TS solution setup it runs `tsc --build --emitDeclarationOnly` and depends on dependencies' `typecheck`                                                                                                                   | Installed `node_modules/@nx/js/src/plugins/typescript/plugin.js` lines 264–299; [Nx with TypeScript](https://nx.dev/docs/technologies/typescript/introduction)                                                                            |
| Its prerequisite                    | Workspaces plus project references: `tsconfig.base.json` with `composite`/`declaration` and **no `compilerOptions.paths`**. This repo resolves imports through `paths` aliases (AGENTS.md: "Use path aliases from `tsconfig.base.json`"), so adopting it means a migration                                          | [TypeScript project linking](https://nx.dev/nx-api/js/documents/typescript-project-references); [Switch to workspaces and project references](https://nx.dev/docs/technologies/typescript/guides/switch-to-workspaces-project-references) |
| Explicit command target per project | `nx:run-commands` with `tsc --noEmit -p tsconfig.lib.json` (plus the spec config), `cache: true`, inputs `["default", "^production"]` and the root tsconfig. Results are cached from terminal output with no file outputs. Typechecking against a dependency's source makes `^production` necessary for correctness | Nx `targetDefaults` / inputs semantics; nx.json already does this for `@nx/js:tsc`                                                                                                                                                        |

Either route makes typecheck run through `nx affected -t typecheck`, so a PR touching one library checks only the projects affected by it. Cache hits come from any of the options in sections 1–3. The whole-tree check stays on `main`.

## Unknowns

- Whether Nx Cloud has a free open-source plan (the FAQ question has no published answer).
- Whether cache operations cost credits apart from the 500 per CI run.
- Nx's on-disk cache size limit at 22.7.12.
- Who counts as an Nx Cloud "contributor" (bots, agent commits) against the five on Hobby.
