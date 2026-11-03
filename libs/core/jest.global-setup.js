/**
 * Pins a fixed, non-UTC timezone before any Jest worker creates its first
 * `Date`. Setting `process.env.TZ` from inside a test or from `setupFiles`
 * has no effect here — by then the worker's VM context has already cached
 * the sandbox's default timezone (UTC, where a local calendar day never
 * disagrees with its UTC one), and later reassigning the env var does not
 * invalidate that cache. `globalSetup` runs in a separate process before
 * workers fork, so every worker inherits this value from birth, before it
 * has ever touched a `Date`.
 *
 * Asia/Tokyo (UTC+9) is picked so a time just after local midnight falls on
 * the *previous* UTC day — the case `localDateKey`'s test needs to tell
 * local from UTC apart.
 */
module.exports = async function () {
  process.env.TZ = 'Asia/Tokyo';
};
