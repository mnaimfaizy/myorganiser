# Backend API on cPanel

How the MyOrganiser backend (Node/Express + Prisma) runs on Namecheap cPanel
shared hosting, for both Staging and Production. Staging and Production are
separate app roots with separate databases on the same kind of host; the
[environment table](#what-differs-between-environments) is the only place they
differ.

This document describes the host. It does not describe how a deploy is started
or approved — that is [CI/CD and release process](CI_CD_AND_RELEASE_PROCESS.md) —
and it does not carry the Host Apply sequence, which lives once, in
[Host Apply: operator setup](HOST_APPLY_OPERATOR_SETUP.md).

> The repository is public. Host, port, user, home paths, and app-root values
> are GitHub Environment secrets, never text in this file
> ([ADR 0056](../adr/0056-ci-owns-host-apply-without-describing-the-jail.md)).
> `<APP_ROOT>` below means that environment's `APP_ROOT` secret.

## What differs between environments

| Concern               | Staging                                                                                                                                                  | Production                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| API origin            | `API_ORIGIN` secret on the `staging` Environment                                                                                                         | `https://api.myorganiser.app`                                                                                                                        |
| Frontend it serves    | The Staging web app on cPanel, on the same site ([Web app on cPanel](CPANEL_WEB_HOSTING.md))                                                             | `https://myorganiser.app` on cPanel ([Web app on cPanel](CPANEL_WEB_HOSTING.md))                                                                     |
| `CORS_ORIGINS`        | The Staging web address (the `WEB_ORIGIN` secret on the `staging` Environment)                                                                           | `https://myorganiser.app,https://www.myorganiser.app`                                                                                                |
| `APP_FRONTEND_URL`    | That same Staging web address                                                                                                                            | `https://myorganiser.app`                                                                                                                            |
| `GOOGLE_REDIRECT_URI` | The Staging web address + `/dashboard/youtube/callback`                                                                                                  | `https://myorganiser.app/dashboard/youtube/callback`                                                                                                 |
| `YOUTUBE_AVAILABLE`   | `true` — Staging's Cloud project stays in Testing and needs no verification                                                                              | `false` until Production's Cloud project is verified ([ADR 0091](../adr/0091-a-google-cloud-project-is-split-by-verification-not-by-environment.md)) |
| YouTube cron jobs     | **Not installed** — Staging is QA only                                                                                                                   | Installed ([YouTube integration](../features/youtube-integration.md#cpanel-cron-configuration))                                                      |
| Version Floor         | `MOBILE_VERSION_FLOOR` empty unless testing a refusal                                                                                                    | `MOBILE_VERSION_FLOOR` empty until a Mobile Release is retired, then the lowest one served                                                           |
| Bundle upload         | Daily at 16:00 UTC from the newest green `main` commit, and on a dispatch                                                                                | After Deploy Approval on a `release/vX.Y.Z` run                                                                                                      |
| Host Apply            | Operator-dispatched `Deploy Staging` run. A Cut needs a full dispatch whose backend upload and Host Apply are green; the guard does not read the web job | Runs after Deploy Approval; required green before a Tag                                                                                              |

Everything not in this table is the same in both environments.

On every environment the API and the web app it serves must be on the same
site, because the refresh cookie is `SameSite=Lax`
([ADR 0128](../adr/0128-the-web-app-is-hosted-on-the-same-site-as-its-api-and-staging-deploys-daily.md)).

## The bundle

```bash
yarn nx run backend:package
```

Produces `dist/deploy/backend-api/` (and `backend-api.zip`):

- `main.js` — the startup file.
- A deploy-only `package.json` and `package-lock.json`, plus npm guardrail
  config, generated from the reviewed Yarn build output.
- `prisma.config.cjs` and the `prisma/` folder (schema and migrations).
- `CPANEL_STARTUP.md` with the exact startup file name.

It deliberately contains no `node_modules`. The Prisma client is generated on
the host, so it is built for the host's OS.

CI builds and uploads this bundle for you; build it locally only to inspect it.

## One-time setup per environment

### 1. Database

1. cPanel → **PostgreSQL Databases**.
2. Create a database and a user; grant the user ALL privileges on it.
3. The app reads it as
   `DATABASE_URL=postgresql://<user>:<pass>@localhost:5432/<db>`.

`DATABASE_URL` lives only in the Node.js app's environment variables on the
host. It is never a GitHub secret; Host Apply reads it from the host.

### 2. Node.js application

cPanel → **Setup Node.js App** → **Create Application**:

```
Node.js Version: 22.x
Application Mode: Production
Application Root: <APP_ROOT>
Application URL: <that environment's API origin>
Application Startup File: main.js
```

Do not use the cPanel **Run NPM Install** button for the backend. It runs a
plain `npm install`, which can re-resolve dependencies; Host Apply runs
`npm ci --omit=dev` against the bundled lockfile instead.

### 3. Environment variables

Set these in the Node.js app's **Environment Variables**. Values that differ
between environments are in the [table above](#what-differs-between-environments).

```bash
NODE_ENV=production
PORT=3000

# API routing
ROUTER_PREFIX=/api/v1

# CORS and email links — see the environment table
CORS_ORIGINS=<frontend origins, comma-separated>
APP_FRONTEND_URL=<frontend origin>

# Version Floor (ADR 0114) — see the environment table
MOBILE_VERSION_FLOOR=<lowest Mobile Release served, X.Y.Z; empty turns it off>

# Database
DATABASE_URL=postgresql://<user>:<pass>@localhost:5432/<db>

# JWT
ACCESS_JWT_SECRET=<strong-random>
REFRESH_JWT_SECRET=<strong-random>
VERIFY_JWT_SECRET=<strong-random>
RESET_JWT_SECRET=<strong-random>

# Mail — auth verify/reset and the YouTube weekly digest share this transport.
# EmailService reads DEFAULT_EMAIL_PROVIDER. The MAIL_SERVICE key in
# .env.example is not read by the app; setting it alone does nothing.
DEFAULT_EMAIL_PROVIDER=smtp
MAIL_HOST=<cpanel-server-hostname>   # businessNN.web-hosting.com, not mail.<domain>
MAIL_PORT=465
MAIL_SECURE=true
MAIL_USERNAME=noreply@<domain>
MAIL_PASSWORD=<mailbox-password>
EMAIL_SENDER=noreply@<domain>

# YouTube integration
YOUTUBE_AVAILABLE=<true once its Cloud project is verified, else false>
GOOGLE_CLIENT_ID=<oauth-client-id>
GOOGLE_CLIENT_SECRET=<oauth-client-secret>
GOOGLE_REDIRECT_URI=<frontend origin>/dashboard/youtube/callback
YOUTUBE_TOKEN_ENCRYPTION_KEY=<64-char-hex>
YOUTUBE_CRON_SECRET=<shared-secret>
FEEDBACK_RELEASE_SECRET=<deploy-secret>
```

`.env.example` in the repository has the full list.

- `MAIL_USERNAME` and `MAIL_PASSWORD` are read as a pair: set only one and the
  transport authenticates as nobody.
- Mail must work before any feature that sends: email verification, password
  reset, and the YouTube weekly digest all share one transport.
- `YOUTUBE_CRON_SECRET` must **also** exist in the cron wrapper's own env file on
  Production, because cPanel cron does not inherit Passenger environment
  variables. `YOUTUBE_API_BASE_URL` belongs only in that file, never here. The
  mailbox, SPF/DKIM, and crontab steps live in
  [YouTube integration](../features/youtube-integration.md#cpanel-cron-configuration).
- `FEEDBACK_RELEASE_SECRET` is the Production deploy's credential for
  `POST /feedback/releases/mark`, sent as `X-Deploy-Secret`
  ([ADR 0133](../adr/0133-a-feedback-report-becomes-fixed-when-the-production-deploy-ships-its-tracking-issue.md)).
  Use a value distinct from `YOUTUBE_CRON_SECRET`. While it is unset, the
  endpoint refuses every request. The same value goes in the `production`
  GitHub Environment — see
  [Release marking](CI_CD_AND_RELEASE_PROCESS.md#release-marking-production).
- YouTube is unavailable in production until its Cloud project is verified
  ([ADR 0091](../adr/0091-a-google-cloud-project-is-split-by-verification-not-by-environment.md)).
  Leave `YOUTUBE_AVAILABLE` unset or `false` until then. When it is `true` in
  production, the backend refuses to start unless `GOOGLE_REDIRECT_URI` is
  `https`, is not `localhost`, and shares `APP_FRONTEND_URL`'s origin — so set
  `APP_FRONTEND_URL` before flipping the switch on.
- Restart the app after changing any variable; Passenger reads them at boot.

### 4. Host Apply access

Before CI can take a bundle live, the environment needs a deploy key on the host
and its secrets filled in. Follow
[Host Apply: operator setup](HOST_APPLY_OPERATOR_SETUP.md) end to end, and run
`yarn host-apply:preflight <environment>` until it is green.

## How a bundle goes live

Uploading files changes nothing the running process uses. A bundle is live only
after **Host Apply** — install, migrate, regenerate the Prisma client, restart,
verify — has gone green for it. Release v0.4.0 served Production with four unapplied migrations, and
the deploy that fixed them still answered every cron call with a 500 because the
Prisma client predated the new models (#273, #437).

- **CI runs it.** Staging: dispatch `Deploy Staging` with SSH shell access
  switched on, in full. `apply_only` is only the retry after a dispatched
  upload whose Host Apply went red; never use it after an upload made by the
  daily schedule, which also cannot be Cut. Production: it follows Deploy
  Approval. See
  [CI/CD and release process](CI_CD_AND_RELEASE_PROCESS.md#host-apply-staging--production).
- **When Actions cannot connect**, the fallback is interactive SSH with the same
  sequence: [Break-glass](HOST_APPLY_OPERATOR_SETUP.md#break-glass). Do not keep a
  copy of the commands anywhere else; the operator guide records the host
  behaviours they depend on.

A green Host Apply already checks that no migration is pending, that `/docs`
answers, and that a wrong-secret cron call is rejected with `401` by the app
rather than by the web server.

One check it cannot make: that mail is actually delivered. `EmailService` hands
nodemailer a callback and logs failures rather than throwing, so a 2xx from the
API never proves delivery. After changing mail settings, trigger a password reset
for your own account and confirm the message arrives from `EMAIL_SENDER`.

## Troubleshooting

### CORS errors in the browser console

- `CORS_ORIGINS` must include the exact frontend origin for that environment
  (and `https://www.myorganiser.app` on Production if it is used).
- Restart the Node app after changing it.

### API works via curl but the frontend fails

- The frontend's `API_BASE_URL` is missing or wrong — see
  [Web app on cPanel](CPANEL_WEB_HOSTING.md).
- Router prefix mismatch: the API serves under `/api/v1`.

### Cron endpoint answers 404, HTML 403, or 500

- `404` — the running build predates the split cron endpoints; Host Apply has
  not run for the current bundle.
- HTML `403` — LiteSpeed refused the request before it reached Node. A POST with
  no `Content-Type` and no body is rejected on every path; send
  `Content-Type: application/json` and `{}`.
- `500` — usually a stale Prisma client. Dispatch Host Apply; do not patch the
  host by hand.

### Prisma errors

- Re-check `DATABASE_URL` in the app's environment variables.
- `Could not load --schema ... prisma/schema: file or directory not found` means
  the command ran outside `<APP_ROOT>`: the directory must contain
  `package.json`, `package-lock.json`, **and** `prisma/`.
- Pending migrations or a stale client: dispatch Host Apply.

### Node app won't start

- Read `stderr.log` / `stdout.log` in `<APP_ROOT>`.
- Missing environment variables, especially `DATABASE_URL` and the JWT secrets.
- Missing dependencies: dispatch Host Apply, which re-runs `npm ci --omit=dev`.

## Monitoring and maintenance

- cPanel **Metrics** → Errors / Resource Usage.
- External uptime monitoring on `https://api.myorganiser.app/docs` (Production).
- Regular PostgreSQL backups.
- Keep the last known good `backend-api.zip`. There is no automated rollback:
  a failed Host Apply leaves the host as it was, and recovery is a fix and a
  re-run, not a migrate-down.
