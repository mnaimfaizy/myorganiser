/**
 * The shape a synchronous child-process throw actually has.
 *
 * `execFileSync` and friends throw on a non-zero exit, and the thrown value
 * carries the exit status and whatever the child wrote — but `@types/node`
 * types the throw as `unknown`, so every caller that wants the status writes
 * its own structural cast. Three did, and they disagreed: two read all three
 * fields, one read `status` alone, and nothing said what happens when the
 * throw is not a spawn failure at all (a missing binary, a thrown string).
 *
 * So the cast lives here once, for the reason `lib/glob.ts` gives for its own
 * contents: two copies of one rule drift, and the drift is silent. For the
 * `message` of an ordinary caught value, see [lib/error-message.ts].
 */

/** The fields a synchronous child-process throw carries, all of them optional. */
export interface SpawnFailure {
  /** The child's exit code, or `undefined` when it never ran. */
  status: number | undefined;
  /** What the child wrote to stdout before failing; `''` when it wrote nothing. */
  stdout: string;
  /** What the child wrote to stderr before failing; `''` when it wrote nothing. */
  stderr: string;
}

/**
 * Read a caught value as a spawn failure. A value that is not one — a thrown
 * string, `undefined`, an `Error` with no `status` — reads as
 * `{ status: undefined, stdout: '', stderr: '' }` rather than throwing again,
 * because a checker inside a `catch` block has no better place to fail.
 */
export function spawnFailure(error: unknown): SpawnFailure {
  const thrown = (error ?? {}) as {
    status?: unknown;
    stdout?: unknown;
    stderr?: unknown;
  };
  return {
    status: typeof thrown.status === 'number' ? thrown.status : undefined,
    stdout: typeof thrown.stdout === 'string' ? thrown.stdout : '',
    stderr: typeof thrown.stderr === 'string' ? thrown.stderr : '',
  };
}
