# A QA Account's credentials are public fixtures in tracked source, and its seeder runs against a local database or not at all

## Status

accepted

## Context

Manual and agent QA needs a User who can sign in and whose Vault unlocks. Until now each QA run made one by hand: register, read the verification email from MailHog, verify, sign in, create a Vault in the browser. The values went into a gitignored file under `tmp/`.

That had three costs:

- An agent on another machine, in another worktree, or in a Cloud Agent could not see the file, so every run started by rebuilding the account.
- Reading a credential out of an untracked file is the shape a permission layer exists to refuse. A QA run of PR #999 stopped at "Unlock your Vault" for that reason.
- The Recovery Key was random, so a recovery scenario needed a capture step, and a damaged Vault could only be thrown away.

Issue #1004 tracks the change.

The repository already commits sign-in fixtures for the live logout Playwright spec (`apps/web-e2e/src/e2e/helpers/liveAuth.ts`), and every vault spec carries its passphrase as a literal.

## Decision

1. **A QA Account's sign-in password and Vault passphrase are public, and fixed by tracked source.** `tools/config/qa-accounts.json` holds one row per account: an id, an email and a name. The password and the passphrase are derived from the id. They are not secrets: they open a fixture User in a local database and nothing else.
2. **The seeder runs against a local database or not at all.** `yarn qa:accounts:seed` creates each account as a verified User, skipping the email round-trip. `localDatabaseRefusal` lets it run only when `DATABASE_URL`'s host is this machine and `NODE_ENV` is not `production`. There is no flag that lifts the refusal. The seeder is the only path to a verified QA Account: the addresses sit on `myorganiser.test`, a reserved domain that receives no mail, so nobody can register and verify one on a real deployment.
3. **The seeder mints the Vault.** It builds the vault meta in Node with `vault-core`'s crypto and the web client's own `localToServerMeta`, and writes only what a client would have pushed. The server still holds Ciphertext only.
4. **Every secret-shaped value is fixed and derived, not committed.** The password, the passphrase, the salt, the Master Key, the Recovery Key and the wrap IVs are each taken from a SHA-256 digest of a label that names the account. They are fixed, so minting twice gives the same Vault. They are derived, so no credential-shaped string sits in the tree for a secret scanner, or a reader, to learn to ignore. `yarn qa:accounts` prints each account's values, Recovery Key included.
5. **The seeder is the Vault's backup.** A seed puts the password and the vault meta back to the fixture and keeps every Vault Blob, which stays readable because the Master Key did not change. It reports a blob that no longer opens. `--restore` deletes the account's blobs, which returns the Vault to its default state, empty. Nothing is stored on disk to go stale.
6. **Two accounts.** `primary` is for ordinary QA. `secondary` exists so a scenario about one User never seeing another's Vault has a second User to use.
7. **The seed is a QA setup step.** The `qa-plan` Skill's Setup runs it, and `.cursor/start.sh` runs it on each Cloud Agent boot. Starting the backend does not: a developer's database gains fixture Users only when someone runs a QA.

## Considered Options

- **Generate the values per machine into a gitignored file.** Rejected. It is what this replaces: the file reaches no other machine or agent, and reading it is the access a permission layer refuses.
- **Keep the values in the local env file.** Rejected. A hook blocks agents from reading env files, on purpose, and a QA fixture is not a reason to weaken that.
- **Commit the values as literals.** Rejected, in two steps. The Master Key and Recovery Key were never going to be committed: that needs standing exemptions in the secret-scan hook and in GitGuardian, and teaches everyone that a key-shaped string in a diff is normal. The password and passphrase were first committed as short readable literals, on the expectation that a scanner would pass them as it passes the vault specs' passphrases. GitGuardian flagged all four on Pull Request #1003, so they are derived as well.
- **Let the first QA run create the Vault in the browser.** Rejected. The Recovery Key would be random again, and "is the account ready" would depend on who ran QA last.
- **Refuse the fixture email in the production backend as well.** Rejected. It puts knowledge of test accounts into production auth code to guard a path the seeder's refusal already closes.
- **An override flag for a staging database.** Rejected. The flag is the path by which an account with a published password reaches a shared environment.

## Consequences

- Anyone with the repository knows these accounts' passwords, passphrases and Recovery Keys. That is safe only while they exist in local databases. Copying a local database into a shared environment copies them too; that is a rule for whoever moves the database, and nothing here enforces it.
- A derived password or passphrase is a two-letter prefix and twelve hex digits. That is fifteen characters: at least the web client's ten-character passphrase minimum, and under the sixteen at which the secret-scan hook refuses a quoted password-like literal, so an agent can type one into a tool input. `qaAccountsProblem` enforces the reserved domain.
- Nobody can read a QA Account's password from a file. `yarn qa:accounts` is the only way to see it, and a change to the derivation changes every value; the next seed puts each account's password and vault meta back to match.
- The seeder wraps at an iteration count it pins itself. Both clients unwrap with the count the meta carries, so the Vault opens whatever that number is; the app's own parameters stay pinned by `libs/vault-core/src/lib/cryptoCompatibility.test.ts`.
- A QA scenario that changes the passphrase, or removes the Vault and creates another, leaves the account off the fixture. The next seed puts the meta back. Blobs written under a different Master Key are reported unreadable, and `--restore` clears them.
- `yarn qa:accounts:test` covers the refusal, the table's rules, the derivation, and that a minted Vault opens by passphrase and by Recovery Key. It needs no database. The database writes were checked by hand against a local Postgres and the iOS simulator, and no automated test covers them.
- The live logout spec keeps its own User. It is seeded by `tools/scripts/e2e-live-backend.ts` into a CI database with a different lifecycle and is not a QA Account.
