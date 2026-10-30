/**
 * The state marker an automation writes at the top of every report it posts
 * on its own fixed-title issue, and the reader that says what the newest
 * report said.
 *
 * Two automations need it for the same reason: they report more often than a
 * person acts. `npm-audit-issue.ts` reports per push to `main`, which happens
 * several times a day, and `ci-duration-watch-issue.ts` reports weekly. Each
 * has to record a recovery exactly **once** — not again on every green push
 * or quiet week that follows it — and the only durable place to remember
 * "the last thing said here was a recovery" is the issue itself.
 *
 * The marker is an HTML comment, so a reader sees nothing and GitHub renders
 * nothing. It is anchored to the **start** of a body: every report opens with
 * it, so advisory text or a measurement table further down a report can never
 * be read as one, and neither can a quotation of a marker in a human's
 * comment.
 *
 * Shared rather than copied because the thing it guarantees — "once" — is one
 * behaviour, and two copies of it drift in one automation and not the other.
 * What differs between callers is only the prefix, the two state names, and
 * what an issue carrying no marker at all counts as; those are the arguments.
 *
 * Run the tests with: node --test tools/scripts/lib/issue-state-marker.test.ts
 */

/** Escapes a string for literal use inside a RegExp. */
const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What a reader is given: an issue body and the comments under it. */
export interface ReportedStateInput {
  body?: string | null;
  comments?: readonly { body?: string | null }[] | null;
}

/** One automation's marker: how to write it, and how to read the newest one. */
export interface IssueStateMarker<State extends string> {
  /** The marker naming `state`, to open a report body with. */
  marker(state: State): string;
  /**
   * The state the newest report on the issue recorded, reading the body and
   * then the comments in the order the API returns them (oldest first). An
   * issue with no marker anywhere — opened by hand under the title — is the
   * `fallback`.
   */
  lastReportedState(input: ReportedStateInput): State;
}

export interface IssueStateMarkerOptions<State extends string> {
  /** The marker's own name, e.g. `npm-audit-issue`. */
  prefix: string;
  /** Every state the marker can name. */
  states: readonly State[];
  /** What an issue carrying no marker at all counts as. */
  fallback: State;
}

export function issueStateMarker<State extends string>({
  prefix,
  states,
  fallback,
}: IssueStateMarkerOptions<State>): IssueStateMarker<State> {
  const known = new Set<string>(states);
  const pattern = new RegExp(
    `^<!-- ${escapeRegExp(prefix)}:(${states.map(escapeRegExp).join('|')}) -->`,
  );

  return {
    marker: (state) => `<!-- ${prefix}:${state} -->`,
    lastReportedState: ({ body, comments }) => {
      const reported = [body, ...(comments ?? []).map((c) => c?.body)]
        .map((text) => (text ?? '').match(pattern)?.[1])
        .filter(
          (state): state is State => state !== undefined && known.has(state),
        );
      return reported.at(-1) ?? fallback;
    },
  };
}
