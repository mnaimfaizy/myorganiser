# MyOrganiser

MyOrganiser is a personal organization app with end-to-end encrypted storage for sensitive user data. The server never stores or processes plaintext — all encryption and decryption happens on the client.

## Domain

**Vault**:
A single User's end-to-end encrypted storage. Exactly one Vault per User. The server stores only its Ciphertext; it never sees plaintext values. A Vault is owned by a User on every surface it appears on — a device holding a Local Vault does not own it.
_Avoid_: Encrypted storage, secure store, lockbox

**Local Vault**:
The on-device copy of one User's Vault, holding that User's Ciphertext and wrapped Master Key. It is owned by the User, not by the device: one browser or device may hold several Local Vaults, at most one per User who has signed in there, and a Local Vault is never adopted by a User other than its owner. May diverge from the server's Ciphertext until reconciled.
_Avoid_: the local vault (as a device-wide singleton), browser vault, device vault, cached vault

**Ciphertext**:
The encrypted blob format produced by the Vault for all vault-backed data types.
_Avoid_: Encrypted data, encrypted blob

**Task**:
A structured work item the user creates to track personal or professional goals. Can have a status, priority, context, due date, effort estimate, and can be archived.
_Avoid_: Todo, to-do, item, reminder

**Subscription**:
A recurring financial commitment the user monitors.
_Avoid_: Recurring payment, recurring task, bill

**Monthly Equivalent**:
A Subscription's amount restated as what it costs per month, whatever its billing cycle — a yearly charge divided by twelve, a weekly one multiplied out and divided back. Stays in the Subscription's own currency: it normalises time, never money. It is plaintext and client-only — derived on the device from decrypted Subscriptions and never stored or sent. Distinct from a total of the Subscriptions billed monthly, which ignores every other cycle.
_Avoid_: monthly total, monthly cost, burn rate, converted total

**User**:
A person's account in MyOrganiser. Authentication is a state a User may be in, not part of what a User is — a Disabled User and an Unverified User are both Users.
_Avoid_: Account, member, customer, person

**Platform Admin**:
A User with elevated privilege to manage other Users' account metadata across the MyOrganiser service. Cannot access Vault plaintext or Master Keys.
_Avoid_: Admin, superuser, staff, operator, system admin

**Disabled User**:
A User blocked from authenticating. Disabling also ends their existing Sessions; re-enabling restores the ability to sign in but does not bring those Sessions back. Their Vault Ciphertext and profile remain until separately deleted or purged.
_Avoid_: Banned user, suspended user, deactivated account, soft-deleted user

**User Deletion**:
A User's own, immediate, and irreversible removal of themselves and everything they own — Vault Ciphertext, Sessions, and third-party grants — offered after an Escape Copy. Not a Disabled User, and has no pending or recoverable state. The Admin Audit Log keeps its entries about the User, and Feedback Reports keep their content, each with the User removed from them.
_Avoid_: account deletion (in domain language), deactivation, closing an account, soft delete

**Admin Audit Log**:
A durable record of Platform Admin actions on Users (who acted, what changed, which User was affected, when).
_Avoid_: Activity log, admin history, audit trail, event log

**Organization**:
A group that allows multiple Users to share resources. Emerging — not fully implemented.
_Avoid_: Team, group, workspace

**Grocery List**:
A named trip-oriented collection of grocery lines the User shops against.
_Avoid_: Shopping list (as the product name), cart, basket

**Checked Item**:
A grocery line marked bought on the current trip; it remains on the Grocery List and can be unchecked.
_Avoid_: Completed item (ambiguous with remove/clear), purchased row, done item

**Uncheck All**:
The Grocery List action that turns every Checked Item back to unchecked so the same list can be reused for another trip. Does not remove lines.
_Avoid_: Reset trip, clear checked, keep for next shop

**Remove Checked From List**:
The Grocery List action that drops Checked Items from that list only. Does not destroy the Catalog Item.
_Avoid_: Clear checked, finish trip, delete purchased, clear list

**Delete List Line**:
Removing one grocery line from a Grocery List (checked or not). Does not destroy the Catalog Item.
_Avoid_: Delete item (ambiguous with catalog), remove forever, trash item

**Delete Grocery List**:
Permanently removing a Grocery List. Its List Lines go with it, and a later edit of that list on another device does not restore it. Catalog Items stay.
_Avoid_: Clear list, delete trip, remove all items, delete list line

**Delete From Catalog**:
Permanently destroying a durable grocery item identity so it is gone from the catalog and from every Grocery List that referenced it. A later edit of that same Catalog Item does not restore it. Requires strong confirmation.
_Avoid_: Clear, remove checked, delete list line

**Catalog Item**:
A durable, user-owned grocery identity in the vault catalog (name, category, default price, notes, image, links). Grocery Lists reference it; it is not owned by a single list.
_Avoid_: Pool item, master item, product, favorite (unless UI label), template

**List Line**:
A Grocery List’s reference to a Catalog Item for a trip, carrying trip-local state such as checked and quantity/amount. The same Catalog Item may appear on multiple Grocery Lists at once.
_Avoid_: Embedded item, list-owned item, row (as domain name)

**Usage Location**:
An organisation the User must notify when an Address or Mobile Number changes, together with whether it has been notified yet. It is not a place — it is one line on a change-of-address checklist, carrying the organisation, how it is reached, how urgent it is, and whether it has been notified.
_Avoid_: Location, place, address usage, linked organisation, contact; updated or changed (for the notified state)

**Address**:
A postal address the User keeps in their Vault, and the anchor for the Usage Locations that must be notified when it changes.
_Avoid_: Location, place, residence

**Mobile Number**:
A phone number the User keeps in their Vault, and the anchor for the Usage Locations that must be notified when it changes.
_Avoid_: Phone, contact number, mobile

## Identity & Session

**Session**:
The period during which a User's client can act on their behalf without re-entering credentials. Independent of Vault Unlock — a User can hold a Session while their Vault is still locked, and unlocking the Vault does not extend the Session.
_Avoid_: Login, sign-in, auth session, logged-in state

**Access Token**:
The short-lived proof of identity a client presents with each request. Held in browser storage, so it is treated as exposed and given a deliberately short life.
_Avoid_: JWT, bearer token, auth token, API token

**Refresh Token**:
The longer-lived credential that obtains a new Access Token without asking the User for anything. How it reaches the client differs by platform — the web client never handles it directly, the Mobile App does (see ADR 0006).
_Avoid_: Renewal token, long-lived token, session token

**Verification Token** / **Reset Token**:
Single-use, purpose-bound credentials delivered by email to prove control of an address or authorise a passphrase change. Each is signed for its own purpose only and cannot be presented in place of an Access Token or Refresh Token.
_Avoid_: Email token, magic link, one-time password

**Restorable Session**:
The state where a client's Access Token is gone but it still holds enough to obtain a new one without credentials. A User in this state has not been signed out, and should not be shown a sign-in prompt.
_Avoid_: Expired session, stale session, half-logged-in, partial session

**Guest**:
A visitor with no Session and no means of restoring one. The only state that warrants a sign-in prompt.
_Avoid_: Anonymous user, logged-out user, visitor, unauthenticated user

**Unverified User**:
A User who has registered but not yet proven control of their email address. Cannot obtain a Session, and is refused at sign-in with a distinct reason rather than a credential failure.
_Avoid_: Pending user, inactive user, new user, unconfirmed account

**Logout**:
The User action that ends this client's Session by retiring this User's Refresh Token for that client. Another User's token is not Logout; other Sessions are untouched. Distinct from Force Logout, which a Platform Admin uses to end every Session.
_Avoid_: sign-out (as the domain name), log off, disconnect, session end

**Force Logout**:
The Platform Admin action that ends a User's existing Sessions while leaving them free to sign in again immediately. Distinct from disabling: Force Logout answers "this User's device is compromised", disabling answers "this User should not be here". Distinct from Logout, which the User performs on one client.
_Avoid_: Kick, revoke access, sign out user, terminate session, ban

**Resend Cooldown**:
The interval during which a repeat request for a verification or reset email is refused. It is not a separate timer — the still-valid outstanding token _is_ the cooldown, so the wait always equals that token's remaining life.
_Avoid_: Rate limit, throttle, spam guard, backoff

## Email

**Transactional Email**:
Mail a User receives because an action of theirs requires it — verifying an address, resetting a passphrase. It carries no unsubscribe option, because opting out of it would lock the User out of their own account. Delivery is a correctness requirement, not a preference.
_Avoid_: system email, auth email, automated email, notification

**Notification Email**:
Mail a User receives because they opted in to being told about something, the Weekly Digest being the only one today. It always offers a way to stop receiving it, and a User who never opens one loses nothing they are entitled to.
_Avoid_: marketing email, newsletter, alert, transactional email

**Email Shell**:
The shared frame every MyOrganiser email is rendered inside — logo, brand colours, typography, and footer. Each email supplies only its body and declares whether it is a Transactional Email or a Notification Email; the declaration is what decides the footer, so the shell can never put an unsubscribe link on mail a User must not opt out of.
_Avoid_: email template, layout, wrapper, base template

## Feedback

**Feedback Report**:
Something a signed-in User sends MyOrganiser about the product itself — a Bug Report or a Suggestion. It is plaintext the server can read, held on MyOrganiser's own infrastructure, and never part of a Vault: it must not carry vault contents, and nothing from the Vault is attached to it on the sender's behalf. It outlives User Deletion with the User removed from it, so it can still be fixed but its sender is never contacted again.
_Avoid_: ticket, issue, support request, feedback item

**Report Context**:
The details attached to a Feedback Report besides what its sender typed — which app sent it (its platform: web, ios or android) and that app's version, the browser and operating system, the page path without its query or fragment, and the time. It is shown to the sender before they send, and it never includes screenshots, logs, or anything read from the Vault.
_Avoid_: diagnostics, telemetry, metadata, device info

**Bug Report**:
A Feedback Report saying something does not work as it should.
_Avoid_: bug ticket, defect, issue

**Suggestion**:
A Feedback Report proposing an improvement or a new feature.
_Avoid_: feature request, idea, enhancement

**Tracking Issue**:
The GitHub issue an admin links a Feedback Report to during triage. Many Feedback Reports may share one Tracking Issue; the Tracking Issue is what ties them to the fix, and through it to the Release that makes them Fixed.
_Avoid_: linked issue, ticket, GitHub link

**Fixed** (of a Bug Report):
The Bug Report's cause is corrected in a Release, or for a Mobile App-only fault in a published Mobile Release. A merged fix that has not reached either is not yet Fixed, and a Mobile Release fix reaches a reporter only once they install it.
_Avoid_: resolved, closed, done, merged

**Shipped** (of a Suggestion):
The Suggestion is delivered in a Release, or for a Mobile App-only change in a published Mobile Release. It is the Suggestion's counterpart of Fixed and is reached the same way, through its Tracking Issue.
_Avoid_: done, implemented, released, completed

**Report Status**:
Where a Feedback Report stands as its reporter sees it — Received, Under review, Planned, Fixed or Shipped, Won't do, or Can't reproduce (Bug Reports only). There is no Duplicate status: a duplicate is simply another Feedback Report on the same Tracking Issue, and it moves through the same statuses as the first.
_Avoid_: state, ticket status, resolution

**Status Note**:
A short message an admin attaches to a Report Status change for the reporter to read. Won't do, Can't reproduce, and a Reopen always carry one.
_Avoid_: admin comment, reply, response, resolution note

**Reopen** (of a Feedback Report):
An admin's correction of a report wrongly marked Fixed or Shipped: it returns to Under review with a Status Note, loses its Release, keeps its Tracking Issue, and may send one new Fix Notice when it is really fixed. It is the one way out of Fixed or Shipped.
_Avoid_: undo, revert, unfix

**Follow-up**:
The one extra message a reporter may add to their own Bug Report while it is Can't reproduce; sending it returns the report to Under review. There is no conversation beyond it.
_Avoid_: reply, comment, thread, message

**Fix Notice**:
The Notification Email telling a reporter their Feedback Report is Fixed or Shipped, naming the Release that delivered it. A reporter receives one only if they opted in when sending the report; they can always see the same outcome in the app without it, and a User removed by User Deletion receives none.
_Avoid_: fix email, resolution email, closed notification

## YouTube (focused watching)

**YouTube Access**:
A Platform Admin's permission for one User to use YouTube in MyOrganiser at all. It is granted to and withdrawn from a specific User, never claimed by the User and never transferable. Without it YouTube does not exist for that User. It comes before a YouTube Connection: Access is MyOrganiser letting the User in, the Connection is the User letting MyOrganiser read their account. Decided in ADR 0129.
_Avoid_: invitation, invite link, test user, beta access, allowlist

**YouTube Connection**:
The User's grant letting MyOrganiser read their YouTube account on their behalf. It is either live or **Revoked** — Google no longer honours it, and only the User reconnecting restores it. A Connection left Revoked for seven days ends in a YouTube Disconnect. The seven-day rule is decided in ADR 0129.
_Avoid_: integration, YouTube account link, OAuth token

**Followed Channel**:
A YouTube channel the User follows, imported from their connected YouTube account.
_Avoid_: Subscription, YouTube subscription, channel subscription

**Enabled Channel**:
A Followed Channel the User has turned on for metadata sync and focused watching surfaces.
_Avoid_: Active channel, selected channel, subscribed channel

**Cached Upload**:
Metadata MyOrganiser stores for one upload from an Enabled Channel (ids, title, thumb, published time, duration). Never the media file.
_Avoid_: Video (as the domain name alone), synced video, YouTube video row

**Watched**:
The binary completion/seen state of a Cached Upload for a User. Reversible by the User; not a viewing-analytics history.
_Avoid_: Viewed, seen, played, completed

**YouTube Disconnect**:
The end of a User's YouTube Connection, by the User's own choice, because a Platform Admin withdrew their YouTube Access, or because the Connection stayed Revoked for seven days. Every way it is immediate and complete: Google is told to revoke the grant, and every Followed Channel, Cached Upload, Watched mark, and digest setting of that User is deleted in the same step. Nothing is kept for a later reconnect. Decided in ADR 0129.
_Avoid_: unlink, soft disconnect, disconnect backup, Watched Ledger

**New**:
A Cached Upload that is not Watched.
_Avoid_: Unwatched, unread, unseen

**Channel Sync**:
One attempt to refresh a User's Followed Channels from their YouTube Connection. It does not fetch Cached Uploads. At most one YouTube sync attempt — a Channel Sync or an Upload Sync — is live per User.
_Avoid_: Sync Run, subscription sync, channel discovery

**Upload Sync**:
One attempt to refresh the Cached Uploads of a User's Enabled Channels. It does not import Followed Channels. The same single-live-attempt rule covers it.
_Avoid_: Sync Run, video sync, upload fetch

**Partial Sync**:
The outcome of an Upload Sync in which at least one Enabled Channel synced and at least one failed, leaving the User with fresh Cached Uploads for some channels and their last good snapshot for the rest.
_Avoid_: partial failure, degraded sync, incomplete sync

**Interrupted Sync**:
The outcome of an Upload Sync that stopped without reporting one, so what it completed is known and what remained is not.
_Avoid_: stalled sync, timed-out sync, crashed sync, stuck sync

**Failing Channel**:
An Enabled Channel whose most recent Upload Sync attempt errored. It stays one across Upload Syncs until one succeeds for it.
_Avoid_: broken channel, errored channel, dead channel

**Weekly Digest**:
The weekly email of long-form Cached Uploads that are still New and inside the Digest Window. Shorts are never part of it.
_Avoid_: notification email, YouTube newsletter, catch-up mail, sync-and-notify

**Digest Window**:
The open interval of publish times that makes a New Cached Upload eligible for a Weekly Digest. It starts at the last successful send, otherwise when the User opted in, otherwise when they connected YouTube.
_Avoid_: lookback, became-New window, since last sync

**Digest Period**:
The User's local ISO week (Monday-start) during which at most one Weekly Digest may be attempted.
_Avoid_: digest week, calendar week, Sunday-start week, interval

**Digest Delivery**:
One attempt to send a Weekly Digest to one User for one Digest Period.
_Avoid_: delivery ledger, notification log, send receipt, mail record

**Shorts Daily Budget**:
The User’s configurable daily cap on time spent in the Shorts lane (default one hour), measured as wall-clock while a Short is active and the document is visible.
_Avoid_: Shorts quota, daily Shorts timer (as the product name), playtime limit

**Shorts Hard Stop**:
The locked state when the Shorts Daily Budget is exhausted for the User’s local calendar day: in-app Shorts playback and navigation are unavailable until local midnight or the User raises the limit enough to unlock.
_Avoid_: Soft lock, cooldown, Shorts ban, timeout

## Frontend Architecture

**UI Primitive**:
A reusable React component in `libs/web/ui/`, or its React Native counterpart in `libs/mobile/ui/`, with no knowledge of domain state, vault data, or route context. It must be fully expressible with mock props — that expressibility is required, not optional. Stateful interaction (checked, open, a mount point that fires a toast) does not disqualify it; domain knowledge does.
_Avoid_: Shared component, base component, core component, common component, stateless component (as the definition)

**Feature Component**:
A React component in `libs/web/pages/<route>/src/components/`, or in a mobile feature's screens under `libs/mobile/`, that composes UI Primitives with domain logic and route- or screen-specific state. Never imported by other routes or other features' screens.
_Avoid_: Page component, route component, smart component

**Vault UI Component**:
A presentational component in `libs/web/vault-ui` that shows vault-adjacent state from mockable props. It knows the vault domain, so it is not a UI Primitive; it is reused across routes, so it is not a Feature Component.
_Avoid_: UI Primitive (wrong scope), Feature Component, vault widget, vault card (as the scope name)

**Brand Primitive**:
A named colour in the primitive tier of `tokens.json` — the value itself, mode-independent. The
landing page, the email shell, and the Mobile App theme consume these directly. Never resolvable
as a Tailwind class on its own.
_Avoid_: token, palette entry, brand colour

**Semantic Role**:
A named slot a Brand Primitive is aliased to for one colour mode — `background`, `card`, `brand`,
`muted-foreground`. Web Tailwind class names resolve against Semantic Roles and nothing else. A
role has a value per mode; a primitive does not. Adding one is the only way to add a web colour
utility.
_Avoid_: token (when a role is meant), colour variable, theme colour

**Neutral Ramp**:
The ordered greyscale in the primitive tier that both colour modes index into — light mode reads it
one way, dark mode inverted. Token data only; never exposed as Tailwind utility classes.
_Avoid_: elevation scale, surface tiers, tonal palette

**Type Scale**:
The seven named steps of the typography system — `display`, `title-lg`, `title`, `body`, `body-sm`,
`label-caps`, `caption` — each carrying a size, a line height, a weight, and a letter-spacing in
`libs/design-tokens/src/tokens.json`. A step is used whole; a size taken from one step and a weight
from another is not a step. Named steps, not a numbered ramp: a step says what the text _is_, which
a number does not.
_Avoid_: font scale, text styles, typography tokens, heading levels

**Material Design 3 role names** (`surface-container-low`, `on-surface-variant`, `outline-variant`,
`surface-bright`, `secondary-fixed`, `primary-container`, `error-container`, `action-cyan`):
Not vocabulary in this codebase. They appeared in the groceries page library written against a
system that was never implemented, compiled to no CSS, and were removed. Use Semantic Roles.
_Avoid_: all of them

**Structured Spec**:
The handoff document the main agent passes to ComponentBuilder. Contains: component name, target path, scope (UI Primitive or Feature Component), props interface, state ownership, Zod schema if applicable, and relevant guideline references.
_Avoid_: Component brief, component plan, design spec

## Mobile

**Web App**:
The Next.js browser client in `apps/web`, the web counterpart of the Mobile App. Feature code lives under `libs/web/*`. Its app folder is named for its role, never for the product.
_Avoid_: frontend (the Mobile App is a frontend too), the myorganiser app, the app

**Mobile App**:
The React Native client in `apps/mobile`, sharing domain logic with the web app through cross-platform libraries. Feature code lives under `libs/mobile/*`.
_Avoid_: native app, RN app, the app

**Installed Web App**:
The web app launched from a Home Screen, Dock, or desktop icon instead of a browser tab. The same client as the web app under the same rules — never a Mobile App and never a Mobile Release, so it has no version of its own and no Version Floor applies to it.
_Avoid_: PWA (in anything a User reads), iOS app, web mobile app, the app

**Platform Adapter**:
A thin implementation of a shared abstract interface (e.g. `VaultCrypto`, token storage) that supplies platform-specific behavior to otherwise platform-agnostic code. An interface earns the name once a platform implements it; a shape written ahead of its implementors is not a Platform Adapter, it is a guess.
_Avoid_: shim, wrapper, provider

**Platform Variant**:
A module selected by bundler filename resolution rather than by an interface — `crypto.web.ts` standing in for `crypto.ts` because one target cannot resolve the other's dependencies. It is the only place mobile code may hold a browser API, and it is not a fallback: the two paths are wire-compatible and change together. Distinct from a Platform Adapter, which a platform is chosen for by implementing an interface, not by being named a certain way.
_Avoid_: shim, web fallback, .web file, platform adapter (for this sense)

**Portable Entry Point**:
A shared library's second import path, carrying only exports that hold on every runtime the Mobile App targets. The Mobile App's native code reaches a shared library through its Portable Entry Point, never through the library's main entry point, which may carry browser-only code. A Portable Entry Point is not a Platform Adapter — it selects what is exported, not how a platform behaves.
_Avoid_: neutral barrel, mobile barrel, platform-agnostic export, secondary entry point

**Device Setting**:
A choice belonging to one installation of the Mobile App — the appearance choice (System, Light,
or Dark), the last used tab, and the Auto-Lock Delay. Plaintext and client-only, and _deliberately_
not vault data: it is never encrypted, never pushed, and never reconciled, because it describes this
device rather than the User. Two devices disagreeing about it is the correct outcome, not a
conflict. Read synchronously, which is what lets the app resolve its colour mode before the first
frame.
_Avoid_: preference, user setting, local storage, app config, profile setting

**User Local Data**:
What a User leaves on one installation of the Mobile App that belongs to them rather than to the
installation: the Refresh Token, the Biometric Unlock item holding their Master Key, and the resume
point. Client-only, and never Ciphertext: the Master Key in that item is plaintext key material the OS
keystore guards, and nothing in User Local Data is ever sent to the server. One function clears it,
and Logout and the Data Guard both go through it. Device Settings are not User Local Data and are
never cleared with it.
_Avoid_: cache, session data, user data, app data

**Data Guard**:
The Mobile App's rule that User Local Data belongs to the backend origin it came from. The app
records that origin, and a launch that finds a different one — only a debug build can, through the
bundle-time switch that points it at Production — clears that User Local Data before its first
request. A record it cannot find counts as a different origin.
_Avoid_: origin check, environment guard, backend switch

**Privacy Cover**:
The opaque panel the Mobile App draws over itself whenever it is not the frontmost app, so that the
app switcher, a screen recording, or a glance over a shoulder shows the app's own mark instead of a
Vault. It is not a lock and never withholds anything: the session behind it is untouched, and
returning to the app takes it away with no credential. It goes up on the app merely stopping taking
input — a system prompt, the switcher being raised — because that is when the OS takes the snapshot
it will show later, which is earlier than the app going to the background ([ADR 0108](docs/adr/0108-a-mobile-device-may-hold-the-master-key-behind-a-biometric-gate.md)).
_Avoid_: blur screen, screen shield, app switcher mask, lock screen

**Unconfirmed Edit**:
An edit a mobile screen shows before the server has confirmed its Vault Push. It ends in one of two ways: confirmed, after which it is ordinary data, or reverted to the last copy the server confirmed, with the reason and a retry offered. A reverted edit is still held by the screen that made it, and the next Vault Pull or retry sends it. An edit that changes nothing — its edit function hands back the envelope it was given — is the exception: no Vault Push is made for it, it is reported as not saved, and it is not held, because there is nothing to send. It is plaintext and client-only: it lives only in memory, never outlives the screen that made it, and reaches the server solely as the Ciphertext its Vault Push sends.
_Avoid_: pending edit, queued edit, sync state, dirty row

## Vault

**Vault Unlock**:
The client-side action of producing the Master Key so vault Ciphertext can be decrypted for the session — from the User's passphrase, or from the Recovery Key when that passphrase is forgotten. No plaintext or key leaves the device. Unlock is a plaintext-access boundary, not a network one: a locked Vault can still send and receive its own Ciphertext, because moving bytes that are already encrypted needs no Master Key. What a lock withholds is the ability to read them.
_Avoid_: vault login, decrypt vault, open vault

**Vault Unlock Secret**:
Which secret produced the current in-memory Vault Unlock — passphrase, Recovery Key, or, on mobile, Biometric Unlock. Client-only session state: it is never written into the Local Vault and never sent to the server. It lives only while the Vault is unlocked on this device, and a lock or a later passphrase unlock clears a recovery-key unlock. It is what authorizes a passphrase _reset_ (no current passphrase) versus a passphrase _change_ (current passphrase required); only a Recovery Key unlock authorizes a reset.
_Avoid_: unlock provenance, unlock method, last unlock, recovery mode

**Passphrase Reset Prompt**:
The one offer, after a Vault Unlock whose Vault Unlock Secret is the Recovery Key, to set a passphrase the User knows. Declining is part of the offer and lasts only for that unlocked session: the forgotten passphrase stays the live one, a reset stays permitted until the session ends, and nothing about the offer is written down or sent anywhere. It is not a condition of entering the app, and it is not a Recovery Key Acknowledgment ([ADR 0095](docs/adr/0095-a-recovered-user-is-prompted-once-to-set-a-passphrase.md)).
_Avoid_: forced reset, rotation nag, recovery gate, passphrase interstitial

**Unclaimed Local Vault**:
A Local Vault on a device with no recorded owner. It predates per-User scoping, so ownership cannot be read from it and must be established by Vault Claim Evidence. It is never removed on anyone's behalf, and a claim copies it into the claiming User's entry rather than moving it, so the slot survives a claim unchanged. It is never resolved implicitly: a User who cannot produce evidence for it sees a device that holds no Vault, and the Vault is not offered, not unlockable, and not guessable at. Offering it on a passphrase alone is what made a shared passphrase enough to open somebody else's Vault.
_Avoid_: orphan vault, legacy vault, unowned vault, shared vault

**Vault Claim**:
The act of recording an ownership that already held, assigning an owner to an Unclaimed Local Vault on evidence that the Vault is that User's. Claiming never moves a Vault between Users. It is separate from Vault Unlock: ownership says whose Vault it is, unlocking says whether it can be read, and a Vault can be claimed while still locked. A claim by a User who already holds a Local Vault of their own replaces that Vault, so it is an explicit, acknowledged act rather than a one-click one.
_Avoid_: adopt vault, take over vault, assign vault, link vault

**Vault Claim Evidence**:
What proves an Unclaimed Local Vault belongs to the signed-in User. Server Vault Meta matching is the strongest evidence: only the authenticated User can have written it. A recovery key is proof, because it is minted per Vault and cannot collide across Users. A passphrase unwrap is never proof, on its own or in combination — it establishes knowledge of a string only, and two people who share a passphrase would each unwrap the other's Vault. Server Vault Meta that denotes a different Vault refuses, and that refusal is decisive: it is evidence of the negative rather than an absence of evidence. A Vault Meta that merely differs is not automatically a different Vault, because rotating a passphrase or a recovery key rewraps the same Master Key without moving the Vault. When the Claim Offer cannot reach the server, the check postpones rather than falling back to passphrase-only — transport failure is a retry condition, not evidence (see [ADR 0061](docs/adr/0061-vault-claim-is-proven-by-evidence-not-by-unwrap.md)). The server check is asked once per Vault Session rather than once per screen, and a postponement is asked again when the connection returns and when the tab regains focus. Its answer is what an Unclaimed Local Vault is waiting on, and nothing that would change what the device holds runs ahead of it — a Vault Reconcile that downloads while the question is out answers it by accident.
_Avoid_: vault proof, ownership check, claim credential

**Vault Absent Evidence**:
What proves whether the server holds a Vault for the signed-in User, when this device holds none of its own. Narrower than Vault Claim Evidence: an absent Local Vault has no Vault Meta to compare a server answer against, so the question is only whether the server holds one at all, never whether it is the same one. It withholds the offer to create a Vault — the single most destructive control in the product — while that question is outstanding, and it never downloads or writes anything itself; the wrapping that follows a server-holding answer is Vault Reconcile's write ([ADR 0066](docs/adr/0066-a-convergence-pass-runs-freely-and-only-the-question-is-suppressed.md), decision point 4).
_Avoid_: vault existence check, server vault check, absence proof

**Claim Offer**:
The interface through which a User establishes Vault Claim Evidence for an Unclaimed Local Vault. It does not lead with unlock, because unlocking is not the claim: it is offered whether or not a Vault is present, so that it discloses nothing about what this device holds, and a credential matching nothing is indistinguishable from a device holding nothing. Where the User already holds a Local Vault, the offer also carries the acknowledgement and the export that make replacing one survivable.
_Avoid_: claim prompt, vault chooser, ownership dialog, migration prompt

**Vault Meta**:
What a Vault needs to be opened rather than read: the key-derivation parameters and the Master Key as wrapped by the passphrase and by the recovery key. It travels with the Vault but is not part of its contents, and it changes for reasons the contents never see — changing a passphrase rewraps the same Master Key, leaving every Vault Blob readable exactly as before. Two Vault Metas differing therefore says nothing about whether their Vault Blobs can be merged.
_Avoid_: vault header, key material, vault config, vault settings

**Vault Identity**:
Which Vault a Vault Meta belongs to, carried by the key-derivation salt and nothing else. It is minted once beside a Master Key and never moves again: rewrapping — a changed passphrase, a replaced Recovery Key — reuses it. So two Vault Metas that differ may still be one Vault, while two Vault Identities that differ are always two Vaults under two Master Keys. It is the one thing about a Vault Meta a Vault Blob decision may rest on, and unlike everything else about opening a Vault it is answerable without unlocking anything.
_Avoid_: vault id, vault fingerprint, meta hash, salt check, vault version

**Vault Blob**:
The unit of Ciphertext the server stores and the client synchronises: one per Vault Blob Type per User, holding every record of that type together. It is the whole of `tasks`, not one Task. Two devices editing different records of the same type are still editing the same Vault Blob, which is why convergence cannot be decided by the Vault Blob alone.
_Avoid_: vault record, encrypted blob, blob (unqualified), vault entry

**Unknown Field**:
A key in a decrypted Vault Blob that the reading client does not name: on a record, on a nested record (a Usage Location, a Catalog Item, a Grocery List, a List Line), on the groceries payload, or on the envelope beside `records` and the Deletion Log. Plaintext and client-only, like everything inside a Vault Blob; the server sees it only as Ciphertext. Every write carries it through untouched, so a lagging Mobile Release never erases a field a newer client added ([ADR 0114](docs/adr/0114-a-mobile-release-ships-in-1-0-what-it-cannot-learn-later.md) decision 3). A legacy key a reader retires (a Task's `todo`, a Usage Location's `changeType`) is known to that reader, not unknown.
_Avoid_: extra field, extras, passthrough field, unrecognised key

**Vault Push**:
Sending one changed Vault Blob to the server. Distinct from Vault Reconcile: a push is the ordinary consequence of a single edit, carries no whole-Vault comparison, and asks the User nothing while it runs. Reconcile compares two whole Vaults and is the backstop for what push did not carry. On mobile, which keeps no Local Vault, a push is read-modify-write against the server: the edited envelope is sent under the ETag it was read at, and a newer server copy is merged into it per the pinned strategy before resending — a type pinned to prompt is refused rather than merged ([ADR 0107](docs/adr/0107-a-mobile-vault-write-is-read-modify-write-against-the-server.md)).
_Avoid_: vault sync (unqualified), upload, save to server, backup

**Vault Pull**:
Taking one Vault Blob from the server and converging it with the Local Vault. The complement of Vault Push, and never a replacement: an arriving Vault Blob is merged against what the device already holds, so a pull cannot discard a local edit the server has not seen. On mobile, which keeps no Local Vault, the only such edit is an Unconfirmed Edit whose Vault Push failed: a pull merges it with the arriving copy per the pinned strategy and sends the result, and persists nothing ([ADR 0121](docs/adr/0121-a-mobile-vault-pull-converges-the-unsent-edit-it-is-handed.md)).
_Avoid_: fetch, download, refresh, sync down

**Vault Pull Pass**:
One sweep of every Vault Blob Type of one User against that User's server Ciphertext, carrying out a Vault Pull for each type that moved. It is what a device runs to stay current: it starts when a tab arrives at the product and again whenever that tab regains focus, so two tabs side by side converge by being tabbed between rather than in place. Distinct from Vault Reconcile, which runs when the Local Vault is replaced under the device and not on any schedule, and distinct from the Vault Pull it performs per type — a pass is the unit that is triggered, debounced and budgeted, while a pull is the unit that converges. Naming the two apart matters because what a pass costs and what a pull decides are different questions: a pass may stop asking about a Vault Blob Type without changing anything about how that type converges when it does.
_Avoid_: pull loop, pull cycle, sync pass, poll

**Vault Blob Inventory**:
What the server says it holds for one User: which Vault Blob Types exist, and the identity of each one's Ciphertext. It describes Ciphertext and contains none, so it is answerable without the Master Key and is as server-storable as the Vault Blobs it lists. It is what lets a Vault Pull Pass and Vault Reconcile ask only about the types that moved, and it only ever narrows what a pass asks — a Vault Blob Type missing from it means there is nothing to pull, never that anything should be deleted ([ADR 0087](docs/adr/0087-a-vault-pull-pass-asks-the-vault-blob-inventory-and-absence-deletes-nothing.md)).
_Avoid_: manifest, blob index, blob list

**Deletion Log**:
The record a Vault Blob keeps of which of its records were deleted, and when. It exists because absence cannot be merged: a device that has not yet seen a deletion holds the record and would otherwise reintroduce it on the next merge. A deletion beats a record that was last changed before it. Entries are kept, not expired — an entry that is dropped while some device is still behind resurrects the record it was there to bury.
_Avoid_: tombstone log, graveyard, trash, deleted items

**Sync Bookmark**:
What one device records, per User and per Vault Blob Type, about the Ciphertext it and the server last agreed on: which Ciphertext that was, and the identity the server gave it. A successful Vault Push sets it; so does taking the server's copy, since both leave the device holding exactly what the server holds. A Vault Blob has unpushed changes when it no longer matches its Sync Bookmark — the state is derived from the Vault rather than flagged alongside it, so no edit can be stranded by a flag nobody set. The recorded identity is also what makes the next push conditional, so a device cannot overwrite Ciphertext it has never seen.
_Avoid_: dirty flag, sync state, pending queue, last-synced marker

**Vault Converge**:
Deciding what one Vault Blob Type's Ciphertext and the server's copy of it should become, and carrying that out: sending, taking, merging, asking, refusing, or doing nothing. Vault Push, Vault Pull and Vault Reconcile are three entries into the one convergence, not three convergences — a decision made in more than one place is a decision that disagrees with itself, which is how a keep-server reconcile destroyed grocery Ciphertext. How a given Vault Blob Type converges is pinned per type, and whether two sides may be merged at all is answered by decrypting the server's copy, never by comparing Vault Meta — the Vault Identity being the single exception, and it answers an earlier question than merging. A Vault Blob is never taken across one that differs: the two sides are then two Vaults, taking would replace readable Ciphertext with bytes this device cannot open, and there is no per-type answer to offer instead. That refusal is the one thing convergence does without asking and without writing, on every path and for every caller.
_Avoid_: sync, resolve, merge (as the name of the whole act), two-way sync

**Vault Meta Converge**:
Deciding whether this device starts using a wrapping set on another device, and carrying that out. Separate from Vault Converge and never an input to it: a Vault Meta that diverges leaves every Vault Blob exactly as mergeable as it was. It is the one convergence that cannot check its own answer — a wrapping cannot be verified without the passphrase it was derived from — so it never replaces a local wrapping without the User saying so, and adopting one is returned for the caller to save rather than written where it was decided.
_Avoid_: meta sync, key sync, passphrase sync, vault meta reconcile

**Vault Meta Change**:
What moved between two Vault Metas, and the thing a User is actually asked about when they diverge. It is named rather than reduced to a boolean because "your vault differs" is not something a User can act on, while "your passphrase was changed on another device" is, and because a User whose passphrase changed elsewhere without their doing needs to hear which one to stop using. Two of them are wrappings that moved — the passphrase and the recovery key. The third is not a change at all: a moved Vault Identity means the two sides were never the same Vault, which is why it is read first and why it is the one nothing may adopt.
_Avoid_: meta conflict, key conflict, vault divergence, credential change

**Vault Meta Push**:
Sending this device's own Vault Meta to the server, so a wrapping the User changed here stops being local to here. The counterpart to Vault Meta Converge and the opposite direction: converge asks whether to start using a wrapping made elsewhere and can never verify it, while a push carries one this device wrote itself. It is refused rather than merged when the server has moved, because two wrappings changed independently is a question for the User at session start, not a choice made mid-flow by whoever pushed second.
_Avoid_: meta upload, key push, passphrase sync, push meta

**Vault Meta Bookmark**:
What one device records, per User, about the Vault Meta it and the server last agreed on. It exists to tell a wrapping this device changed apart from one changed elsewhere — without it the two are the same observation, since either way the local and server wrappings differ. Both questions are derived from it rather than flagged beside it: this device owes a Vault Meta Push when its Vault Meta no longer matches the bookmark, and the server has moved when the server's no longer does. Losing one costs a prompt that misattributes a change, never a User's data.
_Avoid_: pending push flag, meta dirty flag, wrapping marker, meta etag

**Vault Meta Refusal**:
What one device records, per User, about a Vault Meta it was offered and declined — the wrapping that was refused, not the fact that a question was once asked. It is what lets a second, genuinely different change ask again where a record of having asked stays silent, and it is losable in the same direction as a Vault Meta Bookmark: losing one costs a repeated question, never a User's data. A refusal given as an answer outlives the tab; one given by dismissal does not.
_Avoid_: dismissed flag, prompt flag, snooze, seen, asked-already, suppression flag

**Observed Vault Identity**:
What one device records, per User, about the Vault Identity a pass last saw on the server. It is what lets a Vault Sync Standoff be derived from local state alone: comparing it against this device's own Vault Identity is a fact that stops being true on its own the moment a later pass observes a matching one, so nothing has to notice a standoff has ended and clear a flag for it. Recorded whether or not it matches, since a matching observation is what lets the next comparison read false. Losable in the same direction as a Sync Bookmark: losing one costs a status that under-reports a standoff until the next pass, never a User's data.
_Avoid_: vault identity flag, mismatch flag, standoff flag, vault check cache

**Vault Sync Standoff**:
The sync status reported while a device's Observed Vault Identity for a User differs from that device's own — the visible half of a Vault Blob convergence refusing to take across a differing Vault Identity ([ADR 0067](docs/adr/0067-a-vault-blob-is-never-taken-across-a-vault-identity.md)). It exists because that refusal is otherwise invisible: nothing else says why sync has stopped, and a User who has durably declined the Vault Meta dialog has no other notification left to silence. A standoff is not fixed by retrying — the two sides are different Vaults — and it clears only when a pass observes a Vault Identity that matches this device's own again.
_Avoid_: vault mismatch, sync conflict, identity conflict, vault divergence

**Vault Pull Stall**:
The sync status reported while this device's most recent Vault Pull Pass ended without learning what the server holds for some Vault Blob Type — it ran out of time, could not read the Vault Blob Inventory, or could not reach a type the inventory named. It exists because a pass that stops getting answers is otherwise silent: nothing else says the device has stopped hearing from its other devices. Unlike a Vault Sync Standoff it is fixed by trying again, and it clears when a later pass gets every answer — a fact about the last pass, not a flag anything has to lower. A pass replaced by a newer one has not stalled; it was superseded ([ADR 0088](docs/adr/0088-a-vault-pull-pass-has-a-budget-and-is-superseded-never-queued.md)).
_Avoid_: pull failure, pull error, offline, pull timeout

**Server Reachability**:
What one attempt to reach a User's own Vault Meta found, at the moment it ran. It is an observation and never a state: it is discovered by trying, in the same way a Linked Provider's token is, and it says nothing about whether the next write will land — a third device can move the server between the reading and the push. It is therefore shown and never gated on, and a reading that found the server is shown as nothing at all, because a User told the server is reachable has been told something the product cannot keep. What it can honestly carry is the negative: a User about to retire a Recovery Key can be told, before the point of no return, that the retirement will not reach their other devices yet.
_Avoid_: online, connected, server status, connectivity check, health check

**Vault Reconcile**:
The pass that converges every Vault Blob Type of one User's Local Vault against that User's server Ciphertext. It runs when a device arrives at the product and again whenever the Local Vault is replaced under it — a removal, an import, a convergence taking the server's Ciphertext — because each of those leaves this device owing the server something different, and none of them is a sign-in. It does not run for an owner whose device holds an Unclaimed Local Vault until Vault Claim Evidence has answered: an unclaimed slot is not an absent one, and a pass that reads it as absent downloads the server's copy over a claim that was about to be made. It is not a migration and has no one-time character: a User with no server Vault yet is having an ordinary first sync, and a User with no Vault on either side has nothing to reconcile. It carries no convergence of its own — each type goes through Vault Converge, so a Vault Blob Type cannot be reconciled on terms the rest of the product does not use. Non-conflicting divergence therefore converges without asking anything, and what asks is what the pinned strategy says asks. Which types it asks the server about is the Vault Blob Inventory's question, the same one a Vault Pull Pass asks: a type the inventory does not name is not read, and absence is never a deletion; a type whose inventory etag already matches this device's Sync Bookmark is not fetched again. One question is still whole-Vault, because it was never per-record: the server's Ciphertext will not decrypt under this device's Master Key, so the two sides are not the same Vault at all. It decides Ciphertext only: no answer given here adopts a wrapping or reverts a passphrase change made elsewhere, and a Vault Meta is never an input to what it decides. It writes one, and only where there is none to overwrite — a server holding no Vault Meta at all is having a first sync.
_Avoid_: vault migration, phase-1 migration, vault upgrade, sync migration

**Master Key**:
The symmetric key derived from the passphrase (PBKDF2 → AES-GCM) that decrypts vault Ciphertext. Never sent to the server.
_Avoid_: vault key, encryption key, secret key

**Recovery Key**:
The second secret that opens a Vault, and the only way back into one whose passphrase is forgotten. It is minted per Vault rather than chosen by the User, and it wraps the Master Key directly instead of deriving anything — so it carries no salt and no parameters of its own, and replacing one moves a single wrapping and never reads as a different Vault. Being minted per Vault is also what makes it unable to collide, which is why it is Vault Claim Evidence where a passphrase is not. Whoever holds it holds the Vault: it is shown once, kept by the User, and stored nowhere the product can reach.
_Avoid_: backup key, recovery code, reset code, escrow key, second passphrase

**Biometric Unlock**:
A Vault Unlock on a mobile device that reads the Master Key from the platform keystore after a biometric check, instead of deriving it from the passphrase. The User opts in after a passphrase unlock on that device, and turning it on later asks for the passphrase again — an unlocked session alone is never enough to add one. It belongs to that User on that device, ends at logout, when the device's enrolled biometrics change, or when the stored key no longer decrypts the server's Ciphertext, and never replaces the passphrase or the Recovery Key — it is a shortcut to the same Vault, and it authorizes nothing a passphrase unlock does not. What the keystore holds is the plaintext Master Key, and it is client-only: it never leaves that device and is never sent to the server, which keeps holding only Ciphertext ([ADR 0108](docs/adr/0108-a-mobile-device-may-hold-the-master-key-behind-a-biometric-gate.md)).
_Avoid_: Face ID login, fingerprint login, biometric login, quick unlock

**Auto-Lock**:
The Mobile App locking its own Vault after the Auto-Lock Delay has passed with the app in the
background. It is an ordinary lock — the in-memory Master Key is dropped and nothing else is — so
Biometric Unlock survives it and is usually what answers it. It is decided once, on the way back to
the foreground, rather than by a timer: an app the OS has suspended is an app whose timers do not
fire, and a lock that depends on one is a lock that does not happen. The User is told an Auto-Lock
is why they are being asked, because a lock nobody asked for otherwise reads as a lost session
([ADR 0108](docs/adr/0108-a-mobile-device-may-hold-the-master-key-behind-a-biometric-gate.md)).
_Avoid_: idle timeout, session timeout, inactivity lock, auto sign-out

**Auto-Lock Delay**:
How long the Mobile App may stay in the background before an Auto-Lock — immediately, 1, 5, or 15
minutes, and 5 by default. A Device Setting, not vault data: it describes how exposed this
particular phone is, so two devices of the same User disagreeing about it is the point rather than a
conflict. It is measured from the app going to the background and never from the last interaction:
an app in the foreground is an app somebody is holding.
_Avoid_: lock timeout, idle timeout, session length, inactivity period

**Recovery Key Rotation**:
Minting a new Recovery Key for a Vault and retiring the old one, from a session that is already unlocked. Authorized by the passphrase and never by the key being replaced: a User rotating because the old key is lost cannot produce it, and an unattended unlocked session must not be enough to mint a credential that opens the Vault. It is the one Vault change with a step the User can fail — the new key has to be recorded before the old one stops working — so it is minted and shown before anything is written, and abandoning it leaves the old key working. Retirement is not instant everywhere, and copy that claims otherwise is wrong: it holds on this device and on any device signing in afterwards, while a device already holding the old wrapping keeps honouring the old key until the User confirms the change there, and a Vault Export taken beforehand is opened by the retired key for as long as that file exists.
_Avoid_: recovery key reset, regenerate recovery key, new recovery key, revoke recovery key

**Recovery Key Acknowledgment**:
The User's confirmation that they have recorded a newly minted Recovery Key. It is what finishes minting one: a key exists in the Vault's wrapping the moment it is minted, but until the Acknowledgment is given the product has no reason to believe anybody holds it. Creation cannot mint before it writes the way Recovery Key Rotation does — the wrapping has to exist to be shown — so this is creation's version of the same guarantee, moved after the write because it has to be. What is recorded is the absence of one: which wrapping is awaiting an Acknowledgment, and never the key that opens it, which is still shown once and stored nowhere the product can reach. It is therefore held per User against a fingerprint of the wrapping it is about, so an Acknowledgment owed for a wrapping this device no longer holds is not an answer about the Vault it now holds — a claim, an import, a replacement or a rotation moves the wrapping and retires the question with it. A Vault whose Acknowledgment was never given is not broken and is not re-shown its key; it is a Vault whose Recovery Key nobody is known to hold, and the way out of that is Recovery Key Rotation, which the passphrase alone authorizes.
_Avoid_: recovery key saved flag, key confirmed, dismissed recovery key, recovery key receipt

**Vault Handle**:
The object a caller holds to reach a Vault, bound at construction to one owner and one Master Key. Vault access is obtained, not invoked: there is no unbound vault function to call, so a Vault cannot be resolved without saying whose it is ([ADR 0047](docs/adr/0047-vault-access-is-obtained-through-an-owner-bound-handle.md)). Page libraries receive a handle and never learn who the User is.
_Avoid_: vault client, vault service, vault accessor, vault context

**Vault Sync Sink**:
Where a Vault Handle reports that one Vault Blob Type changed. It belongs to the handle rather than to whoever writes through it: the handle is the only way to reach a Local Vault, so a sink held there cannot be gone around, and no write can forget to synchronise. It is told a Vault Blob Type and never Ciphertext, and nothing it does can fail the save that told it — the Local Vault is already written by then, and an edit reported as failed is a lie the User retypes.
_Avoid_: save listener, push callback, change observer, write hook

**Local Vault Revision**:
What a Vault Handle reports when the whole Local Vault has been replaced under whoever is reading it — convergence taking the server's Ciphertext, an import, a removal. It is the inbound counterpart to the Vault Sync Sink and deliberately not the same thing: the sink is told that one Vault Blob Type changed here so it can be sent, while this says that what a reader already holds is no longer what is stored. Feeding one from the other would be a loop, since convergence writes through the path the sink must not hear. It carries a number and never a Vault Blob Type or Ciphertext, so a reader re-reads what it already knows how to read rather than being told what changed. An edit made on this device does not move it — only a replacement does. Recovery Key Rotation is a replacement of the recovery wrapping, not of Ciphertext, and it still bumps this number so a pending Recovery Key Acknowledgment can be re-derived against the wrapping that just moved ([ADR 0070](docs/adr/0069-a-recovery-key-is-acknowledged-and-only-the-acknowledgment-is-stored.md)).
_Avoid_: vault version, change event, invalidation signal, refresh token

**Vault Sync Queue**:
The Vault Blob Types a device has still to converge, held by a Vault Sync Sink. It is a wake-up list rather than the state it wakes for: whether a Vault Blob is unsent is derived from its Sync Bookmark, so a lost queue costs a delay and never an edit. It holds types and never Ciphertext, which is what makes ten saves to one type mark it once while the drain still carries the final state. Not a push queue — a drain converges, so it may equally take the server's copy or merge.
_Avoid_: outbox, dirty queue, pending changes, write buffer, debounce buffer

**Escape Copy**:
A whole-Vault snapshot the User keeps in storage they control, so their Ciphertext outlives MyOrganiser itself. It is not the durability mechanism for a Vault — the server already holds every Vault Blob and converges it per record — and it is not a replica: it does not converge, it has no freshness obligation, and being months old does not make it broken. It exists only once the storage holding it has confirmed it whole: a copy that was started and not finished is not an Escape Copy, and restoring a Vault from one makes no new Escape Copy. What it must be is openable without us, which is why it carries the KDF parameters and both Master Key wrappings and nothing about it depends on a token we hold ([ADR 0062](docs/adr/0062-the-drive-escape-hatch-holds-no-token-we-could-lose.md), [ADR 0064](docs/adr/0064-an-escape-copy-is-opened-by-a-tool-that-needs-nothing-of-ours.md)).
_Avoid_: cloud backup (as the concept), snapshot, sync copy, remote vault, archive

**Escape Copy Reader**:
The tool that opens an Escape Copy, and the thing that makes "openable without us" a fact rather than an arithmetic claim. One self-contained HTML file with no network capability of any kind, held by the User rather than served by us: it takes an Escape Copy and either the passphrase or the Recovery Key and shows the plaintext on screen. It writes no decrypted file — recovery is a thing the User does, not a plaintext copy they then have to remember to delete. It is bundled from the app's own crypto and envelope schema, never written a second time, and a gate opens a freshly produced envelope with the built file because a reader the exporter has outrun fails silently until the one moment it is needed ([ADR 0064](docs/adr/0064-an-escape-copy-is-opened-by-a-tool-that-needs-nothing-of-ours.md)). A reader the User cannot tell from a hostile substitute is not one: it is distributed with a published checksum, and saying so is part of the tool.
_Avoid_: decryptor, offline viewer, recovery tool, vault opener

**Escape Copy Age Limit**:
The age past which a User wants a newer Escape Copy than the one they hold. It is a limit the User sets on how stale they will tolerate their copy becoming, not a promise that a copy will be made on a clock: making one needs the User's storage provider to co-operate, which is not always true while nobody is present. When the newest Escape Copy is older than the limit, or there is none, the User is told so — that telling is what the limit is for — and a copy is made without asking only when nothing has to be asked for.
_Avoid_: backup schedule, interval, frequency, daily/weekly/monthly, staleness target

**Linked Provider**:
An off-device storage service the User has connected an Escape Copy destination to. Linked says the User completed the connection and nothing more: whether a token can be obtained right now is only ever discovered by trying, so it is never inferred and never reported as though it had been tested. A Linked Provider becomes Reconnect Needed only from an attempt that actually ran and failed, and that observation is recorded, because it cost something to learn. An attempt has run only when the provider itself answered it: a refusal from the provider is evidence against the link, while an attempt that never reached the provider — a prompt the browser blocked, or one the User dismissed — observed nothing about the link and leaves it Linked. A connection that was never completed is not Linked, so it cannot need reconnecting.
_Avoid_: connected provider, connected account, active connection, authorized provider

## Planning & Orchestration

**PRD Issue**:
A GitHub issue containing the full Product Requirements Document for a feature. Created by `to-prd`. Serves as the parent to all Slice Issues for that feature. Never closed or modified by agents.
_Avoid_: Epic, parent ticket, feature issue

**Slice Issue**:
A thin vertical-slice GitHub issue created by `to-issues`. References its PRD Issue as parent. Tagged `type:afk` or `type:hitl` and a `complexity:*` label. Each slice is independently demoable end-to-end.
_Avoid_: Sub-issue, task, child ticket

**AFK Slice**:
A Slice Issue the autonomous agent can implement and merge without human interaction. Picked up by `dispatch-agents`.
_Avoid_: Autonomous issue, agent task

**HITL Slice**:
A Slice Issue requiring a human decision before an agent can proceed. Skipped by `dispatch-agents` until a human unblocks it.
_Avoid_: Blocked issue, human task

**dispatch-agents**:
The `yarn dispatch-agents --prd <issue-number>` command that triggers the sandcastle orchestrator. Reads AFK Slice Issues labelled `ready-for-agent`, creates the feature branch **locally (never pushed)**, and runs one sandcastle agent per slice — one at a time, in Docker isolation — fast-forwarding each finished slice into the local feature branch and closing the slice issue when its run ended clean — a slice whose agent left something outstanding is integrated but held open as `ready-for-human` ([ADR 0111](docs/adr/0111-a-prd-slice-closes-only-on-a-clean-outcome.md)). Integration is local: you push the feature branch and open one PR to `main` by hand.
_Avoid_: Agent runner, orchestrator command, run-agents

**Interrupted Slice**:
An AFK Slice whose agent run ended without a completion signal — quota exhaustion, timeout, or crash — leaving unfinished work on its slice branch. Resumed by the next `dispatch-agents`, never silently discarded.
_Avoid_: Failed slice, crashed slice, partial slice

**Slice Checkpoint**:
The commit capturing an Interrupted Slice's uncommitted work on its slice branch. Unreviewed and ungated — a resuming agent audits it before building on it, and never treats it as finished work.
_Avoid_: WIP commit (as the general name), draft commit, savepoint

**QA Plan**:
The manual verification a human performs for completed work before its Pull Request merges, carrying only what the automated suites do not already prove. Every claim it makes about existing coverage is marked as observed or reconstructed, because a reader trusts it to say what may be skipped. It is composed as an uncommitted working file in `tmp/`, whatever becomes of it afterwards.
_Avoid_: Test plan, test matrix, QA cycle, verification checklist, regression plan

**QA Account**:
A User that exists only in a local database, created by the seeder and not by registration, for manual and agent QA. Its sign-in password, Vault passphrase and Recovery Key are public by design: they are plaintext derived from tracked source, and they open nothing outside a local database. The server holds a QA Account's Vault as Ciphertext, like any other. The User the live logout spec signs in as is not one.
_Avoid_: Test account, throwaway account, test user, fixture user

**QA Plan Issue**:
A QA Plan for a PRD Issue, published as a GitHub issue labelled `qa`. Scenarios are checkboxes, closing it is the sign-off, and defects it finds become their own linked issues. A QA Plan for a single issue is not one of these — it stays the uncommitted working file it was composed as.
_Avoid_: QA ticket, test ticket, validation issue

**Issue Orchestration Label**:
A GitHub label in the `orchestration` set of `tools/config/github-labels.json` that coordinates planning tools and dispatch-agents. Applies to Issues only — never to Pull Requests. Includes the ADR 0002 machine contract plus the document-type markers `prd`, `qa`, and `grilling`.
_Avoid_: agent label, workflow label, status label (as the general name)

**Surface Label**:
A GitHub label that names a change's kind (`bug`, `enhancement`, `documentation`, …) or area (`backend`, `web-app`, …). Distinct from Issue Orchestration Labels. Issues may wear both; Pull Requests wear Surface Labels only.
_Avoid_: PR label (as a second vocabulary), topic tag, category

**Gate Tier**:
The pipeline depth chosen for a piece of work before its code exists — `gate:mechanical`, `gate:standard`, or `gate:full` (ADR 0012). Chosen by `to-issues` or by the main agent, recorded as an Issue Orchestration Label, and a judgement about intent that nothing later verifies. Never applied to a Pull Request.
_Avoid_: tier (alone), risk tier, review depth, Review Tier (a different question), a Golden Case's Frontier/Guard tier (a third, different question)

**Review Tier**:
The merge policy a Pull Request's diff earns — `review:auto`, `review:agent`, or `review:human` — computed after the code exists by a deterministic Wired Gate from affected projects, a path map, manifests, size, and author; never by an LLM and never by hand (ADR 0070). The job output is the state; the label is a view of it. Anything unclassifiable or any classifier error is `human`. Distinct from a Gate Tier in time, author, and question; either may only tighten the other's effect.
_Avoid_: tier (alone), risk level, gate tier (for this sense), PR label, a Golden Case's Frontier/Guard tier (a third, different question)

**Request Label**:
A GitHub label a human or `ai:create-pr` puts on a Pull Request to ask a workflow to run now, and which that workflow removes when the run ends — a button, not a state. There are two: `agent-review`, which starts the CI code review in any `CODE_REVIEW_MODE` (ADR 0070 item 7), and `golden-replay`, which replays the Golden Set against that Pull Request's reviewer (ADR 0109). Distinct from a Surface Label (names the change), a Review Tier label (computed, never hand-applied), and an Issue Orchestration Label (never on a Pull Request). Carries no classification and never appears on an Issue.
_Avoid_: trigger label (in prose), review label, review requested

**Finding**:
A code review's unit of feedback about the diff under review — one axis (`standards` or `spec`), one rule drawn from a bounded catalogue, one severity, and the Evidence behind it. It is addressed to the author and nothing else: an Obligation answer that meets its own defect condition is a fact about the pipeline until a Finding is actually raised for it, and the two are never the same artifact ([ADR 0071](docs/adr/0071-a-finding-blocks-only-on-evidence-and-a-verdict-is-computed-never-written.md), [ADR 0078](docs/adr/0078-a-citation-that-does-not-match-its-source-is-a-fact-about-the-pipeline.md)).
_Avoid_: comment, issue, defect (as the general name), review note

**Evidence**:
What a Finding cites so a reader can check its claim without trusting the reviewer — `executed` (a command, its exit code, and its output), `cited` (a source and the quoted rule), or `inferred` (reasoning alone). Only `executed` or `cited` Evidence, anchored to a diff location or a quoted spec line, can make a Finding Blocking ([ADR 0071](docs/adr/0071-a-finding-blocks-only-on-evidence-and-a-verdict-is-computed-never-written.md)). An Upstream Finding cites the same kinds plus one of its own, `absent` — the documents matching its version were read and do not say it — which on its own never proves the repo wrong.
_Avoid_: proof, confidence, backing, Vault Claim Evidence (a different sense)

**Blocking**:
A Finding severity, the top of three (`blocking`, `should-fix`, `nit`), earned only by Evidence that is `executed` or `cited` and anchored to a diff location or a quoted spec line ([ADR 0071](docs/adr/0071-a-finding-blocks-only-on-evidence-and-a-verdict-is-computed-never-written.md)). It names the Finding, never the pipeline: a Blocking finding fails the Agent Verdict check and relabels the Pull Request `review:human`, but does not stop a merge — the Agent Verdict is advisory permanently, because a check may assert a fact about the pipeline and never a judgment about the diff ([ADR 0073](docs/adr/0073-a-required-check-is-a-fact-about-the-pipeline-not-a-judgment-about-the-diff.md)). A check that does stop a merge is a required status check in the branch ruleset; `Agent Review Ran` is the only one of the review's two checks eligible to be one.
_Avoid_: required (for a finding), gating finding, merge-blocking, hard fail

**Agent Verdict**:
The computed outcome of one code review run — `approve`, `comment`, or `request-changes` — a pure function of its Findings' severities that no model writes: any Blocking finding requests changes, only `nit` findings approve, and otherwise the verdict is `comment` ([ADR 0071](docs/adr/0071-a-finding-blocks-only-on-evidence-and-a-verdict-is-computed-never-written.md)). Also the CI status check that reports it, which is advisory permanently and never a required check — distinct from `Agent Review Ran`, which reports whether the review ran as built — the reviewer produced a usable report, and its transcript shows each axis's sub-agent read its brief and returned every finding the report carries ([ADR 0123](docs/adr/0123-a-review-reports-facts-about-its-own-run-are-read-from-the-transcript.md)) — and is the one eligible to be required ([ADR 0073](docs/adr/0073-a-required-check-is-a-fact-about-the-pipeline-not-a-judgment-about-the-diff.md)).
_Avoid_: review result (as the general name), approval, verdict (alone), merge decision

**Golden Set**:
The collection of Golden Cases in `tools/config/review-golden-set.json`, replayed to measure whether the current reviewer would still catch defects this repository has already documented, and grown by attribution as a merged defect is traced to the Pull Request that introduced it. A regression signal for the reviewer, not a trust measure for the next diff — that is the Escaped Defect rate's job, and neither number is quoted as the other ([ADR 0072](docs/adr/0072-a-golden-case-earns-its-replay-frequency.md), [ADR 0077](docs/adr/0077-an-escaped-defect-is-one-the-reviewer-saw-and-passed.md)).
_Avoid_: golden data, fixture set, regression suite, test suite (for this sense)

**Golden Case**:
One entry in the Golden Set: a commit range together with the pattern an acceptable Finding about it must match — an expectation, not a Finding itself, since recall is judged by matching rather than by identity. Most are attributed: a real range from this repository's history in which a documented incident merged. The rest are Seeded Cases. The reviewer is always today's and the standards are always the case head's — a case asks whether the current reviewer, reading the tree as it stood, would catch the defect ([ADR 0102](docs/adr/0102-a-golden-replay-reviews-the-case-tree-with-the-pull-requests-harness.md)). A case that measures the Spec axis reads the spec as the original review saw it, never as it was later edited.
_Avoid_: test case (for this sense), fixture, incident (alone), golden test

**Seeded Case**:
A Golden Case whose defect was planted on purpose on top of a real commit, rather than traced to a Pull Request that merged it. It measures whether the reviewer can catch a defect shape, never whether it missed one in real history, so its recall is never pooled with attributed recall.
_Avoid_: synthetic case, fake defect, mutation (for this sense), injected bug

**Frontier**:
The Golden Case tier for a case the reviewer misses — the reason to run the replay at all, and where a case stands when five or fewer of its last ten scored runs were catches. It replays weekly when a reviewer input moved, three times a case, and on request ([ADR 0072](docs/adr/0072-a-golden-case-earns-its-replay-frequency.md), [ADR 0109](docs/adr/0109-a-golden-replay-runs-on-a-schedule-and-on-request.md), [ADR 0116](docs/adr/0116-a-golden-case-stands-on-its-catch-rate-over-its-last-ten-scored-runs.md)). A third sense of "tier," distinct from a Gate Tier (chosen before code exists) and a Review Tier (the merge policy a diff earns).
_Avoid_: Gate Tier (a different question), Review Tier (a different question), hard case, risk tier

**Guard**:
The Golden Case tier for a case the reviewer catches reliably — a detector for whether a brief or contract edit has silently undone something that already works. It replays in the first week of a month in which a reviewer input moved, and on request when the Standards brief or the finding contract changes ([ADR 0109](docs/adr/0109-a-golden-replay-runs-on-a-schedule-and-on-request.md)), and it is earned: a case stands at Guard when eight or more of its last ten scored runs in the replay results record were catches, falls back to Frontier at five or fewer, and keeps its declared tier until the record holds ten ([ADR 0116](docs/adr/0116-a-golden-case-stands-on-its-catch-rate-over-its-last-ten-scored-runs.md)). The same third sense of "tier" as Frontier.
_Avoid_: Gate Tier (a different question), Review Tier (a different question), stable case, safe case

**Obligation**:
An entry in `tools/config/review-obligations.json` — whose human-readable form is `docs/review/REVIEW_CHECKLIST.md` — naming a question a reviewer must answer in writing about a hunk a selector already matched against the diff, so that noticing a documented failure mode is nobody's job to remember. Every answer field that claims something about source must cite it; whether an Obligation was raised as a Finding is read out of the reviewer's own report, never taken from the answer sheet's own declaration ([ADR 0078](docs/adr/0078-a-citation-that-does-not-match-its-source-is-a-fact-about-the-pipeline.md)). An unanswered Obligation is reported and blocks nobody — thoroughness is not itself a gate.
_Avoid_: checklist item, requirement (alone), review question, mandate

**Standards Source**:
A document a code review's Standards axis was held to: the standards index, a document that index names, or an Agent Guide. A review is held to one in either of two ways, and they are not the same fact: the reviewer opened it, or the Harness placed it in the session without anyone opening it. The second is loaded, never opened, and the two are not reported as one. Searching a document is not opening it. The Review Checklist is not a Standards Source — its entries reach the reviewer as Obligations.
_Avoid_: standards read, sources (unqualified), reference, citation (a different sense)

**Escaped Defect**:
A defect whose root cause is a Pull Request the code reviewer **saw and passed** — `approve` or `comment`, the two verdicts that do not block (ADR 0077). A Pull Request the reviewer never saw is not one, nor is one it asked changes on that merged anyway, and neither is ever counted as one. The escaped-defect rate is escaped defects over the Pull Requests the reviewer passed in the same window, and it is the reviewer's trust measure; golden recall is a regression signal and is not this.
_Avoid_: miss, false negative, regression (for this sense), leaked bug

**Attributable Fix**:
A merged fix that names the change which introduced the defect, in its issue, its Pull Request body, or its commits — `introduced in #415`, not `Closes #721`, which names the ticket the fix resolves. A fix naming none is unattributable and is counted as such rather than dropped, because the denominator is only worth reading if nothing was filtered out of it silently.
_Avoid_: linked fix, traced fix, root-caused fix

**Not Measurable**:
The reported outcome of a review trust measurement — the Escaped Defect rate, the Effective False Positive rate — whose denominator is empty, and which is never rendered as 0%. Zero would claim the reviewer passed work and none of it broke, or that a rule's findings were all acted on; the true state until enough history accumulates is that nothing has been measured yet ([ADR 0077](docs/adr/0077-an-escaped-defect-is-one-the-reviewer-saw-and-passed.md), [ADR 0079](docs/adr/0079-an-effective-false-positive-is-a-finding-nobody-acted-on.md)).
_Avoid_: 0%, zero, no data (as the reported value), unmeasurable

**Effective False Positive**:
A code review finding that was raised and was still there on the next push — inaction, not incorrectness. Whether the finding was right is deliberately not asked: it cost the same attention either way, and the question cannot be answered without a human labelling every comment (ADR 0079). The term is Google's. The effective-false-positive rate is these over the findings observed for the same rule, and it measures what the reviewer costs; the Escaped Defect rate measures what it misses, and neither is quoted as the other.
_Avoid_: false positive (alone), noise, wrong finding, dismissed finding

**Review Acknowledgement**:
A `Review-ack: <finding id>` line in a commit message, which takes that finding out of the effective-false-positive numerator. Optional and never required — the measurement reads inaction and asks for no label. It names the finding id the report prints, never a rule id, and it can only remove evidence about a rule, never create it: an acknowledged finding leaves the denominator too.
_Avoid_: suppression, ignore marker, wontfix, dismissal

**Noise Budget**:
The written share of effective false positives a rule may produce — 10%, borrowed with its definition from Google's Tricorder criteria, judged only once a rule has ten observations. A marker a human reads the rate against, not a threshold anything acts on: no rule is disabled on it (ADR 0079).
_Avoid_: threshold (alone), error budget, SLO, quality bar

**Gated Pipeline**:
A specialist chain that retries between agents until a reviewer or runner verdict passes, with a cap. Components and Jest use this shape. Hitting the cap is a stop, not another silent retry.
_Avoid_: review loop, QA cycle, writer-reviewer loop

**Inferred Target**:
An Nx target a registered plugin derives from a tool's own config file in the project root, with nothing written in `project.json`. The target state for every target a plugin can derive (ADR 0082).
_Avoid_: plugin target, crystal target

**Declared Target**:
An Nx target written out in `project.json`. On an `@nx/*` executor that Nx has deprecated in favour of an inferred plugin it is migration debt, not a pattern to copy (ADR 0082, sharpened by ADR 0083); a `nx:run-commands` target is declared by nature and is not, and neither is one on an `@nx/*` executor Nx still ships as its own answer, such as `@nx/js:node` serving a Node app.
_Avoid_: executor target, hand-declared target, explicit target

**Gate Coverage**:
The set of projects a gate actually reaches, which is not the set its command appears to name. A project can sit inside a gate's invocation and outside its reach: `nx affected -t lint` selects only projects that have a target named `lint`, declared or inferred, so a project whose ESLint target carries another name passes by being invisible. Asserted by a check; never inferred from a green run.
_Avoid_: test coverage, CI coverage, gate scope, covering gate (for this sense)

**Covering Gate**:
The gate that asserts the artifact a given change invalidates. It is named against the change's _trigger_ rather than against the diff, because the artifact at risk is usually not in the diff at all: a version bump in `package.json` invalidates the OpenAPI spec and the generated client, so the Covering Gate is the OpenAPI drift check and not any gate over `package.json`. Being the Covering Gate says nothing about whether the gate is wired, and being wired says nothing about whether it covers anything — a truthful answer about a gate that covers something else is the failure mode this term exists to name.
_Avoid_: gate coverage (a different question), relevant gate, responsible check, the gate for this file

**Assertion Gate**:
A gate that compares two artifacts and fails on a factual mismatch, naming the fact that is wrong. It never fails on the shape of a diff, and editing a file never satisfies it. Every gate in this repo is one (ADR 0043); "surface X changed, therefore doc Y must change" is the shape deliberately not built here.
_Avoid_: drift gate, doc gate, coupling check

**Wired Gate**:
A gate some pipeline actually invokes. A checker that exists, passes, and is referenced by neither Husky nor a workflow asserts nothing — a distinct failure from Gate Coverage, which is about a wired gate's reach across projects. Matched by exact script name, including through an aggregate runner that is itself wired.
_Avoid_: enabled gate, active check, gate coverage (for this sense)

**Meta-Gate**:
The gate whose asserted artifacts are the other gates: `gates:coverage:check` compares the checkers on disk against the ones hooks and workflows invoke, and fails naming each checker that is not a Wired Gate. An ordinary Assertion Gate in shape — its subject is simply the gate set rather than a document. A checker it must not fail is not silently skipped; it carries an entry with a written reason in `tools/config/gate-coverage-optout.json`.
_Avoid_: gate-of-gates, master gate, gate linter

**Unasserted Claim**:
A fact about the tree that an artifact states and nothing checks. Distinct from prose a gate cannot reach: an Unasserted Claim is one an extractor could have read — a count, a source citation, a version — that simply has none, so it drifts silently while the page around it stays green. The defect is the gap between what an artifact states and what it asserts, which is why it applies equally to a page whose manifest omits a number it prints and to a checker whose header claims a direction its code does not run.
_Avoid_: stale doc, prose drift, uncovered fact, documentation rot

**Enum Fan-Out**:
A place in code that covers every member of a domain enum by hand — an object literal keyed by the members, an if-chain over them, a union of their values. Distinct from the parallel-work sense the word carries elsewhere: an Independent Hop is never called this. A fan-out is judged per scope, not per file, because one module routinely iterates the Pinned Table in one function and hand-enumerates in the next.
_Avoid_: exhaustive switch, member sweep, enum iteration

**Pinned Table**:
The single `as const satisfies Record<EnumType, …>` declaration a Guarded Enum's fan-outs iterate instead of re-enumerating. The `satisfies` clause is the guard: a new member fails to compile until it has a home there, and every branch reading the table gets the member without being edited. Where several hand-maintained lists describe the same set, the table satisfies all of them, so none can be extended alone (ADR 0053).
_Avoid_: lookup map, const map, enum registry

**Guarded Enum**:
A domain enum whose omissions are expensive enough to be gated — for `VaultBlobType`, an omitted member destroys User-owned ciphertext with no error and no recovery. Being an enum does not qualify one; the cost of the omission does. A module that _declares_ the member names rather than consuming them is exempt by written reason, and is tied back through the Pinned Table's own `satisfies` clause.
_Avoid_: checked enum, critical enum, protected type

**One-shot Specialist**:
A sub-agent that performs one assigned job, returns a report of what it did, and stops. The orchestrator does not send the work back for another round.
_Avoid_: writer-reviewer loop, retry cycle, gated hop (when you mean this shape)

**Standing Specialist**:
A Sub-agent declared `user-invocable`, entered directly by a human or the main agent rather than as a hop in a Skill's chain. Belonging to no pipeline is a shape, not a defect.
_Avoid_: orphan agent, unused agent, unreferenced sub-agent, ad-hoc agent

**Orchestrator Patch**:
The main agent's local fix to an obvious miss in a One-shot Specialist's output — an annotation, a field, an import, or a command the report claimed but skipped. Not a re-delegation. If the specialist missed the assignment, the orchestrator stops and surfaces it; it does not open a loop.
_Avoid_: retry, reviewer fix, send-back

**Pipeline Incident**:
A durable note that a specialist or gate wasted a cycle, repeated the same FAIL, or missed something a sibling already solved. Written so the specialist can be improved. Not a retry and not an Orchestrator Patch.
_Avoid_: quality flag, agent bug report, suspicious behavior, loop smell

**API Contract**:
The public HTTP surface for one capability: what a client may send, what it receives, and the meaning of success and failure.
_Avoid_: backend API, endpoint (as the unit of work), REST resource

**Independent Hop**:
A specialist job that does not need another specialist's output. Only Independent Hops may run in parallel. The orchestrator judges this; specialists do not schedule themselves.
_Avoid_: fan-out, parallel pipeline, concurrent by default

**Upstream Brief**:
A dated, cited report of how this repo's instructions and usage compare to official upstream documentation for named Ecosystems, anchored to each Ecosystem's Baseline and optionally looking ahead to a Horizon. Records future-risk, mismatch, and missed improvement only, each as an Upstream Finding. Its proposed plan may change five things and nothing else: Instruction Files, Skills, hygiene and test scripts, the definition behind a command an instruction teaches, and its own adapter config. An upstream-grounded finding about anything else — application code, an installed third-party skill — is follow-on, not part of that plan. Never a package upgrade plan.
_Avoid_: research base, research note, upgrade plan, dependency audit

**Ecosystem**:
The unit an Upstream Brief audits: one lead package together with the companion packages its upstream releases, documents, or defines compatibility against. An unrelated library that merely runs inside an Ecosystem is its own Ecosystem, audited against its own version, never against the lead's.
_Avoid_: subject (as the unit), release line, package group

**Baseline**:
The version of an Ecosystem actually installed in the repo, which an Upstream Brief is anchored to. It is read from what is installed, never from a document that records versions, and never from a declared range.
_Avoid_: pin, current version, target, Pinned Table (a different sense)

**Horizon**:
A later version of an Ecosystem the human names so an Upstream Brief can look ahead from the Baseline. Without one, a brief still reports what the Baseline's own documents say is deprecated or scheduled for removal, but never decides for itself what comes next.
_Avoid_: target, latest, next version

**Upstream Finding**:
An Upstream Brief's unit of report: one claim about this repo's instructions or usage, grounded in an upstream statement matched to the Baseline or to the range up to the Horizon, with its Evidence and an urgency. Distinct from a code review's Finding, which is about a diff and carries a rule and a severity.
_Avoid_: Finding (unqualified), upstream issue, drift item

**Upstream Opportunity**:
A technique an Ecosystem's upstream documents — or an alternative that upstream itself names — that would improve code quality or performance at a named place in this repo where nothing is wrong today. It is adoptable at the Baseline or by the Horizon, and its benefit is the upstream's own statement, never an estimate. Never an Upstream Finding and never counted as one; an Upstream Brief carries at most three per Ecosystem.
_Avoid_: suggestion, recommendation, best practice, Missed improvement (grounded in something wrong here)

**Instruction Claim**:
A version-sensitive assertion a repo-owned Instruction File or Skill makes about an Ecosystem — a command, an API, a file convention, or a version. An Upstream Brief checks every one it inventories, and each ends as an Upstream Finding or as checked and clear.
_Avoid_: rule, instruction line, teaching

**Incidental Observation**:
A local defect an Upstream Brief notices that no upstream statement grounds. It is recorded and routed to whoever owns that kind of defect, but it is not a finding, is not counted as one, and never enters the brief's proposed plan.
_Avoid_: follow-on (a different section), side finding, bonus finding

## Release & Deploy

**Staging**:
The QA deployment target. Its backend is a distinct app root with its own database, and its web app is hosted beside that backend, on the same site. Staging is never a second name for Production.
_Avoid_: test production, preview, staging as the live Namecheap host

**Production**:
The live deployment target Users use. Its backend is a distinct app root with its own database, not Staging's.
_Avoid_: live, prod (as the glossary name), staging (when you mean this)

**Release**:
A version of MyOrganiser that is live in Production, identified by a `vX.Y.Z` tag. Not the act of preparing one, not the GitHub Release page that documents it, and not a Mobile Release, which is versioned on its own.
_Avoid_: version, deployment, ship, build

**Cut**:
Creating the Release Branch with its version bump and CHANGELOG entry. Produces a candidate; a Cut that never deploys never becomes a Release. Only a commit that Staging has both uploaded and Host Applied may be Cut.
_Avoid_: release (as a verb), branch off, prepare, bump

**Release Branch**:
`release/vX.Y.Z` — the only ref the `production` GitHub Environment accepts. Its existence lets a deploy be proposed, never lets one proceed.
_Avoid_: version branch, deploy branch, hotfix branch

**Deploy Approval**:
The required-reviewer sign-off on the `production` GitHub Environment. This is the ship decision, and it is distinct from dispatching a deploy run, which automation may do freely. It authorises Production Host Apply; it is not Host Apply itself.
_Avoid_: deploy trigger, manual deploy, production run, workflow dispatch

**Host Apply**:
The on-host work that turns an uploaded backend bundle into that environment's running process. Distinct from the upload that only lands files, and from Deploy Approval, which only authorises this work for Production. An upload alone is not a deploy.
_Avoid_: post-deploy sequence, go-live, activate, restart (as the whole thing)

**Tag**:
An annotated `vX.Y.Z` tag applied after Production Host Apply has succeeded. A receipt that a version shipped — never a trigger that ships it.
_Avoid_: release tag (when you mean a trigger), version marker

**Mobile Release**:
A signed Android build of the Mobile App published on a GitHub Release for anyone to download, identified by a `mobile-vX.Y.Z` tag and numbered independently of Releases. Unlike a Release it is not live once published — each User installs it themselves, nothing updates an installed one, and earlier Mobile Releases stay in use alongside it.
_Avoid_: store release, app release, mobile version, build (for the published version)

**Version Floor**:
The lowest Mobile Release an environment's backend still serves. A Mobile App below it is refused and told to update. A refused edit is a failed push: it is never reported as saved, and the User is told it was not.
_Avoid_: minimum version, force update, kill switch, min supported version

**Product Surface**:
A fact MyOrganiser publishes by existing — its domains, its app store identity, the API origin its clients call. Public by nature: hiding one in git hides it from nobody who can use the app.
_Avoid_: public config, non-secret, branding

**Operator Fingerprint**:
A fact about where and by whom MyOrganiser is run — host, port, account name, home paths, sibling apps on the account, and the operator's other properties. Never enters the tracked tree, and never reaches a public log: on a public repository a workflow's log is published, so a value a step can print is written down. Not a secret: a secret is defeated by a secret store, a Fingerprint only by not writing it down.
_Avoid_: secret, credential, private config, infra detail

## Documentation

**Agent Guide**:
Nested agent instructions colocated with the project they constrain. Under `apps/`, the only instruction document besides an Operational README. Under `libs/`, the only instruction document besides at most one Library README per Nx library.
_Avoid_: project README (when you mean agent rules), local instructions, CLAUDE.md as a second copy of the same rules

**Operational README**:
A human-facing runbook for a deployable app, living next to that app because people run it from there. At most one per app. Not a feature write-up, design note, or ticket close-out.
_Avoid_: feature README, page README, colocated design doc, implementation summary, component breakdown, Library README

**Library README**:
A human-facing package readme for an Nx library: what the package is, how to consume it, and what not to hand-edit. At most one per library. Not a feature write-up, page README, or Agent Guide.
_Avoid_: feature README, page README, Operational README (when you mean a library), Nx scaffold README

**Research Brief**:
A dated, cited investigation in `docs/research/`, frozen at the date in its filename. Records what was true and sourced on that date; never revised afterward. If it must stay current it is not a Research Brief.
_Avoid_: research doc, investigation, internal note, planning doc

## Harness & Instructions

**Harness**:
A coding-agent product that loads this repo's instructions (Cursor, Claude Code, Gemini CLI, GitHub Copilot).
_Avoid_: IDE, vendor, tool (when you mean the product)

**Instruction File**:
Always-on policy markdown a Harness injects into the session. Repo-wide policy has one human-edited Instruction File; other roots are Harness Adapters. Distinct from a Skill, which loads only when the task matches. May include chooser lines (which Skill to load when requests collide); must not restate a Skill's procedure.
_Avoid_: memory file, system prompt, copilot instructions (as the general name)

**Skill**:
An on-demand workflow a Harness loads when the task matches. The repo has one Skill tree; Harnesses discover it natively or via a Harness Adapter and must not copy the body.
_Avoid_: command, rule, workflow file (when you mean the Skill)

**Upstream-Owned Skill**:
A Skill under `.agents/skills/` whose body is authored upstream and refreshed by the Skills CLI, listed in `skills-lock.json`. It is never hand-edited, and tooling must not read it as this repo's routing configuration. Its complement is a repo-native Skill.
_Avoid_: vendored, external, third-party, installed skill

**Harness Adapter**:
A Harness-specific discovery file that exists so that Harness finds an Instruction File or Skill, and that must not restate policy. Distinct from a Platform Adapter.
_Avoid_: Adapter (unqualified), copy, wrapper, sync target

**Sub-agent**:
A named specialist with its own instruction body and model pin, invoked by the main agent for a bounded job. Humans edit one canonical body; each Harness receives a generated Harness Adapter because model pins and tool names are not portable.
_Avoid_: agent (unqualified), custom agent (when you mean the role)

## Agent Roles

**ComponentBuilder**:
The sub-agent responsible for creating or editing a React component from a Structured Spec, following `docs/ui/GUIDELINES.md`.
_Avoid_: Frontend agent, UI agent, component writer

**ComponentReviewer**:
The sub-agent that gates a component produced by ComponentBuilder. Runs `check-component-hygiene.mjs`, `tsc`, and `eslint`, then judges composition, scope placement, concern mixing, the client boundary, Radix usage, and accessibility. `tsc` over the owning project serves as the importer check. Always runs after ComponentBuilder. Produces a report only — no code edits.
_Avoid_: Code reviewer, linter agent, review agent

**DepSync**:
The sub-agent and skill responsible for keeping `TECH_STACK.md` and the fixed set of authoritative files current when dependencies are installed, updated, or removed.
_Avoid_: Dependency agent, package sync, doc updater

**ApiWriter**:
The One-shot Specialist that implements an API Contract from a brief. Returns a report and stops. Not a Gated Pipeline.
_Avoid_: BackendBuilder, API agent, ContractBuilder, backend writer

**PrismaWriter**:
The One-shot Specialist that changes persistence: Prisma schema, generated client types, and the migration produced from that schema. Returns a report and stops. Not folded into ApiWriter.
_Avoid_: schema agent, migration agent, database writer
