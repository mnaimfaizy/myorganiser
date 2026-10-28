# A web device may hold the Master Key wrapped by a passkey

The web app — in a browser tab or the Installed Web App — may keep a User's
Master Key on the device wrapped by a key that only a verified passkey can
produce, so that a phone does not ask for a long passphrase on every relaunch.
It is the web's counterpart to Biometric Unlock, opt-in, enrolled per device,
additive to the passphrase and the Recovery Key, and it authorizes nothing a
passphrase unlock does not.

## Status

accepted

## Context

The web app keeps the Master Key in memory only. A reload, a closed tab, or a
relaunched Installed Web App drops it, and the next visit costs a typed
passphrase. On a phone that is most visits. [ADR 0108](0108-a-mobile-device-may-hold-the-master-key-behind-a-biometric-gate.md)
removed that cost for the Mobile App, but [ADR 0127](0127-a-mobile-release-is-an-android-download-and-ios-is-the-installed-web-app.md)
serves iOS through the Installed Web App, and Android Users can use the web
app in Chrome as well. Feedback reached #1339 from Chrome on Android in the
browser.

The WebAuthn `prf` extension lets a passkey return a secret derived from a
per-credential salt, after the platform's own user verification. That secret
can wrap the Master Key the way the Recovery Key does.

## Decision

1. **Passkey Unlock is a fourth Vault Unlock Secret.** The device stores the
   Master Key wrapped by a key derived from the passkey's PRF output. It never
   stores the Master Key unwrapped, and the wrapped key never leaves the
   device.
2. **It follows ADR 0108's rules 1, 2, 4, and 5.** It is offered once after a
   passphrase unlock; turning it on later from the Vault page asks for the
   passphrase again. The passphrase and the Recovery Key always stay on the
   Unlock screen, and any failed check falls back to them. It never
   authorizes a passphrase reset. It survives a passphrase or Recovery Key
   rotation, and is deleted when the wrapped key no longer decrypts the
   server's Ciphertext.
3. **It is per device and bound to one User.** The wrapped key is stored in
   the browser profile, keyed to the signed-in User, and deleted at logout.
   Another User on the same browser is never offered it. A passkey synced to
   another device unlocks nothing there until that device enrolls.
4. **User verification is required** at enrolment and on every unlock. A
   passkey that is merely present does not unlock.
5. **It is offered only where it works.** Whether a passkey supports PRF is
   known only after it is created; where it does not, the new credential is
   discarded and Passkey Unlock is not offered. Nothing is shown in its place.
6. **A failed check keeps the wrapped key.** The browser reports a cancel and
   a deleted passkey alike, so a failure only falls back. The wrapped key is
   removed at logout, when the User turns Passkey Unlock off, when it no
   longer decrypts, or when the browser reports the credential is gone.
7. **Locking is unchanged.** The unlocked Master Key still lives in memory
   only, and the web app gains no Auto-Lock from this decision.

## Considered Options

- **Keep the vault unlocked across relaunches** by persisting the Master Key
  in the browser. Rejected: it removes the check rather than cheapening it,
  and it would need a web Auto-Lock to be safe at all.
- **A short PIN wrapping the Master Key.** Rejected: a six-digit PIN over data
  copied from the device falls to an offline search.
- **Store the wrapped Master Key on the server.** It is Ciphertext, so it
  would be allowed, and a synced passkey would then unlock on every device it
  reaches. Rejected: it widens the new way into the Vault to every device the
  passkey provider syncs to, needs an API Contract and a migration, and makes
  revocation a server operation. Enrolling once per device is cheap.
- **Reuse Biometric Unlock.** Rejected as a term: Biometric Unlock stores the
  plaintext Master Key behind a hardware keystore gate; Passkey Unlock stores
  only a wrapping, so the two end, fail, and are threatened differently.

## Consequences

- For the first time, something derived from the Master Key rests on a web
  device between visits. It is unreadable without the passkey and its user
  verification; a compromise that defeats both reads the Vault. That is the
  accepted cost, and the reason the feature is opt-in.
- The web's "the Master Key stays in memory" holds for the Master Key itself.
  This ADR carves out its wrapping only.
- Browsers and passkey providers without PRF get nothing new. The passphrase
  remains the way in for them.
- A web Auto-Lock is a separate decision and is not made here.
