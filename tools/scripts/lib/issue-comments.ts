/**
 * What an issue's comments add to its specification.
 *
 * An issue's body is the reporter's text. Triage then files its conclusions as a
 * comment headed `## Agent Brief` (the `my-triage` Skill), and that brief is the
 * contract an implementer works to. A maintainer amends it later under
 * `## Maintainer Review`. Two readers need it: `dispatch-agents`, which
 * builds an AFK agent's prompt, and the CI code review's spec resolver, which
 * hands the Spec axis what the change was asked to do. Reading only the body,
 * both saw the report and missed the decisions — so the rule lives here, once.
 *
 * Comments are opt-in rather than wholesale: the orchestrator posts its own status
 * comments (Pipeline Incident, unblock notices) on the same issues, and replaying
 * those back to an agent is noise at best and stale instruction at worst. Only text
 * filed under one of the two marker headings travels. #396 closed with three
 * reviewed findings unaddressed because nothing below the body travelled at all.
 *
 * The repository is public: anyone can comment, and a comment that reaches an
 * agent's prompt is an instruction. Only comments from the repository's owner,
 * members, or collaborators count. A comment that does not say who wrote it is
 * not trusted.
 */

/** GitHub author associations whose comments may amend an issue's spec. */
export const TRUSTED_AUTHOR_ASSOCIATIONS = [
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
] as const;

/** Heading that marks a comment as the issue's triage brief. */
export const TRIAGE_BRIEF_MARKER = '## Agent Brief';

/** Heading that marks a comment as instructions for the next agent run. */
export const MAINTAINER_NOTE_MARKER = '## Maintainer Review';

/** One issue comment, as `gh issue view --json comments` returns the fields read here. */
export interface IssueComment {
  body?: string | null;
  authorAssociation?: string | null;
}

/** True when the comment's author may amend the issue's spec. */
export function isTrustedComment(
  comment: IssueComment | null | undefined,
): boolean {
  const association = String(comment?.authorAssociation ?? '').toUpperCase();
  return (TRUSTED_AUTHOR_ASSOCIATIONS as readonly string[]).includes(
    association,
  );
}

/**
 * The text below a marker heading in one comment, trimmed, or `''`.
 *
 * The marker must be a heading on its own line, so prose that only mentions it
 * does not count. It is matched case-insensitively: a maintainer typing
 * "## maintainer review" means the same thing, and failing silently on
 * capitalisation is the worst outcome here. Text above the heading — the triage
 * disclaimer, conversational preamble — is dropped.
 */
function textBelowHeading(body: string, marker: string): string {
  const heading = new RegExp(
    `^${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`,
    'im',
  ).exec(body);
  if (!heading) return '';
  return body.slice(heading.index + heading[0].length).trim();
}

/**
 * The most recent trusted triage brief on an issue, or `null`.
 *
 * A re-triage posts a fresh brief, so the latest one wins and earlier ones are
 * history.
 *
 * @param comments the issue's comments, oldest first
 */
export function latestTriageBrief(
  comments: (IssueComment | null | undefined)[] | undefined,
): string | null {
  if (!Array.isArray(comments)) return null;

  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const comment = comments[index];
    if (!isTrustedComment(comment)) continue;
    const brief = textBelowHeading(
      String(comment?.body ?? ''),
      TRIAGE_BRIEF_MARKER,
    );
    if (brief) return brief;
  }

  return null;
}

/**
 * Every trusted maintainer note on an issue.
 *
 * Everything below the marker heading is taken, so a note can carry whatever
 * structure it needs. Notes amend rather than replace one another, so all of
 * them travel.
 *
 * @returns note bodies, in the order they were filed
 */
export function extractMaintainerNotes(
  comments: (IssueComment | null | undefined)[] | undefined,
): string[] {
  if (!Array.isArray(comments)) return [];

  const notes: string[] = [];
  for (const comment of comments) {
    if (!isTrustedComment(comment)) continue;
    const note = textBelowHeading(
      String(comment?.body ?? ''),
      MAINTAINER_NOTE_MARKER,
    );
    if (note) notes.push(note);
  }

  return notes;
}
