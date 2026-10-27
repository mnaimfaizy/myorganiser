# Web app on cPanel

How the MyOrganiser web app (Next.js, standalone output) runs as a Node.js
application on Namecheap cPanel shared hosting.

Both Staging's and Production's web app run this way, each beside its own
backend, which is described in
[Backend API on cPanel](CPANEL_BACKEND_HOSTING.md).

**The web app and its API must be on the same site on every environment.** The
refresh cookie is `SameSite=Lax`, so a browser sends it to the API only from a
page on the same site; on two sites, sign-in does not survive closing the web
app. In practice: host both on subdomains of one domain. Staging's deploy
asserts this before it packages and uploads the web bundle (the backend upload
comes first); Production relies on the rule. See
[ADR 0128](../adr/0128-the-web-app-is-hosted-on-the-same-site-as-its-api-and-staging-deploys-daily.md).

> The repository is public. Host, user, and app-root values are GitHub
> Environment secrets, never text in this file
> ([ADR 0056](../adr/0056-ci-owns-host-apply-without-describing-the-jail.md)).
> `<WEB_APP_ROOT>` below means the directory that environment's upload secret
> points at: `FTP_FRONTEND_DIR` on Staging, `FTP_PROD_FRONTEND_DIR` on
> Production. The Staging web address is the `WEB_ORIGIN` secret and is never
> written here.

## What differs between environments

| Concern                        | Staging                                                                            | Production                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Web origin                     | The Staging web address (`WEB_ORIGIN`), on the same site as Staging's `API_ORIGIN` | `https://myorganiser.app`                                            |
| `API_BASE_URL`                 | Staging's `API_ORIGIN` + `/api/v1`                                                 | `https://api.myorganiser.app/api/v1`                                 |
| Upload secrets                 | `FTP_HOST`, `FTP_FRONTEND_USERNAME`, `FTP_FRONTEND_PASSWORD`, `FTP_FRONTEND_DIR`   | `FTP_PROD_HOST`, `FTP_PROD_FRONTEND_USERNAME`, `…_PASSWORD`, `…_DIR` |
| Bundle upload                  | FTP, daily at 16:00 UTC from the newest green `main` commit, and on a dispatch     | FTP after Deploy Approval on a `release/vX.Y.Z` run                  |
| Going live                     | The run restarts the app and probes it ([below](#how-a-staging-deploy-goes-live))  | Manual install and restart on the host ([below](#production))        |
| Same-site check                | Asserted by the run before it packages                                             | The written rule only                                                |
| Service worker headers checked | By the run's probe                                                                 | By hand ([below](#service-worker-headers))                           |

## The bundle

```bash
yarn package:web
```

Produces `dist/deploy/web/`:

1. Next.js built with `output: 'standalone'` through the Nx `web:package`
   target (`tools/scripts/package-web.ts`).
2. A deploy-only `package.json` generated from `.next/standalone/node_modules`.
3. `.next/` and `public/` copied alongside.
4. A Linux-safe root `server.js` (avoids Windows path issues), and
   `CPANEL_STARTUP.md` naming it.

It contains no `node_modules`. CI builds and uploads this bundle; build it
locally only to inspect it.

The app reads its API location at **runtime** from `API_BASE_URL`, so changing
the API endpoint does not need a rebuild. `NEXT_PUBLIC_API_BASE_URL` is still
honoured as a build-time fallback for local development.

`NEXT_PUBLIC_GOOGLE_CLIENT_ID` (Vault Cloud Backup) is **not** a cPanel runtime
variable. Next inlines it when CI runs `yarn package:web`. Set it
as the GitHub Environment **variable** of the same name on `production` before
that package step; putting it only in this Node.js app panel leaves the baked
bundle unchanged. The value is sticky after first production enable — see
[Vault Cloud Backup](../features/vault-cloud-backup-google-drive.md#sticky-client-id).
Staging reads the variable of the same name on `staging`, at the same step.

On Staging the package step also sets `WEB_BUILD_ID` to the commit being
deployed, which `next.config.js` uses as the Next.js build id. The running
process puts that id in the HTML it renders, and that is how a run tells which
build is answering.

## One-time setup

The same for both environments, with that environment's values. cPanel →
**Setup Node.js App** → **Create Application**:

```
Node.js Version: 22.x
Application Mode: Production
Application Root: <WEB_APP_ROOT>
Application URL: https://myorganiser.app          (Staging: the Staging web address)
Application Startup File: server.js
```

Environment variables:

```bash
NODE_ENV=production
PORT=3000
API_BASE_URL=https://api.myorganiser.app/api/v1   # Staging: Staging's API_ORIGIN + /api/v1
OPERATOR_NAME=<legal operator name, or empty>
OPERATOR_CONTACT_EMAIL=<contact email, or empty>
```

The backend must list this origin in `CORS_ORIGINS`, and point
`APP_FRONTEND_URL` at it — see
[Backend API on cPanel](CPANEL_BACKEND_HOSTING.md#what-differs-between-environments).

Then append the service worker header block to the host's `.htaccess`, once
per environment — see [Service worker headers](#service-worker-headers).

Staging also needs its GitHub `staging` Environment settings before a run can
deploy: the secrets `WEB_ORIGIN`, `FTP_FRONTEND_USERNAME`,
`FTP_FRONTEND_PASSWORD` and `FTP_FRONTEND_DIR` (which must end with `/`), and
the variable `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. `FTP_HOST` and `API_ORIGIN` are
the ones the backend already uses. The list is in
[CI/CD and release process](CI_CD_AND_RELEASE_PROCESS.md#staging-main).

**Staging's cutover takes two dispatches.** The first run against a host with
no deploy state is always red with "install owed": nothing is known to be
installed, so the run uploads and does not restart.

1. Dispatch `Deploy Staging` in full. The web job fails with "install owed".
2. In cPanel, click **Run NPM Install**, then **Restart**, for the Staging web
   app.
3. Dispatch `Deploy Staging` in full again. The run now sees the process
   answering from the uploaded build, restarts it, and the probe passes.

`OPERATOR_NAME` and `OPERATOR_CONTACT_EMAIL` are Operator Fingerprints
([ADR 0086](../adr/0086-a-public-tree-hides-an-operator-not-a-product.md)).
The Privacy Policy and Terms of Service pages read them at request time.
Leave both empty to omit the Operator & Contact section rather than
rendering a placeholder.

If `www.myorganiser.app` should redirect to `myorganiser.app`, configure it in
cPanel **Domains** / **Redirects**.

## After an upload

An uploaded bundle is not live: it has no `node_modules`, and the running
process keeps serving the previous build until it restarts. The two
environments differ in who does the rest. Neither is Host Apply, which is
backend-only.

### How a Staging deploy goes live

First the `select` job decides whether the run deploys at all, and at which
commit. A dispatch always proceeds, at the commit it was dispatched at. A
scheduled run takes the newest `main` commit whose CI is green, or stops green
when there is none, and then checks these in order, looking at both the web
host and the latest backend upload (`decideSchedule` in
`tools/scripts/lib/staging-web-deploy.ts`):

| What the run finds, in order                                                                           | Outcome                                                                        |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| The commit predates the Staging web deploy, so its build cannot name itself                            | Stops green                                                                    |
| The Staging web address did not answer, or `WEB_ORIGIN` is unset                                       | **Fails**: unknown is not "nothing there"                                      |
| The running web app already serves that commit                                                         | Stops green — but **fails** if `/sw.js` lacks its two headers                  |
| An earlier run already uploaded that commit (web bundle or backend), and the web app is not serving it | **Fails** ([below](#when-a-scheduled-run-fails-with-uploaded-but-not-running)) |
| The web app or the backend holds a newer commit, which a dispatch put there                            | Stops green; the schedule never rolls Staging back                             |
| None of the above                                                                                      | Proceeds with that commit                                                      |

The run also fails if it cannot read the recent `Deploy Staging` runs from the
Actions API. Nothing is uploaded on any stop or failure.

Then the `deploy-frontend` job does this without a shell
(`tools/scripts/staging-web-deploy.ts`). The bundle is built from the selected
commit, while the job runs that script from a separate checkout of the tip
(`.deploy-tools`), so the workflow's steps and the script they call always
match ([ADR 0128](../adr/0128-the-web-app-is-hosted-on-the-same-site-as-its-api-and-staging-deploys-daily.md)). It has its own concurrency group and
is never cancelled in progress, because a cancelled FTP upload would leave half
a bundle on the host; a second run queues behind it.

1. **Same-site assertion.** Compares the last two hostname labels of
   `WEB_ORIGIN` and `API_ORIGIN` and fails when they differ. That is a rule of
   thumb, not the Public Suffix List: it is wrong for a two-label suffix such
   as `co.uk`.
2. **Package** with `yarn package:web`, the build id set to the
   commit.
3. **Plan.** Decides `restart` or `install-owed`. The host cannot be asked what
   is installed, so the run infers it from two requests: `/deploy-state.json`,
   a file in the bundle's `public/` that records the last upload's commit and
   a hash of its dependency list, and `/login`, whose HTML carries the build
   the process is running. When the process is running the last uploaded
   build, that build's dependencies are proven installed. The plan is
   `restart` only when the new bundle's dependency list matches the proven
   one.
4. **Upload** the bundle by FTP.
5. **Restart** (plan `restart` only): upload `tmp/restart.txt` on its own,
   last. The host restarts a Node.js app when that file changes.
6. **Probe** (plan `restart` only): request `/login` every 10 seconds for up to
   5 minutes until the HTML carries the commit, then request `/sw.js` and
   compare its `Cache-Control` and `Content-Security-Policy` with the exact
   expected values. A file served from disk does not count as proof the build
   is live; only the running process does.

A run that deploys is green only when the probe passes.

Two limits are accepted ([ADR 0128](../adr/0128-the-web-app-is-hosted-on-the-same-site-as-its-api-and-staging-deploys-daily.md)):

- "Installed" is inferred, not read: a build's dependencies count as installed
  because the running process answers from the build that was last uploaded.
- Between an upload that owes an install and the install itself, the new bundle
  is on disk under the old process, so a restart the host makes on its own in
  that window starts the new build on the old dependencies.

### When a Staging run fails with "install owed"

The bundle's dependency list differs from the one known to be installed (or
nothing is known yet, as on the first deploy). The bundle **is uploaded**, the
app was **not restarted**, and Staging still serves the previous build:
restarting onto missing packages would take it down.

1. cPanel → **Setup Node.js App** → the Staging web app → **Run NPM Install**.
2. Click **Restart**.
3. The next run sees the process answering from that build and treats its
   dependencies as installed: a scheduled run at the same commit stops green,
   and a dispatch restarts and probes. Dispatch `Deploy Staging` to see the
   probe pass now.

Do not leave it: until the install and restart are done, the next scheduled
run at that commit fails as described below.

### When a scheduled run fails with "uploaded but not running"

An earlier run already uploaded the newest green `main` commit — the web
bundle, or the backend, for example a dispatch whose web job failed — but the
running web app is not serving it. The run uploads nothing, because uploading
the same commit again fixes nothing.

- **If an install is owed** (the earlier run's web job said so): in cPanel,
  click **Run NPM Install**, then **Restart**, for the Staging web app. A
  dispatch is not a substitute; it would go red with "install owed" again.
- **Otherwise** (a restart did not take, or the web job failed before
  uploading): dispatch `Deploy Staging` in full at that commit.

A probe that times out instead ("did not answer from build … within 300s")
means the bundle is uploaded and the restart file was written, but the process
is not serving the new build. Read `stderr.log` in `<WEB_APP_ROOT>` and restart
from the panel.

### Production

The Production deploy uploads the bundle and stops; nothing on the host installs
or restarts the web app for it, and nothing probes it.

1. Click **Run NPM Install** in the Node.js app (required — the bundle has no
   `node_modules`).
2. Click **Restart**.
3. Load `https://myorganiser.app`, confirm API calls go to
   `https://api.myorganiser.app/api/v1/...`, and sign in once to confirm CORS
   and cookies.
4. Check the [service worker headers](#service-worker-headers).

## Service worker headers

`/sw.js` must never be cached and must be confined to same-origin scripts
([ADR 0127](../adr/0127-a-mobile-release-is-an-android-download-and-ios-is-the-installed-web-app.md)).
`next.config.js` sets both headers in `headers()`, but only a request that
reaches the Next.js process sees them. On cPanel the host's web server answers
a file under `public/` from disk, so on both environments that rule never runs
for `/sw.js`.

So the web server has to set them, from an `.htaccess` in the web app's
document root. That document root is the bundle's `public/` folder, and the
host already keeps its own `.htaccess` there: the Passenger configuration and
the app's environment variables, inside "DO NOT REMOVE" markers.

**The bundle never ships an `.htaccess`.** One uploaded to `public/` would
overwrite the host's file and take the app down. A test fails if
the app's `public/` folder holds an `.htaccess`, and Staging's plan step refuses a
bundle that contains one. Never upload an `.htaccess`, and never replace the
host's.

Instead, an operator appends a block **once per environment**, by hand, to the
host's existing `.htaccess` in the web app's document root — at the bottom,
below the host's managed blocks, changing nothing above it. Copy the block from
[`apps/web/deploy/sw-headers.htaccess`](../../apps/web/deploy/sw-headers.htaccess);
it lives outside `public/`, so it is never uploaded. It is not reproduced here
on purpose: the two values are stated in `next.config.js`, in that snippet, and
in the probe's constants, and `tools/scripts/lib/staging-web-deploy.test.ts`
fails when they fall out of step.

The rules sit inside `<IfModule mod_headers.c>`, so a web server without that
module ignores them silently. Staging's probe compares both headers with the
exact expected values on every deploy, so a missing or lost block turns the run
red. Production has no probe, so check it by hand after each install and
restart:

```bash
curl -sI https://myorganiser.app/sw.js
```

Expect both:

```
cache-control: no-cache, no-store, must-revalidate
content-security-policy: default-src 'self'; script-src 'self'
```

If either is missing, the block is not in the host's `.htaccess`: append it
again as above (file managers often hide dotfiles).

Not verified: whether the host keeps hand-added lines when it rewrites its
managed blocks, for example after an environment variable is changed in the
panel. Re-check `/sw.js` after changing the app's settings in the panel.

## Troubleshooting

### App loads but API calls fail

- `API_BASE_URL` is missing or wrong in the app's environment variables.
- The backend's `CORS_ORIGINS` does not include the web origin
  (`https://myorganiser.app`, and `https://www.myorganiser.app` if used; on
  Staging, the Staging web address).

### Sign-in is asked for again after the web app is closed

- The web app and its API are not on the same site, so the browser does not
  send the refresh cookie and the refresh request returns `401`. Host both
  under one domain ([ADR 0128](../adr/0128-the-web-app-is-hosted-on-the-same-site-as-its-api-and-staging-deploys-daily.md)).

### A scheduled Staging run is red in `Select Commit`

- The job summary says which. The commit is uploaded but not running: see
  [uploaded but not running](#when-a-scheduled-run-fails-with-uploaded-but-not-running).
- The Staging web address did not answer, or the `WEB_ORIGIN` secret is unset.
  Nothing was uploaded; check the app is up and the secret is set.
- Staging serves the commit but `/sw.js` lacks its two headers: see
  [Service worker headers](#service-worker-headers).
- The run could not read recent `Deploy Staging` runs from the Actions API.
  Re-run it.

### The Staging probe fails on `/sw.js` headers

- The message names the header and the value it got. The header block is
  missing from the host's `.htaccess`, was lost when the host rewrote the file,
  or differs from the snippet. Append it again — see
  [Service worker headers](#service-worker-headers) — then dispatch
  `Deploy Staging`.
- It is not forgiven on the next run: the build is live, but every scheduled
  run at that commit fails in `Select Commit` until the block is in place.

### 404s for static assets

- `.next/static` and `public/` must exist directly under `<WEB_APP_ROOT>`.

### Node app won't start

- Read `stderr.log` / `stdout.log` in `<WEB_APP_ROOT>`.
- The startup file must be exactly `server.js`.
- Dependencies missing: **Run NPM Install**, then restart.

## Monitoring and maintenance

- cPanel **Metrics** → Resource Usage.
- External uptime monitoring on `https://myorganiser.app`.
- Keep a copy of the last deployed `dist/deploy/web/` bundle.
