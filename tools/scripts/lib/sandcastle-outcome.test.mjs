import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPLETION_PROMISE,
  formatHeldComment,
  judgeRunOutcome,
  lastIterationOutput,
  NEEDS_HUMAN_LABEL,
} from './sandcastle-outcome.mjs';

const run = (...lines) =>
  ['--- Run started: 2026-09-29T01:23:27.947Z ---', ...lines].join('\n');

test('a run that completed with nothing outstanding and a passing review is clean', () => {
  const log = run(
    'Iteration 1/2',
    'HANDOFF: /code-review PASS (2 findings addressed)',
    'HANDOFF: committed abc1234 via Commit sub-agent',
    COMPLETION_PROMISE,
  );
  assert.deepEqual(judgeRunOutcome(log), { clean: true, outstanding: [] });
});

test('a run that never signalled completion is held', () => {
  const { clean, outstanding } = judgeRunOutcome(
    run('Iteration 1/2', 'HANDOFF: /code-review PASS'),
  );
  assert.equal(clean, false);
  assert.match(outstanding[0], /did not signal completion/);
});

test('every OUTSTANDING line is an item, in order, including list and bold forms', () => {
  const { clean, outstanding } = judgeRunOutcome(
    run(
      'Iteration 1/2',
      'OUTSTANDING: keep-awake is not wired; needs a native module',
      '- OUTSTANDING: "Show done" on device is unverified',
      '**OUTSTANDING:** the canvas link could not be opened from the sandbox',
      COMPLETION_PROMISE,
    ),
  );
  assert.equal(clean, false);
  assert.deepEqual(outstanding, [
    'keep-awake is not wired; needs a native module',
    '"Show done" on device is unverified',
    'the canvas link could not be opened from the sandbox',
  ]);
});

test('"OUTSTANDING: none" is not an item', () => {
  const result = judgeRunOutcome(
    run(
      'Iteration 1/2',
      'OUTSTANDING: none',
      'OUTSTANDING:',
      COMPLETION_PROMISE,
    ),
  );
  assert.deepEqual(result, { clean: true, outstanding: [] });
});

// #1326 printed this line, every criterion met, and was held for a person.
test('a "none" followed by its justification is not an item', () => {
  const result = judgeRunOutcome(
    run(
      'Iteration 1/2',
      'OUTSTANDING: none — all acceptance criteria verified directly (four suites wired in CI, `gates:coverage:check` green), both code-review findings fixed and re-verified, and the working tree is clean.',
      'OUTSTANDING: None. Every criterion was checked.',
      'OUTSTANDING: nothing: the review passed',
      '- OUTSTANDING: n/a (docs-only slice)',
      'OUTSTANDING: none - all green',
      COMPLETION_PROMISE,
    ),
  );
  assert.deepEqual(result, { clean: true, outstanding: [] });
});

test('a "none" whose reason carves out an exception is an item', () => {
  const { clean, outstanding } = judgeRunOutcome(
    run(
      'Iteration 1/2',
      'OUTSTANDING: none — except the device check, which needs a phone',
      'OUTSTANDING: none, but the Husky selection is unverified',
      'OUTSTANDING: nothing: the CI step could not be run here',
      COMPLETION_PROMISE,
    ),
  );
  assert.equal(clean, false);
  assert.deepEqual(outstanding, [
    'none — except the device check, which needs a phone',
    'none, but the Husky selection is unverified',
    'nothing: the CI step could not be run here',
  ]);
});

test('"none" running straight into its sentence is an item', () => {
  const { clean, outstanding } = judgeRunOutcome(
    run(
      'Iteration 1/2',
      'OUTSTANDING: none of the device checks ran in the sandbox',
      COMPLETION_PROMISE,
    ),
  );
  assert.equal(clean, false);
  assert.deepEqual(outstanding, [
    'none of the device checks ran in the sandbox',
  ]);
});

test('the marker counts only at the start of a line, not quoted in narration', () => {
  const result = judgeRunOutcome(
    run(
      'Iteration 1/2',
      'I checked for OUTSTANDING: items and found none to report.',
      COMPLETION_PROMISE,
    ),
  );
  assert.deepEqual(result, { clean: true, outstanding: [] });
});

// #913 left a blocking finding open and printed the completion promise anyway;
// it was closed as completed. Under the outcome contract that finding is an
// OUTSTANDING line, and the slice is held.
test('an unresolved blocking finding listed as OUTSTANDING holds the slice after COMPLETE', () => {
  const { clean, outstanding } = judgeRunOutcome(
    run(
      'Iteration 1/2',
      'HANDOFF: /code-review request-changes (10 findings: 1 blocking, 7 should-fix, 2 nits)',
      'OUTSTANDING: blocking — the trip view never keeps the screen awake',
      COMPLETION_PROMISE,
    ),
  );
  assert.equal(clean, false);
  assert.deepEqual(outstanding, [
    'blocking — the trip view never keeps the screen awake',
  ]);
});

// The review runs once, before its findings are fixed, so its verdict is
// request-changes on a slice that then fixed everything (#912). The verdict is
// not the signal; what the agent lists afterwards is.
test('a request-changes review whose findings were all fixed does not hold the slice', () => {
  const log = run(
    'Iteration 1/2',
    'HANDOFF: /code-review request-changes (10 findings: 2 blocking + 8 should-fix, all addressed)',
    'HANDOFF: committed abc1234 via Commit sub-agent',
    COMPLETION_PROMISE,
  );
  assert.deepEqual(judgeRunOutcome(log), { clean: true, outstanding: [] });
});

// #909's first iteration wrote its caveat and never completed; the second, a cold
// restart, completed. What the branch was left as is the second one's account.
test('only the last iteration of the last run is judged', () => {
  const log = [
    run('Iteration 1/2', 'OUTSTANDING: an old run left this'),
    run(
      'Iteration 1/2',
      'OUTSTANDING: role values were derived, not read from the sheet',
      'Iteration 2/2',
      COMPLETION_PROMISE,
    ),
  ].join('\n');
  assert.deepEqual(judgeRunOutcome(log), { clean: true, outstanding: [] });
  assert.doesNotMatch(lastIterationOutput(log), /derived/);
});

test('a repeated item is listed once', () => {
  const { outstanding } = judgeRunOutcome(
    run(
      'Iteration 1/2',
      'OUTSTANDING: device QA pending',
      'OUTSTANDING: device QA pending',
      COMPLETION_PROMISE,
    ),
  );
  assert.deepEqual(outstanding, ['device QA pending']);
});

test('an empty or missing log is held, never clean', () => {
  assert.equal(judgeRunOutcome('').clean, false);
  assert.equal(judgeRunOutcome(undefined).clean, false);
});

test('the held comment names the label, the branch, and every item', () => {
  const body = formatHeldComment({
    outstanding: ['keep-awake not wired', 'device QA pending'],
    integrationBranch: 'feat/mobile-v1',
    commits: 3,
  });
  assert.match(body, /3 commit\(s\)/);
  assert.match(body, /`feat\/mobile-v1`/);
  assert.match(body, new RegExp(NEEDS_HUMAN_LABEL));
  assert.match(body, /^- keep-awake not wired$/m);
  assert.match(body, /^- device QA pending$/m);
});
