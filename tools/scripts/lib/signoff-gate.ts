/**
 * The production gate (ADR 0151 decisions 8 and 9): a production deploy is
 * not dispatched while the Cut's Sign-off Issue holds a `staging` Person
 * Check that is neither ticked nor waived by the Maintainer.
 *
 * Everything this reads is text that collaborators can edit, so it trusts
 * only what it can tie to the Maintainer's login — the repository's owner —
 * and errs toward holding:
 *
 * - **A tick** counts only when the issue's edit history shows that the
 *   revision that last turned the box from unticked (or absent) to ticked
 *   was the Maintainer's. A later edit by someone else that keeps it ticked
 *   does not undo it; an untick by anyone holds.
 * - **A `staging` check** is any key that was `[staging]` in any revision,
 *   so relabelling a line or deleting it never releases the deploy. A
 *   removed line holds until it is waived.
 * - **A waiver** is a never-edited, not-minimised comment by the owner login
 *   with the OWNER association, every non-blank line of which is
 *   `waive: <pr>:<key> — <reason>` with a non-blank reason.
 * - **A history** that is truncated, has a deleted revision, or whose newest
 *   revision is not the body cannot prove anything: the gate cannot decide.
 *
 * Trust is by login: the Merge Train and an agent acting for the Maintainer
 * write as the owner's login too, so provenance cannot tell them apart. "An
 * agent never ticks" holds because the train's insert-only write never
 * flips a box, not because of anything read here.
 *
 * The Cut's issue is the owner-written Sign-off Issue that any revision
 * froze for the version. With none, the gate holds on any unfrozen Sign-off
 * Issue's open `staging` checks instead, open or closed, since a Cut that
 * failed to freeze leaves its checks there.
 *
 * Pure: the `gh` reads live in `tools/scripts/ci/signoff-gate.ts`. The input
 * types are the GraphQL node shapes that script reads.
 *
 * Run the tests with: node --test tools/scripts/lib/signoff-gate.test.ts
 */

import {
  SIGNOFF_ISSUE_MARKER,
  isReleaseVersion,
  parseSignOffIssue,
  signOffCheckId,
  type SignOffIssueBody,
} from './signoff-issue.ts';

// --------------------------------------------------------------- input

type Login = { login?: string | null } | null | undefined;

/** One `UserContentEdit` node. `diff` is the full text of that revision. */
export interface ContentEdit {
  editedAt: string;
  deletedAt?: string | null;
  editor?: Login;
  diff?: string | null;
}

/** One issue comment node. */
export interface GateComment {
  author?: Login;
  authorAssociation?: string | null;
  body?: string | null;
  isMinimized?: boolean | null;
  lastEditedAt?: string | null;
}

/** One candidate Sign-off Issue, with its history and comments as read. */
export interface GateIssue {
  number: number;
  state: 'OPEN' | 'CLOSED';
  author?: Login;
  body?: string | null;
  edits: { totalCount: number; nodes: ContentEdit[] } | null;
  comments: { totalCount: number; nodes: GateComment[] } | null;
}

/** Everything the gate decides from. */
export interface GateInput {
  /** The repository's owner, as `repository { owner { __typename login } }` returns it. */
  owner: { __typename?: string | null; login?: string | null } | null;
  /** The Cut being deployed, `vX.Y.Z`. */
  version: string;
  /**
   * The issues labelled `qa` that the owner wrote and whose body starts with
   * the marker, open and closed; null when that list could not be read whole.
   */
  issues: GateIssue[] | null;
}

// --------------------------------------------------------------- output

/** Why a `staging` Person Check still holds the deploy. */
export type OpenWhy =
  | 'not ticked'
  | 'ticked, but not by the Maintainer'
  | 'removed from the issue';

/** One `staging` Person Check that holds the deploy. */
export interface OpenCheck {
  issue: number;
  pr: number;
  key: string;
  text: string;
  why: OpenWhy;
}

export type GateDecision =
  | { status: 'allow'; reason: string }
  | { status: 'held'; reason: string; open: OpenCheck[] }
  | { status: 'cannot-decide'; reason: string };

// --------------------------------------------------------------- pieces

/** `release/vX.Y.Z` → `vX.Y.Z`; null for anything else. */
export function releaseVersion(branch: string): string | null {
  const name = branch.trim();
  if (!name.startsWith('release/')) return null;
  const version = name.slice('release/'.length);
  return isReleaseVersion(version) ? version : null;
}

/** A waiver's id, `<pr>:<key>`: the same id as a check line's trailer. */
export const checkId = signOffCheckId;

const WAIVER_RE =
  /^waive:[ \t]+([1-9]\d*:[0-9a-f]{12})[ \t]+(?:—|–|--|-)[ \t]+(\S.*)$/;

/**
 * The waivers a comment states, by allow-list: every non-blank line must be
 * `waive: <pr>:<key> — <reason>` (an em dash, en dash, `--` or `-`, with
 * whitespace on both sides) with a non-blank reason, or the comment states
 * none and this is null.
 */
export function parseWaivers(
  body: string | null | undefined,
): { id: string; reason: string }[] | null {
  const lines = (body ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) return null;
  const waivers: { id: string; reason: string }[] = [];
  for (const line of lines) {
    const m = WAIVER_RE.exec(line);
    if (!m) return null; // `(\S.*)` already refuses a blank reason
    waivers.push({ id: m[1], reason: m[2].trim() });
  }
  return waivers;
}

/**
 * Whether a comment can be trusted as the Maintainer's words: written by the
 * owner login with the OWNER association, not minimised, never edited.
 */
export const isOwnerComment = (comment: GateComment, owner: string): boolean =>
  comment.authorAssociation === 'OWNER' &&
  comment.author?.login === owner &&
  !comment.isMinimized &&
  !comment.lastEditedAt;

/**
 * The waivers that count: only from a comment the owner login wrote with the
 * OWNER association, that is not minimised and was never edited (anyone
 * with write access can edit someone else's comment). Keyed by check id.
 */
export function trustedWaivers(
  comments: readonly GateComment[],
  owner: string,
): Map<string, string> {
  const waived = new Map<string, string>();
  for (const comment of comments) {
    if (!isOwnerComment(comment, owner)) continue;
    for (const { id, reason } of parseWaivers(comment.body) ?? [])
      if (!waived.has(id)) waived.set(id, reason);
  }
  return waived;
}

/** One revision of an issue body, oldest first. */
export interface Revision {
  editor: string | null;
  body: string;
}

const sameText = (a: string, b: string): boolean =>
  a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');

/**
 * An issue's revisions, oldest first, or why they cannot be trusted. With no
 * edits the body is the only revision, by the author. Once an issue is
 * edited, GitHub lists every revision newest first, the original last;
 * ties in `editedAt` keep that order, and an order the timestamps
 * contradict is unreadable.
 */
export function revisionsOf(
  issue: GateIssue,
):
  | { status: 'read'; revisions: Revision[] }
  | { status: 'unreadable'; reason: string } {
  const body = issue.body ?? '';
  const edits = issue.edits;
  if (!edits)
    return {
      status: 'unreadable',
      reason: `the edit history of #${issue.number} could not be read`,
    };
  if (edits.nodes.length !== edits.totalCount)
    return {
      status: 'unreadable',
      reason: `the edit history of #${issue.number} was not read whole (${edits.nodes.length} of ${edits.totalCount} revisions)`,
    };
  // With no edits the author made the only revision. Only an issue the
  // owner wrote is ever a candidate (`isCandidate`), so this is the owner.
  if (edits.nodes.length === 0)
    return {
      status: 'read',
      revisions: [{ editor: issue.author?.login ?? null, body }],
    };
  if (
    edits.nodes.some((edit) => edit.deletedAt || typeof edit.diff !== 'string')
  )
    return {
      status: 'unreadable',
      reason: `a revision of #${issue.number} was deleted from its history`,
    };
  // GitHub lists edits newest first, and `editedAt` has one-second
  // precision, so two ticks in the same second tie. The API's order is the
  // order of record; the timestamps only have to agree with it.
  const ordered = [...edits.nodes].reverse();
  const times = ordered.map((edit) => Date.parse(edit.editedAt));
  if (times.some((t, i) => Number.isNaN(t) || (i > 0 && t < times[i - 1])))
    return {
      status: 'unreadable',
      reason: `the edit history of #${issue.number} is not in the order of its timestamps`,
    };
  const revisions = ordered.map((edit) => ({
    editor: edit.editor?.login ?? null,
    body: edit.diff as string,
  }));
  if (!sameText(revisions[revisions.length - 1].body, body))
    return {
      status: 'unreadable',
      reason: `the newest revision of #${issue.number} is not its current body`,
    };
  return { status: 'read', revisions };
}

/** What an issue's history proves about each of its checks. */
export interface IssueProof {
  current: SignOffIssueBody;
  /** Every version any revision froze the issue at. */
  frozenAt: Set<string>;
  /** Every check id that was `[staging]` in any revision, with its latest text. */
  staging: Map<string, { pr: number; key: string; text: string }>;
  /** Every check id that was `[production]` in any revision, with its latest text. */
  production: Map<string, { pr: number; key: string; text: string }>;
  /** Check ids ticked in the current body, by whether the Maintainer made the tick. */
  ticked: Map<string, boolean>;
}

/**
 * Walks an issue's revisions and proves who ticked each box. A revision that
 * does not parse is passed over, and its editor joins the next readable
 * revision's: a tick that shows up across it counts only if every editor in
 * between was the Maintainer.
 */
export function proveIssue(
  issue: GateIssue,
  owner: string,
):
  | { status: 'read'; proof: IssueProof }
  | { status: 'unreadable'; reason: string } {
  const history = revisionsOf(issue);
  if (history.status === 'unreadable') return history;
  const current = parseSignOffIssue(issue.body);
  if (!current)
    return {
      status: 'unreadable',
      reason: `the body of #${issue.number} is not in the Sign-off Issue's fixed form`,
    };
  const frozenAt = new Set<string>();
  const staging = new Map<string, { pr: number; key: string; text: string }>();
  const production = new Map<
    string,
    { pr: number; key: string; text: string }
  >();
  const checked = new Map<string, boolean>();
  const byOwner = new Map<string, boolean>();
  let editors: (string | null)[] = [];
  for (const revision of history.revisions) {
    editors.push(revision.editor);
    const parsed = parseSignOffIssue(revision.body);
    if (!parsed) continue;
    // A frozen line decides which Cut the issue belongs to, so one that
    // first appears in a revision anyone but the Maintainer made is forged.
    if (parsed.frozen && !frozenAt.has(parsed.frozen.version)) {
      if (!editors.every((editor) => editor === owner))
        return {
          status: 'unreadable',
          reason: `a frozen line on #${issue.number} (${parsed.frozen.version}) was not written by the Maintainer`,
        };
      frozenAt.add(parsed.frozen.version);
    }
    const now = new Map<string, boolean>();
    for (const check of parsed.checks) {
      const id = checkId(check.pr, check.key);
      now.set(id, check.checked);
      if (check.place === 'staging' || staging.has(id))
        staging.set(id, { pr: check.pr, key: check.key, text: check.text });
      if (check.place === 'production' || production.has(id))
        production.set(id, {
          pr: check.pr,
          key: check.key,
          text: check.text,
        });
    }
    for (const id of new Set([...checked.keys(), ...now.keys()])) {
      const was = checked.get(id) ?? false;
      const is = now.get(id) ?? false;
      if (is && !was)
        byOwner.set(
          id,
          editors.every((editor) => editor === owner),
        );
      if (!is) byOwner.delete(id);
      checked.set(id, is);
    }
    editors = [];
  }
  const ticked = new Map<string, boolean>();
  for (const check of current.checks) {
    const id = checkId(check.pr, check.key);
    if (check.checked) ticked.set(id, byOwner.get(id) ?? false);
  }
  return {
    status: 'read',
    proof: { current, frozenAt, staging, production, ticked },
  };
}

/** The `staging` checks of one proven issue that are neither ticked by the Maintainer nor waived. */
export function openStagingChecks(
  issue: GateIssue,
  proof: IssueProof,
  waived: ReadonlyMap<string, string>,
): OpenCheck[] {
  return openChecks(issue, proof, waived, 'staging');
}

/**
 * The checks of one proven issue that were `place` in any revision and are
 * neither ticked by the Maintainer nor waived. The Cut reads the `production`
 * ones to close the issue; the gate reads the `staging` ones to hold.
 */
export function openChecks(
  issue: GateIssue,
  proof: IssueProof,
  waived: ReadonlyMap<string, string>,
  place: 'staging' | 'production',
): OpenCheck[] {
  const present = new Set(
    proof.current.checks.map((c) => checkId(c.pr, c.key)),
  );
  const open: OpenCheck[] = [];
  for (const [id, check] of proof[place]) {
    if (waived.has(id) || proof.ticked.get(id) === true) continue;
    const why: OpenWhy = !present.has(id)
      ? 'removed from the issue'
      : proof.ticked.has(id)
        ? 'ticked, but not by the Maintainer'
        : 'not ticked';
    open.push({ issue: issue.number, ...check, why });
  }
  return open;
}

// --------------------------------------------------------------- decision

/** Whether an issue is one of the owner's Sign-off Issues: written by the owner, marker on line 1. */
export const isCandidate = (
  issue: Pick<GateIssue, 'author' | 'body'>,
  owner: string,
): boolean =>
  issue.author?.login === owner &&
  (issue.body ?? '').split(/\r?\n/, 1)[0]?.trim() === SIGNOFF_ISSUE_MARKER;

/**
 * Whether the production deploy of `input.version` may be dispatched.
 * `allow` dispatches it; `held` names each `staging` Person Check still open;
 * `cannot-decide` is anything the gate cannot prove, and holds too.
 */
export function decideProductionGate(input: GateInput): GateDecision {
  const { version } = input;
  if (!isReleaseVersion(version))
    return {
      status: 'cannot-decide',
      reason: `\`${version}\` is not a release version`,
    };
  if (input.owner?.__typename !== 'User' || !input.owner.login)
    return {
      status: 'cannot-decide',
      reason:
        'the repository owner is not a single user login, so no tick or waiver can be trusted',
    };
  const owner = input.owner.login;
  if (!input.issues)
    return {
      status: 'cannot-decide',
      reason: 'the open and closed `qa` issues could not be read whole',
    };

  const proven: { issue: GateIssue; proof: IssueProof }[] = [];
  for (const issue of input.issues.filter((i) => isCandidate(i, owner))) {
    const result = proveIssue(issue, owner);
    if (result.status === 'unreadable')
      return { status: 'cannot-decide', reason: result.reason };
    proven.push({ issue, proof: result.proof });
  }

  const waiversOf = (issue: GateIssue): Map<string, string> | null => {
    const comments = issue.comments;
    if (!comments || comments.nodes.length !== comments.totalCount) return null;
    return trustedWaivers(comments.nodes, owner);
  };
  const judge = (
    entries: readonly { issue: GateIssue; proof: IssueProof }[],
  ): OpenCheck[] | { unreadable: number } => {
    const open: OpenCheck[] = [];
    for (const { issue, proof } of entries) {
      if (proof.staging.size === 0) continue;
      const waived = waiversOf(issue);
      if (!waived) return { unreadable: issue.number };
      open.push(...openStagingChecks(issue, proof, waived));
    }
    return open;
  };

  const frozen = proven.filter(({ proof }) => proof.frozenAt.has(version));
  if (frozen.length > 1)
    return {
      status: 'cannot-decide',
      reason: `more than one Sign-off Issue was frozen for ${version} (${frozen.map(({ issue }) => `#${issue.number}`).join(', ')})`,
    };
  if (frozen.length === 1) {
    const number = frozen[0].issue.number;
    const open = judge(frozen);
    if (!Array.isArray(open))
      return {
        status: 'cannot-decide',
        reason: `the comments on #${open.unreadable} could not be read whole`,
      };
    return open.length > 0
      ? {
          status: 'held',
          reason: `Sign-off Issue #${number} for ${version} has ${open.length} \`staging\` Person Check${open.length === 1 ? '' : 's'} neither ticked nor waived by the Maintainer`,
          open,
        }
      : {
          status: 'allow',
          reason: `every \`staging\` Person Check on Sign-off Issue #${number} for ${version} is ticked or waived by the Maintainer`,
        };
  }

  // No issue was frozen for this Cut. A Cut that failed to freeze leaves its
  // checks in the unfrozen issue, so that issue's open checks hold. A closed
  // one holds too: anyone with triage access can close an issue, and every
  // Sign-off Issue is frozen before its Release closes it.
  const unfrozen = proven.filter(({ proof }) => proof.frozenAt.size === 0);
  const open = judge(unfrozen);
  if (!Array.isArray(open))
    return {
      status: 'cannot-decide',
      reason: `the comments on #${open.unreadable} could not be read whole`,
    };
  if (open.length > 0) {
    const issues = [...new Set(open.map((c) => `#${c.issue}`))].join(', ');
    return {
      status: 'held',
      reason: `no Sign-off Issue was frozen for ${version}, and the unfrozen Sign-off Issue ${issues} was not frozen for it but has ${open.length} \`staging\` Person Check${open.length === 1 ? '' : 's'} neither ticked nor waived by the Maintainer`,
      open,
    };
  }
  return {
    status: 'allow',
    reason: `no Sign-off Issue was frozen for ${version}, and no unfrozen Sign-off Issue has a \`staging\` Person Check left open, so no \`staging\` Person Check was deferred to this Cut`,
  };
}

/** The lines the gate prints and writes to the job summary. */
export function renderGateDecision(decision: GateDecision): string[] {
  if (decision.status === 'allow')
    return [`Production gate: allowed — ${decision.reason}.`];
  if (decision.status === 'cannot-decide')
    return [`Production gate: held — it cannot decide: ${decision.reason}.`];
  return [
    `Production gate: held — ${decision.reason}:`,
    ...decision.open.map(
      (c) => `- #${c.issue} · [staging] ${c.text} · from #${c.pr} · ${c.why}`,
    ),
    '',
    'The Maintainer ticks each check on its Sign-off Issue, or waives it with one comment line each:',
    ...decision.open.map((c) => `waive: ${checkId(c.pr, c.key)} — <reason>`),
  ];
}
