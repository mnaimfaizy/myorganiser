# YouTube Integration Feature

## Overview

Allow users to securely link their YouTube account via OAuth 2.0, sync selected channel subscriptions, browse cached videos with sorting/searching/view modes, and receive periodic email notifications for new uploads.

## Architecture

### Data Flow

```
User ──OAuth 2.0──▶ Google  ──tokens──▶  Backend (encrypted at rest in DB)

  cPanel cron ──flock──▶ /cron/sync        cPanel cron ──flock──▶ /cron/digest
         │                                        │
         ▼                                        ▼
  Sync worker (lease: youtube-sync)        Digest worker (lease: youtube-digest)
  Refresh Cached Uploads                   New-only weekly mail
  (YouTube Data API)                       (EmailService + delivery ledger)
         │                                        │
         └────────────────┬───────────────────────┘
                          ▼
                     PostgreSQL
                  (cached metadata)
                          │
                          ▼
              Frontend Dashboard (DB queries only)
```

The two workers are deliberately independent. They hold separate database
leases, keep separate cursors, and run on separate cron entries, so a YouTube
quota stall or one slow account in sync can no longer swallow a week of digest
mail — which is exactly what the previous combined `sync-and-notify` job did.

Each endpoint processes one bounded slice of the User list per call and records
a resume cursor, so neither job has to finish inside a single cron tick.

### YouTube Data API v3 — Quota & Limits

| Endpoint             | Cost (units) | Notes                                                            |
| -------------------- | ------------ | ---------------------------------------------------------------- |
| `subscriptions.list` | 1            | Fetches user's subscribed channels (50 per page)                 |
| `playlistItems.list` | 1            | Fetches videos from a channel's "Uploads" playlist (50 per page) |
| `videos.list`        | 1            | Batch-fetch video details (up to 50 IDs per call)                |
| `search.list`        | **100**      | **Avoid** — extremely expensive                                  |

- **Default daily quota**: 10,000 units per project.
- **Strategy**: Use `playlistItems.list` (1 unit) to get upload IDs, then `videos.list` (1 unit, 50 IDs) for metadata. Never use `search.list`.
- **Estimated cost per user sync**: ~2-5 units per channel (1 page of playlist items + 1 batch video details). A user with 50 channels costs ~100-250 units.
- **Quota increase**: Can be requested via the Google Cloud Console if the user base grows.

### Security

#### OAuth 2.0 (Server-Side Web App Flow)

1. Backend generates a Google OAuth consent URL with scope `https://www.googleapis.com/auth/youtube.readonly`.
2. User authorizes in the browser; Google redirects back with an authorization code.
3. Backend exchanges the code for access + refresh tokens.
4. Tokens are **encrypted at rest** using AES-256-GCM with a server-side secret (`YOUTUBE_TOKEN_ENCRYPTION_KEY` env var) before storing in the database.
5. This is **separate from the E2EE Vault** — the server must be able to decrypt tokens to run background syncs when the user is offline.

#### Token Lifecycle

- Access tokens expire after ~1 hour; the `googleapis` library auto-refreshes using the stored refresh token.
- If a refresh token is revoked by the user via Google settings, the next sync attempt marks the YouTube Connection as `revoked`, records `revokedAt`, and the User is prompted to reconnect. Reconnecting clears `revokedAt`.
- After its normal work, each cron sync pass (inside the same worker lease, bounded by `SWEEP_MAX_CANDIDATES_PER_RUN` and `SWEEP_TIME_BUDGET_MS`) performs a YouTube Disconnect on every connection Revoked for seven days or more and on every connection whose User no longer has YouTube Access (ADR 0129). A connection with a live Channel Sync or Upload Sync is left for the next pass; a failed revocation at Google is expected there and logged at debug. Revoked rows that predate `revokedAt` are stamped on the first pass after deploy.

#### API Key for Cron Endpoint

- The `/api/v1/youtube/cron/sync` and `/api/v1/youtube/cron/digest` endpoints are protected by an `X-Cron-Secret` header validated against the `YOUTUBE_CRON_SECRET` env var.
- No JWT required — these endpoints are for server-to-server (cPanel cron) use only.

### Environment Variables (new)

| Variable                       | Purpose                                                                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `YOUTUBE_AVAILABLE`            | Backend switch (ADR 0091). Unset/`false`: every YouTube route 404s except the cron endpoints (succeed, do nothing) and `GET /youtube/availability` (reports it)                                                                 |
| `YOUTUBE_ACCESS_CEILING`       | Lifetime number of Users who may ever be granted YouTube Access (ADR 0129). Default `25`. A grant to a never-granted User is refused with 409 once reached; re-granting is free                                                 |
| `GOOGLE_CLIENT_ID`             | Google OAuth 2.0 client ID                                                                                                                                                                                                      |
| `GOOGLE_CLIENT_SECRET`         | Google OAuth 2.0 client secret                                                                                                                                                                                                  |
| `GOOGLE_REDIRECT_URI`          | OAuth callback URL (e.g. `https://api.example.com/api/v1/youtube/callback`). In production, with the switch on, the backend refuses to start unless this is `https`, is not `localhost`, and shares `APP_FRONTEND_URL`'s origin |
| `YOUTUBE_TOKEN_ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM token encryption                                                                                                                                                                                |
| `YOUTUBE_CRON_SECRET`          | Shared secret for authenticating cPanel cron requests                                                                                                                                                                           |

## Database Models

### `YouTubeIntegration`

Stores the user's OAuth connection to YouTube.

| Column                    | Type                          | Notes                                                    |
| ------------------------- | ----------------------------- | -------------------------------------------------------- |
| `id`                      | `String @id @default(cuid())` |                                                          |
| `userId`                  | `String @unique`              | FK → User                                                |
| `encrypted_access_token`  | `String`                      | AES-256-GCM encrypted                                    |
| `encrypted_refresh_token` | `String`                      | AES-256-GCM encrypted                                    |
| `token_iv`                | `String`                      | Initialization vector for AES                            |
| `token_auth_tag`          | `String`                      | GCM auth tag                                             |
| `status`                  | `String`                      | `connected` / `disconnected` / `revoked`                 |
| `revokedAt`               | `DateTime?`                   | When the connection became Revoked; cleared on reconnect |
| `createdAt`               | `DateTime`                    |                                                          |
| `updatedAt`               | `DateTime`                    |                                                          |

### `YouTubeSubscription`

Stores channels the user has chosen to sync.

| Column              | Type                          | Notes                                                                                                  |
| ------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `id`                | `String @id @default(cuid())` |                                                                                                        |
| `userId`            | `String`                      | FK → User                                                                                              |
| `channelId`         | `String`                      | YouTube channel ID                                                                                     |
| `channelTitle`      | `String`                      | Display name                                                                                           |
| `channelThumbnail`  | `String?`                     | URL to channel avatar                                                                                  |
| `uploadsPlaylistId` | `String`                      | The channel's "Uploads" playlist                                                                       |
| `enabled`           | `Boolean @default(true)`      | User can toggle sync on/off                                                                            |
| `lastSyncedAt`      | `DateTime?`                   | Stamp of the last Upload Sync that synced this channel                                                 |
| `lastSyncAttemptAt` | `DateTime?`                   | Stamp of the last Upload Sync that _attempted_ it, success or failure                                  |
| `lastSyncError`     | `String?`                     | Error code from the last failed attempt; null once one succeeds. Non-null makes this a Failing Channel |
| `createdAt`         | `DateTime`                    |                                                                                                        |
| `updatedAt`         | `DateTime`                    |                                                                                                        |

### `YouTubeVideo`

Cached video metadata from synced channels.

| Column        | Type                          | Notes                   |
| ------------- | ----------------------------- | ----------------------- |
| `id`          | `String @id @default(cuid())` |                         |
| `userId`      | `String`                      | FK → User               |
| `videoId`     | `String`                      | YouTube video ID        |
| `channelId`   | `String`                      | Which channel posted it |
| `title`       | `String`                      | Video title             |
| `thumbnail`   | `String?`                     | Thumbnail URL           |
| `publishedAt` | `DateTime`                    | Upload date             |
| `createdAt`   | `DateTime`                    |                         |

### `YouTubeNotificationSettings` (fields on User or separate)

| Column             | Type                          | Notes                                             |
| ------------------ | ----------------------------- | ------------------------------------------------- |
| `id`               | `String @id @default(cuid())` |                                                   |
| `userId`           | `String @unique`              | FK → User                                         |
| `intervalDays`     | `Int @default(7)`             | Legacy; not in the API contract, nothing reads it |
| `lastNotifiedAt`   | `DateTime?`                   | Last successful digest send; the window start     |
| `enabled`          | `Boolean @default(false)`     | Opt-in                                            |
| `optedInAt`        | `DateTime?`                   | Window start before the first send                |
| `preferredWeekday` | `Int @default(1)`             | 0 = Sunday .. 6 = Saturday, local                 |
| `timeZone`         | `String?`                     | IANA; null means UTC                              |
| `unsubscribeToken` | `String? @unique`             | Secret in every digest's unsubscribe link         |
| `createdAt`        | `DateTime`                    |                                                   |
| `updatedAt`        | `DateTime`                    |                                                   |

## API Endpoints

All under `/api/v1/youtube`, JWT-secured unless noted.

**YouTube Access (ADR 0129).** Every JWT-secured route below also requires the
signed-in User to hold YouTube Access; without it the route answers
`404 { "message": "Not Found" }`, the same body the `YOUTUBE_AVAILABLE` switch
produces (the switch is checked first). `GET /youtube/access` returns
`{ granted, state, withdrawnAt? }` for the signed-in User and is reachable
without access. `state` is `granted`, `not_granted` (never granted) or
`withdrawn` (granted once, now taken back); `withdrawnAt` is the time of the
withdrawal, stored in `User.youtube_access_withdrawn_at` — set by withdraw,
cleared by grant — and absent for Users withdrawn before that column existed.
The YouTube pages show the "Access withdrawn" notice for `withdrawn`. The
availability report, digest unsubscribe and cron routes are outside the
per-User check, and the sync and digest workers skip Users without access.
A Platform Admin grants and withdraws access with
`POST /admin/users/{userId}/youtube-access/grant|withdraw` (each writes an
Admin Audit Log entry; withdraw performs a YouTube Disconnect and reports
`youtubeDisconnect: completed | pending | not_connected`) and reads
`GET /admin/youtube-access` (`{ everGranted, ceiling }`).

| Method   | Path                     | Description                                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/auth-url`              | Returns Google OAuth consent URL. Refused with 409 `acknowledgement_required` until the User has accepted the one-time YouTube acknowledgement (ADR 0129)                                                                                                                                                                                                                                          |
| `GET`    | `/acknowledgement`       | `{ acknowledgedAt }` — when the User accepted the acknowledgement, or `null`                                                                                                                                                                                                                                                                                                                       |
| `POST`   | `/acknowledgement`       | Records the acknowledgement once; a repeat call returns the original time. Kept across disconnects and across a withdrawal and re-grant of YouTube Access                                                                                                                                                                                                                                          |
| `POST`   | `/callback`              | OAuth callback — exchanges `{ code }` JSON body for tokens (JWT-authenticated)                                                                                                                                                                                                                                                                                                                     |
| `GET`    | `/status`                | Returns integration status (`connected`/`disconnected`)                                                                                                                                                                                                                                                                                                                                            |
| `DELETE` | `/disconnect`            | Takes no body. Removes Followed Channels, Cached Uploads with their Watched marks, digest settings, digest deliveries, and the integration; nothing is kept for a reconnect (ADR 0129). Returns 409 `sync_run_live` while a Channel Sync or an Upload Sync is live. Token revocation is best-effort; a failure still disconnects locally and returns `revokeFailed` plus a Google permissions URL. |
| `GET`    | `/subscriptions`         | Lists all user's YouTube channel subscriptions                                                                                                                                                                                                                                                                                                                                                     |
| `PUT`    | `/subscriptions/sync`    | Channel Sync only: refreshes Followed Channels and does not fetch uploads. 5-minute cooldown. The web client does not wait — see below                                                                                                                                                                                                                                                             |
| `PUT`    | `/uploads/sync`          | Manual Upload Sync of Enabled Channels. 15-minute cooldown. Does not import Followed Channels. The web client does not wait                                                                                                                                                                                                                                                                        |
| `GET`    | `/sync-status`           | Upload Sync outcome (`status`, `retryAt`, `progress`) and Channel Sync outcome (`channelStatus`, `channelRetryAt`, `channelLastAttemptAt`, `channelLastError`)                                                                                                                                                                                                                                     |
| `PATCH`  | `/subscriptions/:id`     | Toggle a subscription enabled/disabled                                                                                                                                                                                                                                                                                                                                                             |
| `GET`    | `/videos`                | Returns cached videos with query params: `sort` (latest/oldest/az), `search`, `page`, `limit`                                                                                                                                                                                                                                                                                                      |
| `GET`    | `/notification-settings` | Returns digest preferences: opt-in flag, preferred weekday, time zone                                                                                                                                                                                                                                                                                                                              |
| `PATCH`  | `/notification-settings` | Updates opt-in flag, `preferredWeekday` (0-6), and IANA `timeZone`                                                                                                                                                                                                                                                                                                                                 |

| `POST` | `/digest/unsubscribe` | **Public**. Turns the digest off from the token carried by every digest email |
| `POST` | `/cron/sync` | **Cron-only** (X-Cron-Secret). One bounded pass of the metadata sync worker |
| `POST` | `/cron/digest` | **Cron-only** (X-Cron-Secret). One bounded pass of the weekly digest worker |

`POST /cron/sync-and-notify` was replaced by the two separate cron endpoints
above. Existing deployments must update their cron entries — see below.

## Channel Sync, Upload Sync, and visible progress

A **Channel Sync** refreshes Followed Channels and does not fetch Cached Uploads.
An **Upload Sync** refreshes Cached Uploads of Enabled Channels and does not
import channels. At most one of those attempts is live per User. Manual Channel
Sync is `PUT /subscriptions/sync` (5-minute cooldown). Manual Upload Sync is
`PUT /uploads/sync` (15-minute cooldown). The cron worker is an Upload Sync of
Enabled Channels and is not subject to that cooldown. Both manual paths and the
cron worker claim with one optimistic `updateMany`; losing the claim is a normal
outcome and returns the live attempt's status rather than an error.
[ADR 0096](../adr/0096-a-youtube-sync-is-either-a-channel-sync-or-an-upload-sync.md)
supersedes the combined Sync Run in ADR 0080.

A User-initiated run stays **inline in the request**, and the web client does not
block on the response. It fires the `PUT` and polls `GET /sync-status` every two
seconds while the run is live, which is how the page shows progress and how it
learns that a run it did not start (cron, another tab) has finished. For a run the
User started, the `PUT` response is also a completion signal: a run that finishes
before the first poll sees it live still refreshes the lists
([#753](https://github.com/mnaimfaizy/myorganiser/issues/753)). The response
counts as a run only when its status is one that did work and its attempt stamp
moved past the one read just before the request, because a lost claim answers with
an earlier run's stored status. Either path refreshes the lists at most once per
run. Express does not abort a handler when the client disconnects, so the run
finishes and records its outcome whether or not the tab is open — leaving the page
is safe, and the page picks a run in flight back up on mount. A gateway timeout on
the `PUT` is cosmetic: the poll covers a run too long for the request to return.
[ADR 0080](../adr/0080-a-user-initiated-sync-is-tracked-in-place-not-queued.md)
records why this is not a queued job: cron on the production host cannot tick more
often than every five minutes, so a queued run could not start sooner than that.

Progress is **derived**, not journalled. An Upload Sync stamps
`YouTubeIntegration.lastSyncAttemptAt` once and writes that same timestamp to
each Enabled Channel as it is attempted, so `processed`, `succeeded`, `failed`
and the Failing Channel list all read off the channel rows by equality on that
stamp. There is no run or job table. Channel Sync outcome is stored separately
(`lastChannelSyncStatus`) so a channel refresh does not wipe this progress.

Upload Sync statuses:

| Status           | Meaning                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discovering`    | Legacy only: a combined run from before the split, still paginating channels. New attempts do not use it                                                              |
| `running`        | Syncing Enabled Channels; `progress` counts are live                                                                                                                  |
| `success`        | Every Enabled Channel synced. No `progress` block — there is nothing to break down                                                                                    |
| `partial`        | A **Partial Sync**: some channels synced, some failed. `progress.failedChannels` names them, on the terminal read as well as mid-run                                  |
| `failed`         | No channel synced. `lastSyncError` of `syncInterrupted` means an **Interrupted Sync** — the process died mid-run, so what completed is known and what remained is not |
| `quota_exceeded` | The daily YouTube quota ran out; channels after the stall were never reached                                                                                          |
| `cooldown`       | A manual Upload Sync outcome, not a health state: the User asked again inside the 15-minute window                                                                    |

Channel Sync statuses are `discovering`, `success`, `failed`, `quota_exceeded`,
and `cooldown` (the 5-minute window). `discovering` has no per-channel count.

An Interrupted Sync is a **read-time projection**, not a stored status. An Upload
Sync whose persisted status is still `running` (or a legacy `discovering`) past
the 15-minute upload TTL is reported as interrupted, keeping its last known
counts. A Channel Sync whose status is still `discovering` past the 5-minute
channel TTL is reported as a failed channel refresh with `syncInterrupted`. Each
TTL equals that attempt's cooldown, so "declared dead" and "may retry" are the
same instant — ADR 0096 decision 3. Upload Sync progress stays channel-level;
there is no intra-channel counter.

## Weekly digest

- **Opt-in.** `YouTubeNotificationSettings.enabled` defaults to `false`, and
  connecting an account no longer switches it on. The migration also cleared
  the flag for rows created under the old opt-out default.
- **New only.** Eligible items are Cached Uploads from Enabled Channels that
  are still New (`watched = false`) and published after the window start.
  Watched uploads never appear.
- **Window** runs from the last successful send, falling back to `optedInAt`,
  then to when the account was connected — so opting in never back-fills every
  upload the account has ever seen.
- **The window filters on `publishedAt`, deliberately.** Two consequences,
  both intended:
  - Enabling a channel does not mail its back-catalogue. Those uploads are
    New and visible in the app, but they were published before the window
    opened, so they never appear in a digest. The digest answers "what is new
    this week across your Enabled Channels", not "what is new to you".
  - `lastNotifiedAt` only advances on a **successful send**, so a run of empty
    or failed weeks widens the next window rather than skipping those uploads.
    A long gap produces a fuller digest, never a lossy one — the 25-item cap
    is what bounds the email's size.
- **Long-form only.** Shorts are excluded: they live behind the Shorts Daily
  Budget on their own page, and the digest's per-item link is the long-form
  channel page.
- **Cap** of 25 items per email.
- **No interval knob.** The legacy `intervalDays` column remains on the row but
  is gone from the API contract and the UI — the digest is weekly and fires on
  `preferredWeekday`, so an interval control would do nothing.
- **Empty weeks skip.** No mail is sent, `lastNotifiedAt` does not advance,
  and no Digest Delivery is written, so a later tick the same local day
  (for example after sync catches up) can still send. See ADR 0016.
- **Preferred weekday** is evaluated against the User's own calendar using
  their stored IANA `timeZone` (null means UTC).
- **Idempotent ledger.** `YouTubeDigestDelivery` is unique on
  `(userId, periodKey)` where `periodKey` is the local ISO week, e.g.
  `2026-W33`. The row is claimed _before_ the mail reaches SMTP, so a worker
  that dies mid-send leaves a claimed row that no later pass re-sends: losing
  one week's digest is the deliberate trade against mailing it twice.
- **Unsubscribe** link in every email, backed by a stable per-User token, and
  every content link points back into MyOrganiser rather than youtube.com.

## Frontend Views

### YouTube Dashboard (`/dashboard/youtube`)

#### Channels (`/dashboard/youtube/channels`)

- Permanent management surface: the Followed Channel list, enable toggles, and
  **Refresh channels** (Channel Sync, 5-minute cooldown).
- **Disconnect** lives here. The confirmation names the stores it destroys.
  Watched marks are deleted with everything else and do not return on
  reconnect (ADR 0129). The button is disabled while a Channel Sync or an
  Upload Sync is live.

#### Watching home (`/dashboard/youtube`)

- Channel-first directory and queue. A **Channels** link opens the management page.
- **Sync uploads** starts an Upload Sync (15-minute cooldown). While one is live:
  the phase, a bar with channels processed of total, elapsed time, and — once at
  least five channels are done — a coarse estimate of the time left. The panel
  says syncing continues if the User leaves the page, because it does. Progress
  is channel-level only.
- After a Partial Sync, the channels that failed are named. After an Interrupted
  Sync, how far the run got.
- Channels known and uploads never pulled: an honest note and the Sync uploads
  control. No channels yet: a note linking to Refresh channels. Nothing starts
  an Upload Sync on its own, and the directory still renders.

#### Video Feed — Grid View (default)

- Unified list of all videos from enabled subscriptions.
- Sorting: Latest (default), Oldest, A-Z by title.
- Search bar filters the cached list by video title (client-side or server query).
- Responsive grid of video cards (thumbnail + title + channel name + date).

#### Video Feed — Carousel View

- Channels listed alphabetically.
- Each channel shows a horizontal carousel of videos (latest → oldest).
- Clicking a video opens it on YouTube in a new tab.

### Settings Page (existing account page extension)

- Weekly digest opt-in toggle.
- Preferred weekday select (Sunday-Saturday), evaluated in the browser's time zone.

## cPanel Cron Configuration

Production target is Namecheap Stellar Plus (`api.myorganiser.app`). Staging
is QA only — do not install these jobs there.

Trigger is **batched HTTP only**, via `tools/scripts/youtube-cron.sh`. That
wrapper takes a non-blocking `flock` and then `curl`s one worker. Do not add
a Node/CLI cron. The backend deploy zip does **not** include this script;
place a copy **outside** the Passenger app root so the next FTP deploy does
not delete it.

The wrapper sends `Content-Type: application/json` and an empty `{}` body even
though neither endpoint reads one. LiteSpeed on the production host answers a
POST carrying no content type and no body with its own 403 page, before the
request reaches Node. These routes can only return 401 or 200 from the app, so
an HTML 403 is always the web server, never the cron secret (#273).

The wrapper reads the status from `--write-out` rather than using
`--fail-with-body`, because that flag needs curl 7.76 and the production host
ships 7.61. A wrapper that uses it exits with `option --fail-with-body: is
unknown` before making any request, which looks like a dead cron rather than a
failed one.

### Host files (outside the Node app root)

```text
$HOME/bin/youtube-cron.sh          # copy of tools/scripts/youtube-cron.sh
$HOME/bin/youtube-cron.env         # mode 600; not in git
$HOME/bin/myorganiser-youtube-sync.lock
$HOME/bin/myorganiser-youtube-digest.lock
```

`youtube-cron.env`:

```bash
YOUTUBE_API_BASE_URL=https://api.myorganiser.app/api/v1
YOUTUBE_CRON_SECRET=          # same value as the Node.js App env var
YOUTUBE_CRON_LOCK_DIR=$HOME/bin
```

cPanel cron does not inherit Passenger env vars. The secret must exist in
**both** the Node.js App environment (so the API can validate
`X-Cron-Secret`) and this file (so the wrapper can send the header). Never
put the secret on the crontab line.

### Crontab (server time: America/New_York)

Two entries — inside the Stellar Plus budget (≥ 5 minute interval, ≤ 5 jobs):

```bash
*/15 * * * * set -a; . $HOME/bin/youtube-cron.env; $HOME/bin/youtube-cron.sh sync
0 * * * * set -a; . $HOME/bin/youtube-cron.env; $HOME/bin/youtube-cron.sh digest
```

After the production proof in #273, append `>/dev/null 2>&1` to both lines
so Namecheap cron mail does not fill inodes. Leave output visible until that
proof is done.

Sync at 15 minutes is for cursor resume (100 Users/tick), not because every
account must sync 96 times a day. Digest is **hourly**, not every 30 minutes:
`DIGEST_MAX_USERS_PER_RUN` is 200, which equals the Stellar Plus
200-emails-per-hour-per-domain cap. Two digest ticks in one hour can spend
the cap and get the sending script disabled.

Both endpoints are safe to call when there is no work: each pass is bounded,
resumes from its stored cursor, and no-ops while another pass holds the
lease. If `flock` is missing on the box, keep HTTP cron and treat the DB
lease (`ran: false`) as the overlap guard — do not add a CLI job.

Migrating from the old combined job: delete any
`/cron/sync-and-notify` entry. Leaving it in place will 404.

Both workers open on `YouTubeWorkerLease`, which arrived with the digest
migration. A deploy that applied the migrations but reused the Prisma client
generated before them answers every cron call with a 500 and logs `Cannot read
properties of undefined (reading 'updateMany')`. Run `npm run prisma:generate`
in the app root and restart the Node.js app — Passenger holds the old client in
memory, so regenerating alone changes nothing.

### Production SMTP

Use the existing `smtp` provider (not Gmail, not a transactional host).
Namecheap SMTP Restrictions often block outbound SendGrid/Mailgun/SES.

| Variable                         | Production value                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `DEFAULT_EMAIL_PROVIDER`         | `smtp`                                                                                |
| `MAIL_HOST`                      | cPanel **server hostname** (`businessNN.web-hosting.com`), not `mail.myorganiser.app` |
| `MAIL_PORT`                      | `465`                                                                                 |
| `MAIL_SECURE`                    | `true`                                                                                |
| `MAIL_USERNAME` / `EMAIL_SENDER` | `noreply@myorganiser.app`                                                             |
| `MAIL_PASSWORD`                  | that mailbox's password                                                               |

Create the `noreply@myorganiser.app` mailbox in cPanel. Publish SPF and DKIM
for the domain before calling mail ready. Auth verify/reset and YouTube
digests share this path.

Operator verification and the close bar for this recipe live on #273. Do not
close that issue until the production proof there is done.

## Testing Strategy

### Backend Unit Tests

- `YouTubeTokenEncryption.spec.ts` — encrypt/decrypt round-trip, invalid key handling.
- `YouTubeSyncService.spec.ts` — mock `googleapis`, verify DB writes, quota-efficient fetching.
- `YouTubeDigestService.spec.ts` — New-only eligibility, empty-week skip, ledger idempotency, worker separation from sync.
- `YouTubeSyncWorkerService.spec.ts` — lease acquisition, cursor resumption, revoked-token handling.
- `WorkerLeaseService.spec.ts` — acquire/steal-expired/release, cursor persistence.
- `localCalendar.spec.ts` — local weekday and ISO week key across time zones.
- `YouTubeController.spec.ts` — mock services, test endpoint responses and auth checks.

### Frontend Unit Tests

- `YouTubeDashboard.spec.tsx` — renders grid/carousel views with mocked data.
- `SubscriptionManager.spec.tsx` — toggle interactions, sync button.
- `VideoCard.spec.tsx` — renders video metadata correctly.
- `NotificationSettings.spec.tsx` — interval validation (2-15 range), save.

### E2E Tests

- OAuth flow (mocked Google redirect).
- Dashboard renders with subscriptions and videos.
- View toggle between Grid and Carousel.
- Settings interval update persists.

## Implementation Phases

1. **Phase 1 — Database & Schema**: Add Prisma models, run migration.
2. **Phase 2 — Backend Services**: Token encryption, YouTube API service, sync service, notification service.
3. **Phase 3 — Backend Controller**: TSOA endpoints, cron webhook.
4. **Phase 4 — Frontend Library**: Create `@myorganiser/web-pages/youtube`, build dashboard components.
5. **Phase 5 — Settings Integration**: Extend account settings page.
6. **Phase 6 — Testing**: Unit tests + E2E scaffolding.
