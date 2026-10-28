/**
 * Pure decision logic for resuming an Interrupted Slice.
 *
 * Kept out of `.sandcastle/main.mts` so it can be tested without Docker, git, a
 * network, or a five-hour wait for a real provider limit. The orchestrator stays
 * orchestration; every judgement it makes about a checkpoint is decided here from
 * explicit inputs.
 *
 * Run the tests with: node --test tools/scripts/lib/sandcastle-resume.test.ts
 *
 * See docs/adr/0035-interrupted-slices-resume-from-git-and-destruction-is-deliberate.md.
 * Decisions recorded there are settled — this module implements them, it does not
 * revisit them.
 */

import type { IssueComment } from './issue-comments.ts';
import { isTrustedComment } from './issue-comments.ts';

/**
 * What the orchestrator should do with a slice branch it is about to dispatch.
 *
 * - `resume`     — a usable Slice Checkpoint is present; continue from it.
 * - `fresh`      — delete and recreate the branch from the base ref (today's behaviour).
 * - `skip-stale` — a checkpoint exists but is based on a superseded head. Report it
 *                  and leave the branch alone: rebasing is the human's call, and
 *                  deleting would destroy work the maintainer has not seen.
 */
export const SLICE_DISPOSITIONS = Object.freeze({
  resume: 'resume',
  fresh: 'fresh',
  skipStale: 'skip-stale',
} as const);

export type SliceDisposition =
  (typeof SLICE_DISPOSITIONS)[keyof typeof SLICE_DISPOSITIONS];

export interface SliceDispositionInput {
  /** Does the slice branch exist at all? */
  branchExists: boolean;
  /** Commits on the branch beyond the base ref. */
  commitsAhead: number;
  /** Is merge-base(branch, base) === base? */
  mergeBaseMatchesBase: boolean;
  /** Did the maintainer pass the discard flag? */
  discardRequested?: boolean;
}

/** Decide how to treat a slice branch. */
export function decideSliceDisposition({
  branchExists,
  commitsAhead,
  mergeBaseMatchesBase,
  discardRequested = false,
}: SliceDispositionInput): SliceDisposition {
  // An explicit discard outranks everything. The maintainer has looked at the work
  // and judged it worthless; this is the only path that destroys a checkpoint.
  if (discardRequested) return SLICE_DISPOSITIONS.fresh;

  // No branch, or a branch with nothing on it, is not a checkpoint. Recreating it is
  // both correct and what happens today.
  if (!branchExists) return SLICE_DISPOSITIONS.fresh;
  if (!Number.isFinite(commitsAhead) || commitsAhead <= 0) {
    return SLICE_DISPOSITIONS.fresh;
  }

  // Slices stack: each is cut from the live feature head so it builds on every
  // integrated predecessor. A checkpoint left behind while later slices integrated is
  // based on a head that no longer exists in the feature branch's history, so it can
  // neither fast-forward nor be safely built on.
  if (!mergeBaseMatchesBase) return SLICE_DISPOSITIONS.skipStale;

  return SLICE_DISPOSITIONS.resume;
}

/**
 * Guardrails every resumed agent is held to, whatever ended the previous run.
 *
 * An agent that did not finish leaves work no reviewer has signed off on, so these
 * exist to stop a fresh agent reading that output as finished.
 */
export const RESUME_GUARDRAILS_COMMON: readonly string[] = Object.freeze([
  'The previous run’s commits are a starting point, NOT approved work. Audit them before you extend them.',
  'Do NOT reset, rebase, or amend those commits. They are the maintainer’s anchor for diffing what the previous run produced. Correct them FORWARD with normal commits.',
  'Do NOT restart from scratch and do NOT revert files wholesale. If part of the work is wrong, change it forward and say why.',
  'Report your inventory BEFORE your first edit: which acceptance criteria are met, which are partial, and which are untouched.',
]);

/**
 * The two guardrails that apply ONLY to a genuinely interrupted run.
 *
 * Both are statements of fact about a Slice Checkpoint — a commit the ORCHESTRATOR
 * made with `--no-verify` around a dirty worktree after the agent was killed. They
 * are false about a run that finished and committed through the Commit sub-agent,
 * which is why they are no longer unconditional. See ADR 0044.
 */
export const INTERRUPTED_GUARDRAILS: readonly string[] = Object.freeze([
  'Files present in the checkpoint do NOT satisfy a Gated Pipeline. A spec file already in the tree does not mean TestScaffold ran, was reviewed, or passed — route it through the pipelines named above regardless.',
  'Nothing in the checkpoint has passed a deterministic check. It was committed with `--no-verify` while the run was being killed, so lint, tsc and the test suite have never once seen it. Run them over the checkpoint’s files and fix what they report BEFORE you report this slice complete — a finished-looking file is not a checked one.',
]);

/**
 * The two guardrails that replace them when the previous run FINISHED and the host
 * gate is what failed.
 *
 * Here the pipelines did run and the commit went through husky, so ordering a full
 * re-run burns a quota window reproducing reviewed work. The instruction inverts:
 * verify, then fix the gate.
 */
export const GATE_FAILURE_GUARDRAILS: readonly string[] = Object.freeze([
  'The previous run finished and committed through the `Commit` sub-agent — it was the host BUILD GATE that failed, not the agent. Do not re-run a pipeline whose result the handoff below already accounts for; confirm the work exists, then fix what the gate reported.',
  'Deterministic checks ran inside that run and the commit passed husky. Re-run them to confirm the current state, but treat a green result as expected rather than as new information.',
]);

/**
 * Backwards-compatible view: the interrupted-run guardrail set, in order.
 *
 * @deprecated Prefer `resumeGuardrails(kind)`.
 */
export const RESUME_GUARDRAILS: readonly string[] = Object.freeze([
  ...RESUME_GUARDRAILS_COMMON,
  ...INTERRUPTED_GUARDRAILS,
]);

/** How the previous run for a slice ended. */
export const PRIOR_RUN_KINDS = Object.freeze({
  interrupted: 'interrupted',
  gateFailure: 'gate-failure',
} as const);

export type PriorRunKind =
  (typeof PRIOR_RUN_KINDS)[keyof typeof PRIOR_RUN_KINDS];

/** The guardrails for one kind of prior run. */
export function resumeGuardrails(
  kind: PriorRunKind = PRIOR_RUN_KINDS.interrupted,
): readonly string[] {
  return Object.freeze([
    ...RESUME_GUARDRAILS_COMMON,
    ...(kind === PRIOR_RUN_KINDS.gateFailure
      ? GATE_FAILURE_GUARDRAILS
      : INTERRUPTED_GUARDRAILS),
  ]);
}

// ─── Handoff: what the previous run actually did ──────────────────────────────
// Git records the FILES a run produced; nothing records which Gated Pipelines ran,
// whether `/code-review` passed, or why the run ended. That gap cost #447 a full
// quota window re-running ComponentBuilder, ComponentReviewer, TestScaffold,
// TestReviewer, TestRunner and `/code-review` over work all six had already cleared.
//
// The agent is therefore asked to print a one-line `HANDOFF:` marker as each hop
// lands, and the orchestrator appends its own verdict the same way. Markers are
// INCREMENTAL on purpose: a quota kill lands mid-thought, so a summary written only
// at the end is absent from exactly the run that needed it most.
//
// The slice log is the carrier because it always exists — `--trace-subagents` is
// opt-in, so `logs/subagents/<n>/index.md` may simply not be there. Only marker
// lines travel: raw log tail would drag a dead agent's mid-thought reasoning into
// the next brief as if it were instruction. See ADR 0044.

/** Prefix an agent (or the orchestrator) uses to record a completed step. */
export const HANDOFF_MARKER = 'HANDOFF:';

/** Hard cap on markers carried forward, so a chatty run cannot flood the brief. */
export const MAX_HANDOFF_LINES = 40;

/**
 * Pull the `HANDOFF:` markers out of a slice log.
 *
 * Reads the LAST run segment, which at prompt-build time is the previous run: the
 * new run's own marker is not written until sandcastle starts it.
 *
 * @param contents Full slice log.
 * @returns marker text, in order, without the prefix.
 */
export function extractHandoff(
  contents: string,
  limit: number = MAX_HANDOFF_LINES,
): string[] {
  const text = String(contents ?? '');
  const lastRunStart = text.lastIndexOf(RUN_START_MARKER);
  const segment = lastRunStart === -1 ? text : text.slice(lastRunStart);

  const seen = new Set<string>();
  const markers: string[] = [];
  for (const line of segment.split('\n')) {
    const at = line.indexOf(HANDOFF_MARKER);
    if (at === -1) continue;
    const entry = line.slice(at + HANDOFF_MARKER.length).trim();
    // A marker echoed by the agent AND logged by the orchestrator is one event.
    if (entry === '' || seen.has(entry)) continue;
    seen.add(entry);
    markers.push(entry);
  }
  return markers.slice(-limit);
}

/**
 * Render the handoff for inclusion in a resume brief. Empty when there is nothing
 * to say — an absent handoff must read as "unknown", never as "nothing ran".
 */
export function formatHandoffSection(handoff?: string[]): string[] {
  if (!handoff || handoff.length === 0) return [];
  return [
    ``,
    `### What the previous run reported`,
    ``,
    `Self-reported by that run as each step completed. It is EVIDENCE, not proof:`,
    `confirm a claim cheaply (the commit exists, the file is in the tree) and then`,
    `review rather than re-run. Re-run only what these lines do not account for.`,
    ``,
    ...handoff.map((entry) => `  - ${entry}`),
  ];
}

export interface ResumeCheckpoint {
  sha: string;
  files?: string[];
}

export interface BuildResumeBriefInput {
  /** The prompt this slice would normally get. */
  basePrompt: string;
  issueNumber: number;
  sliceBranch: string;
  checkpoint: ResumeCheckpoint;
  /** How the previous run ended. */
  kind?: PriorRunKind;
  /** HANDOFF lines from the previous run's log. */
  handoff?: string[];
}

/**
 * Build the brief for a resumed slice.
 *
 * Takes the prompt the slice would normally receive and prepends the checkpoint
 * context plus the audit-first instruction. The diff itself is deliberately NOT
 * inlined: the agent can read it from git in one command, and spending the context
 * budget on it defeats the point of resuming rather than restarting.
 */
export function buildResumeBrief({
  basePrompt,
  issueNumber,
  sliceBranch,
  checkpoint,
  kind = PRIOR_RUN_KINDS.interrupted,
  handoff = [],
}: BuildResumeBriefInput): string {
  const files = checkpoint.files ?? [];
  const inventory =
    files.length > 0
      ? files.map((file) => `  - ${file}`).join('\n')
      : '  (file list unavailable — read it with `git show --stat`)';

  const interrupted = kind !== PRIOR_RUN_KINDS.gateFailure;
  const heading = interrupted
    ? '## RESUMING an interrupted attempt — read this before anything else'
    : '## RESUMING after a BUILD GATE failure — read this before anything else';
  const preamble = interrupted
    ? [
        `A previous agent run on issue #${issueNumber} was interrupted before it signalled`,
        `completion. Its work was preserved as a Slice Checkpoint on your branch:`,
      ]
    : [
        `A previous agent run on issue #${issueNumber} FINISHED and committed its work. The`,
        `host build gate then failed, so the slice was not integrated. Its commits are on`,
        `your branch:`,
      ];

  return [
    heading,
    ``,
    ...preamble,
    ``,
    `  branch     ${sliceBranch}`,
    `  head       ${checkpoint.sha}`,
    `  files      ${files.length || 'unknown'}`,
    ``,
    inventory,
    ``,
    `Inspect it with \`git show ${checkpoint.sha}\` and \`git show --stat ${checkpoint.sha}\`.`,
    ...formatHandoffSection(handoff),
    ``,
    `### Rules for this run`,
    ``,
    ...resumeGuardrails(kind).map(
      (guardrail, index) => `${index + 1}. ${guardrail}`,
    ),
    ``,
    `Your FIRST output must be the inventory required by rule 4. Only then start work.`,
    ``,
    `---`,
    ``,
    basePrompt,
  ].join('\n');
}

// ─── Maintainer notes on an issue ─────────────────────────────────────────────
// A maintainer who reviews a checkpoint writes their conclusions on the Slice Issue,
// but the orchestrator interpolates only an issue's BODY into a prompt, so those
// conclusions never reach the next agent. #396 closed with three reviewed findings
// unaddressed for exactly this reason.
//
// Comments are opt-in rather than wholesale: the orchestrator posts its own status
// comments (Pipeline Incident, unblock notices) on the same issues, and replaying
// those back to an agent is noise at best and stale instruction at worst. Only text
// a human deliberately filed under the marker heading travels — and only from an
// author the repository trusts (`issue-comments.ts`): the repository is public, and
// a note is replayed to an agent as binding.

/** Heading that marks a comment as instructions for the next agent run. */
export const MAINTAINER_NOTE_MARKER = '## Maintainer Review';

/**
 * Pull the maintainer-authored notes out of an issue's comments.
 *
 * Everything after the marker heading in a comment is taken, so a note can carry
 * whatever structure it needs. Text BEFORE the marker is dropped — that is where
 * conversational preamble lives, and a directive belongs under the heading.
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
    const body = String(comment?.body ?? '');
    // Case-insensitive: a maintainer typing "## maintainer review" means the same
    // thing, and failing silently on capitalisation is the worst outcome here.
    const marker = body
      .toLowerCase()
      .indexOf(MAINTAINER_NOTE_MARKER.toLowerCase());
    if (marker === -1) continue;

    const afterHeading = body.slice(marker + MAINTAINER_NOTE_MARKER.length);
    const note = afterHeading.replace(/^[^\n]*\n?/, '').trim();
    if (note) notes.push(note);
  }

  return notes;
}

/**
 * Append maintainer notes to a prompt.
 *
 * Placed AFTER the issue body so it reads as a later amendment to the brief rather
 * than part of the original specification, and stated as binding so an agent does
 * not weigh it against the acceptance criteria and pick.
 */
export function withMaintainerNotes(
  prompt: string,
  notes: string[] | undefined,
): string {
  if (!Array.isArray(notes) || notes.length === 0) return prompt;

  return [
    prompt,
    ``,
    `## Maintainer notes on this issue`,
    ``,
    `A maintainer reviewed this issue and left ${notes.length === 1 ? 'the following instruction' : 'the following instructions'}.`,
    `Treat this as binding: it is more recent than the issue body above, and where the`,
    `two disagree, this wins. If a note tells you something is already done, verify it`,
    `rather than assuming it.`,
    ``,
    ...notes.flatMap((note, index) => [`### Note ${index + 1}`, ``, note, ``]),
  ].join('\n');
}

/**
 * Append an issue's triage brief to a prompt.
 *
 * Placed after the issue body and before any maintainer notes: the body is the
 * report, the brief is what triage decided the work is, and a maintainer note is
 * later still. Stated as the contract so an agent does not implement the report's
 * first idea where triage settled on a different one.
 */
export function withTriageBrief(
  prompt: string,
  brief: string | null | undefined,
): string {
  if (!brief) return prompt;

  return [
    prompt,
    ``,
    `## Triage brief on this issue`,
    ``,
    `This issue was triaged, and the brief below is the contract for this work. It is`,
    `more recent than the issue body above: where the two disagree, the brief wins.`,
    `Its "Verified in triage" facts were true when triage ran — re-check any you rely on.`,
    ``,
    brief,
    ``,
  ].join('\n');
}

// ─── Discarding a checkpoint ──────────────────────────────────────────────────
// Resume is the default, so destroying preserved work needs an argument. These
// helpers decide whether that argument was given and whether it was given somewhere
// it is allowed to apply.

/** The flag that discards a Slice Checkpoint instead of resuming from it. */
export const DISCARD_FLAG = '--fresh';

export function isDiscardRequested(argv: string[]): boolean {
  return argv.includes(DISCARD_FLAG);
}

export type DispatchMode = 'prd' | 'issue' | 'sweep';

export interface ValidateDiscardScopeInput {
  discardRequested: boolean;
  mode: DispatchMode;
  /** The `--issue` target, when one was given. */
  issueNumber?: number;
}

export interface DiscardScopeResult {
  ok: boolean;
  /** Empty when ok. */
  message: string;
}

/**
 * A discard is a surgical instruction about ONE attempt a maintainer has inspected
 * and judged worthless. Applied to a whole PRD it becomes "destroy any checkpoint you
 * encounter", which is the blast radius resume exists to remove — so in PRD mode the
 * flag is only accepted alongside the per-slice targeting that already exists.
 */
export function validateDiscardScope({
  discardRequested,
  mode,
  issueNumber,
}: ValidateDiscardScopeInput): DiscardScopeResult {
  if (!discardRequested) return { ok: true, message: '' };

  if (mode === 'prd' && issueNumber === undefined) {
    return {
      ok: false,
      message:
        `${DISCARD_FLAG} discards preserved work, so it must name the slice it applies to.\n` +
        `Re-run with the slice targeted:  --prd <n> --issue <slice> ${DISCARD_FLAG}`,
    };
  }

  if (mode === 'sweep') {
    return {
      ok: false,
      message:
        `${DISCARD_FLAG} is not accepted in sweep mode — a sweep selects work nobody named,\n` +
        `so a blanket discard would destroy checkpoints you have never seen.\n` +
        `Discard one issue at a time:  --issue <n> ${DISCARD_FLAG}`,
    };
  }

  return { ok: true, message: '' };
}

export interface WaveForwardingResult {
  ok: boolean;
  message: string;
  forwarded: string[];
}

/**
 * Decide what the wave driver forwards to the orchestrator.
 *
 * The wave driver is a bulk unattended pass across an entire PRD, so it refuses the
 * discard flag outright rather than forwarding it: composing "discard" with "every
 * slice in this PRD" is exactly the blast radius this feature removes. Everything the
 * driver does not own itself still forwards untouched.
 *
 * @param argv Full process argv.
 */
export function planWaveForwarding(argv: string[]): WaveForwardingResult {
  if (isDiscardRequested(argv)) {
    return {
      ok: false,
      forwarded: [],
      message:
        `${DISCARD_FLAG} is not accepted by the wave driver.\n` +
        `It discards preserved work, and a wave run spans every slice in the PRD — so it\n` +
        `would destroy checkpoints across the whole feature, not the one you meant.\n\n` +
        `Discard the single attempt you inspected, then re-run the waves:\n` +
        `  npx tsx .sandcastle/main.mts --prd <n> --issue <slice> ${DISCARD_FLAG}\n` +
        `  npx tsx .sandcastle/dispatch-waves.mts --prd <n>`,
    };
  }

  const forwarded: string[] = [];
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    // --prd and --plan are the driver's own; everything else belongs downstream.
    if (arg === '--prd') {
      index += 1;
      continue;
    }
    if (arg === '--plan') continue;
    forwarded.push(arg);
  }

  return { ok: true, message: '', forwarded };
}

// ─── Provider usage limits ────────────────────────────────────────────────────
// This orchestrator dispatches three different agents, so "did we hit a usage limit"
// cannot be one hardcoded string match. Each provider contributes its own matchers;
// a provider with none classifies as `unknown`, which is the correct answer rather
// than a gap — their message formats are not ours to guess, and a wrong guess is
// worse than no guess because it can trigger a multi-hour sleep.
//
// The thrown agent error is NOT the input. It carries whatever was last on stderr,
// routinely a trailing warning rather than the cause. The log tail is.

export const LIMIT_CLASSIFICATIONS = Object.freeze({
  limitHit: 'limit-hit',
  other: 'other',
  unknown: 'unknown',
} as const);

export type LimitClassificationKind =
  (typeof LIMIT_CLASSIFICATIONS)[keyof typeof LIMIT_CLASSIFICATIONS];

export type AgentKind = 'claude' | 'cursor' | 'copilot';

/**
 * Per-provider matchers over a log tail.
 *
 * Claude Code is the only provider whose limit message we have observed. Cursor and
 * Copilot intentionally have none: add a matcher when a real message is captured,
 * never a guessed one.
 */
export const LIMIT_MATCHERS: Readonly<Record<AgentKind, readonly RegExp[]>> =
  Object.freeze({
    claude: Object.freeze([
      /you've hit your (?:session|usage) limit/i,
      /\bsession limit reached\b/i,
      /\busage limit reached\b/i,
    ]),
    cursor: Object.freeze([]),
    copilot: Object.freeze([]),
  });

/**
 * Marker sandcastle writes when a run begins. A slice log is APPENDED to across runs,
 * so this is what separates them.
 */
export const RUN_START_MARKER = '--- Run started:';

/**
 * The last `count` non-empty lines of the CURRENT run in a slice log.
 *
 * Scoping to the current run is not a nicety. Slice logs accumulate: re-dispatching
 * an issue appends to the same file, so a plain tail-of-file can reach back past the
 * run boundary and classify the PREVIOUS run's ending as this one's. That produced a
 * real misfire — a dependency-install failure was read as a usage limit because the
 * prior run's limit message was still within 15 lines of the end — and parked a run
 * for roughly twenty hours.
 *
 * When no marker is present the whole file is used, which is correct for a
 * single-run log. `boundMaxWait` covers the case where the marker format changes.
 */
export function tailLines(contents: string, count = 15): string[] {
  const text = String(contents ?? '');
  const lastRunStart = text.lastIndexOf(RUN_START_MARKER);
  const currentRun = lastRunStart === -1 ? text : text.slice(lastRunStart);

  return currentRun
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
    .slice(-count);
}

/**
 * Parse a reset time out of a limit message.
 *
 * Returns undefined whenever the text cannot be read with confidence. That is
 * load-bearing: the wait policy refuses to sleep without a parsed time rather than
 * guessing a window, because a wrong guess either wastes hours or wakes into the
 * same wall and burns a retry.
 */
export function parseResetTime(
  text: string | undefined,
  now: Date,
): Date | undefined {
  // Observed shape: "resets 4:30am (UTC)". Only UTC is accepted — a bare local time
  // would be ambiguous across the machines this runs on.
  const match =
    /resets\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(UTC\)/i.exec(
      String(text ?? ''),
    );
  if (!match) return undefined;

  let hour = Number.parseInt(match[1], 10);
  const minute = match[2] ? Number.parseInt(match[2], 10) : 0;
  const meridiem = match[3].toLowerCase();

  if (hour < 1 || hour > 12 || minute > 59) return undefined;
  if (meridiem === 'pm' && hour !== 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  const reset = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hour,
      minute,
      0,
      0,
    ),
  );
  // A reset time already past today refers to tomorrow.
  if (reset.getTime() <= now.getTime()) {
    reset.setUTCDate(reset.getUTCDate() + 1);
  }
  return reset;
}

export interface RunFailureClassification {
  kind: LimitClassificationKind;
  resetAt: Date | undefined;
  evidence: string | undefined;
}

export interface ClassifyRunFailureInput {
  agentKind: AgentKind;
  /** Already tailed — see tailLines. */
  logTail: string[];
  now: Date;
}

/** Classify why a run ended, from the tail of its log. */
export function classifyRunFailure({
  agentKind,
  logTail,
  now,
}: ClassifyRunFailureInput): RunFailureClassification {
  const matchers = LIMIT_MATCHERS[agentKind];

  // A provider we have no matchers for is `unknown`, never `other`: the difference is
  // "we did not look" versus "we looked and it was not a limit".
  if (!matchers || matchers.length === 0) {
    return {
      kind: LIMIT_CLASSIFICATIONS.unknown,
      resetAt: undefined,
      evidence: undefined,
    };
  }

  const lines = Array.isArray(logTail) ? logTail : [];
  for (const line of lines) {
    if (matchers.some((matcher) => matcher.test(line))) {
      return {
        kind: LIMIT_CLASSIFICATIONS.limitHit,
        resetAt: parseResetTime(line, now),
        evidence: line.trim(),
      };
    }
  }

  return {
    kind: LIMIT_CLASSIFICATIONS.other,
    resetAt: undefined,
    evidence: undefined,
  };
}

/** How many times one run may wait out a provider limit before giving up. */
export const MAX_QUOTA_WAITS = 2;

/**
 * The furthest ahead a reset time may plausibly be before we refuse to trust it.
 *
 * A provider's usage window is measured in hours, so a reset further out than this
 * means something is wrong — a stale message from an earlier run, a truncated line, a
 * changed format — and sleeping on it wastes most of a day. Independent of how the
 * classification was reached, so it still holds if the run-boundary scoping above
 * fails for a reason we have not thought of.
 */
export const MAX_WAIT_MS = 6 * 60 * 60 * 1000;

export interface DecideWaitPolicyInput {
  classification: Pick<RunFailureClassification, 'kind' | 'resetAt'>;
  /** Did the maintainer opt in? */
  waitEnabled: boolean;
  /** Waits already spent this run. */
  waitsTaken: number;
  now?: Date;
  maxWaits?: number;
  /** Reject a reset further ahead than this. */
  maxWaitMs?: number;
}

export interface WaitPolicyDecision {
  action: 'wait' | 'exit';
  until: Date | undefined;
  reason: string;
}

/**
 * Decide whether to park the run until a limit resets, or exit with the work
 * preserved.
 */
export function decideWaitPolicy({
  classification,
  waitEnabled,
  waitsTaken,
  now = new Date(),
  maxWaits = MAX_QUOTA_WAITS,
  maxWaitMs = MAX_WAIT_MS,
}: DecideWaitPolicyInput): WaitPolicyDecision {
  const exit = (reason: string): WaitPolicyDecision => ({
    action: 'exit',
    until: undefined,
    reason,
  });

  if (!waitEnabled) return exit('waiting was not requested');

  if (classification.kind !== LIMIT_CLASSIFICATIONS.limitHit) {
    return exit(
      classification.kind === LIMIT_CLASSIFICATIONS.unknown
        ? 'this provider reports no limit format we recognise'
        : 'the run did not end on a provider limit',
    );
  }

  // Never sleep blind. An unreadable timestamp means the format changed or the
  // message was truncated; guessing a window is worse than stopping.
  if (!(classification.resetAt instanceof Date)) {
    return exit('the reset time could not be read from the limit message');
  }

  if (waitsTaken >= maxWaits) {
    return exit(`the wait limit of ${maxWaits} for this run is exhausted`);
  }

  // Sanity-bound the window. A reset further out than a provider's usage window is
  // not believable, and the cost of trusting it is most of a day parked for nothing.
  const untilMs = classification.resetAt.getTime() - now.getTime();
  if (untilMs > maxWaitMs) {
    return exit(
      `the reset time is ${Math.round(untilMs / 3_600_000)}h away, further than the ` +
        `${Math.round(maxWaitMs / 3_600_000)}h bound — treating it as not trustworthy`,
    );
  }

  return {
    action: 'wait',
    until: classification.resetAt,
    reason: `provider limit resets at ${classification.resetAt.toISOString()}`,
  };
}

// ─── Reporting a wait ─────────────────────────────────────────────────────────

/** A duration as `19h 25m` / `45m`, for a human deciding whether to let a run park. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}

/**
 * Describe a wait window in the operator's own timezone, with the duration.
 *
 * Reset times arrive in UTC and the sleep itself is an absolute delta, so the zone
 * never affects how long a run parks. It does affect whether a person notices that
 * the wait is wrong: `2026-08-21T04:30:00.000Z` reads as unremarkable, while
 * `21 Aug, 2:30 pm AEST (in 19h 25m)` is obviously not a five-hour usage window.
 * The duration is the part that makes a mistake visible.
 */
export function formatWaitWindow(
  until: Date,
  now: Date,
  timeZone: string | undefined = undefined,
): string {
  // Explicit components rather than dateStyle/timeStyle: those cannot be combined
  // with timeZoneName, and naming the zone is the point.
  const local = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(until);

  return `${local} (in ${formatDuration(until.getTime() - now.getTime())})`;
}
