/**
 * Run with: node --test tools/scripts/lib/sandcastle-resume.test.ts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DISCARD_FLAG,
  LIMIT_CLASSIFICATIONS,
  MAX_QUOTA_WAITS,
  MAX_WAIT_MS,
  RUN_START_MARKER,
  formatDuration,
  formatWaitWindow,
  classifyRunFailure,
  decideWaitPolicy,
  parseResetTime,
  tailLines,
  RESUME_GUARDRAILS,
  GATE_FAILURE_GUARDRAILS,
  INTERRUPTED_GUARDRAILS,
  PRIOR_RUN_KINDS,
  extractHandoff,
  resumeGuardrails,
  MAINTAINER_NOTE_MARKER,
  extractMaintainerNotes,
  withMaintainerNotes,
  SLICE_DISPOSITIONS,
  buildResumeBrief,
  decideSliceDisposition,
  isDiscardRequested,
  planWaveForwarding,
  validateDiscardScope,
} from './sandcastle-resume.ts';

const usableCheckpoint = {
  branchExists: true,
  commitsAhead: 1,
  mergeBaseMatchesBase: true,
};

test('resumes a slice branch carrying a usable checkpoint', () => {
  assert.equal(
    decideSliceDisposition(usableCheckpoint),
    SLICE_DISPOSITIONS.resume,
  );
});

test('starts fresh when the slice branch does not exist', () => {
  assert.equal(
    decideSliceDisposition({
      branchExists: false,
      commitsAhead: 0,
      mergeBaseMatchesBase: true,
    }),
    SLICE_DISPOSITIONS.fresh,
  );
});

test('starts fresh when the branch exists but carries no work', () => {
  assert.equal(
    decideSliceDisposition({
      branchExists: true,
      commitsAhead: 0,
      mergeBaseMatchesBase: true,
    }),
    SLICE_DISPOSITIONS.fresh,
  );
});

test('a checkpoint based on a superseded head is skipped, never resumed', () => {
  assert.equal(
    decideSliceDisposition({
      branchExists: true,
      commitsAhead: 3,
      mergeBaseMatchesBase: false,
    }),
    SLICE_DISPOSITIONS.skipStale,
  );
});

test('a stale checkpoint is skipped rather than destroyed', () => {
  // The distinction that matters: skip-stale leaves the branch alone. Returning
  // `fresh` here would delete work the maintainer has never seen.
  assert.notEqual(
    decideSliceDisposition({
      branchExists: true,
      commitsAhead: 3,
      mergeBaseMatchesBase: false,
    }),
    SLICE_DISPOSITIONS.fresh,
  );
});

test('an explicit discard outranks a usable checkpoint', () => {
  assert.equal(
    decideSliceDisposition({ ...usableCheckpoint, discardRequested: true }),
    SLICE_DISPOSITIONS.fresh,
  );
});

test('an explicit discard also overrides a stale checkpoint', () => {
  assert.equal(
    decideSliceDisposition({
      branchExists: true,
      commitsAhead: 3,
      mergeBaseMatchesBase: false,
      discardRequested: true,
    }),
    SLICE_DISPOSITIONS.fresh,
  );
});

test('a non-numeric commit count is treated as no work rather than resumed', () => {
  // rev-list output can be empty when the ref is unreadable. Guessing "resume" there
  // would hand an agent a brief describing a checkpoint that is not present.
  assert.equal(
    decideSliceDisposition({
      branchExists: true,
      commitsAhead: Number.NaN,
      mergeBaseMatchesBase: true,
    }),
    SLICE_DISPOSITIONS.fresh,
  );
});

test('the resume brief carries all six guardrails', () => {
  const brief = buildResumeBrief({
    basePrompt: 'BASE PROMPT BODY',
    issueNumber: 396,
    sliceBranch: 'slice/396-example',
    checkpoint: { sha: '1f056fa', files: ['a.ts', 'b.ts'] },
  });

  assert.equal(RESUME_GUARDRAILS.length, 6);
  for (const guardrail of RESUME_GUARDRAILS) {
    assert.ok(
      brief.includes(guardrail),
      `resume brief dropped a guardrail: ${guardrail}`,
    );
  }
});

test('the resume brief states that existing files do not satisfy a pipeline', () => {
  // The rationalization this exists to close: a resumed agent finding a spec file in
  // the tree and concluding the Jest pipeline already ran.
  const brief = buildResumeBrief({
    basePrompt: 'BASE',
    issueNumber: 1,
    sliceBranch: 'slice/1-x',
    checkpoint: { sha: 'abc1234', files: ['x.spec.ts'] },
  });

  assert.match(brief, /do NOT satisfy a Gated Pipeline/);
  assert.match(brief, /does not mean TestScaffold ran/);
});

test('the resume brief demands deterministic checks over inherited work', () => {
  // Regression: on the first live resume of #396 the agent inventoried the checkpoint,
  // judged every acceptance criterion met, committed nothing, and stopped. The build
  // gate then failed on two `import/first` errors that had been sitting in the
  // checkpoint since the interrupted run — which was killed long before any gate could
  // see them, and whose commit used --no-verify by design. Auditing the checkpoint for
  // *completeness* is not the same as running lint over it.
  const brief = buildResumeBrief({
    basePrompt: 'BASE',
    issueNumber: 396,
    sliceBranch: 'slice/396-x',
    checkpoint: { sha: '1f056fa', files: ['a.test.ts'] },
  });

  assert.match(brief, /has passed a deterministic check/);
  assert.match(brief, /--no-verify/);
  assert.match(brief, /BEFORE you report this slice complete/);
});

test('the resume brief preserves the original prompt', () => {
  const brief = buildResumeBrief({
    basePrompt: 'ORIGINAL SLICE BRIEF CONTENTS',
    issueNumber: 7,
    sliceBranch: 'slice/7-y',
    checkpoint: { sha: 'deadbee', files: [] },
  });

  assert.ok(brief.includes('ORIGINAL SLICE BRIEF CONTENTS'));
});

test('the resume brief names the branch, sha and file inventory', () => {
  const brief = buildResumeBrief({
    basePrompt: 'BASE',
    issueNumber: 42,
    sliceBranch: 'slice/42-z',
    checkpoint: { sha: 'cafe123', files: ['apps/a.ts', 'libs/b.ts'] },
  });

  assert.ok(brief.includes('slice/42-z'));
  assert.ok(brief.includes('cafe123'));
  assert.ok(brief.includes('apps/a.ts'));
  assert.ok(brief.includes('libs/b.ts'));
  assert.match(brief, /#42/);
});

test('the resume brief degrades when the file list is unavailable', () => {
  const brief = buildResumeBrief({
    basePrompt: 'BASE',
    issueNumber: 9,
    sliceBranch: 'slice/9-w',
    checkpoint: { sha: 'beef456' },
  });

  assert.match(brief, /file list unavailable/);
});

test('the resume brief does not inline the diff', () => {
  // Spending the context budget on a diff the agent can read from git in one command
  // defeats the point of resuming rather than restarting.
  const brief = buildResumeBrief({
    basePrompt: 'BASE',
    issueNumber: 3,
    sliceBranch: 'slice/3-q',
    checkpoint: { sha: 'aaa111', files: ['f.ts'] },
  });

  assert.ok(!brief.includes('diff --git'));
  assert.match(brief, /git show aaa111/);
});

// ─── Discarding a checkpoint ──────────────────────────────────────────────────

const argv = (...args: string[]): string[] => ['node', 'main.mts', ...args];

test('the discard flag is recognised in argv', () => {
  assert.equal(isDiscardRequested(argv('--prd', '401', DISCARD_FLAG)), true);
  assert.equal(isDiscardRequested(argv('--prd', '401')), false);
});

test('a discard in PRD mode must name the slice it applies to', () => {
  const result = validateDiscardScope({
    discardRequested: true,
    mode: 'prd',
    issueNumber: undefined,
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /--issue/);
});

test('a discard in PRD mode is accepted when a slice is targeted', () => {
  assert.equal(
    validateDiscardScope({
      discardRequested: true,
      mode: 'prd',
      issueNumber: 396,
    }).ok,
    true,
  );
});

test('a discard is refused in sweep mode', () => {
  // A sweep selects work nobody named, so a blanket discard would destroy
  // checkpoints the maintainer has never looked at.
  const result = validateDiscardScope({
    discardRequested: true,
    mode: 'sweep',
  });

  assert.equal(result.ok, false);
});

test('issue mode accepts a discard — the issue is already the target', () => {
  assert.equal(
    validateDiscardScope({
      discardRequested: true,
      mode: 'issue',
      issueNumber: 42,
    }).ok,
    true,
  );
});

test('no discard requested is always in scope', () => {
  for (const mode of ['prd', 'issue', 'sweep'] as const) {
    assert.equal(
      validateDiscardScope({ discardRequested: false, mode }).ok,
      true,
    );
  }
});

// ─── Wave driver forwarding ───────────────────────────────────────────────────

test('the wave driver refuses the discard flag', () => {
  const result = planWaveForwarding(argv('--prd', '401', DISCARD_FLAG));

  assert.equal(result.ok, false);
  assert.match(result.message, /not accepted by the wave driver/);
});

test('the wave driver refusal names the single-slice command to use instead', () => {
  const result = planWaveForwarding(argv('--prd', '401', DISCARD_FLAG));

  assert.match(result.message, /--issue <slice>/);
  assert.match(result.message, /dispatch-waves\.mts --prd/);
});

test('the wave driver never forwards the discard flag', () => {
  const result = planWaveForwarding(argv('--prd', '401', DISCARD_FLAG));

  assert.equal(result.ok, false);
  assert.deepEqual(result.forwarded, [] as string[]);
  assert.equal(result.forwarded.includes(DISCARD_FLAG), false);
});

test('the wave driver forwards flags it does not own', () => {
  const result = planWaveForwarding(
    argv('--prd', '401', '--agent', 'cursor', '--model', 'x'),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.forwarded, ['--agent', 'cursor', '--model', 'x']);
});

test('the wave driver keeps its own flags to itself', () => {
  const result = planWaveForwarding(
    argv('--prd', '401', '--plan', '--agent', 'copilot'),
  );

  assert.equal(result.ok, true);
  assert.equal(result.forwarded.includes('--prd'), false);
  assert.equal(result.forwarded.includes('401'), false);
  assert.equal(result.forwarded.includes('--plan'), false);
  assert.deepEqual(result.forwarded, ['--agent', 'copilot']);
});

// ─── Provider usage limits ────────────────────────────────────────────────────

// The real message observed when slice #396 died mid-run.
const CLAUDE_LIMIT_LINE = "You've hit your session limit · resets 4:30am (UTC)";
const NOW = new Date('2026-08-20T03:03:00Z');

test('the observed Claude limit message classifies as a limit hit', () => {
  const result = classifyRunFailure({
    agentKind: 'claude',
    logTail: ['Bash(ls)', CLAUDE_LIMIT_LINE],
    now: NOW,
  });

  assert.equal(result.kind, LIMIT_CLASSIFICATIONS.limitHit);
  assert.ok(result.resetAt instanceof Date);
  assert.equal(result.resetAt.toISOString(), '2026-08-20T04:30:00.000Z');
});

test('cursor classifies as unknown — we have no matcher, and must not guess', () => {
  // This is an asserted expectation, NOT a gap. Guessing a message format we have
  // never observed could park a run for hours on a failure that was not a limit.
  const result = classifyRunFailure({
    agentKind: 'cursor',
    logTail: [CLAUDE_LIMIT_LINE],
    now: NOW,
  });

  assert.equal(result.kind, LIMIT_CLASSIFICATIONS.unknown);
});

test('copilot classifies as unknown for the same reason', () => {
  assert.equal(
    classifyRunFailure({
      agentKind: 'copilot',
      logTail: [CLAUDE_LIMIT_LINE],
      now: NOW,
    }).kind,
    LIMIT_CLASSIFICATIONS.unknown,
  );
});

test('unknown is distinct from other — "did not look" is not "looked and found nothing"', () => {
  const unknown = classifyRunFailure({
    agentKind: 'cursor',
    logTail: ['some failure'],
    now: NOW,
  });
  const other = classifyRunFailure({
    agentKind: 'claude',
    logTail: ['some failure'],
    now: NOW,
  });

  assert.equal(unknown.kind, LIMIT_CLASSIFICATIONS.unknown);
  assert.equal(other.kind, LIMIT_CLASSIFICATIONS.other);
  assert.notEqual(unknown.kind, other.kind);
});

test('only the tail is classified, so an agent writing about limits cannot trip it', () => {
  // An agent that reads or writes the words mid-run must not look like a limit hit.
  const wholeLog = [
    'Read(docs/limits.md)',
    CLAUDE_LIMIT_LINE,
    ...Array.from({ length: 40 }, (_, i) => `Bash(step ${i})`),
  ].join('\n');

  const result = classifyRunFailure({
    agentKind: 'claude',
    logTail: tailLines(wholeLog, 15),
    now: NOW,
  });

  assert.equal(result.kind, LIMIT_CLASSIFICATIONS.other);
});

test('tailLines drops blank lines and keeps the last n', () => {
  const tail = tailLines('a\n\n\nb\nc\n\n', 2);
  assert.deepEqual(tail, ['b', 'c']);
});

test('a reset time earlier in the day than now means tomorrow', () => {
  const reset = parseResetTime(
    'resets 2:00am (UTC)',
    new Date('2026-08-20T03:03:00Z'),
  );
  assert.equal(reset?.toISOString(), '2026-08-21T02:00:00.000Z');
});

test('parseResetTime handles pm and bare hours', () => {
  assert.equal(
    parseResetTime('resets 11pm (UTC)', NOW)?.toISOString(),
    '2026-08-20T23:00:00.000Z',
  );
  assert.equal(
    parseResetTime('resets at 12:15am (UTC)', NOW)?.toISOString(),
    '2026-08-21T00:15:00.000Z',
  );
});

test('parseResetTime returns undefined rather than guessing', () => {
  for (const text of [
    'resets soon',
    'resets 4:30am', // no timezone — ambiguous across machines
    'resets 25:00am (UTC)', // impossible hour
    "You've hit your session limit",
    '',
  ]) {
    assert.equal(parseResetTime(text, NOW), undefined, `parsed: ${text}`);
  }
});

// ─── Wait policy ──────────────────────────────────────────────────────────────

const limitHit = (resetAt: Date | undefined) => ({
  kind: LIMIT_CLASSIFICATIONS.limitHit,
  resetAt,
});

test('waits until the reset when opted in and the time is known', () => {
  const until = new Date('2026-08-20T04:30:00Z');
  const decision = decideWaitPolicy({
    classification: limitHit(until),
    waitEnabled: true,
    waitsTaken: 0,
    now: NOW,
  });

  assert.equal(decision.action, 'wait');
  assert.equal(decision.until?.toISOString(), until.toISOString());
});

test('never waits unless the maintainer opted in', () => {
  const decision = decideWaitPolicy({
    classification: limitHit(new Date('2026-08-20T04:30:00Z')),
    waitEnabled: false,
    waitsTaken: 0,
    now: NOW,
  });

  assert.equal(decision.action, 'exit');
});

test('never sleeps blind when the reset time could not be read', () => {
  // The guard that keeps a provider changing its message format from becoming a
  // multi-hour sleep.
  const decision = decideWaitPolicy({
    classification: limitHit(undefined),
    waitEnabled: true,
    waitsTaken: 0,
    now: NOW,
  });

  assert.equal(decision.action, 'exit');
  assert.match(decision.reason, /reset time could not be read/);
});

test('never waits on an unknown provider even with waiting enabled', () => {
  const decision = decideWaitPolicy({
    classification: { kind: LIMIT_CLASSIFICATIONS.unknown, resetAt: undefined },
    waitEnabled: true,
    waitsTaken: 0,
    now: NOW,
  });

  assert.equal(decision.action, 'exit');
  assert.match(decision.reason, /no limit format we recognise/);
});

test('never waits when the run did not end on a limit', () => {
  assert.equal(
    decideWaitPolicy({
      classification: { kind: LIMIT_CLASSIFICATIONS.other, resetAt: undefined },
      waitEnabled: true,
      waitsTaken: 0,
      now: NOW,
    }).action,
    'exit',
  );
});

test('the wait cap is enforced', () => {
  const until = new Date('2026-08-20T04:30:00Z');

  assert.equal(
    decideWaitPolicy({
      classification: limitHit(until),
      waitEnabled: true,
      waitsTaken: MAX_QUOTA_WAITS - 1,
      now: NOW,
    }).action,
    'wait',
  );

  const exhausted = decideWaitPolicy({
    classification: limitHit(until),
    waitEnabled: true,
    waitsTaken: MAX_QUOTA_WAITS,
    now: NOW,
  });
  assert.equal(exhausted.action, 'exit');
  assert.match(exhausted.reason, /wait limit/);
});

test('the cap is two — three limit hits is more than a day of wall clock', () => {
  assert.equal(MAX_QUOTA_WAITS, 2);
});

// ─── Regression: stale log content from an earlier run ────────────────────────
// A slice log is appended to across runs. On 2026-08-20 a resumed #396 failed at
// `yarn install --immutable`, but the tail of the FILE still held the previous run's
// limit message nine lines further up — so it was classified as a usage limit and the
// run parked for roughly twenty hours on a failure that was never a limit.

const TWO_RUN_LOG = [
  `${RUN_START_MARKER} 2026-08-20T03:03:59.768Z ---`,
  'Bash(npx tsc --noEmit)',
  'Let me review what TestScaffold actually wrote before sending it to TestReviewer.',
  "You've hit your session limit · resets 4:30am (UTC)",
  'Agent invocation failed: claude-code exited with code 1:',
  `${RUN_START_MARKER} 2026-08-20T08:59:56.452Z ---`,
  'Sandcastle Run',
  '  Agent: #396',
  '  Max iterations: 2',
  'Iteration 1/2',
  'Setting up sandbox',
  'Command failed in sandbox (corepack yarn install --immutable): exit 1',
].join('\n');

test('the tail is scoped to the current run, not the whole file', () => {
  const tail = tailLines(TWO_RUN_LOG, 15);

  assert.ok(
    tail.every((line) => !line.includes('session limit')),
    "the previous run's limit message leaked into the current run's tail",
  );
  assert.ok(tail[0].includes('2026-08-20T08:59:56.452Z'));
});

test('an install failure after an earlier limit is NOT a limit hit', () => {
  const result = classifyRunFailure({
    agentKind: 'claude',
    logTail: tailLines(TWO_RUN_LOG, 15),
    now: new Date('2026-08-20T09:05:00Z'),
  });

  assert.equal(result.kind, LIMIT_CLASSIFICATIONS.other);
});

test('a log with no run marker still classifies — single-run logs are valid', () => {
  const result = classifyRunFailure({
    agentKind: 'claude',
    logTail: tailLines(
      "You've hit your session limit · resets 4:30am (UTC)",
      15,
    ),
    now: new Date('2026-08-20T03:03:00Z'),
  });

  assert.equal(result.kind, LIMIT_CLASSIFICATIONS.limitHit);
});

// ─── Regression: an implausibly distant reset ─────────────────────────────────

test('refuses to wait for a reset further ahead than the bound', () => {
  // Independent of how the classification was reached, so it still holds if the
  // run-boundary scoping fails for a reason we have not thought of. The real misfire
  // computed a reset ~19.5h out; a usage window is hours, not most of a day.
  const now = new Date('2026-08-20T09:00:00Z');
  const decision = decideWaitPolicy({
    classification: limitHit(new Date('2026-08-21T04:30:00Z')),
    waitEnabled: true,
    waitsTaken: 0,
    now,
  });

  assert.equal(decision.action, 'exit');
  assert.match(decision.reason, /further than the/);
});

test('a reset inside the bound is still waited for', () => {
  const now = new Date('2026-08-20T03:00:00Z');
  const decision = decideWaitPolicy({
    classification: limitHit(new Date('2026-08-20T04:30:00Z')),
    waitEnabled: true,
    waitsTaken: 0,
    now,
  });

  assert.equal(decision.action, 'wait');
});

test('the wait bound is six hours', () => {
  assert.equal(MAX_WAIT_MS, 6 * 60 * 60 * 1000);
});

// ─── Reporting a wait ─────────────────────────────────────────────────────────

test('durations read in hours and minutes', () => {
  assert.equal(formatDuration(19.42 * 3600000), '19h 25m');
  assert.equal(formatDuration(45 * 60000), '45m');
  assert.equal(formatDuration(2 * 3600000), '2h 0m');
  assert.equal(formatDuration(-5000), '0m');
});

test('a wait window is shown in the operator timezone with its duration', () => {
  const window = formatWaitWindow(
    new Date('2026-08-21T04:30:00Z'),
    new Date('2026-08-20T09:05:00Z'),
    'Australia/Sydney',
  );

  // The same instant is 2:30 pm the next day in AEST. Printing it as UTC is what
  // made a nineteen-hour park look unremarkable.
  assert.match(window, /2:30 pm/);
  assert.match(window, /in 19h 25m/);
});

test('the duration makes an implausible wait obvious', () => {
  const short = formatWaitWindow(
    new Date('2026-08-20T04:30:00Z'),
    new Date('2026-08-20T03:00:00Z'),
    'Australia/Sydney',
  );

  assert.match(short, /in 1h 30m/);
});

// ─── Maintainer notes ─────────────────────────────────────────────────────────

test('a comment without the marker is not a maintainer note', () => {
  // The orchestrator posts its own comments on these issues. Replaying an unblock
  // notice or a Pipeline Incident back to an agent is noise at best.
  const notes = extractMaintainerNotes([
    { body: 'Unblocked: every blocker is now closed.' },
    { body: '## Pipeline Incident\n\nTestReviewer hit the retry cap.' },
    { body: 'lgtm' },
  ]);

  assert.deepEqual(notes, []);
});

test('text under the marker is taken and preamble above it is dropped', () => {
  const notes = extractMaintainerNotes([
    {
      body: [
        'Had a look at the checkpoint this morning.',
        '',
        MAINTAINER_NOTE_MARKER,
        '',
        'The CID linkage assertion cannot fail — rewrite it.',
      ].join('\n'),
    },
  ]);

  assert.deepEqual(notes, [
    'The CID linkage assertion cannot fail — rewrite it.',
  ]);
});

test('the marker is matched case-insensitively', () => {
  // Failing silently on capitalisation is the worst outcome: the maintainer believes
  // the note was filed and the agent never sees it.
  const notes = extractMaintainerNotes([
    { body: '## maintainer review\n\nlowercase still counts' },
  ]);

  assert.deepEqual(notes, ['lowercase still counts']);
});

test('an empty note is not carried', () => {
  const notes = extractMaintainerNotes([
    { body: `${MAINTAINER_NOTE_MARKER}\n\n   ` },
  ]);
  assert.deepEqual(notes, []);
});

test('notes keep the order they were filed and survive multi-line bodies', () => {
  const notes = extractMaintainerNotes([
    { body: `${MAINTAINER_NOTE_MARKER}\nfirst` },
    { body: 'unrelated' },
    { body: `${MAINTAINER_NOTE_MARKER}\nsecond\n\n- with a list` },
  ]);

  assert.deepEqual(notes, ['first', 'second\n\n- with a list']);
});

test('extraction tolerates missing or malformed comment payloads', () => {
  assert.deepEqual(extractMaintainerNotes(undefined), []);
  assert.deepEqual(extractMaintainerNotes([]), []);
  assert.deepEqual(extractMaintainerNotes([null, {}, { body: null }]), []);
});

test('a prompt with no notes is returned untouched', () => {
  assert.equal(withMaintainerNotes('BASE PROMPT', []), 'BASE PROMPT');
  assert.equal(withMaintainerNotes('BASE PROMPT', undefined), 'BASE PROMPT');
});

test('notes are appended after the issue body and declared binding', () => {
  // Regression: #396 was dispatched three times while three reviewed findings sat in
  // a comment the agent could not see, because only issue.body reached the prompt.
  const prompt = withMaintainerNotes('ORIGINAL BRIEF', [
    'Decide who owns the CID linkage invariant.',
  ]);

  assert.ok(prompt.startsWith('ORIGINAL BRIEF'));
  assert.match(prompt, /Treat this as binding/);
  assert.match(prompt, /this wins/);
  assert.match(prompt, /Decide who owns the CID linkage invariant\./);
});

test('multiple notes are numbered so a prompt can reference one', () => {
  const prompt = withMaintainerNotes('BASE', ['first thing', 'second thing']);

  assert.match(prompt, /### Note 1/);
  assert.match(prompt, /### Note 2/);
  assert.match(prompt, /following instructions/);
});

// ─── Handoff carried between runs (ADR 0044) ──────────────────────────────────

const HANDOFF_LOG = [
  '--- Run started: 2026-08-22T07:43:49.210Z ---',
  'Agent started',
  'HANDOFF: ComponentBuilder -> ComponentReviewer PASS',
  'some unrelated chatter',
  'HANDOFF: /code-review PASS (2 findings addressed)',
  '--- Run started: 2026-08-22T13:08:32.187Z ---',
  'HANDOFF: TestRunner 47 passed',
  '  HANDOFF: gate FAILED (lint test build)',
].join('\n');

test('extractHandoff reads only the last run segment', () => {
  assert.deepEqual(extractHandoff(HANDOFF_LOG), [
    'TestRunner 47 passed',
    'gate FAILED (lint test build)',
  ]);
});

test('extractHandoff dedupes a marker the agent and orchestrator both logged', () => {
  const log = [
    '--- Run started: x ---',
    'HANDOFF: /code-review PASS',
    'HANDOFF: /code-review PASS',
  ].join('\n');
  assert.deepEqual(extractHandoff(log), ['/code-review PASS']);
});

test('extractHandoff caps how many markers travel', () => {
  const many = ['--- Run started: x ---']
    .concat(Array.from({ length: 60 }, (_, i) => `HANDOFF: step ${i}`))
    .join('\n');
  const extracted = extractHandoff(many, 5);
  assert.equal(extracted.length, 5);
  assert.equal(extracted.at(-1), 'step 59');
});

test('extractHandoff returns nothing for a log with no markers', () => {
  assert.deepEqual(extractHandoff('--- Run started: x ---\nplain output'), []);
});

test('a gate-failure resume does not claim the work is unchecked', () => {
  const brief = buildResumeBrief({
    basePrompt: 'BASE',
    issueNumber: 447,
    sliceBranch: 'slice/447-x',
    checkpoint: { sha: 'b6a0e84', files: ['a.tsx'] },
    kind: PRIOR_RUN_KINDS.gateFailure,
  });
  assert.match(brief, /BUILD GATE failure/);
  assert.ok(!brief.includes('--no-verify'));
  assert.ok(!brief.includes('never once seen it'));
  for (const guardrail of GATE_FAILURE_GUARDRAILS) {
    assert.ok(brief.includes(guardrail));
  }
});

test('an interrupted resume keeps the original unchecked-work guardrails', () => {
  const brief = buildResumeBrief({
    basePrompt: 'BASE',
    issueNumber: 396,
    sliceBranch: 'slice/396-x',
    checkpoint: { sha: 'deadbee', files: ['a.ts'] },
  });
  assert.match(brief, /RESUMING an interrupted attempt/);
  for (const guardrail of INTERRUPTED_GUARDRAILS) {
    assert.ok(brief.includes(guardrail));
  }
});

test('handoff lines reach the brief as evidence, not authority', () => {
  const brief = buildResumeBrief({
    basePrompt: 'BASE',
    issueNumber: 447,
    sliceBranch: 'slice/447-x',
    checkpoint: { sha: 'b6a0e84', files: ['a.tsx'] },
    kind: PRIOR_RUN_KINDS.gateFailure,
    handoff: ['/code-review PASS', 'gate FAILED (lint test build)'],
  });
  assert.match(brief, /What the previous run reported/);
  assert.match(brief, /EVIDENCE, not proof/);
  assert.ok(brief.includes('  - /code-review PASS'));
});

test('an absent handoff adds no section at all', () => {
  const brief = buildResumeBrief({
    basePrompt: 'BASE',
    issueNumber: 447,
    sliceBranch: 'slice/447-x',
    checkpoint: { sha: 'b6a0e84', files: ['a.tsx'] },
    handoff: [],
  });
  assert.ok(!brief.includes('What the previous run reported'));
});

test('resumeGuardrails swaps only the last two entries', () => {
  const interrupted = resumeGuardrails(PRIOR_RUN_KINDS.interrupted);
  const gate = resumeGuardrails(PRIOR_RUN_KINDS.gateFailure);
  assert.equal(interrupted.length, 6);
  assert.equal(gate.length, 6);
  assert.deepEqual(interrupted.slice(0, 4), gate.slice(0, 4));
  assert.notDeepEqual(interrupted.slice(4), gate.slice(4));
});

test('RESUME_GUARDRAILS stays the interrupted set for existing callers', () => {
  assert.deepEqual(
    RESUME_GUARDRAILS,
    resumeGuardrails(PRIOR_RUN_KINDS.interrupted),
  );
});
