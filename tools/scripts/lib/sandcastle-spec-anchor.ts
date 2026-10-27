// The spec anchor: how a branch whose NAME carries no issue number still tells
// the code review which issue it answers to.
//
// `/code-review` resolves its spec source in a fixed order — branch name, then
// an issue reference in a commit, then nothing (tools/scripts/review/
// resolve-spec.mjs). A sandcastle PRD integration branch is `feat/<prd-slug>`:
// the slug is the PRD's title, not its number, so the branch-name step cannot
// match and the pull request opened from it reaches the reviewer with no spec.
// That drops the effective tier one level on exactly the work a human most
// needs the Spec axis to cover — agent-authored.
//
// The fix stays inside the existing discovery order: the orchestrator writes an
// empty first commit on the branch it creates, carrying a closing reference the
// commit step already reads. Nothing about resolve-spec.mjs changes. See
// ADR 0076.
//
// A pull request body is deliberately NOT a spec source, so this cannot be
// solved by having the agent describe its own work — see the same ADR.

import { discoverSpec } from '../review/resolve-spec.ts';

/** The reference keywords `resolve-spec.mjs` matches; `Closes` is one of them. */
const CLOSING_KEYWORD = 'Closes';

export interface SpecAnchorInput {
  branch: string;
  issue: number;
  title?: string;
}

/**
 * Pure: the anchor commit message for a branch created around one issue.
 *
 * The subject says what the commit is for, because it is the oldest commit on
 * the branch and shows up in every log of it. The trailer is the payload: one
 * `Closes #<n>`, which both GitHub and the spec resolver read.
 */
export const specAnchorMessage = ({
  branch,
  issue,
  title,
}: SpecAnchorInput): string => {
  if (!Number.isInteger(issue) || issue <= 0) {
    throw new Error(`spec anchor needs a positive issue number, got ${issue}`);
  }
  if (!branch) throw new Error('spec anchor needs a branch name');
  return [
    `chore(sandcastle): anchor ${branch} to #${issue}`,
    '',
    `\`${branch}\` carries no issue number in its name, so this empty commit`,
    'carries the reference instead. It is the oldest commit on the branch, and',
    '`/code-review` reads it through the commit step of its existing spec',
    'discovery order — see ADR 0076 and AGENTS.md "Branch naming".',
    ...(title ? ['', `Issue: ${title}`] : []),
    '',
    `${CLOSING_KEYWORD} #${issue}`,
  ].join('\n');
};

/**
 * Pure: whether a branch's NAME already resolves to this exact issue, so an
 * anchor would say nothing the resolver does not already know.
 *
 * This asks the resolver rather than restating its regex. A copy of the pattern
 * is not a contract with it: it agrees on whatever examples a test lists and
 * drifts silently on everything else.
 *
 * The comparison is against `issue`, not merely against the SHAPE of a branch
 * name. `feat/2026-roadmap` matches the shape while the `2026` is a slug
 * fragment, and treating that as "already carried" skips the anchor on exactly
 * the branch that needed one — see `prdBranchSlug` for the other half.
 */
export const branchNameCarriesIssue = (
  branch: string,
  issue: number,
): boolean => {
  const found = discoverSpec({ headRef: branch, commits: [] });
  return found.foundBy === 'branch' && found.ref === `#${issue}`;
};

// A slug is a title, and a title may begin with a number: "2026 roadmap" slugs
// to `2026-roadmap`, and `feat/2026-roadmap` is indistinguishable from a branch
// deliberately named after issue 2026. The resolver then reads the slug fragment
// as the issue and never reaches the anchor commit — silently reviewing against
// the wrong ticket when that number exists, and failing the resolve when it does
// not. A slug cannot begin with a digit run, so prefix one that would.
const LEADING_DIGITS = /^\d+(?:-|$)/;

/** Pure: the branch slug for a PRD title, safe to sit after `feat/`. */
export const prdBranchSlug = (title: string): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return LEADING_DIGITS.test(slug) ? `prd-${slug}` : slug;
};
