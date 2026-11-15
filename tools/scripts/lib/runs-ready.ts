// Whether finished Standalone Runs' Pull Requests are ready for QA (#1587;
// ADR 0142, as amended for the continuous run). A pure decision over facts
// read for each Pull Request's head, and the wait that re-reads them until
// every one is ready or one needs a decision.
//
// It reads the same facts the Merge Train reads — the head's required
// checks and the Agent Verdict through `HeadFactIo` — plus the conversation:
// comments, review bodies and review threads, with each author's
// association. It writes nothing.
//
// Trust is an allow-list: only OWNER, MEMBER and COLLABORATOR comments are
// a person's words to answer. Anyone else's comment makes the Pull Request
// need a decision, and is shown by author, association and URL only, never
// by its text, so untrusted words never reach the agent reading the result.
// The run posts as the Maintainer, so that login's comment is the run's own
// voice only when it carries one of the run's markers; with none, it is the
// Maintainer's own words, and only a marked agent reply answers it.
import {
  DEFAULT_POLL_SECONDS,
  SHADOW_COMMENT_MARKER,
  parseTrainArgs,
  requiredCheckState,
  type AgentVerdictFact,
  type HeadFactIo,
  type PullRequestSnapshot,
  type TrainIo,
} from './merge-train.ts';
import { QA_REPORT_MARKER } from './qa-report.ts';
import {
  FINDING_MARKER_ANY_VERSION_SOURCE,
  SUMMARY_AUTHOR_LOGIN,
  SUMMARY_MARKER,
} from '../review/publish.ts';

/** The time limit, in minutes, when `--timeout` is not given. */
export const DEFAULT_READY_TIMEOUT_MINUTES = 60;

/**
 * Seconds between rounds when `--poll` is not given. Longer than the
 * train's, since each round reads every Pull Request's conversation too.
 */
export const DEFAULT_READY_POLL_SECONDS = 2 * DEFAULT_POLL_SECONDS;

/** The only `authorAssociation` values whose comments are a person's words to answer. */
export const TRUSTED_ASSOCIATIONS: readonly string[] = [
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
];

/**
 * A finding thread's marker at any report schema version. An older version's
 * thread is one the publisher no longer resolves, and it still counts:
 * an unresolved finding is never read as ready.
 */
const FINDING_MARKER_ANY_VERSION_RE = new RegExp(
  FINDING_MARKER_ANY_VERSION_SOURCE,
);

/** One comment, review body or thread comment, as the decision reads it. */
export interface ConversationComment {
  /** The author's login; null for a deleted account. */
  author: string | null;
  /** GitHub's `authorAssociation`; null when it was not given. */
  association: string | null;
  /** ISO 8601, as GitHub gives it; later strings are later times. */
  createdAt: string;
  /** Hidden on GitHub, which only someone with write access can do. */
  minimized: boolean;
  url: string;
  body: string;
}

export interface ReviewThread {
  resolved: boolean;
  /** Oldest first. */
  comments: ConversationComment[];
}

/** Everything people and the review wrote on one Pull Request. */
export interface Conversation {
  /** Conversation comments, oldest first. */
  comments: ConversationComment[];
  /** Submitted reviews with a non-empty body, oldest first. */
  reviews: ConversationComment[];
  threads: ReviewThread[];
}

/**
 * The hidden line every reply an agent posts on a Pull Request carries
 * (`address-pr-review`, and any comment `finish-standalone-runs` writes that
 * has no marker of its own). It is what answers a trusted comment.
 */
export const AGENT_REPLY_MARKER = '<!-- agent-reply -->';

/**
 * The markers, each alone on its own line, that make a comment by the `gh`
 * login the run's own voice: an agent reply, the QA Report, the Merge
 * Train's record, and the code review's summary and finding markers. An
 * allow-list: a line that is not exactly one of these marks nothing.
 */
const RUN_VOICE_MARKERS: readonly string[] = [
  AGENT_REPLY_MARKER,
  QA_REPORT_MARKER,
  SHADOW_COMMENT_MARKER,
  SUMMARY_MARKER,
];
const FINDING_MARKER_LINE_RE = new RegExp(
  `^${FINDING_MARKER_ANY_VERSION_SOURCE}$`,
);

/** A body's lines, each trimmed, which is how a marker line is matched. */
const trimmedLines = (body: string): string[] =>
  body.split(/\r?\n/).map((line) => line.trim());

/**
 * Whether a comment is the run's own voice: written by the `gh` login the
 * run posts as **and** carrying one of the run's markers on its own line.
 * The run posts as the Maintainer, so that login's comment with no marker is
 * the Maintainer's own words, read as a trusted comment that needs an
 * answer (DR-1 of #1587, decided by the Maintainer).
 *
 * This rule and `answersAsRun` are the only places it lives, so changing
 * what counts as the run's own voice is a change here alone.
 */
export function isRunVoice(
  comment: Pick<ConversationComment, 'author' | 'body'>,
  viewerLogin: string,
): boolean {
  if (comment.author !== viewerLogin) return false;
  return trimmedLines(comment.body).some(
    (line) =>
      RUN_VOICE_MARKERS.includes(line) || FINDING_MARKER_LINE_RE.test(line),
  );
}

/**
 * Whether a comment answers a trusted one: an agent reply, which is the
 * `gh` login's comment carrying `AGENT_REPLY_MARKER` on its own line. A QA
 * Report or the train's record is the run's voice but answers nobody.
 */
export function answersAsRun(
  comment: Pick<ConversationComment, 'author' | 'body'>,
  viewerLogin: string,
): boolean {
  return (
    comment.author === viewerLogin &&
    trimmedLines(comment.body).includes(AGENT_REPLY_MARKER)
  );
}

/**
 * The comment that asks for a code review. `code-review.yml` runs on a Pull
 * Request comment whose body starts with this, case-insensitively as GitHub's
 * `startsWith` compares, from an author whose association is in
 * `TRUSTED_ASSOCIATIONS`. A test pins both against the workflow.
 */
export const CODE_REVIEW_COMMAND_PREFIX = '/code-review';

/**
 * Whether a trusted conversation comment is the `/code-review` command, not
 * words to answer (DR-5 of #1587). An allow-list of exactly that one prefix,
 * matched as the workflow matches it: the Maintainer's own unmarked trigger
 * comment would otherwise hold the wait until an agent replied to a command.
 * An outside author's command is still an outside comment.
 */
export function isReviewCommand(comment: ConversationComment): boolean {
  return (
    comment.association !== null &&
    TRUSTED_ASSOCIATIONS.includes(comment.association) &&
    comment.body.toLowerCase().startsWith(CODE_REVIEW_COMMAND_PREFIX)
  );
}

/** Whose words a comment is. */
export type AuthorClass = 'publisher' | 'run' | 'trusted' | 'outside';

/**
 * Sorts one comment's author, in this order: the review publisher's identity
 * (read only as the automated review), the run's own voice, an allow-listed
 * association, and everyone else. The publisher posts as a bot that GitHub
 * calls a CONTRIBUTOR, so it is matched by login before any association.
 */
export function authorClass(
  comment: ConversationComment,
  viewerLogin: string,
): AuthorClass {
  if (comment.author === SUMMARY_AUTHOR_LOGIN) return 'publisher';
  if (isRunVoice(comment, viewerLogin)) return 'run';
  if (
    comment.association !== null &&
    TRUSTED_ASSOCIATIONS.includes(comment.association)
  )
    return 'trusted';
  return 'outside';
}

export const READINESS_REASON_KINDS = [
  'unreadable',
  'check-waiting',
  'review-pending',
  'check-red',
  'not-open',
  'conflict',
  'review-asks',
  'automated-thread',
  'trusted-comment',
  'outside-comment',
] as const;
export type ReadinessReasonKind = (typeof READINESS_REASON_KINDS)[number];

/**
 * What each reason makes the Pull Request. A pending reason can change by
 * itself — a check finishes, the review reaches the head — so it is waited
 * on. Waiting never changes a needs-decision reason, so it ends the wait.
 */
export const READINESS_REASON_STATES = {
  unreadable: 'pending',
  'check-waiting': 'pending',
  'review-pending': 'pending',
  'check-red': 'needs-decision',
  'not-open': 'needs-decision',
  conflict: 'needs-decision',
  'review-asks': 'needs-decision',
  'automated-thread': 'needs-decision',
  'trusted-comment': 'needs-decision',
  'outside-comment': 'needs-decision',
} as const satisfies Record<ReadinessReasonKind, 'pending' | 'needs-decision'>;

export interface ReadinessReason {
  kind: ReadinessReasonKind;
  text: string;
}

export type ReadinessState = 'ready' | 'pending' | 'needs-decision';

export interface PullRequestReadiness {
  pr: number;
  state: ReadinessState;
  /** Every reason found; empty when ready. */
  reasons: ReadinessReason[];
}

/** Every fact one readiness decision reads, for one Pull Request. */
export interface ReadinessFacts {
  pr: number;
  /** Null when the Pull Request could not be read. */
  snapshot: PullRequestSnapshot | null;
  required: readonly string[];
  /** The Agent Verdict for the snapshot's head; null when there is no snapshot. */
  agentVerdict: AgentVerdictFact | null;
  /** Null when the conversation could not be read in full. */
  conversation: Conversation | null;
  viewerLogin: string;
}

const shortSha = (sha: string): string => sha.slice(0, 8);

const isAutomatedThread = (thread: ReviewThread): boolean => {
  const first = thread.comments[0];
  return (
    first !== undefined &&
    first.author === SUMMARY_AUTHOR_LOGIN &&
    FINDING_MARKER_ANY_VERSION_RE.test(first.body)
  );
};

/** Who wrote a comment, as a reason shows it: login and association, never the text. */
const authorLabel = (comment: ConversationComment): string =>
  `${comment.author ?? 'a deleted account'} (${comment.association ?? 'no association'})`;

const outsideReason = (comment: ConversationComment): ReadinessReason => ({
  kind: 'outside-comment',
  text: `${authorLabel(comment)} commented from outside the repository: ${comment.url}`,
});

const unansweredReason = (comment: ConversationComment): ReadinessReason => ({
  kind: 'trusted-comment',
  text: `${authorLabel(comment)} has an unanswered comment: ${comment.url}`,
});

/** Why a review that does not name the head in full is still pending. */
const reviewElsewhereText = (
  reviewedOid: string | null,
  head: string,
): string => {
  if (reviewedOid === null)
    return `the code review does not name the commit it reviewed; the head is \`${shortSha(head)}\``;
  // Prefixes that read the same would say nothing, so both are shown in full.
  const [reviewed, at] =
    shortSha(reviewedOid) === shortSha(head)
      ? [reviewedOid, head]
      : [shortSha(reviewedOid), shortSha(head)];
  return `the code review is for \`${reviewed}\`, not the head \`${at}\``;
};

/** The reasons the conversation gives, given whether the review names the head. */
function conversationReasons(
  conversation: Conversation,
  viewerLogin: string,
  reviewAtHead: boolean,
): ReadinessReason[] {
  const reasons: ReadinessReason[] = [];
  const timeline = [...conversation.comments, ...conversation.reviews].filter(
    (c) => !c.minimized,
  );
  for (const comment of timeline) {
    const kind = authorClass(comment, viewerLogin);
    if (kind === 'outside') reasons.push(outsideReason(comment));
    if (kind !== 'trusted') continue;
    // Only a conversation comment is the command; a review body is words.
    if (conversation.comments.includes(comment) && isReviewCommand(comment))
      continue;
    const answered = timeline.some(
      (later) =>
        answersAsRun(later, viewerLogin) && later.createdAt > comment.createdAt,
    );
    if (!answered) reasons.push(unansweredReason(comment));
  }

  for (const thread of conversation.threads) {
    const shown = thread.comments.filter((c) => !c.minimized);
    for (const comment of shown) {
      if (authorClass(comment, viewerLogin) === 'outside')
        reasons.push(outsideReason(comment));
    }
    if (isAutomatedThread(thread) && !thread.resolved && reviewAtHead) {
      reasons.push({
        kind: 'automated-thread',
        text: `an automated-review thread is unresolved: ${thread.comments[0].url}`,
      });
    }
    if (thread.resolved) continue;
    const last = shown.at(-1);
    if (!last || answersAsRun(last, viewerLogin)) continue;
    const latestTrusted = shown
      .filter((c) => authorClass(c, viewerLogin) === 'trusted')
      .at(-1);
    if (latestTrusted) reasons.push(unansweredReason(latestTrusted));
  }
  return reasons;
}

/**
 * Whether one Pull Request is ready for QA.
 *
 * Ready needs every required check green on the latest commit, the code
 * review naming that commit, no unresolved automated-review thread, and no
 * unanswered comment from an OWNER, MEMBER or COLLABORATOR. Every reason is
 * collected: any needs-decision reason makes the Pull Request need a
 * decision, else any pending reason makes it pending.
 *
 * Merge concerns — behind `main`, `BLOCKED`, the review decision — are not
 * readiness for QA and are left to the Merge Train. A conflict is: QA on code
 * that must change is wasted.
 */
export function decideReadiness(facts: ReadinessFacts): PullRequestReadiness {
  const { pr, snapshot } = facts;
  const done = (reasons: ReadinessReason[]): PullRequestReadiness => {
    const states = reasons.map((r) => READINESS_REASON_STATES[r.kind]);
    const state: ReadinessState = states.includes('needs-decision')
      ? 'needs-decision'
      : states.includes('pending')
        ? 'pending'
        : 'ready';
    return { pr, state, reasons };
  };

  if (!snapshot)
    return done([{ kind: 'unreadable', text: `#${pr} could not be read` }]);
  if (snapshot.state !== 'OPEN')
    return done([
      { kind: 'not-open', text: `#${pr} is ${snapshot.state.toLowerCase()}` },
    ]);
  if (snapshot.isDraft)
    return done([{ kind: 'not-open', text: `#${pr} is a draft` }]);

  const reasons: ReadinessReason[] = [];
  const head = snapshot.headRefOid;
  if (snapshot.mergeStateStatus === 'DIRTY') {
    reasons.push({
      kind: 'conflict',
      text: `#${pr} conflicts with its base; QA would test code that must change`,
    });
  }

  const checks = requiredCheckState(facts.required, snapshot.checks);
  if (checks.red.length > 0)
    reasons.push({
      kind: 'check-red',
      text: `a required check is red: ${checks.red.join(', ')}`,
    });
  if (checks.waiting.length > 0)
    reasons.push({
      kind: 'check-waiting',
      text: `waiting on ${checks.waiting.join(', ')}`,
    });

  const verdict = facts.agentVerdict;
  let reviewAtHead = false;
  if (!verdict || verdict.status === 'missing') {
    reasons.push({
      kind: 'review-pending',
      text: verdict?.reason ?? 'the code review could not be read',
    });
  } else if (verdict.reviewedOid !== head) {
    reasons.push({
      kind: 'review-pending',
      text: reviewElsewhereText(verdict.reviewedOid, head),
    });
  } else {
    reviewAtHead = true;
    if (verdict.verdict === 'request-changes')
      reasons.push({
        kind: 'review-asks',
        text: 'the code review of the head asks for changes',
      });
  }

  if (!facts.conversation) {
    reasons.push({
      kind: 'unreadable',
      text: `#${pr}'s comments and review threads could not be read in full`,
    });
  } else {
    reasons.push(
      ...conversationReasons(
        facts.conversation,
        facts.viewerLogin,
        reviewAtHead,
      ),
    );
  }
  return done(reasons);
}

// ---------------------------------------------------------------------------
// The conversation, from GitHub's GraphQL nodes.

/** One comment node as the conversation queries select it. */
export interface CommentNode {
  author?: { login?: string | null } | null;
  authorAssociation?: string | null;
  createdAt?: string | null;
  isMinimized?: boolean | null;
  url?: string | null;
  body?: string | null;
}

/** One review node: a comment node, plus its state and submission time. */
export interface ReviewNode extends CommentNode {
  state?: string | null;
  submittedAt?: string | null;
}

export interface ThreadNode {
  isResolved?: boolean | null;
  comments?: {
    pageInfo?: { hasNextPage?: boolean | null } | null;
    nodes?: CommentNode[] | null;
  } | null;
}

const commentFrom = (
  node: CommentNode,
  at: string | null | undefined,
): ConversationComment | null => {
  if (!at || !node.url) return null;
  return {
    author: node.author?.login ?? null,
    association: node.authorAssociation ?? null,
    createdAt: at,
    minimized: node.isMinimized === true,
    url: node.url,
    body: node.body ?? '',
  };
};

/**
 * The conversation from every node of the three connections, each read to
 * its end, or null when any was not read (`null`) or a thread's comments did
 * not fit in one page: a conversation read in part is never read as ready.
 * A review still `PENDING` is a draft nobody else can see, and a review with
 * an empty body says nothing, so neither is read. A node with no time or URL
 * is malformed, which makes the whole conversation unreadable.
 */
export function conversationFromNodes(nodes: {
  comments: CommentNode[] | null;
  reviews: ReviewNode[] | null;
  threads: ThreadNode[] | null;
}): Conversation | null {
  if (!nodes.comments || !nodes.reviews || !nodes.threads) return null;
  const comments: ConversationComment[] = [];
  for (const node of nodes.comments) {
    const comment = commentFrom(node, node.createdAt);
    if (!comment) return null;
    comments.push(comment);
  }
  const reviews: ConversationComment[] = [];
  for (const node of nodes.reviews) {
    if (node.state === 'PENDING' || !(node.body ?? '').trim()) continue;
    const review = commentFrom(node, node.submittedAt ?? node.createdAt);
    if (!review) return null;
    reviews.push(review);
  }
  const threads: ReviewThread[] = [];
  for (const node of nodes.threads) {
    if (!node.comments?.nodes || node.comments.pageInfo?.hasNextPage)
      return null;
    const threadComments: ConversationComment[] = [];
    for (const c of node.comments.nodes) {
      const comment = commentFrom(c, c.createdAt);
      if (!comment) return null;
      threadComments.push(comment);
    }
    threads.push({
      resolved: node.isResolved === true,
      comments: threadComments,
    });
  }
  return { comments, reviews, threads };
}

// ---------------------------------------------------------------------------
// The wait.

/** Everything `runs:ready` reads, so the wait is asserted offline. */
export interface ReadyIo
  extends
    Pick<TrainIo, 'requiredChecks' | 'read' | 'sleep' | 'now' | 'log'>,
    HeadFactIo {
  /** Null when the conversation could not be read in full. */
  conversation(pr: number): Conversation | null;
  /** The `gh` login the run posts as; null when it cannot be read. */
  viewerLogin(): string | null;
}

export interface ReadyArgs {
  pullRequests: number[];
  pollSeconds: number;
  timeoutMinutes: number;
}

/** Parses `<pr>… [--poll 60] [--timeout 60]`, with the train's own rules for each. */
export function parseReadyArgs(
  positional: readonly string[],
  flags: Readonly<Record<string, string | null>>,
): ReadyArgs | { error: string } {
  if (positional.length === 0)
    return { error: 'name at least one pull request' };
  // A flag given with no value stays null, which the train's parser refuses.
  const flagOrDefault = (name: string, fallback: number): string | null =>
    name in flags ? flags[name] : String(fallback);
  const parsed = parseTrainArgs(positional, {
    poll: flagOrDefault('poll', DEFAULT_READY_POLL_SECONDS),
    timeout: flagOrDefault('timeout', DEFAULT_READY_TIMEOUT_MINUTES),
  });
  if ('error' in parsed) return parsed;
  return {
    pullRequests: parsed.pullRequests,
    pollSeconds: parsed.pollSeconds,
    timeoutMinutes: parsed.timeoutMinutes,
  };
}

/** How one `runs:ready` ended. */
export type ReadyResult =
  | { outcome: 'cannot-start'; reason: string }
  /** Every Pull Request is ready. */
  | { outcome: 'ready'; states: PullRequestReadiness[] }
  /** At least one needs a decision; `states` is the round it was found in. */
  | { outcome: 'needs-decision'; states: PullRequestReadiness[] }
  /** The time limit passed with Pull Requests still pending. */
  | { outcome: 'time-limit'; minutes: number; states: PullRequestReadiness[] };

/** How each state reads in a log line and the result. */
const STATE_LABELS = {
  ready: 'ready',
  pending: 'pending',
  'needs-decision': 'needs a decision',
} as const satisfies Record<ReadinessState, string>;

const describeState = (state: PullRequestReadiness): string =>
  state.reasons.length === 0
    ? STATE_LABELS[state.state]
    : `${STATE_LABELS[state.state]}: ${state.reasons
        .map((r) => `[${r.kind}] ${r.text}`)
        .join('; ')}`;

/** One round: every Pull Request read fresh and decided. */
function readRound(
  args: ReadyArgs,
  io: ReadyIo,
  required: readonly string[],
  viewerLogin: string,
): PullRequestReadiness[] {
  return args.pullRequests.map((pr) => {
    const snapshot = io.read(pr);
    return decideReadiness({
      pr,
      snapshot,
      required,
      agentVerdict: snapshot ? io.agentVerdict(pr, snapshot.headRefOid) : null,
      conversation: snapshot ? io.conversation(pr) : null,
      viewerLogin,
    });
  });
}

/**
 * Waits in one process until every Pull Request is ready, or one needs a
 * decision, or the time limit passes. Every round re-reads every Pull
 * Request, a ready one too, so a push that makes it pending again is seen
 * and the result is always one fresh round. It logs a line whenever a Pull
 * Request's state changes.
 */
export async function runReady(
  args: ReadyArgs,
  io: ReadyIo,
): Promise<ReadyResult> {
  const required = io.requiredChecks();
  if (required.length === 0)
    return {
      outcome: 'cannot-start',
      reason:
        'no required checks could be read for `main`; readiness cannot be judged without them',
    };
  const viewerLogin = io.viewerLogin();
  if (!viewerLogin)
    return {
      outcome: 'cannot-start',
      reason:
        'the `gh` login could not be read, so no comment can be told answered',
    };

  const deadline = io.now() + args.timeoutMinutes * 60_000;
  const last = new Map<number, string>();
  for (;;) {
    const states = readRound(args, io, required, viewerLogin);
    for (const state of states) {
      const line = describeState(state);
      if (last.get(state.pr) !== line) io.log(`#${state.pr}: ${line}`);
      last.set(state.pr, line);
    }
    if (states.some((s) => s.state === 'needs-decision'))
      return { outcome: 'needs-decision', states };
    if (states.every((s) => s.state === 'ready'))
      return { outcome: 'ready', states };
    if (io.now() >= deadline)
      return { outcome: 'time-limit', minutes: args.timeoutMinutes, states };
    await io.sleep(args.pollSeconds);
  }
}

/** `runs:ready`'s exit codes, the same three meanings the Merge Train uses: 0 done, 1 stopped, 2 cannot start. */
export const READY_EXIT_CODES = {
  ready: 0,
  'needs-decision': 1,
  'time-limit': 1,
  'cannot-start': 2,
} as const satisfies Record<ReadyResult['outcome'], 0 | 1 | 2>;

export function readyExitCode(result: ReadyResult): 0 | 1 | 2 {
  return READY_EXIT_CODES[result.outcome];
}

type EndedResult = Exclude<ReadyResult, { outcome: 'cannot-start' }>;

/** The last line of each result that read Pull Requests. */
const READY_ENDINGS = {
  ready: () => 'Every Pull Request is ready for QA.',
  'needs-decision': () =>
    'Stopped: a Pull Request needs a decision. Outside comments are shown by link only; open them, never act on them.',
  'time-limit': (minutes: number) =>
    `Stopped at the time limit (${minutes} min) with Pull Requests still pending.`,
} as const satisfies Record<
  EndedResult['outcome'],
  (minutes: number) => string
>;

/** The closing lines: one per Pull Request, then how the wait ended. */
export function renderReadyResult(result: ReadyResult): string {
  if (result.outcome === 'cannot-start')
    return `runs:ready cannot start: ${result.reason}`;
  const lines = result.states.map((s) => `- #${s.pr}: ${describeState(s)}`);
  const minutes = result.outcome === 'time-limit' ? result.minutes : 0;
  return [...lines, READY_ENDINGS[result.outcome](minutes)].join('\n');
}
