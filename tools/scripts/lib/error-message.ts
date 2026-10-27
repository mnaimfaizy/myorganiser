/**
 * The one way the tooling turns a caught value into a message.
 *
 * `catch (err)` hands over `unknown` under `strict`, so every checker that
 * wants `err.message` has to narrow first. ADR 0135's migration wrote that
 * narrowing out by hand in each `catch` block it touched — the same
 * conditional, in 34 places across 20 files — and a hand-written copy is
 * where the shapes drift: `String(err)` in one, `err.message` guarded only by
 * a truthiness check in the next, `'unknown error'` in a third. A reader
 * comparing two gates' failure output could not tell whether the difference
 * was deliberate.
 *
 * So the narrowing lives here, for the reason `lib/glob.ts` gives for its own
 * contents: two copies of one rule drift, and the drift is silent.
 */

/**
 * The message a caught value carries, for an operator reading a gate's
 * failure. An `Error` gives up its `message`; anything else — a thrown
 * string, a rejected number, `undefined` — is stringified, because a gate
 * that says nothing about why it stopped is worse than one that says
 * `undefined`.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
