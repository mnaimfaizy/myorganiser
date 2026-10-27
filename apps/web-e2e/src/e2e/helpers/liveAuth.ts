/**
 * Verified user seeded by `tools/scripts/e2e-live-backend.ts`.
 * The password stays inside the 10–15 character fixture window.
 */
export const LIVE_AUTH_EMAIL = 'e2e-logout@example.com';
export const LIVE_AUTH_PASSWORD = 'password123';

/**
 * A second verified user, which the live User Deletion spec deletes. Its own
 * so the logout spec's user survives; re-seeded on every boot, so a run after
 * a deletion starts from the same state.
 */
export const LIVE_DELETION_EMAIL = 'e2e-deletion@example.com';
export const LIVE_DELETION_PASSWORD = 'password123';
