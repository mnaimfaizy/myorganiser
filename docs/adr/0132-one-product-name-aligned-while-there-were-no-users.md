# One product name, aligned while there were no Users

The product is **MyOrganiser** on every live surface, code identity included. The rename happened before the first Mobile Release and before any User existed, and that timing is the only reason it could rename stored-data keys without a migration.

## Status

accepted

## Context

Grilled 2026-10-15, joining #954 (the product spells its own name two ways) and #162 (the web app's folder shares its name with the repository). Before this ADR, the domain, the bundle identifier (ADR 0086, #807) and the web page title used the British "-iser" spelling, while about a thousand tracked files used the "-izer" spelling: the GitHub repository, the web app's folder and Nx project, the import scope, the scripts, the mobile display name, and the email brand. The mobile store-release grilling of 2026-09-30 chose an Australia-only v1, where "organiser" is the local spelling.

When this was decided, no `mobile-v*` tag existed and the operator reported no Users. Every browser storage key, device keychain entry and Google Drive backup that carried the old spelling belonged to the operator or to a QA Account.

## Decision

- **One spelling everywhere live.** User-visible strings, the import scope, Nx project names, scripts, CI, docker-compose, environment examples, stored-data keys, the Escape Copy Reader asset, the OpenAPI title, the GitHub repository and the prose of merged ADRs all use MyOrganiser.
- **App folders are named for their role, never for the product.** The web app takes `web` (and its e2e project `web-e2e`), alongside `mobile` and `backend`, and mirrors `libs/web/*` the way `mobile` mirrors `libs/mobile/*`. Renaming the product again never touches a folder.
- **Merged ADRs are rewritten for the name only.** The no-rewrite rule protects a decision, and a spelling or path change alters none. The rename diff to an ADR must show only name substitutions under `git diff --word-diff`.
- **History stays frozen.** `docs/research/` (frozen at its date, ADR 0041), past `CHANGELOG.md` entries, the recorded review fixtures in `tools/scripts/review/fixtures/2026-09-10/`, the golden-spec snapshots in `tools/config/review-golden-specs/`, git history, and closed issue and PR text keep the old spelling. History is not rewritten (ADR 0086). The QA Account files (`tools/scripts/lib/qa-accounts.ts`, its test, and `tools/config/qa-accounts.json`) keep it too: their email suffix and hash salt derive the QA credentials, which do not change (ADR 0122).
- **Stored-data keys were renamed outright, with no migration**, because no User and no installed Mobile Release existed to strand. **After the first Mobile Release this exception is closed:** a key that data outside the tree is stored or found under is never renamed without a migration that ships for as long as an affected install or file can exist.
- **The GitHub repository is renamed last**, after the code and docs sweep, and the repository slug references are rewritten after it. GitHub redirects the old slug only while no repository holds it, so **a repository with the old name is never created on the account.**
- **Hosting internals are out of scope.** Database names, database users, host app-root folders and GitHub Environment names are Operator Fingerprints that no User reads (ADR 0086). Renaming a production database buys nothing visible.
- **Enforcement is the `product-name:check` gate,** wired into `yarn gates:run` and so into Husky and CI. It asserts that no tracked file outside the frozen set contains the old spelling, and fails naming file and line. The frozen set is the path allowlist in `tools/config/product-name-allowlist.json`, each entry with a written reason.

## Considered Options

- **Keep the import scope and other code identifiers in the old spelling, renaming only what Users see.** This would have cost far less and been invisible to Users. Rejected by the product owner: the product carries one name, and a namespace that disagrees with it is a permanent footnote.
- **Freeze stored-data keys** as permanent values behind renamed constants. This was the right answer for a product with Users. With none, it would have kept the old spelling forever to protect only the operator's own test data.
- **Migrate stored-data keys.** The migration code would be permanent, the keychain migration would ship inside the first Mobile Release only to read keys that release never wrote, and the Drive `appProperties` key cannot be migrated without rewriting files on Users' Drives. With no Users, it migrates nothing.
- **`frontend` or `web-app` for the web app's folder.** `frontend` is wrong because the Mobile App is also a frontend. `web-app` breaks the role-only naming the other app folders already follow.
- **Rename the repository first.** Redirects make either order work, but renaming first means the sweep's pull requests open against a slug that is changing underneath them.
- **Rewrite `docs/research/` too.** Rejected: a dated record would then claim a layout that did not exist on its date.

## Consequences

- The operator re-establishes their own state after the rename: logging in again on web and mobile, re-enrolling biometric unlock, and reconnecting Google Drive with a fresh backup.
- Renaming the OAuth consent screens can send an External, in-production Google Cloud project through brand verification again. That is an operator step started as early as possible so it runs alongside the code work.
- The rename runs as a strictly serial set of slices with feature work held. Each of the first slices rewrites hundreds of files, and any branch open at the same time conflicts.
- Vocabulary: [`CONTEXT.md`](../../CONTEXT.md) § Mobile (Web App).
