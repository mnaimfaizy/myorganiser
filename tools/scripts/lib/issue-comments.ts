/**
 * What an issue's comments add to its specification.
 *
 * An issue's body is the reporter's text. Triage then files its conclusions as a
 * comment headed `## Agent Brief` (the `my-triage` Skill), and that brief is the
 * contract an implementer works to. Two readers need it: `dispatch-agents`, which
 * builds an AFK agent's prompt, and the CI code review's spec resolver, which
 * hands the Spec axis what the change was asked to do. Reading only the body,
 * both saw the report and missed the decisions — so the rule lives here, once.
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

const TRIAGE_BRIEF_HEADING = new RegExp(
  `^${TRIAGE_BRIEF_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`,
  'im',
);

/**
 * The most recent trusted triage brief on an issue, or `null`.
 *
 * The marker must be a heading on its own line, so a comment that only mentions
 * "## Agent Brief" in prose does not count. Text above it — the triage disclaimer
 * — is dropped; everything below it is the brief. A re-triage posts a fresh brief,
 * so the latest one wins and earlier ones are history.
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
    const body = String(comment?.body ?? '');
    const heading = TRIAGE_BRIEF_HEADING.exec(body);
    if (!heading) continue;
    const brief = body.slice(heading.index + heading[0].length).trim();
    if (brief) return brief;
  }

  return null;
}
