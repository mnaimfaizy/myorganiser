# Host credentials have three sources, and the env file Sandcastle forwards must stay empty

## Status

accepted

Builds on [ADR 0010](0010-sandcastle-local-only-integration.md): only the host pushes, and the sandbox holds no credential that can read or write the repository. Resolves #1593.

## Context

A dispatch started from a shell where `gh` had exported `GH_TOKEN` or `GITHUB_TOKEN` forwarded it into a networked container that reads issue text, whichever agent ran. Selecting one credential per agent kind in our own `docker({ env })` record closed that route, but `@ai-hero/sandcastle`'s `run()` has a second one: it reads `.sandcastle/.env` and forwards every key listed there into the sandbox, taking the shell's value when the file leaves one empty, and merges that with our record. A key in that file reaches every sandbox, and no guard on our record can see it.

## Decision

1. **`.sandcastle/.env` must hold no key.** `dispatch-agents` and `dispatch-waves` refuse to start when it exists and holds any `KEY=` line, naming the keys and never a value. An empty value counts: Sandcastle would fill it from the shell.
2. **Host credentials come from three sources, highest first.** A 1Password Environment when `OP_ENVIRONMENT_ID` is set, read in memory on the host (`op environment read`, or `op environment secret list`, the form 1Password CLI 2.42.0 and later documents, on a CLI that lacks `read`; the id must be letters, digits, `-` and `_`, starting with a letter or digit, so it can never read as an `op` flag); then the shell; then a gitignored `.sandcastle/secrets.env` that only host code reads and that is never handed to Sandcastle. If the Environment is named and cannot be read, the dispatch stops. It never falls through to a lower source, which could bill a different account.
3. **`OP_ENVIRONMENT_ID` is not a secret** and may live in `secrets.env` alone. A value in the shell wins.
4. **Only the selected agent's credential reaches a container.** The provider part of the sandbox environment is a pure function of the agent kind, the resolved Claude auth and the host environment. `GH_TOKEN` and `GITHUB_TOKEN` are never forwarded, and an assertion on the assembled `docker({ env })` record fails the dispatch before a container starts if either is present. The selection is an allow-list by agent kind; the assertion is a deny-list of exactly those two names, a backstop for a later edit that spreads in another source.
5. **The committed example is `.sandcastle/secrets.env.example`.** It names no GitHub token. Copilot's credential is `COPILOT_GITHUB_TOKEN`, a fine-grained token with only the "Copilot Requests" permission and no repository access; GitHub's Copilot CLI reference checks `COPILOT_GITHUB_TOKEN` before `GH_TOKEN` and `GITHUB_TOKEN`, so it authenticates alone ([GitHub Docs, Copilot CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference), read 2026-11-16).
6. **The `:1password` wrapper scripts are removed.** `op run --environment` injected the same variables into the shell, a second path to the same sources. The dispatch reads the Environment itself.

## Consequences

- A maintainer with a populated `.sandcastle/.env` sees a refusal that says where credentials go instead, not a silent leak.
- A credential added to the shell for another reason, such as a GitHub token for `gh`, stays on the host: it is never in the allow-list for a container.
- Reading the Environment needs a 1Password CLI with Environments support.
- A new agent kind adds one entry to the per-kind table; the assertion needs no change.
