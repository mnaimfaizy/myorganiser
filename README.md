<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/images/logo-shield-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="apps/web/public/images/logo-shield.svg" />
    <img src="apps/web/public/images/logo-shield.svg" alt="MyOrganiser logo" width="220" />
  </picture>
</p>

<h1 align="center">MyOrganiser</h1>

<p align="center">
  A privacy-first personal organizer. Your data is encrypted in the browser — the server only ever sees ciphertext.
</p>

<p align="center">
  <a href="https://myorganiser.app" target="_blank"><strong>Live Demo →</strong></a>
  &nbsp;·&nbsp;
  <a href="#getting-started">Getting Started</a>
  &nbsp;·&nbsp;
  <a href="DEVELOPMENT.md">Developer Guide</a>
  &nbsp;·&nbsp;
  <a href="#documentation">Documentation</a>
</p>

<p align="center">
  <a href="https://github.com/mnaimfaizy/myorganiser/actions/workflows/ci.yml">
    <img src="https://github.com/mnaimfaizy/myorganiser/actions/workflows/ci.yml/badge.svg" alt="CI" />
  </a>
  <a href="https://myorganiser.app">
    <img src="https://img.shields.io/badge/demo-live-brightgreen" alt="Live Demo" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-Elastic%202.0-blue" alt="Elastic License 2.0" />
  </a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen?logo=node.js" alt="Node >=22" />
</p>

---

## What it is

MyOrganiser keeps the things you would rather not hand to a server — addresses, phone numbers,
subscriptions, tasks, groceries — in a vault that is encrypted and decrypted **in your browser**.
The key is derived from your passphrase and never leaves the device; the backend stores an opaque
blob it cannot read.

It is an Nx monorepo with three deployable apps: a Next.js web client, an Express API, and a React
Native mobile client that opens the same vault the browser wrote.

Three interactive pages explain the hard parts better than prose can. Open any of them in a
browser — no build step, no network, no server:

- **[Vault lifecycle](docs/vault/lifecycle.html)** — what happens over time, from creating a vault
  to restoring it on a new device.
- **[Vault trust boundary](docs/vault/trust-boundary.html)** — which zone holds keys, which holds
  only ciphertext, and what is allowed to cross.
- **[Session lifecycle](docs/authentication/session-lifecycle.html)** — one account from
  registration to revocation: which check rejects a login, and what "log everyone out" actually
  kills.

---

## Features

| Area               | What it does                                                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E2EE Vault**     | AES-GCM encryption in the browser — addresses, mobile numbers, subscriptions, tasks, groceries                                                                                                     |
| **Vault Backup**   | Export and import an encrypted envelope; optional Google Drive backup                                                                                                                              |
| **Authentication** | JWT access and refresh tokens, email verification, password reset                                                                                                                                  |
| **Mobile**         | React Native client sharing the vault format and auth contract                                                                                                                                     |
| **Phone web**      | Below 768 px the web app (and the Installed Web App) uses a phone shell: bottom tab bar, large titles, pushed screens with a back link, and a More screen at `/dashboard/more`                     |
| **YouTube**        | Server-side OAuth with a separate channel refresh and upload sync, a channels page, a channel-first directory, an in-session queue, and a time-capped Shorts budget                                |
| **Platform Admin** | User directory, disable and force-logout, role changes, durable audit log, and a Feedback inbox for triaging reports                                                                               |
| **Feedback**       | Send a Bug Report or Suggestion from anywhere in the dashboard; track status, Status Notes, and Release links on "Your reports" under `/dashboard/account`, with a badge for unseen status changes |
| **UI Library**     | Storybook-driven Radix component library built on W3C design tokens                                                                                                                                |
| **API Docs**       | OpenAPI generated from TSOA decorators, served at `/docs`                                                                                                                                          |

---

## Getting Started

**Prerequisites:** Node.js ≥ 22, Yarn ≥ 4 via [Corepack](https://nodejs.org/api/corepack.html),
and Docker for local Postgres and MailHog.

```sh
git clone https://github.com/mnaimfaizy/myorganiser.git
cd myorganiser
corepack enable
cp .env.example .env          # fill in database credentials and JWT secrets
corepack yarn install --immutable
docker-compose up -d          # Postgres + MailHog
yarn nx run backend:migrate
```

Then start the apps in separate terminals:

```sh
yarn start:backend       # http://localhost:3000 — API docs at /docs
yarn start:web   # http://localhost:4200
```

[DEVELOPMENT.md](DEVELOPMENT.md) covers everything past this point: architecture, testing, running
the mobile app, and the agent workflows.

---

## Repository layout

```
myorganiser/
├── apps/
│   ├── backend/          # Express + TSOA REST API, Prisma, PostgreSQL
│   ├── web/              # Next.js web client (App Router — route wrappers only)
│   ├── mobile/           # React Native client
│   ├── escape-copy-reader/ # Standalone offline vault Escape Copy reader (one HTML file)
│   └── web-e2e/          # Playwright end-to-end tests
├── libs/
│   ├── api-specs/        # OpenAPI spec, synced from TSOA decorators
│   ├── app-api-client/   # Generated API client — never edit by hand
│   ├── auth/             # Session module, route guards, refresh contract
│   ├── core/             # Shared utilities and types
│   ├── design-tokens/    # W3C DTCG tokens → CSS, TypeScript, Tailwind
│   ├── email-shell/      # Shared HTML/text email frame (logo, colours, footer)
│   ├── vault-core/       # Vault envelope format, crypto suite, Escape Copy reader core
│   ├── web/pages/        # One library per route — all page logic lives here
│   ├── web/ui/           # Radix component library
│   ├── web/usage-locations/ # Usage Location UI shared by Addresses and Mobile numbers
│   ├── web/vault/        # Browser vault state, crypto, cloud backup
│   ├── web/vault-ui/     # Vault-specific UI
│   ├── web/youtube/      # Browser YouTube API access shared by page libraries
│   └── mobile/           # Mobile screens, features, hooks, and UI
├── docs/                 # Architecture, features, ADRs, agent workflows
└── tools/                # Build, release, and repo-guard scripts
```

The web app enforces a strict thin-wrapper rule: `apps/web/src/app/**` holds routing,
metadata, and layout composition only, and every page's logic lives in `libs/web/pages/<route>/`.
Shared code belongs in `libs/**`, never in `apps/web/src/lib/**`.
A web library's folder under `libs/web/` records its scope; its import alias (`@myorganiser/web-ui`,
`@myorganiser/web-vault`, …) is stable and does not follow the folder.

---

## Where things are

This README is a front door, not a manual. Each of the files below is the single source of truth
for its area — restating them here is how they go stale, so this table points instead.

| Looking for                      | Go to                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| Package versions, and why        | [TECH_STACK.md](TECH_STACK.md)                                                         |
| Every available script           | the `scripts` block in [package.json](package.json)                                    |
| Environment variables            | [.env.example](.env.example)                                                           |
| Production and deployment config | [apps/backend/README.md](apps/backend/README.md), [docs/deployment/](docs/deployment/) |
| The words this codebase uses     | [CONTEXT.md](CONTEXT.md)                                                               |
| Contributor and agent workflows  | [AGENTS.md](AGENTS.md)                                                                 |
| License                          | [LICENSE](LICENSE) (Elastic License 2.0); third-party [NOTICE](NOTICE)                 |

---

## Documentation

| Document                                                                                     | Description                                                                    |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [DEVELOPMENT.md](DEVELOPMENT.md)                                                             | Complete developer guide — setup, workflow, architecture                       |
| [AGENTS.md](AGENTS.md)                                                                       | Contributor and agent workflows, branch naming, gates                          |
| [CONTEXT.md](CONTEXT.md)                                                                     | Domain glossary                                                                |
| [TECH_STACK.md](TECH_STACK.md)                                                               | Dependency versions and rationale                                              |
| [docs/adr/](docs/adr/)                                                                       | Architecture Decision Records                                                  |
| [docs/vault/README.md](docs/vault/README.md)                                                 | Vault architecture, plus the two interactive pages                             |
| [docs/authentication/README.md](docs/authentication/README.md)                               | JWT and session strategy, plus the session lifecycle page                      |
| [docs/agents/model-governance.md](docs/agents/model-governance.md)                           | Sub-agent fleet, model governance, orchestration                               |
| [docs/features/README.md](docs/features/README.md)                                           | Feature integration index                                                      |
| [docs/testing/README.md](docs/testing/README.md)                                             | Testing strategy and per-project tooling                                       |
| [docs/storybook/README.md](docs/storybook/README.md)                                         | Storybook setup                                                                |
| [docs/deployment/CI_CD_AND_RELEASE_PROCESS.md](docs/deployment/CI_CD_AND_RELEASE_PROCESS.md) | CI/CD and release process                                                      |
| [docs/sandcastle/RUNBOOK.md](docs/sandcastle/RUNBOOK.md)                                     | Autonomous agent dispatch                                                      |
| [libs/design-tokens/DESIGN.md](libs/design-tokens/DESIGN.md)                                 | Design system and token reference                                              |
| [LICENSE](LICENSE)                                                                           | Elastic License 2.0; see also [ADR 0024](docs/adr/0024-elastic-license-2.0.md) |

---

## License

Copyright 2024-2026 Mohammad Naim Faizy. Licensed under the
[Elastic License 2.0](LICENSE).

Earlier MIT badges were incorrect; this repository never shipped an MIT grant.
Pull requests are offered under the same license (GitHub inbound=outbound).
Vendored third-party notices live in [NOTICE](NOTICE).

---

<p align="center">
  <a href="https://nx.dev" target="_blank" rel="noreferrer">
    <img src="https://raw.githubusercontent.com/nrwl/nx/master/images/nx-logo.png" width="32" alt="Nx" />
  </a>
  &nbsp; Built with <a href="https://nx.dev">Nx</a> · <a href="LICENSE">Elastic License 2.0</a>
</p>
