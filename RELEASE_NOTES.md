# Release v2.3.0

## What's changed

### Added

- **Vault (E2EE):** Unlock the vault on the web with a device passkey instead of retyping your passphrase (#1468).
- **Vault (E2EE):** Turn Passkey Unlock on or off from the Vault page; the phone's passkey row asks before turning it off (#1468, #1483).
- **Vault (E2EE):** Tasks and Groceries show an unlock form in the vault gate instead of a dead end (#1464).
- **Vault (E2EE):** If you removed the passkey, a failed passkey unlock now tells you to turn Passkey Unlock off (#1576).
- Tasks: filtered views show a clear empty state, and "All clear" counts tasks done this week across every context (#1400).
- Admin: user detail pages show a copyable User ID, the user's last active day, and when an admin disabled the account (#1441, #1446, #1536).
- Desktop detail pages show the record name in the breadcrumb (#1426).

### Fixed

- **Vault (E2EE):** Saves are re-read and merged first, so overlapping edits and stale-tab saves no longer lose data (#1402, #1500, #1538).
- **Vault (E2EE):** Ending a session or deleting your account now clears the stored Passkey Unlock record (#1583, #1575).
- **Vault (E2EE):** A passphrase or recovery-key change no longer leaves a stale wrapping behind (#1577).
- **Admin:** Admins can no longer disable or demote themselves (#1455).
- YouTube: Channels, Shorts and digest settings show a status alert with Retry on failure, and the digest form no longer saves before settings load (#1450, #1481, #1482, #1433, #1434).
- Home: the greeting and "today" summary refresh across local midnight, and the YouTube card reports HTTP errors (#1417, #1419).
- Subscriptions: the converted AUD total recomputes when subscriptions change, and unsafe website links are blocked (#1404, #1403).
- Phone numbers: the national trunk zero is stripped from Peru (+51) numbers and from tel and SMS links (#1435).
- Groceries: edit dialogs stay open when a save is rejected (#1414).
- Phone: toasts and floating buttons no longer cover each other or the bottom sheet (#1429, #1479).
- Search: comboboxes match options by label (#1425).
- SEO: robots, sitemap and canonical tags are in place so pages index correctly (#1560).

### Changed

- **Vault (E2EE):** Repeated vault reads are shared while in flight, cutting duplicate requests (#1502).
- Vault gate: the locked-state copy points to both passphrase and passkey, and the gate's links wrap on phone (#1484).
- Legal: the terms of service show a last-updated date (#1366).
- Admin user list: "Load more" offers a retry after a failed load (#1480).
- Forgot-password copy now explains vault storage correctly (#1461).

### Internal

- Agent tooling, Sandcastle dispatch hardening (no GitHub tokens in the sandbox, all Linux capabilities dropped, 8-CPU cap), QA scenario tooling, the Merge Train and Sign-off Issue, faster PR CI, strict TypeScript for `tools/scripts`, and related docs and ADRs.
