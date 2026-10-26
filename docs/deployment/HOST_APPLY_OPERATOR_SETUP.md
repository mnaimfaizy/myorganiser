# Host Apply: operator setup and first live apply

Issue [#569](https://github.com/mnaimfaizy/myorganiser/issues/569). The work in
[ADR 0056](../adr/0056-ci-owns-host-apply-without-describing-the-jail.md) gives CI
the ability to install, migrate, regenerate the Prisma client, restart, and
verify — but only once a human has put a deploy key on the host and real values
in the two GitHub Environments. Those cannot be invented in CI, which is why
this is the one slice of the PRD that stays human-only.

Do Staging end to end first. Production repeats it with its own values.

> This document names secrets and describes procedure. It never carries a host,
> port, user, path, or key value — the repository is public.

## What you are proving

Six things, in order. Each one is a way the first CI run could go red for a
reason CI cannot fix:

1. The runner can verify it is talking to the right host.
2. A deploy key gets in without a password.
3. A non-interactive shell can find `node` and `npm`.
4. `APP_ROOT` is the right tree, and holds a bundle new enough to have the
   Prisma scripts.
5. The Node.js Selector really holds `DATABASE_URL` for the pinned identity,
   at the path this repo assumes.
6. The API answers the two probes.

`yarn host-apply:preflight` checks all six against the real host without
changing anything on it. Run it until it is green, then let CI do the real thing.

---

## Step 1 — Make a deploy key

A key for CI alone, so it can be rotated without touching how you log in. No
passphrase: a passphrase-protected key cannot be used non-interactively, and
storing the passphrase alongside the key defeats the point.

```bash
ssh-keygen -t ed25519 -C "github-actions-host-apply" -f ~/.ssh/id_ed25519_myorg_deploy -N ""
```

Install the **public** half on the hosting account — cPanel → _SSH Access_ →
_Manage SSH Keys_ → _Import_, then **Authorize** it. Paste the contents of
`~/.ssh/id_ed25519_myorg_deploy.pub`. Never paste the private half anywhere but
the GitHub secret in Step 3.

Do **not** try to prove the key works yet. Step 2 has to come first: on a
machine that has never reached this host, an `ssh -o BatchMode=yes` attempt
fails at `Host key verification failed.` before it ever tries your key, because
`BatchMode` forbids the "continue connecting?" prompt and there is nothing on
disk to check the host against. That error says nothing about whether the key
was authorized.

## Step 2 — Verify and pin the host keys

`StrictHostKeyChecking=accept-new` is useless on a runner that is destroyed
after every job: it would trust whatever answered, every single time. The keys
are pinned as a secret instead — which means somebody has to establish, once,
what the right keys actually are.

Capture what the host presents:

```bash
ssh-keyscan -p <port> -t rsa,ecdsa,ed25519 <host> > ~/myorg-hostkeys.txt
ssh-keygen -lf ~/myorg-hostkeys.txt
```

**Now verify those fingerprints over a different channel**, before trusting
them. A `ssh-keyscan` you have not checked is trust-on-first-use with extra
steps: it pins whatever answered, including a machine in the middle.

The practical second channel is cPanel's browser _Terminal_, which you reached
over an authenticated HTTPS session rather than over the SSH connection you are
trying to verify. Ask the SSH daemon for its key from _inside_ the machine,
where there is no network path to sit in the middle of:

```bash
ssh-keyscan -p <port> 127.0.0.1 | ssh-keygen -lf -
```

Compare the `SHA256:` fingerprints against what your laptop's `ssh-keyscan`
returned. They must match exactly.

Do not reach for `/etc/ssh/ssh_host_*_key.pub` on shared hosting. The Terminal
is usually jailed (CageFS), so `/etc` there is a virtualised stub and the real
host keys are not in it — the glob simply fails to match. If `ssh-keyscan` is
also missing from the jail, ask `ssh` itself and read the key off the handshake:

```bash
ssh -v -o BatchMode=yes -p <port> 127.0.0.1 2>&1 | grep -i 'server host key'
```

If neither works, the remaining honest options are to scan from two or three
unrelated networks and require them to agree, or to open a support ticket and
have the host state the fingerprints. Both are weaker than the loopback check;
neither is as weak as not checking. If the fingerprints do not match, stop and
work out why before going further.

Once they match, trust them locally so your own SSH stops refusing:

```bash
cat ~/myorg-hostkeys.txt >> ~/.ssh/known_hosts
```

**Scan by the same name you will connect by.** A `known_hosts` entry is keyed on
the host string, so an entry captured for an IP does nothing for a connection
made to the hostname, and vice versa — you get `Host key verification failed.`
again and it looks like the pinning never worked. Since `SSH_HOST` should be the
hostname, scan the hostname. The key material is the same either way; only the
label at the start of each line changes, so you can confirm it against the
fingerprints you just verified rather than re-verifying from scratch.

The contents of `~/myorg-hostkeys.txt` are also exactly the `SSH_KNOWN_HOSTS`
value for Step 3 — all lines, unedited. Nothing here is wasted work.

## Step 2b — Now prove the deploy key

With the host key known, the `BatchMode` test finally means what it claims:

```bash
ssh -i ~/.ssh/id_ed25519_myorg_deploy -o BatchMode=yes -o IdentitiesOnly=yes -p <port> <user>@<host> 'echo ok'
```

`BatchMode=yes` forbids every interactive prompt, which is the condition a
GitHub runner works under. `IdentitiesOnly=yes` is the other half: without it
your local agent offers its other keys too, so the test can pass on a key CI
will not have. A runner starts with no agent and exactly one `-i`, and this
makes your laptop behave the same way.

`ok` means CI can get in. `Permission denied (publickey,...)` means the host
never accepted this key — it got past host verification, so this is now purely
about authorization:

```bash
ssh-keygen -lf ~/.ssh/id_ed25519_myorg_deploy.pub
```

Compare that fingerprint against what the account actually accepts, listed from
cPanel's Terminal (public keys only, nothing secret):

```bash
ssh-keygen -lf ~/.ssh/authorized_keys
```

Absent from that list means the key was imported into _Manage SSH Keys_ but
never **Authorized** — importing only stores it. Present but still refused is
usually permissions: `~/.ssh` must be `700` and `~/.ssh/authorized_keys` `600`,
and sshd silently ignores the file when either is looser.

## Step 2c — Find the four host-specific values

`APP_ROOT`, `NODEVENV_ACTIVATE`, `SELECTOR_APP_KEY` and `API_ORIGIN` describe
this host, so they have to be read off it rather than guessed.

Three of them are on one cPanel page. **Setup Node.js App** → your backend app
shows, near the top, the command to enter the app's environment. It reads like
`source <activate script> && cd <app root>`. Those two paths, exactly as
printed, are `NODEVENV_ACTIVATE` and `APP_ROOT`. `API_ORIGIN` is that app's
Application URL, without a trailing slash.

`SELECTOR_APP_KEY` is the identity the Node.js Selector files the app under,
which is not always what the UI displays. This reads all of it off the host in
one go — every app environment, and the identities the store knows:

```bash
ssh -i ~/.ssh/id_ed25519_myorg_deploy -o BatchMode=yes -o IdentitiesOnly=yes -p <port> <user>@<host> 'bash -s' <<'REMOTE'
echo "=== activate scripts (one per Node.js app) ==="
find "$HOME/nodevenv" -maxdepth 4 -name activate -type f 2>/dev/null | sort
echo
echo "=== selector identities ==="
store="$HOME/.cl.selector/node-selector.json"
if [ ! -f "$store" ]; then echo "no $store"; exit 0; fi
act=$(find "$HOME/nodevenv" -maxdepth 4 -name activate -type f 2>/dev/null | head -1)
[ -n "$act" ] || { echo "store exists but no activate script to run node with"; exit 0; }
. "$act"
node -e 'const fs=require("fs");console.log(Object.keys(JSON.parse(fs.readFileSync(process.env.HOME+"/.cl.selector/node-selector.json","utf8"))).join("\n"))'
REMOTE
```

Each activate path is one app's `NODEVENV_ACTIVATE`, and the path segment under
`nodevenv/` is that app's root — so this also answers whether you have one
Node.js app or two. The second block prints top-level keys only, never a value.

Do not `cat` the store: it holds every app's environment, `DATABASE_URL`
included. If it reports the file is absent, that is a useful result rather than
a failure — the preflight in Step 5 probes the other candidate locations and
reports which one is real.

**You need both environments' app roots before either can run.**
`COUNTERPART_APP_ROOT` is the other environment's `APP_ROOT`, so read the same
cPanel page for the Production app too, even while you are setting up Staging.
If Staging and Production are not yet two separate Node.js apps with two
separate roots, stop and create the second one — the guard exists precisely
because one account holds both, and there is nothing to guard if they are the
same tree.

## Step 3 — Fill in the GitHub Environments

`Settings → Environments → staging` (then repeat for `production`). Same ten
names in both, different values.

| Secret                 | Where its value comes from                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `SSH_HOST`             | The hostname you SSH to. Prefer the name over a bare IP: shared-hosting addresses get renumbered, and a hostname survives it. |
| `SSH_PORT`             | The port you SSH to.                                                                                                          |
| `SSH_USER`             | The cPanel account you SSH as.                                                                                                |
| `SSH_PRIVATE_KEY`      | The **whole** `id_ed25519_myorg_deploy` file, including both `-----` lines.                                                   |
| `SSH_KNOWN_HOSTS`      | The verified `ssh-keyscan` output from Step 2.                                                                                |
| `APP_ROOT`             | This environment's backend application directory, absolute.                                                                   |
| `COUNTERPART_APP_ROOT` | The **other** environment's `APP_ROOT`.                                                                                       |
| `NODEVENV_ACTIVATE`    | The Node virtualenv `activate` script, absolute.                                                                              |
| `SELECTOR_APP_KEY`     | The identity cPanel files this app under in the Node.js Selector.                                                             |
| `API_ORIGIN`           | This environment's API base URL, no trailing slash.                                                                           |

Two of these are worth dwelling on.

**`COUNTERPART_APP_ROOT` is crossed over.** In the `staging` environment it
holds _Production's_ root; in `production` it holds _Staging's_. Both jobs
refuse to run when their two values are equal. The hosting account is shared, so
an SSH principal that can apply to Staging can reach Production's tree — this
pin is the only thing standing between a typo in `APP_ROOT` and a Staging run
migrating Production. Get these backwards and both environments refuse, which is
the safe direction to be wrong in.

**`APP_ROOT` and `NODEVENV_ACTIVATE` must be absolute.** The remote command runs
`cd "$APP_ROOT"` before anything else, from whatever directory the SSH session
lands in.

Confirm what the Selector calls the app before you set `SELECTOR_APP_KEY` — Step
5 checks it, but it is the value most likely to be wrong on the first try.

`DATABASE_URL` is deliberately **not** on this list. Putting it in GitHub would
make Actions a second copy of the database credential, and it would drift from
the value the app actually boots with. Host Apply reads it on the host, for
`SELECTOR_APP_KEY` only, and never prints it.

## Step 4 — Confirm the app has `DATABASE_URL` in the Selector

cPanel → _Setup Node.js App_ → your app → **Environment variables**.
`DATABASE_URL` must be set there, on the app, not only in an app-root `.env`.
Do not open or echo the value — you are confirming presence, and Step 5 does
that for you without reading it.

## Step 5 — Run the preflight

This is the part that replaces guessing. From a checkout of this branch:

```bash
export SSH_HOST=<host> SSH_PORT=<port> SSH_USER=<user>
export SSH_KEY_FILE=~/.ssh/id_ed25519_myorg_deploy
export APP_ROOT=<staging app root> COUNTERPART_APP_ROOT=<production app root>
export NODEVENV_ACTIVATE=<staging activate script>
export SELECTOR_APP_KEY=<staging selector identity>
export API_ORIGIN=<staging api base url>
yarn host-apply:preflight staging
```

These are shell variables for one command, not entries for `.env.example` —
none of them is application configuration. Run it in a throwaway shell, or
`unset` them afterwards.

Leave `SSH_KNOWN_HOSTS` out of the first run — the preflight will print the keys
for you to verify and paste into the secret, then pass once you supply it.

It changes nothing on the host: no `npm ci`, no migrate, no generate, no
restart. Every remote command reads. It runs the _same_ `APP_ROOT` guard, the
_same_ virtualenv activation and the _same_ probe grading the CI job uses, so a
value that fails here fails there.

Its output has two sections, and only the first is a gate. **Readiness** is what
must hold before an apply can run — secrets, guard, connection, tree, store.
**Post-apply health** is the state an apply is supposed to produce, and on a
backend that has never been applied it cannot pass: with no `node_modules`,
Passenger cannot boot the app, so `/docs` answers 503 and the cron probe answers
from the host rather than from the API. Red health with green readiness is the
normal state immediately before a first apply. After one, red health is a real
defect.

All remote output is passed through the same redaction scrubber CI uses before
it reaches your terminal, so a host that echoes a connection string cannot paint
it across your scrollback.

### Reading the failures

| Check               | What a failure means                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ROOT guard`    | The two roots are equal, or one is unset. Fix the secret; do not remove the guard.                                                                                   |
| non-interactive SSH | The key is not authorized, or the account requires a password. Back to Step 1.                                                                                       |
| host key pin        | Expected on the first run — it prints what to paste. After that, the pin does not match what answered. Investigate, do not overwrite.                                |
| Node virtualenv     | `NODEVENV_ACTIVATE` is wrong, or the shell is jailed without `node`. A raw SSH `PATH` usually has no `node` — that is why the sequence sources the virtualenv first. |
| `APP_ROOT` on host  | Wrong tree, or the uploaded bundle predates `prisma:migrate:status`. Re-upload a bundle built from this branch.                                                      |
| restart trigger     | `tmp/` is not writable. The apply creates it if absent, but cannot fix permissions.                                                                                  |
| selector store      | Either the identity is wrong, or `DATABASE_URL` is not set on the app — **or** the Selector keeps its store somewhere this repo does not pin. See below.             |
| HTTP probes         | `/docs` not 2xx means Passenger is not up. A cron `500` means a stale Prisma client; `403` HTML means a host challenge page answered instead of the API.             |

### If the selector store is somewhere else

`buildSelectorLoadStep` reads `SELECTOR_STORE_PATH` and `SELECTOR_ENV_FIELD` in
`tools/scripts/lib/host-apply.ts` — currently `~/.cl.selector/node-selector.json`,
keyed by domain, with the app's variables under `env_vars`. That was confirmed
against a real CloudLinux account during #569, replacing the engine's original
guess of `~/.cpanel/nodejsapps.json` under `envvars`. Both halves of the guess
were wrong, which is a fair warning that another host may differ again.

The preflight probes several candidate paths and field names and tells you which
one actually holds the value. If it reports a path or field other than the
pinned pair, it fails on purpose and names both. Change those two constants,
rerun `yarn host-apply:test`, and rerun the preflight. A wrong pin fails closed
— the apply refuses rather than reading another app on the account — so being
wrong here costs a red preflight, never a bad migration.

`SELECTOR_APP_KEY` is that store's top-level key for your app, which on this
host is the domain rather than the app root.

## Step 6 — First real Staging apply

Only once the preflight is green.

**Staging Host Apply does not run on its own.** The daily schedule uploads a
bundle from the newest green `main` commit, but nothing applies it until you
dispatch the workflow. SSH shell access on this account is a manual toggle that
reverts, so an automatic apply would go red on every night the shell happened
to be off. That is a
deliberate amendment to PRD #565 user story 3, and it has a cost worth stating
plainly: **an uploaded Staging bundle is not a migrated Staging backend.**
Between an upload and your dispatch, Staging is running new code against an old
schema — the exact shape of the incident this whole feature exists to prevent,
now confined to Staging and to a window you control.

1. Enable SSH shell access on the hosting account. Confirm it is actually on:
   `ssh -i <key> -o BatchMode=yes -o IdentitiesOnly=yes -p <port> <user>@<host> 'echo ok'`.
   A reverted toggle answers `Shell access is not enabled on your account!`
   after authenticating, which is what a red `host-apply` will look like.
2. _Actions → Deploy Staging → Run workflow._ Leave `apply_only` unticked for
   upload → apply in one go. Tick it only to retry the apply of a bundle a
   dispatch uploaded, never for one the daily schedule uploaded. A
   full dispatch also deploys the Staging web app at the same commit; that is
   a separate job with no shell, and is not Host Apply
   ([Web app on cPanel](CPANEL_WEB_HOSTING.md#how-a-staging-deploy-goes-live)).
3. Watch the `host-apply` job. The `Host Apply output (redaction-checked)` step
   is where the on-host log appears — it is withheld rather than printed if it
   carries a connection string.
4. Green means: migrations applied, client regenerated, Passenger restarted,
   `/docs` 2xx, and a wrong-secret cron POST answered `401`.

**If it goes red, do not fix it by hand on the host.** The sequence is
fail-closed: the first failing step aborts everything after it, so the host is
left as it was rather than half-applied. There is no rollback and no
migrate-down, by design. Read the failing step, fix the cause, and re-run.

## Step 7 — Prove re-run without upload

The reason `apply_only` exists: recovering from a blip should not mean pushing a
new bundle.

_Actions → Deploy Staging → Run workflow →_ tick **`apply_only`** → run. The
upload jobs skip; `host-apply` runs alone against the bundle already on the host.
This should be green immediately after Step 6, and it is worth doing once while
things are known-good rather than discovering it during an incident.

**Never use `apply_only` after a scheduled upload.** `host-apply` checks out
the tip of the dispatched ref, which may not be the commit the schedule
uploaded, so the apply could run one commit's sequence against another's
bundle. A scheduled run also does not record which commit it uploaded, so
`release:cut` refuses a scheduled upload whether or not anything was applied
afterwards. To apply what the schedule uploaded, and before any Cut, dispatch
`Deploy Staging` in full — `apply_only` unticked — at the commit you want
([ADR 0128](../adr/0128-the-web-app-is-hosted-on-the-same-site-as-its-api-and-staging-deploys-daily.md)).

## Step 8 — Production

Staging is done and proven. Production has never run, and it happens at release
time — possibly months later, possibly under pressure. This section is therefore
written to stand on its own rather than as "repeat the above".

### 8a. Secrets

The `production` Environment needs the same ten names as `staging`, with these
four **different**:

| Secret                 | Production value                                              |
| ---------------------- | ------------------------------------------------------------- |
| `APP_ROOT`             | the Production app's root                                     |
| `COUNTERPART_APP_ROOT` | **Staging's** `APP_ROOT` — crossed the other way from Staging |
| `SELECTOR_APP_KEY`     | the Production app's identity in the selector store           |
| `API_ORIGIN`           | the Production API base URL, no trailing slash                |

`SSH_HOST`, `SSH_PORT`, `SSH_USER`, `SSH_PRIVATE_KEY` and `SSH_KNOWN_HOSTS` may
be identical to Staging's when it is the same hosting account. Read the four
different ones off **Setup Node.js App** for the Production app, exactly as
Step 2c describes.

Get `COUNTERPART_APP_ROOT` backwards and both environments refuse. That is the
safe direction to be wrong in, and it is the only guard standing between a typo
in `APP_ROOT` and Production being migrated by the wrong job.

### 8b. Prove it before the release, not during it

```bash
yarn host-apply:preflight production
```

Nothing about Production has been verified — not its selector entry, not its
virtualenv, not its app root. Run this **well before** you need the release, so
a wrong value is a quiet afternoon rather than a blocked deploy. All readiness
checks must pass; post-apply health may legitimately be red if Production is
mid-deploy.

Enable SSH shell access first — it is a manual toggle that reverts, and every
SSH-based check fails with `Shell access is not enabled on your account!` when
it is off.

### 8c. The release itself

1. Cut the release branch. `release:cut` refuses unless **Staging Host Apply
   is green for the commit being cut** — not merely CI and a successful upload —
   and the upload it applied came from a dispatch, not the daily schedule. A
   full `Deploy Staging` dispatch at that commit satisfies both.
2. The Production run waits on **Deploy Approval**. The approval authorises Host
   Apply; it does not replace it. Approving is the ship decision, and `host-apply`
   is what executes it.
3. Watch `host-apply`. Green means: `npm ci --omit=dev`, migrations applied,
   Prisma client regenerated, Passenger restarted, `Database schema is up to
date!`, `/docs` 2xx and a wrong-secret cron POST answering `401`.
4. **Tag only after `host-apply` is green.** The tag is a receipt that the
   version is live, not that files arrived — see
   [ADR 0028](../adr/0028-production-deploys-are-approval-gated-and-tags-are-receipts.md).

If it goes red, do not hand-fix on the host. The sequence is fail-closed: the
first failing step aborts everything after it, so the host is left as it was
rather than half-applied. There is no rollback and no migrate-down. Read the
failing step, fix the cause, re-run with `apply_only` — the bundle is already
uploaded.

### 8d. Re-running without a second upload

`apply_only` re-runs `host-apply` alone against the bundle already on the host.
On Production this is the recovery path after a red apply; it still passes
through Deploy Approval.

## Known behaviours of this host

Five things cost real time to work out on Staging. They are recorded so
Production does not re-learn them.

| Behaviour                                                                                                     | Consequence                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSH shell access is a manual toggle that reverts                                                              | Staging Host Apply is `workflow_dispatch`-only; check the toggle before any apply. Amends PRD #565 user story 3.                                           |
| The Node.js Selector stores app env at `~/.cl.selector/node-selector.json`, keyed by domain, under `env_vars` | Pinned as `SELECTOR_STORE_PATH` / `SELECTOR_ENV_FIELD`. The engine originally guessed `~/.cpanel/nodejsapps.json` under `envvars`; both halves were wrong. |
| CloudLinux's `activate` reads `CL_VIRTUAL_ENV` unguarded                                                      | `set -u` is suspended across that one vendor script, or the apply dies before `node` is on `PATH`.                                                         |
| `swagger-ui-express` answers a bare `/docs` with a 301 to `/docs/`                                            | The probe follows redirects; without `-L` a healthy app reports a 3xx.                                                                                     |
| LiteSpeed rejects a POST with no `Content-Type` and no body, on **every** path, with HTML 403                 | The cron probe sends `Content-Type: application/json` and `{}`, or it reports the host's opinion, not the API's.                                           |

`bin/` entries under `nodevenv/` are symlinks, so `find -type f` misses them
while `[ -f … ]` follows them — worth knowing when writing ad-hoc diagnostics.

## Break-glass

Interactive SSH remains the fallback for when Actions cannot connect. Use the
same sequence, in the same order — activate the virtualenv, `cd` to the app
root, `npm ci --omit=dev`, `npm run prisma:migrate:deploy`,
`npm run prisma:generate`, `touch tmp/restart.txt`, then
`npm run prisma:migrate:status` — and expect nothing pending at the end. It is
the same procedure, not a second product.
