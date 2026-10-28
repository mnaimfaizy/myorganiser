# Vault Cloud Backup — Google Drive Integration

End-to-end documentation for the **vault cloud backup** feature: how it works,
how to configure Google OAuth credentials for it, the relevant code surface,
and troubleshooting.

> **Scope.** This document covers the cloud backup capability exposed on the
> consolidated `/dashboard/vault` page, alongside Export and Import. It is
> **separate** from the [YouTube integration](./google-youtube-oauth-setup.md)
> — they share Google Cloud as the OAuth provider but use different flows,
> scopes, and credentials.

> **New to the vault?** Two visual pages cover the architecture this feature sits
> on: [the lifecycle walkthrough](../vault/lifecycle.html) for what happens over
> time, and [the trust boundary map](../vault/trust-boundary.html) for what
> crosses which line. See [docs/vault/](../vault/README.md).

## Table of contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Google Cloud Console setup](#google-cloud-console-setup)
- [Production Google application](#production-google-application)
- [Sticky client ID](#sticky-client-id)
- [Environment variables](#environment-variables)
- [Frontend integration points](#frontend-integration-points)
- [Backend integration points](#backend-integration-points)
- [What the feature is for](#what-the-feature-is-for)
- [Linked, Not linked, Reconnect Needed](#linked-not-linked-reconnect-needed)
- [Newest copy age and the Escape Copy Age Limit](#newest-copy-age-and-the-escape-copy-age-limit)
- [Restore](#restore)
- [Retention and pending-file cleanup](#retention-and-pending-file-cleanup)
- [Troubleshooting](#troubleshooting)
- [References](#references)

---

## Overview

Vault cloud backup lets a user upload an encrypted snapshot of their personal
vault to **their own Google Drive `appDataFolder`** (a per-app hidden folder
that only this app can read or write).

Key properties:

- **End-to-end encrypted.** The vault is encrypted on the client using the
  same envelope as `Export Vault`. Google Drive (and Google) sees only
  ciphertext.
- **Browser-only OAuth.** The browser obtains an access token directly from
  Google Identity Services (GIS) using the **implicit token flow** with the
  `drive.appdata` scope. The backend **never** receives the user's Google
  access token.
- **No server-side Drive calls.** Upload, list, download, and delete all
  happen from the browser to `googleapis.com`.
- **Audit log only on the backend.** The backend is told _that_ a backup
  succeeded/failed (size, blob types, schema version, source =
  `google-drive`), so the vault page can show the age of the newest copy on
  any device via `GET /vault/backups/latest`. The success row is written only
  after Drive has confirmed the upload complete.

### How is this different from "Vault Export / Import"?

Cloud backup and Export/Import both live on the same `/dashboard/vault`
page — this isn't a separate page or route, just a different backup
mechanism offered alongside the manual file-based one:

| Capability       | Vault Export / Import                             | Vault Cloud Backup                                    |
| ---------------- | ------------------------------------------------- | ----------------------------------------------------- |
| Trigger          | Manual download / upload of a JSON file           | Manual "Back up now" + optional Escape Copy Age Limit |
| Storage          | User's local filesystem                           | User's Google Drive (`appDataFolder`)                 |
| Auth             | None beyond the app login                         | Google account (browser OAuth, scope `drive.appdata`) |
| Encryption       | Client-side envelope (E2EE)                       | Same client-side envelope (E2EE)                      |
| Server knowledge | Backup audit row (size, blobTypes, schemaVersion) | Same audit row, but with `source = 'google-drive'`    |

### How is this different from the YouTube integration?

| Capability               | YouTube integration                                                                                                      | Vault cloud backup                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| OAuth flow               | **Server-side web app flow** (`code` exchanged on backend)                                                               | **Browser implicit token flow** (GIS in the page)     |
| Token storage            | Encrypted at rest in Postgres (backend has refresh token)                                                                | In-memory only (browser); re-acquired on user gesture |
| Scopes                   | `youtube.readonly`                                                                                                       | `drive.appdata`                                       |
| Required env on backend  | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `YOUTUBE_TOKEN_ENCRYPTION_KEY`, `YOUTUBE_CRON_SECRET` | _none — backend stores no Drive token_                |
| Required env on frontend | _none_                                                                                                                   | `NEXT_PUBLIC_GOOGLE_CLIENT_ID`                        |

In production the two features use separate Cloud projects, so Drive backup
never waits on YouTube's sensitive-scope verification
([ADR 0091](../adr/0091-a-google-cloud-project-is-split-by-verification-not-by-environment.md)).
The YouTube production project is created in [#848](https://github.com/mnaimfaizy/myorganiser/issues/848);
the Drive production project is created here — do not reuse or duplicate that
YouTube project. Development and staging may share one Testing-project client
(it just needs both **Authorized redirect URIs** _and_ **Authorized JavaScript
origins** filled in) — see [Google Cloud Console setup](#google-cloud-console-setup)
below.

---

## Architecture

```
                         ┌──────────────────────────────────────────────┐
                         │  Browser (Next.js client)                    │
                         │                                              │
   user clicks ─────────▶│  CloudBackupCard                             │
   "Back up now"         │     │                                        │
                         │     ▼                                        │
                         │  useCloudBackup hook                         │
                         │     │                                        │
                         │     ▼                                        │
                         │  CloudBackupCoordinator                      │
                         │     ├──▶ encrypts vault (E2EE envelope)      │
                         │     │                                        │
                         │     ├──▶ GoogleDriveCloudBackupProvider      │
                         │     │       │                                │
                         │     │       │ POST /drive/v3/files           │
                         │     │       │ PATCH /upload/drive/v3/files   │
                         │     │       │ PATCH finalize metadata        │
                         │     │       ▼                                │
                         │     │   Google Drive (appDataFolder)         │
                         │     │   ciphertext only ✱                    │
                         │     │                                        │
                         │     └──▶ AuditReporter                       │
                         │            │ POST /vault/backups             │
                         │            ▼                                 │
                         └────────────┼─────────────────────────────────┘
                                      │
                                      ▼
                         ┌──────────────────────────────────────────────┐
                         │  Backend (Express + Prisma)                  │
                         │                                              │
                         │  VaultBackupController (JWT-protected)       │
                         │     POST /vault/backups        ▶ audit row   │
                         │     GET  /vault/backups/latest  ◀ "last      │
                         │     GET  /vault/backups            backup"   │
                         │                                              │
                         │  Stores ONLY the audit row                   │
                         │  (event, source, status, size, blobTypes…)   │
                         └──────────────────────────────────────────────┘
```

✱ The backend never holds the user's Google access token, never proxies a
Drive call, and never sees the plaintext vault.

---

## Google Cloud Console setup

The browser flow uses Google Identity Services (GIS). GIS validates two
things on every token request:

1. The **OAuth Client ID** (`NEXT_PUBLIC_GOOGLE_CLIENT_ID`).
2. The **JavaScript origin** of the page making the request.

> If you only set "Authorized redirect URIs" (the YouTube setup), GIS will
> reject the request with **`Error 400: origin_mismatch`**: the page's origin
> is not an authorized JavaScript origin of the client.

### Step 1 — Pick (or create) the Cloud project

| Environment           | Cloud project                                                                                                                           | Why                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Development / staging | Shared **Testing** project with YouTube ([ADR 0091](../adr/0091-a-google-cloud-project-is-split-by-verification-not-by-environment.md)) | Weekly reconnect is accepted there. One Web client can hold YouTube redirect URIs _and_ Drive JavaScript origins.                                      |
| Production            | **Dedicated Drive project** (this issue)                                                                                                | Consent, publishing, and quota belong to the project. `drive.appdata` is non-sensitive and must not wait on YouTube's `youtube.readonly` verification. |

[#848](https://github.com/mnaimfaizy/myorganiser/issues/848) creates the production
**YouTube** project. It does not create this Drive project. Do not put
`drive.appdata` on the YouTube production consent screen, and do not invent a
second Drive production project beside the one this runbook describes.

### Step 2 — Enable the Google Drive API

1. In the Cloud Console, go to **APIs & Services → Library**.
2. Search **Google Drive API** and click **Enable**.
3. _Do not_ also enable Drive Activity API or Drive Labels API; they aren't
   used.

### Step 3 — Configure the OAuth consent screen

On the shared **dev/staging** Testing project you can reuse the YouTube consent
screen and add the Drive scope. On the **production Drive** project, Branding
has no separate "purpose" or "description" field — only **App name** and
**App logo**. Distinction from YouTube is the App name plus Data Access, not
a second logo:

| Branding / access field    | YouTube production                      | Drive production                                         |
| -------------------------- | --------------------------------------- | -------------------------------------------------------- |
| **App name**               | `MyOrganiser`                           | `MyOrganiser Vault Backup`                               |
| **App logo**               | Same MyOrganiser shield (120 × 120 PNG) | Same file — one product                                  |
| Homepage / privacy / terms | `https://myorganiser.app`               | Same URLs                                                |
| **Data Access**            | `youtube.readonly` only                 | `drive.appdata` only                                     |
| Enabled API                | YouTube Data API v3                     | Google Drive API                                         |
| Client extras              | Authorized redirect URIs                | Authorized JavaScript origins; leave redirect URIs empty |

The logo to upload is `apps/web/public/images/google-oauth-app-logo.png`
(square PNG, 120 × 120, under 1 MB — Google's Branding spec). It is the same
shield as `apps/web/src/app/icon.svg`. Do not invent a Drive-only mark
or use a Google Drive icon.

1. **Google Auth platform → Branding** → fill:
   - **App name:** `MyOrganiser Vault Backup` (YouTube production stays
     `MyOrganiser` — this is the field that differs)
   - **App logo:** upload `google-oauth-app-logo.png`
   - Support email and developer contact
   - App domain links (homepage, privacy, terms) on `myorganiser.app` once
     those public pages exist
2. **User type:** External (or Internal for Workspace orgs).
3. **Data Access → Add or Remove Scopes** → add:
   `https://www.googleapis.com/auth/drive.appdata`

   The `drive.appdata` scope is _**not**_ classed as a sensitive or
   restricted scope, which means:
   - No **data-access** verification is required to publish in production.
   - The "unverified app" warning still appears in **Testing** mode for
     external users.
   - **Brand** verification is a separate check: without it, Google shows
     only the authorized domain on the consent screen, not the App name or
     logo. Name and logo still belong on Branding so they are ready when
     you submit.

4. **Audience → Test users:** while in Testing mode, add every Google
   account that needs to use cloud backup (your own dev account, QA users,
   etc.). External users not on this list will see `access_denied`.

Production Drive can move **Audience** from Testing to **In production**
without Google's app-verification review. Do that when you are ready for
Users; until then, only listed test users can complete the GIS popup. There
is no YouTube-style availability switch in this app: an empty
`NEXT_PUBLIC_GOOGLE_CLIENT_ID` is what keeps the card on _"Cloud backup is
not configured"_.

### Step 4 — Create / edit the OAuth Client ID

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. **Application type:** Web application.
3. **Authorized JavaScript origins** — add the page origins where the cloud
   backup UI loads (no trailing slash, no path):

   | Environment | Origin                                                                                                                                       |
   | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
   | Local dev   | `http://localhost:4200`                                                                                                                      |
   | Staging     | The Staging web address, the `WEB_ORIGIN` secret on the `staging` Environment (see [Web app on cPanel](../deployment/CPANEL_WEB_HOSTING.md)) |
   | Production  | `https://myorganiser.app` (see [Web app on cPanel](../deployment/CPANEL_WEB_HOSTING.md))                                                     |

4. **Authorized redirect URIs** — only needed if this same client is also
   used for YouTube; otherwise leave empty.

   | Used for | Redirect URI                                              |
   | -------- | --------------------------------------------------------- |
   | YouTube  | `http://localhost:4200/dashboard/youtube/callback` (etc.) |
   | Drive    | _(none — implicit flow has no redirect)_                  |

5. **Save.** Copy the **Client ID**. The Client Secret is _not_ needed for
   the Drive flow (it's a public OAuth client; Drive is browser-only).

   Treat that Client ID as **sticky** the moment it is used in production —
   see [Sticky client ID](#sticky-client-id).

### Step 5 — Verify the consent screen

Sign out of all Google accounts, then visit the dev app and click
**Connect Google Drive**. Confirm the popup shows:

- The correct app name (`MyOrganiser Vault Backup` on the production Drive
  client). Until brand verification is approved, Google may show only the
  domain `myorganiser.app` instead of the name and logo — that is expected.
- A **single** scope item: _"See, create, and delete its own configuration
  data in your Google Drive"_.

If you see additional scopes (`profile`, `email`, `youtube.readonly`, etc.)
the wrong client ID is wired up — check `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

---

## Production Google application

This is operator work in Google Cloud Console. The repository cannot create
the project. [#848](https://github.com/mnaimfaizy/myorganiser/issues/848) is
the YouTube production project; this section is the Drive one.

1. Create a Cloud project (name e.g. `MyOrganiser Vault Backup`).
2. Enable **Google Drive API** only ([Step 2](#step-2--enable-the-google-drive-api)).
3. Configure the consent screen with App name **MyOrganiser Vault Backup**,
   the shared shield logo, and scope `drive.appdata` only
   ([Step 3](#step-3--configure-the-oauth-consent-screen)).
4. Create a **Web application** OAuth client whose **Authorized JavaScript
   origins** include `https://myorganiser.app` and nothing else required for
   Drive. Leave redirect URIs empty.
5. Copy the Client ID into the production frontend **build** as
   `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (see [Environment variables](#environment-variables)).
   Do this **before** the production package step runs. The first enable
   needs no migration: no production Drive client exists yet.

Staging does **not** wait on this project. Point staging at the Testing
project client (it may share YouTube's) and add the staging origin under
**Authorized JavaScript origins**. Users on staging who are not test users
will still see `access_denied` until you add them or publish that Testing
app, which you should not.

---

## Sticky client ID

Google Drive's `appDataFolder` is scoped **per OAuth application**. The
hidden folder a User's Escape Copies live in belongs to the client that
wrote them. Changing production `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to a client
from a different Cloud project (or a newly created client) makes those
copies **invisible** to the new client — a data-loss-shaped outcome for
anyone who relied on Drive as their Escape Copy destination.

- **Never swap the production client casually.** A forced move needs its
  own ADR and a User-visible migration. Do not build that migration before
  a production client exists.
- Development and staging clients can still rotate: Testing-mode tokens are
  short-lived and those environments are not the User's Escape Copy home.
- Recording a new Client ID in the GitHub `production` Environment variable
  is the production cutover. Because the value is inlined at build time,
  the next `yarn package:web` in
  [Deploy Production](../deployment/CI_CD_AND_RELEASE_PROCESS.md) is what
  ships it.

---

## Environment variables

| Variable                       | Where used | Required for cloud backup | Notes                                                                                           |
| ------------------------------ | ---------- | :-----------------------: | ----------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Frontend   |          **Yes**          | Public OAuth client id, **inlined at build time**. Sticky in production. Empty = not configured |
| `GOOGLE_CLIENT_ID`             | Backend    |            No             | Used by the YouTube server-side flow                                                            |
| `GOOGLE_CLIENT_SECRET`         | Backend    |            No             | YouTube only                                                                                    |
| `GOOGLE_REDIRECT_URI`          | Backend    |            No             | YouTube only                                                                                    |

`NEXT_PUBLIC_GOOGLE_CLIENT_ID` is consumed in
[libs/web/pages/vault/src/components/VaultPageClient.tsx](../../libs/web/pages/vault/src/components/VaultPageClient.tsx).
If it is empty (or the GIS script fails to load) the page renders a
disabled card with the message _"Cloud backup is not configured…"_ instead
of the connect controls. That empty-value card **is** the off switch —
Drive has no YouTube-style production availability flag.

The same file also reads `window.__MYORG_GOOGLE_CLIENT_ID__` when the
build-time variable is absent. That fallback exists so Playwright can
enable the card without rebuilding
([vault-cloud-backup.spec.ts](../../apps/web-e2e/src/e2e/vault-cloud-backup.spec.ts)).
It is **not** a production configuration path. Do not inject the production
client id through `window` on a hosted origin.

The Vault operation policy answers first, though
([ADR 0068](../adr/0068-a-locked-vault-blocks-exactly-the-operations-that-need-the-master-key.md)).
While the User is signed out or this device holds no Local Vault, the card is
unavailable for that reason and says so, whatever the client ID is set to — with
nothing to back up, how Google Drive is configured is not why the card is
unavailable. The configuration messages above are shown only once the policy
permits cloud backup. A locked Vault does **not** hide the card: cloud backup
moves Ciphertext and needs no Master Key.

For Next.js to pick up the variable, restart `corepack yarn start:web`
after editing `.env`. `NEXT_PUBLIC_*` values are inlined at build time.

> **Ops — where to set it.**
>
> | Environment | Where the value lives                                                                                                                | Notes                                                                                                                                                                        |
> | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | Local       | `.env` as `NEXT_PUBLIC_GOOGLE_CLIENT_ID`                                                                                             | Testing-project client is fine; may share YouTube's.                                                                                                                         |
> | Staging     | GitHub Environment **variable** `NEXT_PUBLIC_GOOGLE_CLIENT_ID` on `staging` ([CI/CD](../deployment/CI_CD_AND_RELEASE_PROCESS.md))    | Testing-project client. Add the Staging web address as an Authorized JavaScript origin. Injected when CI runs `yarn package:web`, as for Production.                         |
> | Production  | GitHub Environment **variable** `NEXT_PUBLIC_GOOGLE_CLIENT_ID` on `production` ([CI/CD](../deployment/CI_CD_AND_RELEASE_PROCESS.md)) | Dedicated Drive client. Injected when CI runs `yarn package:web`. Setting it only in the cPanel Node.js app panel does nothing — the value is already baked into the bundle. |
>
> Changing the production value after Users have copies in `appDataFolder`
> is a [sticky-client](#sticky-client-id) event, not a routine rotate.

### Why there is no ADR 0043 gate

[#751](https://github.com/mnaimfaizy/myorganiser/issues/751) asked whether any
fact here is worth an [ADR 0043](../adr/0043-gates-assert-facts.md) Assertion
Gate, or whether this stays operational and documented only. The 2026-09-18
triage chose **ops + docs**: no new checker, and no YouTube-style availability
switch.

The facts that can fail in production are not in the repository. The Client ID
lives in a GitHub Environment **variable** on `production` that no `check-*.ts`
can read; a gate that demanded a non-empty value would also fail every local
commit that leaves `.env.example`'s `NEXT_PUBLIC_GOOGLE_CLIENT_ID=` blank (that
blank line **is** the off switch). The Cloud project, consent brand, and
Authorized JavaScript origins live in Google Cloud Console. Same shape as
[ADR 0091](../adr/0091-a-google-cloud-project-is-split-by-verification-not-by-environment.md)
leaving YouTube's production `GOOGLE_REDIRECT_URI` to a boot check rather than
a repo gate: the value is not an artifact a checker can compare.

What _is_ in git — `.env.example` declaring the name, and
`deploy-production.yml` injecting `vars.NEXT_PUBLIC_GOOGLE_CLIENT_ID` into
`yarn package:web` — is already visible to review. A dedicated
checker that only confirmed that one YAML line still would not catch the
operator failure that matters (the value stored as a Secret instead of a
Variable, or never set), so it would assert a fact that has never broken a
deploy. ADR 0043 rejects that kind of gate.

---

## Frontend integration points

```
libs/web/vault/src/lib/cloud/
├── coordinator.ts          # CloudBackupCoordinator — orchestrates upload+audit
├── googleDriveProvider.ts  # GoogleDriveCloudBackupProvider — GIS + Drive calls
├── googleIdentity.types.ts # GIS / window.google typings
├── preferences.ts          # localStorage prefs (Escape Copy Age Limit, retention)
├── promptError.ts          # CloudBackupPromptError — an attempt that never reached Google
├── scheduler.ts            # Escape Copy Age Limit check (poll + visibility/online)
└── types.ts                # Public CloudBackupProvider interface

libs/web/vault/src/lib/vault/auditReporter.ts
                            # POST /vault/backups (used by coordinator)

libs/web/pages/vault/src/
├── hooks/
│   ├── useCloudBackup.ts          # link / reconnect / backupNow / restore / ageLimit
│   ├── useGoogleIdentityScript.ts # loads https://accounts.google.com/gsi/client
│   ├── useLatestCloudBackup.ts    # newest export/success row, source='google-drive'
│   └── useVaultImportDisclosure.ts # what a restore or import does to credentials
├── components/
│   ├── CloudBackupLiveCard.tsx    # renders CloudBackupCard once GIS is ready
│   ├── CloudBackupUnavailableCard.tsx # disabled-state card
│   ├── ExportVaultCard.tsx
│   ├── ImportVaultCard.tsx
│   ├── ImportVaultReplaceDialog.tsx # confirms file import and Drive restore
│   └── VaultPageClient.tsx        # VaultPage — cloud backup, export, import
└── page.tsx

libs/web/pages/account/src/hooks/useLatestBackup.ts
                            # cross-source latest export — feeds the
                            # last-backup summary card on the account page,
                            # not the vault page

libs/web/vault-ui/src/lib/CloudBackupCard.tsx
                            # The visible card with all the buttons
```

The Next.js route wrapper at
[apps/web/src/app/dashboard/vault/page.tsx](../../apps/web/src/app/dashboard/vault/page.tsx)
is intentionally minimal — it just re-exports `VaultPage` from the
`@myorganiser/web-pages/vault` library.

The page is reachable from:

- **Sidebar → "Vault"** (added in
  [libs/web/pages/dashboard/src/components/app-sidebar.tsx](../../libs/web/pages/dashboard/src/components/app-sidebar.tsx)).
- **Account page → "Go to Vault →"** link
  in [AccountPageClient](../../libs/web/pages/account/src/components/AccountPageClient.tsx).

Two old routes redirect here permanently:
`/dashboard/vault-export` and `/dashboard/account/vault` (see
[apps/web/next.config.js](../../apps/web/next.config.js)).

---

## Backend integration points

The backend exposes three JWT-protected endpoints under `/api/v1/vault/backups`:

| Method | Path                                              | Purpose                                         |
| ------ | ------------------------------------------------- | ----------------------------------------------- |
| POST   | `/vault/backups`                                  | Append an audit row (called by `AuditReporter`) |
| GET    | `/vault/backups/latest?status=…&source=…&event=…` | Fetch latest matching audit row (404 if none)   |
| GET    | `/vault/backups?cursor=…&limit=…&source=…`        | Cursor-paginated list of audit rows             |

Schema highlights (Prisma model `VaultBackupRecord`):

- `event` — `export | import` (a Drive backup writes `export`, a Drive restore
  writes `import` — which is why anything reporting the newest copy filters on
  `event=export`)
- `source` — `local-file | google-drive` (extend the union to add providers)
- `status` — `success | failed`
- `errorCode`, `schemaVersion`, `blobTypes[]`, `sizeBytes`, `createdAt`

`source = 'google-drive'` is allow-listed in
[apps/backend/src/services/vaultBackupConstants.ts](../../apps/backend/src/services/vaultBackupConstants.ts);
adding a new cloud provider means extending that allow-list, regenerating
the OpenAPI client (`yarn openapi:sync && yarn api:generate`), and updating
the relevant page hooks/UI.

---

## What the feature is for

Vault Cloud Backup makes an **Escape Copy** (see `CONTEXT.md`): a whole-Vault
copy in storage the User controls, so their Ciphertext outlives MyOrganiser.
It is **not** how a Vault stays durable — the server already holds every Vault
Blob and converges it per record. So the feature promises no schedule, and a
months-old copy is not broken. What it owes the User is honesty about how old
the newest copy is, and about whether the link still works.

The backend never holds a Drive token and the feature never adopts the
authorization-code flow
([ADR 0062](../adr/0062-the-drive-escape-hatch-holds-no-token-we-could-lose.md)).
Service Workers cannot close the tab-must-be-open gap either; ADR 0062 records
why.

---

## Linked, Not linked, Reconnect Needed

Browsers block popups that aren't tied to a user gesture, and the GIS implicit
flow always opens one, so a token can never be obtained on page load. The
provider therefore reports only what it has recorded — `getConnectionState()`
never contacts Google:

| State              | Recorded by                                        | Card offers                  |
| ------------------ | -------------------------------------------------- | ---------------------------- |
| `not-linked`       | No link flag                                       | **Link Google Drive**        |
| `linked`           | A `connect()` that obtained a token                | Back up now, Restore, Unlink |
| `reconnect-needed` | Google itself refused a token request while linked | **Reconnect**, Unlink        |

```
myorganiser.cloudBackup.googleDrive.connected       = "1"   # linked (historical key name)
myorganiser.cloudBackup.googleDrive.reconnectNeeded = "1"   # a recorded refusal
```

Which failures count is precise, because Reconnect Needed survives a reload:

| What happened                                                              | Result                                                                  |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| GIS `callback` returns an `error` (`access_denied`, `consent_required`, …) | Reconnect Needed, if linked. A first link that fails stays Not linked.  |
| GIS `error_callback` with `popup_failed_to_open`                           | `CloudBackupPromptError('popup-blocked')`; stays Linked; error is shown |
| GIS `error_callback` with `popup_closed`                                   | `CloudBackupPromptError('popup-closed')`; stays Linked; nothing shown   |
| GIS not loaded, or `error_callback` with `unknown`                         | Stays Linked; the action's error is shown                               |

Without `error_callback`, GIS delivers a blocked or dismissed popup to nothing
and the token request never settles. Reconnect Needed clears on any successful
token and on Unlink. A Drive `401` on a held token drops that token, so the next
attempt asks Google, whose answer decides.

> **Implementation:**
> [libs/web/vault/src/lib/cloud/googleDriveProvider.ts](../../libs/web/vault/src/lib/cloud/googleDriveProvider.ts)
> — see `getConnectionState`, `connect`, `disconnect`, `acquireToken`, and
> `canRunWithoutPrompt`.

---

## Newest copy age and the Escape Copy Age Limit

The card always shows the **age of the newest Escape Copy** ("3 days old",
exact date on hover), read from
`GET /vault/backups/latest?event=export&status=success&source=google-drive`.
Because it is a server audit row, it is correct on any device and needs no
token.

Two rules keep that age honest:

- The coordinator holds back the export's `success` row until Drive has
  confirmed the upload `complete`. A failed upload writes a `failed` row
  instead, so it never reads as a new copy.
- A restore writes `import`, and the query filters on `export`, so restoring
  never resets the age.

The optional **Escape Copy Age Limit** (`off | 1-day | 1-week | 1-month`,
stored per device in `localStorage`; older `daily | weekly | monthly` values
are read as the matching limit) is a limit on staleness, not a clock:

- When the newest copy is older than the limit, or there is none, the card
  shows an **Overdue** notice next to _Back up now_. That notice is what the
  limit is for.
- While the page is open and the provider is Linked,
  [scheduler.ts](../../libs/web/vault/src/lib/cloud/scheduler.ts) checks every
  15 minutes and on `visibilitychange` / `online`. It backs up **only** when
  the copy is overdue **and** this tab already holds an unexpired token
  (`canRunWithoutPrompt()`). It never requests a token, so it never opens a
  popup and never records anything against the link.

---

## Restore

Restore replaces the whole Local Vault, so it is confirmed first
([ADR 0063](../adr/0063-a-restore-discards-the-evidence-it-holds-about-the-server.md)):

1. _Restore from Google Drive_ runs `coordinator.fetchLatestCopy()` inside the
   click, so the popup is allowed. Nothing is written. With no completed copy,
   the card says so.
2. The shared `ImportVaultReplaceDialog` opens with the same credential
   disclosure file import uses (ADR 0068), plus the copy's age and a note that
   the next sync will ask about anything that differs from the server.
3. Confirm runs `coordinator.restoreCopy(copy, handle)`, which imports **the
   bytes that were shown**. The import clears Sync Bookmarks for every type it
   writes, so the next Vault Reconcile asks instead of pushing the older copy
   over the server. Decline writes and audits nothing.

---

## Retention and pending-file cleanup

After every successful upload the coordinator calls `provider.pruneBackups`:

- Keeps the latest **N** completed files (default `CLOUD_BACKUP_DEFAULT_RETENTION = 10`).
- Deletes pending files older than `CLOUD_BACKUP_STALE_PENDING_MS` (24 h)
  to recover from interrupted uploads.
- Errors during prune are logged via `console.warn` and never block a
  successful backup.

Override defaults via `CloudBackupCoordinator` constructor options
(`retention`, `stalePendingMs`).

---

## Troubleshooting

| Symptom                                                              | Likely cause                                                                                  | Fix                                                                                                                                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Error 400: origin_mismatch` on connect popup                        | The page origin is not in **Authorized JavaScript origins** of the OAuth client.              | Add `http://localhost:4200` (and the Staging and Production origins) under **Credentials → OAuth client → Authorized JavaScript origins**.                                     |
| `Drive request failed: 403 …Drive API has not been used in project…` | Google Drive API is not enabled in the GCP project owning the OAuth client.                   | Enable **Google Drive API** in **APIs & Services → Library**.                                                                                                                  |
| `Drive request failed: 403 Insufficient Permission`                  | The user closed the consent popup before granting `drive.appdata`.                            | Click **Unlink**, then **Link Google Drive** again, leaving the scope checkbox checked.                                                                                        |
| `Drive request failed: 403 access_denied` / "App is blocked"         | Consent screen is in **Testing** and the user is not on the test-users list.                  | Add the email to **OAuth consent → Audience → Test users**, or publish the app.                                                                                                |
| Cloud backup card shows _"Cloud backup is not configured"_           | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is empty at build time (and the E2E window fallback is unset). | Set it in `.env` locally, or in the GitHub Environment variable on `staging` or `production`, then rebuild. Do not use `window.__MYORG_GOOGLE_CLIENT_ID__` on a hosted origin. |
| Brief popup flashes on every page load                               | Old build still calls `acquireToken({ interactive: false })` from `getConnectionState`.       | Pull latest `main`. Current code never re-acquires tokens outside a user gesture.                                                                                              |
| `[GSI_LOGGER]: Failed to open popup window … Maybe blocked…`         | A token request is happening outside a user gesture.                                          | The scheduler only uses `canRunWithoutPrompt()`, which never requests a token. If you patched it, restore the user-gesture-only invariant.                                     |
| Card stuck on "Working…" after closing the Google popup              | A build without `error_callback` on `initTokenClient`.                                        | Pull latest `main`; a dismissed popup now ends the action quietly.                                                                                                             |
| `POST /vault/backups → 401`                                          | The app's JWT access token expired or was signed with a different secret.                     | Logout → login. If still failing, check that `ACCESS_JWT_SECRET` matches between the running backend and the token issuer.                                                     |
| `GET /vault/backups/latest → 401`                                    | Same as above.                                                                                | Logout → login.                                                                                                                                                                |
| Connect button is disabled                                           | The GIS script (`https://accounts.google.com/gsi/client`) failed to load.                     | Check Network tab; common causes are content blockers, an offline state, or a strict CSP that omits `accounts.google.com`. Allowlist `*.gstatic.com` if needed.                |

When debugging Drive errors specifically, the provider re-reads the response
body and includes Google's `error.message` field in the thrown `Error`. The
exact error payload is logged in DevTools under the failing `googleapis.com`
request — it is the most authoritative source.

---

## References

- Google Identity Services — [token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- Drive API — [`appDataFolder` reference](https://developers.google.com/drive/api/guides/appdata)
- Drive API — [files.create with appProperties](https://developers.google.com/drive/api/reference/rest/v3/files)
- OWASP — [OAuth 2.0 implicit flow guidance](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html)
- Internal: [ADR 0062](../adr/0062-the-drive-escape-hatch-holds-no-token-we-could-lose.md), [ADR 0063](../adr/0063-a-restore-discards-the-evidence-it-holds-about-the-server.md), [ADR 0064 — standalone reader, not built yet (#792)](../adr/0064-an-escape-copy-is-opened-by-a-tool-that-needs-nothing-of-ours.md), [ADR 0039 — vault crypto suite](../adr/0039-web-and-mobile-vaults-share-one-crypto-suite.md), [ADR 0033 — local vaults are user-owned](../adr/0033-local-vaults-are-user-owned-and-never-silently-destroyed.md), [ADR 0091 — Google Cloud project split](../adr/0091-a-google-cloud-project-is-split-by-verification-not-by-environment.md), [vault overview](../vault/README.md)
- Sibling integration: [YouTube OAuth setup](./google-youtube-oauth-setup.md), [YouTube integration architecture](./youtube-integration.md)
