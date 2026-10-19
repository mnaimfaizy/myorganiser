# Release v2.0.0

Date: 2026-10-19

Compare: https://github.com/mnaimfaizy/myorganiser/compare/v1.1.0...v2.0.0

## Breaking Changes

- Product renamed to MyOrganiser everywhere: existing sessions end, biometric unlock resets, and Google Drive must be re-linked. **Migration**: sign in again, re-enable biometric unlock, and reconnect Google Drive.
- Mobile Apps below the minimum supported version (Version Floor) get HTTP 426 "Update required". **Migration**: install the latest Mobile Release.
- Mobile App identifier changed to `app.myorganiser` on Android and iOS. **Migration**: install as a new app; the old install does not upgrade in place.

## Security

- Sessions are kept unless the server actually refuses a token refresh; a rejected refresh token now gets 401 instead of 404.
- Dependency advisories patched across Nx, Next.js, axios, undici, joi, nodemailer, fast-uri, basic-ftp, handlebars and brace-expansion.
- Mobile release signing keys are read from 1Password, and committed signing material is refused by tooling.
- Operator-specific fingerprint removed from the default CORS configuration.

## Added

- In-app feedback: send bug reports and suggestions, follow them on a Your Reports page, and get an email when a fix ships (#1225, #1231).
- Admins can reopen a report that was wrongly marked Fixed or Shipped, with an audit log entry (#1230, #1232).
- Delete your account from the web Account page or the mobile Account tab; feedback retention is explained before you confirm.
- Mobile App v1: login, forgot-password and unlock flows, Tasks, Groceries with a trip view, Subscriptions, Details and Account screens (#944, #919).
- Mobile biometric unlock with auto-lock and a privacy cover over the app switcher.
- Mobile shows "Update required" when the backend refuses an out-of-date build.
- Keyboard focus rings and Full Keyboard Access support on mobile (#1012, #1019).
- YouTube integration: uploads sync, gated by Platform Admin YouTube Access; first connect needs an acknowledgement (#1160, #1205).
- Installable web app with an offline page and install card (#1123).
- Landing page rewritten as a scroll-driven privacy overview, with a link to the public repository (#1217).

## Fixed

- A network failure during token refresh no longer signs you out; sign-in failures show the server's message (#1081).
- Failed Task adds keep your text; failed deletes show a notice; "Task not found" no longer appears mid-delete (#1087, #1096, #1093).
- Vault edits that change nothing are detected and saved correctly on mobile (#1011).
- Android Back no longer jumps to the first tab; Escape closes bottom sheets; keyboard focus stays where expected (#1107, #1097, #1080).
- Vault fields added by newer apps are kept through every edit instead of being dropped.
- The current page is highlighted in the sidebar, and the dashboard no longer overflows on phones (#1223).
- Errors in the root layout render a full error page instead of a blank screen (#1202).
- New accounts can create their first Grocery List.

## Changed

- Groceries edits that conflict now merge by record instead of asking you to choose (#953).
- Mobile vault pulls merge with unsent edits rather than discarding them (#999).
- Email is sent from the configured sender under the MyOrganiser brand name.
- Privacy policy dated and updated for the Mobile App and YouTube features.
- YouTube: disconnecting deletes your Watched marks; revoked connections can be disconnected.
