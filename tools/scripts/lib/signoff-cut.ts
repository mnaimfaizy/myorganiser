/**
 * The Sign-off Issue at the Cut (ADR 0151 decision 7, and the close of
 * decision 8): `release:cut` freezes the open issue, retitled for its version,
 * and carries into it the unfinished checks of an earlier Cut that never
 * deployed; `release:signoff-close` closes a Cut's issue once its checks are
 * done.
 *
 * Every decision reads the issues the way the production gate does, so it
 * trusts only what it can tie to the Maintainer's login: a candidate is an
 * issue the owner wrote with the marker on line 1, its body is read by the
 * allow-list in `signoff-issue.ts`, ticks are proven from its edit history
 * and waivers from owner comments (`signoff-gate.ts`). Anything it cannot
 * read whole refuses the Cut rather than guess, and nothing here writes
 * unless the viewer the writes run as is the owner, since a frozen line
 * written by any other login is forged to the gate.
 *
 * A Cut writes the issue once: the frozen line, the new title and the carried
 * lines go in one body, so an issue is never left half frozen, and carried
 * checks never sit in an unfrozen issue where they would hold every deploy.
 * A created issue is created already frozen. Every write is read back.
 *
 * Pure apart from the `SignOffCutIo` it is handed: the `gh` calls live in
 * `tools/scripts/lib/signoff-github.ts`.
 *
 * Run the tests with: node --test tools/scripts/lib/signoff-cut.test.ts
 */

import {
  type GateComment,
  type GateInput,
  type GateIssue,
  type IssueProof,
  isCandidate,
  isOwnerComment,
  openChecks,
  type OpenCheck,
  proveIssue,
  trustedWaivers,
} from './signoff-gate.ts';
import {
  addCarriedToSignOffIssue,
  freezeSignOffBody,
  isReleaseVersion,
  parseCarriedComment,
  parseSignOffIssue,
  renderCarriedComment,
  renderCarriedLine,
  renderFrozenSignOffIssue,
  renderSignOffFrozen,
  signOffCheckId,
  signOffFrozenTitle,
  type SignOffCheck,
  unsafeSignOffText,
} from './signoff-issue.ts';

// ------------------------------------------------------------------ IO

/** What one read of the repository's Sign-off Issues returns. */
export interface SignOffRead {
  /** The repository's owner, as the gate reads it. */
  owner: GateInput['owner'];
  /** The login the writes run as; null when it could not be read. */
  viewer: string | null;
  /** The owner's open and closed `qa` Sign-off Issues, with history and comments; null when not read whole. */
  issues: GateIssue[] | null;
}

/** What the Cut and the close need from GitHub and git. */
export interface SignOffCutIo {
  /** A fresh read of every Sign-off Issue. */
  read(): SignOffRead;
  /** An issue's current title, for the read-back; null when it could not be read. */
  readTitle(number: number): string | null;
  /**
   * Whether the Release `version` is out: its tag is on origin (the receipt
   * `release:tag` leaves once production deployed, ADR 0028). Null when that
   * could not be read.
   */
  isReleased(version: string): boolean | null;
  /** Replaces an issue's title and body. Blind, like the train's write. Returns whether GitHub accepted it. */
  updateIssue(number: number, change: { title: string; body: string }): boolean;
  /** Creates a `qa` issue. Returns its number, or null when GitHub refused or the number was not read. */
  createIssue(issue: { title: string; body: string }): number | null;
  /** Adds a comment. Returns whether GitHub accepted it. */
  comment(number: number, body: string): boolean;
  /** Closes an issue. Returns whether GitHub accepted it. */
  close(number: number): boolean;
}

// ------------------------------------------------------------ the read

interface Proven {
  issue: GateIssue;
  proof: IssueProof;
  waived: Map<string, string>;
}

type Loaded =
  | { status: 'loaded'; proven: Proven[] }
  | { status: 'refused'; reason: string };

/**
 * Reads and proves every candidate Sign-off Issue, or refuses. Refuses unless
 * the owner is a single user, the viewer is that user, and every candidate's
 * history and comments were read whole.
 */
function load(read: SignOffRead): Loaded {
  if (read.owner?.__typename !== 'User' || !read.owner.login)
    return {
      status: 'refused',
      reason:
        'the repository owner is not a single user login, so no tick, waiver or frozen line can be trusted',
    };
  const owner = read.owner.login;
  if (read.viewer !== owner)
    return {
      status: 'refused',
      reason: `the Cut writes as ${read.viewer ? `\`${read.viewer}\`` : 'a login it could not read'}, but the frozen line counts only from the repository owner \`${owner}\`; run it as the owner`,
    };
  if (!read.issues)
    return {
      status: 'refused',
      reason: 'the open and closed `qa` issues could not be read whole',
    };
  const proven: Proven[] = [];
  for (const issue of read.issues.filter((i) => isCandidate(i, owner))) {
    const result = proveIssue(issue, owner);
    if (result.status === 'unreadable')
      return { status: 'refused', reason: result.reason };
    const comments = issue.comments;
    if (!comments || comments.nodes.length !== comments.totalCount)
      return {
        status: 'refused',
        reason: `the comments on #${issue.number} could not be read whole`,
      };
    proven.push({
      issue,
      proof: result.proof,
      waived: trustedWaivers(comments.nodes, owner),
    });
  }
  return { status: 'loaded', proven };
}

const ownerOf = (read: SignOffRead): string => read.owner?.login ?? '';

/** `[major, minor, patch]` of a `vX.Y.Z`. */
const semver = (version: string): number[] =>
  version.slice(1).split('.').map(Number);
const isBefore = (a: string, b: string): boolean => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
};

// ----------------------------------------------------------------- plan

/** The unfinished checks carried from one earlier Cut's issue. */
export interface CarrySource {
  issue: number;
  /** The Cut that issue was frozen for. */
  version: string;
  checks: SignOffCheck[];
}

/** What a Cut would write. */
export interface CutPlan {
  version: string;
  /** The issue to freeze: an open unfrozen one, or one to create frozen to hold carried checks, or nothing. */
  target:
    | { kind: 'freeze'; number: number; body: string }
    | { kind: 'create' }
    // Already frozen for this version by an earlier run of this Cut (one that stopped before its push): nothing to write.
    | { kind: 'frozen'; number: number }
    | { kind: 'none' };
  carry: CarrySource[];
  /** Things the Maintainer should know that stop nothing. */
  notes: string[];
}

export type CutPlanResult =
  | { status: 'planned'; plan: CutPlan }
  | { status: 'refused'; reason: string };

const finished = ({ proof, waived }: Proven, check: SignOffCheck): boolean => {
  const id = signOffCheckId(check.pr, check.key);
  return waived.has(id) || proof.ticked.get(id) === true;
};

/**
 * What cutting `version` would do, from reads alone. Refuses on anything it
 * cannot prove, so a Cut is never begun that it could not finish.
 */
export function planCut(io: SignOffCutIo, version: string): CutPlanResult {
  if (!isReleaseVersion(version))
    return {
      status: 'refused',
      reason: `\`${version}\` is not a release version`,
    };
  const read = io.read();
  const loaded = load(read);
  if (loaded.status === 'refused') return loaded;
  const owner = ownerOf(read);
  const { proven } = loaded;

  const frozenFor = proven.filter(({ proof }) => proof.frozenAt.has(version));
  if (frozenFor.length > 0) {
    // A Cut that stopped after its freeze, before its push, is run again.
    // Re-freezing is not needed and not possible (the gate reads a removed
    // frozen line as forged), so exactly one issue still frozen for this
    // version, by the owner, is the Cut's issue and the re-run goes on.
    const [only] = frozenFor;
    if (
      frozenFor.length === 1 &&
      only.proof.current.frozen?.version === version
    )
      return {
        status: 'planned',
        plan: {
          version,
          target: { kind: 'frozen', number: only.issue.number },
          carry: [],
          notes: [
            `Sign-off Issue #${only.issue.number} is already frozen for ${version}, so nothing was written to it`,
          ],
        },
      };
    return {
      status: 'refused',
      reason: `a Sign-off Issue is already frozen for ${version}, but not as one issue still frozen for it (${frozenFor.map(({ issue }) => `#${issue.number}`).join(', ')})`,
    };
  }

  const notes: string[] = [];
  const gathering = proven.filter(
    ({ issue, proof }) =>
      issue.state === 'OPEN' && proof.current.frozen === null,
  );
  // An issue that was frozen once and reads unfrozen now had its line edited out.
  const unfrozenAgain = gathering.find(({ proof }) => proof.frozenAt.size > 0);
  if (unfrozenAgain)
    return {
      status: 'refused',
      reason: `the frozen line of #${unfrozenAgain.issue.number} was removed after it was written`,
    };
  if (gathering.length > 1)
    return {
      status: 'refused',
      reason: `more than one Sign-off Issue is open and unfrozen (${gathering.map(({ issue }) => `#${issue.number}`).join(', ')})`,
    };

  // The gate reads closed issues too: one left unfrozen with a `staging` check open holds every deploy.
  for (const { issue, proof, waived } of proven)
    if (
      issue.state === 'CLOSED' &&
      proof.current.frozen === null &&
      openChecks(issue, proof, waived, 'staging').length > 0
    )
      notes.push(
        `closed, unfrozen Sign-off Issue #${issue.number} still has a \`staging\` Person Check neither ticked nor waived, which holds every production deploy until it is ticked or waived`,
      );

  const carry: CarrySource[] = [];
  const earlier = proven.filter(
    ({ issue, proof }) =>
      issue.state === 'OPEN' &&
      proof.current.frozen !== null &&
      isBefore(proof.current.frozen.version, version),
  );
  for (const source of earlier) {
    const { issue, proof } = source;
    const sourceVersion = (proof.current.frozen as { version: string }).version;
    const released = io.isReleased(sourceVersion);
    if (released === null) {
      notes.push(
        `could not tell whether ${sourceVersion} was released, so nothing was carried from #${issue.number}`,
      );
      continue;
    }
    if (released) continue;
    // Only the owner's unedited, not-minimised comment says it was carried.
    const comments = (issue.comments?.nodes ?? []) as GateComment[];
    if (
      comments.some(
        (c) => isOwnerComment(c, owner) && parseCarriedComment(c.body) !== null,
      )
    )
      continue;
    const checks: SignOffCheck[] = [];
    for (const check of proof.current.checks) {
      if (finished(source, check)) continue;
      if (unsafeSignOffText(check.text)) {
        notes.push(
          `#${issue.number}: a Person Check whose text holds \`<!--\` or \`-->\` was not carried: ${signOffCheckId(check.pr, check.key)}`,
        );
        continue;
      }
      checks.push(check);
    }
    const present = new Set(
      proof.current.checks.map((c) => signOffCheckId(c.pr, c.key)),
    );
    for (const [id, c] of [...proof.staging, ...proof.production])
      if (!present.has(id) && !source.waived.has(id))
        notes.push(
          `#${issue.number}: a Person Check removed from the issue was not carried: ${id} (${c.text})`,
        );
    // Nothing unfinished: nothing to carry, so no comment either.
    if (checks.length > 0)
      carry.push({ issue: issue.number, version: sourceVersion, checks });
  }
  // The same check in two earlier issues is carried once.
  const seen = new Set<string>();
  for (const source of carry)
    source.checks = source.checks.filter((c) => {
      const id = signOffCheckId(c.pr, c.key);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

  const target = gathering[0];
  const carried = carry.some((s) => s.checks.length > 0);
  if (target)
    return {
      status: 'planned',
      plan: {
        version,
        target: {
          kind: 'freeze',
          number: target.issue.number,
          body: target.issue.body ?? '',
        },
        carry,
        notes,
      },
    };
  if (carried)
    return {
      status: 'planned',
      plan: { version, target: { kind: 'create' }, carry, notes },
    };
  notes.push(
    'no open Sign-off Issue and nothing to carry, so no Sign-off Issue was frozen',
  );
  return {
    status: 'planned',
    plan: { version, target: { kind: 'none' }, carry: [], notes },
  };
}

/** What a dry run prints for a plan. */
export function renderCutPlan(plan: CutPlan): string[] {
  const lines: string[] = [];
  const carried = plan.carry.reduce((n, s) => n + s.checks.length, 0);
  if (plan.target.kind === 'freeze')
    lines.push(
      `would freeze Sign-off Issue #${plan.target.number} for ${plan.version}: retitle it "${signOffFrozenTitle(plan.version)}" and add the frozen line`,
    );
  else if (plan.target.kind === 'create')
    lines.push(
      `would create a Sign-off Issue already frozen for ${plan.version}, holding ${carried} carried Person Check${carried === 1 ? '' : 's'}`,
    );
  for (const source of plan.carry)
    lines.push(
      `would carry ${source.checks.length} unfinished Person Check${source.checks.length === 1 ? '' : 's'} from #${source.issue} (${source.version}, never released) and comment on it where they went`,
    );
  for (const note of plan.notes) lines.push(`note: ${note}`);
  return lines;
}

// -------------------------------------------------------------- execute

/** What a Cut left. */
export interface CutResult {
  /** Whether the freeze and its read-back held. When false, `release:cut` must not push. */
  ok: boolean;
  /** The frozen issue, if any. */
  issue: number | null;
  created: boolean;
  carried: { from: number; ids: string[] }[];
  notes: string[];
  /** Everything that did not hold, each with the manual step to take. */
  failures: string[];
}

const ids = (checks: readonly SignOffCheck[]): string[] =>
  checks.map((c) => signOffCheckId(c.pr, c.key));

/** A fresh read of one issue; undefined when it is not among those read. */
const readIssue = (io: SignOffCutIo, number: number): GateIssue | undefined =>
  io.read().issues?.find((i) => i.number === number);

/** The owner's issue now frozen for `version`, when a create's number was not read. */
function findFrozenFor(io: SignOffCutIo, version: string): number | null {
  const read = io.read();
  const owner = ownerOf(read);
  return (
    read.issues?.find(
      (i) =>
        isCandidate(i, owner) &&
        parseSignOffIssue(i.body)?.frozen?.version === version,
    )?.number ?? null
  );
}

/** Whether issue `number` now reads frozen for `version`, holding every id and wearing the title. */
function frozenBack(
  io: SignOffCutIo,
  number: number,
  version: string,
  expectIds: readonly string[],
): boolean {
  const issue = readIssue(io, number);
  const parsed = issue ? parseSignOffIssue(issue.body) : null;
  if (!parsed || parsed.frozen?.version !== version) return false;
  const held = new Set(ids(parsed.checks));
  return (
    expectIds.every((id) => held.has(id)) &&
    io.readTitle(number) === signOffFrozenTitle(version)
  );
}

/**
 * Freezes the Cut's Sign-off Issue and carries the unfinished checks into it,
 * then leaves each earlier issue a comment saying where its checks went. Plans
 * again from a fresh read, so what is written is what is on GitHub now.
 * Never throws: `ok` false means the freeze did not hold, and the caller must
 * not push the release branch.
 */
export function executeCut(io: SignOffCutIo, version: string): CutResult {
  const result: CutResult = {
    ok: false,
    issue: null,
    created: false,
    carried: [],
    notes: [],
    failures: [],
  };
  const planned = planCut(io, version);
  if (planned.status === 'refused') {
    result.failures.push(
      `the Sign-off Issue was not frozen: ${planned.reason}. Freeze it by hand: ${isReleaseVersion(version) ? `add the line \`${renderSignOffFrozen(version)}\` after the marker line and retitle it "${signOffFrozenTitle(version)}", ` : ''}written as the repository owner`,
    );
    return result;
  }
  const { plan } = planned;
  result.notes.push(...plan.notes);
  const carryChecks = plan.carry.flatMap((s) => s.checks);
  const expect = ids(carryChecks);

  if (plan.target.kind === 'none') {
    result.ok = true;
    return result;
  }
  if (plan.target.kind === 'frozen') {
    result.ok = true;
    result.issue = plan.target.number;
    return result;
  }

  if (plan.target.kind === 'create') {
    const body = renderFrozenSignOffIssue(version, carryChecks);
    const created = io.createIssue({
      title: signOffFrozenTitle(version),
      body,
    });
    // A create GitHub took whose number could not be read still made the issue.
    const number = created ?? findFrozenFor(io, version);
    if (number === null || !frozenBack(io, number, version, expect)) {
      result.failures.push(
        `the Sign-off Issue for ${version} could not be created or read back as frozen${number === null ? '' : ` (#${number} may exist: check it first, and freeze it rather than create a second)`}. Otherwise create it by hand, labelled \`qa\`, titled "${signOffFrozenTitle(version)}", with this body:\n${body}`,
      );
      return result;
    }
    result.issue = number;
    result.created = true;
  } else {
    const number = plan.target.number;
    // One write, never retried: a first revision that landed but did not read
    // back would make a second write look like a second freeze to the gate.
    const withCarried = addCarriedToSignOffIssue(plan.target.body, carryChecks);
    const frozen = withCarried
      ? freezeSignOffBody(withCarried.body, version)
      : null;
    const held =
      frozen !== null &&
      io.updateIssue(number, {
        title: signOffFrozenTitle(version),
        body: frozen,
      }) &&
      frozenBack(io, number, version, expect);
    if (!held) {
      result.failures.push(
        `Sign-off Issue #${number} was not frozen for ${version}, or the write could not be read back. Freeze it by hand: add the line \`${renderSignOffFrozen(version)}\` after the marker line, retitle it "${signOffFrozenTitle(version)}", and add these carried lines to its checks:\n${carryChecks.map(renderCarriedLine).join('\n')}`,
      );
      return result;
    }
    result.issue = number;
  }

  result.ok = true;
  const to = result.issue as number;
  for (const source of plan.carry) {
    const sourceIds = ids(source.checks);
    result.carried.push({ from: source.issue, ids: sourceIds });
    const comment = renderCarriedComment(to, version, sourceIds);
    if (
      !io.comment(source.issue, comment) ||
      !markerBack(io, source.issue, to, version)
    )
      result.failures.push(
        `#${source.issue}: its unfinished checks were carried to #${to}, but the comment saying so was not posted. Post it as the repository owner, or a later Cut carries them again:\n${comment}`,
      );
  }
  return result;
}

/**
 * The lines `release:cut` prints for a Cut's Sign-off Issue step. When the
 * freeze did not hold they end by saying the release branch was not pushed:
 * `release:cut` stops there, even under `--push`, because the dispatcher's
 * gate would otherwise run against a Cut whose issue is not frozen.
 */
export function renderCutResult(version: string, result: CutResult): string[] {
  const lines: string[] = [];
  if (result.issue !== null)
    lines.push(
      `Sign-off Issue #${result.issue} ${result.created ? 'created' : 'frozen'} for ${version}.`,
    );
  for (const { from, ids: carried } of result.carried)
    lines.push(
      `Carried ${carried.length} unfinished Person Check${carried.length === 1 ? '' : 's'} from #${from} into #${result.issue}.`,
    );
  for (const note of result.notes) lines.push(`Note: ${note}.`);
  lines.push(...result.failures.map((f) => `Sign-off Issue: ${f}`));
  if (!result.ok)
    lines.push(
      `The Sign-off Issue was not frozen for ${version}, so the release branch was NOT pushed. Fix the above and push it yourself, or abandon the Cut.`,
    );
  return lines;
}

/** Whether the owner's trusted comment on `from` names `to` and `version`. */
function markerBack(
  io: SignOffCutIo,
  from: number,
  to: number,
  version: string,
): boolean {
  const read = io.read();
  const owner = ownerOf(read);
  const issue = read.issues?.find((i) => i.number === from);
  return (issue?.comments?.nodes ?? []).some((c) => {
    const marker = parseCarriedComment(c.body);
    return (
      isOwnerComment(c, owner) &&
      marker?.to === to &&
      marker.version === version
    );
  });
}

// ---------------------------------------------------------------- close

export type ClosePlan =
  | { status: 'refused'; reason: string }
  | { status: 'already-closed'; number: number }
  | { status: 'open'; number: number; open: OpenCheck[] }
  | { status: 'ready'; number: number };

/**
 * Whether the Sign-off Issue frozen for `version` can close: the Release is
 * out (its tag is on origin), and every `production` Person Check is ticked
 * by the Maintainer or waived, using the gate's proof of who ticked. It also
 * waits for any `staging` check still open, which only a deploy past the gate
 * can leave, so a sign-off is never closed over one.
 */
export function planClose(io: SignOffCutIo, version: string): ClosePlan {
  if (!isReleaseVersion(version))
    return {
      status: 'refused',
      reason: `\`${version}\` is not a release version`,
    };
  const loaded = load(io.read());
  if (loaded.status === 'refused') return loaded;
  const matching = loaded.proven.filter(
    ({ proof }) => proof.current.frozen?.version === version,
  );
  if (matching.length !== 1)
    return {
      status: 'refused',
      reason:
        matching.length === 0
          ? `no Sign-off Issue is frozen for ${version}`
          : `more than one Sign-off Issue is frozen for ${version} (${matching.map(({ issue }) => `#${issue.number}`).join(', ')})`,
    };
  const [{ issue, proof, waived }] = matching;
  const released = io.isReleased(version);
  if (released === null)
    return {
      status: 'refused',
      reason: `could not tell whether ${version} was released`,
    };
  if (!released)
    return {
      status: 'refused',
      reason: `${version} is not released: its tag is not on origin`,
    };
  if (issue.state === 'CLOSED')
    return { status: 'already-closed', number: issue.number };
  const open = [
    ...openChecks(issue, proof, waived, 'staging'),
    ...openChecks(issue, proof, waived, 'production'),
  ];
  return open.length > 0
    ? { status: 'open', number: issue.number, open }
    : { status: 'ready', number: issue.number };
}

/** Closes a ready issue and reads the close back. Returns the plan with `closed` set. */
export function executeClose(
  io: SignOffCutIo,
  version: string,
): ClosePlan & { closed: boolean } {
  const plan = planClose(io, version);
  if (plan.status !== 'ready') return { ...plan, closed: false };
  const comment = `Closing: every Person Check of ${version} is ticked or waived by the Maintainer after its Release.`;
  // Close first: a refused close then leaves no comment to repeat on a retry.
  const done =
    io.close(plan.number) && readIssue(io, plan.number)?.state === 'CLOSED';
  if (done) io.comment(plan.number, comment);
  return { ...plan, closed: done };
}

/** The lines `release:signoff-close` prints. */
export function renderClose(
  version: string,
  plan: ClosePlan & { closed?: boolean },
  dryRun: boolean,
): string[] {
  switch (plan.status) {
    case 'refused':
      return [`Sign-off Issue not closed: ${plan.reason}.`];
    case 'already-closed':
      return [
        `Sign-off Issue #${plan.number} for ${version} is already closed.`,
      ];
    case 'open':
      return [
        `Sign-off Issue #${plan.number} for ${version} stays open: ${plan.open.length} Person Check${plan.open.length === 1 ? '' : 's'} neither ticked nor waived by the Maintainer:`,
        ...plan.open.map(
          (c) =>
            `- ${signOffCheckId(c.pr, c.key)} · ${c.text} · from #${c.pr} · ${c.why}`,
        ),
      ];
    case 'ready':
      return dryRun
        ? [
            `[dry-run] would close Sign-off Issue #${plan.number} for ${version}: every Person Check is ticked or waived by the Maintainer.`,
          ]
        : plan.closed
          ? [`Closed Sign-off Issue #${plan.number} for ${version}.`]
          : [
              `Sign-off Issue #${plan.number} for ${version} could not be closed, or the close could not be read back. Close it by hand.`,
            ];
  }
}

/** 1 when `release:signoff-close` refused, or a ready issue was not closed; 0 otherwise (closed, already closed, still open, or a dry run). */
export function closeExitCode(
  plan: ClosePlan & { closed?: boolean },
  dryRun: boolean,
): number {
  if (plan.status === 'refused') return 1;
  return plan.status === 'ready' && !dryRun && !plan.closed ? 1 : 0;
}
