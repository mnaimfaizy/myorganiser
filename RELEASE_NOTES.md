# v2.4.0 — 2026-11-17

## Highlights

- Passkey Unlock is now available on the web app, and enrolment works with 1Password on desktop browsers.
- Emails such as verification now report a failed send instead of claiming success.
- Vault edits made in two tabs or on two devices are merged instead of overwriting each other.
- Admins can see when a User was last active and how long they have been disabled.

## ⚠ Breaking Changes

- `GET /vault/backups/latest` returns `200` with a `null` body, not `404`, when empty. — **Migration**: check for `null`.

## Added

- **Vault / E2EE:** unlock your Vault with a passkey on the web app (`f8e34b0d`).
- **Vault / E2EE:** turn Passkey Unlock on or off for this device from the Vault page (`65af5281`).
- Admins see each User's last active day in the directory and on the user detail page (`93bcb16d`).
- Admins see how long a User has been disabled, such as "Disabled 3 days ago" (`38d75319`).
- Admins can copy a User's full ID from the user detail page (`cfd96d29`).
- YouTube pages show a permanent "access withdrawn" notice, with the date when known (`87340de7`).
- Tasks show a "No tasks match these filters" state with a Clear filters button (`8cb99c6c`).

## Fixed

- Emails such as verification now report a failed send and log the error for the server operator (`d0358f94`).
- **Vault / E2EE:** Passkey Unlock setup works with 1Password on desktop browsers (`d4e2c05e`).
- **Auth / Sessions:** Passkey Unlock is cleared when the server ends your session (`1c363d1b`).
- **Vault / E2EE:** deleting an account also removes this device's Passkey Unlock record (`c5e3123b`).
- **Vault / E2EE:** Passkey Unlock checks the server's Vault first, so a Vault changed elsewhere is caught (`3f45f50c`).
- **Vault / E2EE:** a stale tab no longer replaces records another tab added (`d70a9018`).
- **Vault / E2EE:** passphrase changes and Recovery Key rotations no longer undo a concurrent Vault write (`9e3fa76c`).
- **Vault / E2EE:** an older read no longer overwrites newer Vault data on the page (`725ede3c`).
- **Vault / E2EE:** overlapping task changes are queued, so none are lost (`16386e67`).
- **Vault / E2EE:** subscription and usage-location links that are not plain http or https are blocked (`379e62cf`).
- **Auth / Sessions:** resending a verification email shows the server's message, such as a rate limit (`635ab76f`).
- Subscriptions recalculate the converted total when subscriptions change (`f4e0b18d`).
- Groceries edit dialogs stay open when a save fails (`a206ccda`).
- YouTube pages now report status and connection failures to the user (`a6f80ac7`).
- The Videos page sync button stays disabled until a channel is turned on, with a note saying why (`581ee80b`).
- Call and text links drop the national trunk 0 for countries that use one, such as UK and Australia (`2aa65745`).
- Phone toasts stay clear of floating buttons and bottom sheets (`f7b7d8f2`).
- The YouTube data privacy page now has a browser tab title (`f982c44f`).

## Changed

- **API contract:** admins cannot disable or demote their own account; both now return `409` (`9ef19d0d`).
- **Vault / E2EE:** Passkey Unlock is removed on sign-out, Vault removal, or when the passkey is gone (`d9eabccf`).
- **Vault / E2EE:** turning Passkey Unlock off on a phone asks for confirmation first (`79da6fc9`).
- Public pages can be indexed by search engines; signed-in and one-off pages are marked noindex (`4abaf403`).
- The Terms of Service shows a last-updated date (`db867df7`).
- YouTube availability is checked once for the sidebar and page, not once per component (`8dfeb9f4`).

## Internal

Sandcastle dispatch hardening and 0.14 upgrade, Sign-off Issue and Merge Train tooling, QA Storyboards and annotated MP4s, TypeScript tooling move, CI speed-ups, and agent docs.
