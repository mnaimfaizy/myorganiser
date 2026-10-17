# Authentication

> **[Session lifecycle](session-lifecycle.html)** is an interactive walk through one account from
> registration to revocation — which check rejects a login, and what Force Logout kills. `/auth/*`
> is served only by `AuthController`. Open it in a browser; no build step or server needed. This
> file stays the endpoint reference.

This project uses **Option A**:

- **Access token**: short-lived JWT, sent as `Authorization: Bearer <token>`.
- **Refresh token**: stored in an **HTTP-only cookie** (not accessible to JavaScript).
- Frontend stores **only the access token** (localStorage or sessionStorage).

## Backend endpoints

All endpoints are under the backend router prefix (see `ROUTER_PREFIX`).

- `POST /auth/register` – creates a user
  - Body: `firstName`, `lastName`, `email`, `password`, optional `phone`
- Creates the user and sends a verification email
- Returns a message-based response (e.g. `{ message, user }`)
- `POST /auth/login` – returns `{ token, expires_in, user }` and sets refresh cookie
- `POST /auth/refresh` – returns `{ token, expires_in, user }`
  - Refresh token is taken from the refresh cookie (request body is optional)
  - **Rotates the refresh token**: a new one is minted and the cookie is reset on every
    successful refresh. The response body carries only the access token, so the rotation is
    invisible to web clients and handled by the cookie jar.
- `POST /auth/logout/:userId` – Logout: ends this client's Session
  - Requires JWT and ownership (`userId` matches the JWT User)
  - Refresh token is `body.refresh_token ?? refresh_cookie` (same two channels as refresh)
  - The chosen token must belong to the JWT User
  - Revokes that Refresh Token and clears the refresh cookie
  - Web sends the cookie; mobile sends `refresh_token` in the body
- `DELETE /users/me` – User Deletion: permanently deletes the signed-in User
  - Requires JWT. Body: `{ password, confirmation: "DELETE" }` (no other keys)
  - `422` if the body fails validation; nothing is deleted
  - `403 { message: "Incorrect password." }` if the password does not match; nothing is deleted.
    This is deliberately not `401`, which the web client treats as an expired Access Token
  - `409 { message }` if a YouTube sync is running; nothing is deleted, so retry shortly
  - The YouTube Connection goes first, through YouTube Disconnect (a Google revoke failure does not block deletion)
  - `204` on success: one `DELETE` of the User row, inside which all owned data cascades.
    Sessions end because the User row is gone. The refresh cookie is cleared
  - Admin Audit Log entries about the User are kept with the User removed from them
    (`actorUserId` / `targetUserId` become `null`)
  - Feedback Reports the User sent are kept with the reporter removed from them
    (`reporter_user_id` becomes `null`), so a report can still be fixed and its
    sender is never contacted about it again (CONTEXT.md § User Deletion)
  - A confirmation Transactional Email is sent to the captured address; a send failure does not fail the request

Email verification:

- `PATCH /auth/verify/email` – verifies the email using a token
  - Body: `{ token: string }`
- `POST /auth/verify/resend` – resends the verification email (public)
  - Body: `{ email: string }`
  - Returns `429` if a non-expired verification token already exists (cooldown)
- `POST /auth/verify/resend/:userId` – resends the verification email (authenticated)
  - Requires JWT + ownership

## Frontend behavior

Frontend auth logic lives in the monorepo library `@myorganiser/auth`.

### Email verification UX

- After successful registration, the user is redirected to: `/verify/email/sent?email=...`
- The verification email links to the frontend: `/verify/email?token=...`
  - This page calls the backend `PATCH /auth/verify/email` endpoint.
- Login/refresh are blocked until the email is verified.
  - Backend responds with `403` and a user-friendly message (frontend displays it).
- The login page and the verification instructions page include a **Resend verification email** action.
  - If a verification email was sent recently, backend returns `429` to prevent spamming.

### Token storage

- If user checks **Remember me**, the access token is stored in `localStorage`.
- Otherwise it is stored in `sessionStorage`.

Keys used:

| Key                         | Where            | Holds                                                         |
| --------------------------- | ---------------- | ------------------------------------------------------------- |
| `myorganiser_access_token`  | local or session | The access token                                              |
| `myorganiser_user`          | `localStorage`   | The filtered user, always local                               |
| `myorganiser_token_storage` | `localStorage`   | Which of the two the access token went to (`local`/`session`) |

`myorganiser_token_storage` is what makes **Remember me** survive a reload: the access token
itself may live in `sessionStorage`, but the preference recording that choice cannot, or the next
page load would not know where to look.

Because `myorganiser_user` is always in `localStorage`, a user whose access token has expired
still has a recoverable identity on disk. That is the `restorable` session state — see
`getSnapshot` in `@myorganiser/auth`.

### Requests and refresh-on-401

`@myorganiser/auth` creates an Axios instance with:

- `withCredentials: true` (so the refresh cookie is sent)
- An interceptor that, on `401` for non-auth requests:
  1. Calls `POST /auth/refresh`
  2. Updates stored access token
  3. Retries the original request once

If the server refuses the refresh (a 4xx other than `408` or `429`), the session is cleared and the session-ended signal fires once. A refresh that could not be completed — no response, a timeout, a `5xx`, `408` or `429` — keeps the session: the request rejects with the refresh error and the next `401` tries the refresh again.

### Route guards

On load, the route guards in `@myorganiser/auth` (`resolveOutboundGuard` for `/dashboard` and `/admin`, `resolveInboundGuard` for the landing page) restore a `restorable` session before deciding what to show:

| Restore result                                 | Protected page (`DashboardGuard`, `AdminGuard`) | Landing page (`RootAuthRedirect`)                                                       |
| ---------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| Restored                                       | Shows the page                                  | Redirects to `/dashboard`                                                               |
| Server refused the refresh (session cleared)   | Redirects to `/login`                           | Shows the landing page                                                                  |
| Could not be completed (`restore_unavailable`) | Shows a "Can't reach the server" notice         | Shows the landing page, with **Open dashboard** in place of **Login** / **Get Started** |

A refresh that could not be completed leaves a Restorable Session, which is not a Guest and is never sent to sign-in. The guard retries the restore when the user presses **Try again**, when the browser comes back online, and when the window regains focus or becomes visible, then acts on the new result. The landing page offers no sign-in link while the restore is unavailable.

## Configuration

Frontend expects an API base URL. In production, prefer setting `API_BASE_URL` at runtime (cPanel env vars). `NEXT_PUBLIC_API_BASE_URL` is still supported as a fallback.

Examples:

- No prefix: `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000`
- With prefix: `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api/v1`

The value should match how the backend is started (notably `ROUTER_PREFIX`).

Backend uses `APP_FRONTEND_URL` to generate links inside emails (verification/reset).

Typical dev defaults:

- Backend: `http://localhost:3000`
- Frontend: `http://localhost:4200`

## Security notes

- Refresh token is in an HTTP-only cookie, reducing XSS exposure.
- Access token in browser storage is still sensitive; keep token TTL short.
- Ensure CORS allows credentials and restricts origins.
- In production, refresh cookie should be `Secure` and an appropriate `SameSite`.
- Email verification is required before issuing tokens.

## Anti-spam / cooldown behavior

To avoid email flooding, verification resends are guarded:

- Backend stores the last verification token in `User.email_verification_token`.
- While the token is still valid (currently `10m`, same as `VERIFY_JWT_SECRET` token TTL), resend requests return `429`.
- The token is persisted **only after** the verification email was sent successfully.
- When the user verifies (`PATCH /auth/verify/email`), the stored token is cleared.
