import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  REQUIRED_OUTPUTS,
  classifyReviewerRun,
  main,
  refusedOutputPath,
} from './classify-reviewer-run.ts';
import type { ReviewerRunClassification } from './classify-reviewer-run.ts';

const FIXTURES = new URL('./fixtures/reviewer-runs/', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, FIXTURES), 'utf8');
const classify = (events: unknown) =>
  classifyReviewerRun(JSON.stringify(events));
const errors = ({ annotations }: ReviewerRunClassification) =>
  annotations.filter((a) => a.level === 'error').map((a) => a.message);

const WORKSPACE = '/home/runner/work/myorganiser/myorganiser';
const result = (fields: Record<string, unknown>) => ({
  type: 'result',
  subtype: 'success',
  ...fields,
});
const denied = (tool_name: string, file_path: string) => ({
  tool_name,
  tool_input: { file_path },
});

test('a run that ended in success but was refused a write to its report is prevented (issue #880)', () => {
  const run = classifyReviewerRun(
    fixture('success-write-denied-absolute.json'),
  );
  assert.deepEqual(run.outputs, {
    total_cost_usd: '1.25',
    turns: '49',
    rate_limited: 'false',
    turn_exhausted: 'false',
    prevented: 'true',
  });
  const [message] = errors(run);
  assert.match(message, /refused a write to its own required output/);
  assert.match(message, /tmp\/code-review\/report\.json/);
  assert.match(message, /tmp\/code-review\/obligations\.answers\.json/);
  assert.doesNotMatch(message, /_permtest/, 'a probe file is not an output');
  assert.match(message, /\(2 refusal\(s\)\)/);
});

test('a refused output written as a relative path is prevented too', () => {
  const run = classifyReviewerRun(
    fixture('success-write-denied-relative.json'),
  );
  assert.equal(run.outputs.prevented, 'true');
  assert.equal(run.outputs.turn_exhausted, 'false');
});

test('a run that ended in success with only Bash and scratch-file denials is not prevented', () => {
  const run = classifyReviewerRun(fixture('success-bash-denials-only.json'));
  assert.equal(run.outputs.prevented, 'false');
  assert.equal(run.outputs.turn_exhausted, 'false');
  assert.deepEqual(run.annotations, []);
});

test('the turn ceiling with permission denials is prevented, as before', () => {
  const run = classifyReviewerRun(fixture('max-turns-with-denials.json'));
  assert.equal(run.outputs.turn_exhausted, 'true');
  assert.equal(run.outputs.prevented, 'true');
  assert.equal(run.outputs.turns, '81');
  assert.match(
    errors(run)[0],
    /turn ceiling after 81 turn\(s\) with 2 permission denial\(s\)/,
  );
  assert.match(
    errors(run)[1],
    /prevented by the apparatus, not by a hard case/,
  );
});

test('the turn ceiling with no denial is exhausted but not prevented', () => {
  const run = classify([result({ subtype: 'error_max_turns', num_turns: 80 })]);
  assert.equal(run.outputs.turn_exhausted, 'true');
  assert.equal(run.outputs.prevented, 'false');
});

test('the turn-ceiling ground reads only the transcript count, as before', () => {
  const run = classify([
    result({
      subtype: 'error_max_turns',
      num_turns: 80,
      permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'x' } }],
    }),
  ]);
  assert.equal(run.outputs.turn_exhausted, 'true');
  assert.equal(run.outputs.prevented, 'false');
});

test('refusedOutputPath matches every required output in both path forms and nothing else', () => {
  const outputs = REQUIRED_OUTPUTS.map((output) =>
    output.replace('<head>', '5aaa40b3'),
  );
  assert.equal(outputs.length, 3);
  for (const output of outputs) {
    for (const tool of ['Write', 'Edit']) {
      assert.equal(refusedOutputPath(denied(tool, output)), output);
      assert.equal(
        refusedOutputPath(denied(tool, `./${output}`)),
        `./${output}`,
      );
      assert.equal(
        refusedOutputPath(denied(tool, `${WORKSPACE}/${output}`)),
        `${WORKSPACE}/${output}`,
      );
    }
  }
  const notOutputs = [
    denied('Write', `${WORKSPACE}/tmp/code-review/scratch.mjs`),
    denied('Write', `${WORKSPACE}/tmp/code-review/_permtest.json`),
    denied('Write', `${WORKSPACE}/tmp/code-review/myreport.json`),
    denied('Write', `${WORKSPACE}/tmp/code-review/worktree/x/report.json`),
    denied('Write', `${WORKSPACE}/report.json`),
    denied('Write', `${WORKSPACE}/not-tmp/code-review/report.json`),
    denied('Read', `${WORKSPACE}/tmp/code-review/report.json`),
    {
      tool_name: 'Bash',
      tool_input: { command: 'cat tmp/code-review/report.json' },
    },
    { tool_name: 'Write' },
    null,
  ];
  for (const denial of notOutputs) {
    assert.equal(refusedOutputPath(denial), null, JSON.stringify(denial));
  }
});

test("a refused write to the skill's interactive report name is prevented, because the action accepts that name", () => {
  const run = classify([
    result({
      permission_denials: [
        denied('Write', `${WORKSPACE}/tmp/code-review/5aaa40b3.report.json`),
      ],
    }),
  ]);
  assert.equal(run.outputs.prevented, 'true');
});

test('a rejected rate-limit event is a lockout, and names the window', () => {
  const run = classify([
    {
      type: 'rate_limit_event',
      rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' },
    },
    result({ num_turns: 3 }),
  ]);
  assert.equal(run.outputs.rate_limited, 'true');
  assert.match(errors(run)[0], /five_hour rate limit after 3 turn\(s\)/);
});

test('a transcript that cannot be read is unknown, never "not rate limited"', () => {
  for (const text of ['', 'not json', '{"type":"result"}', '"a string"']) {
    const run = classifyReviewerRun(text);
    assert.deepEqual(run.outputs, {
      total_cost_usd: '',
      turns: '',
      rate_limited: 'unknown',
    });
    assert.equal(run.annotations[0].level, 'warning');
  }
});

test('accounting that is not a number is left empty rather than passed through', () => {
  const run = classify([
    result({ num_turns: '5\nprevented=true', total_cost_usd: null }),
  ]);
  assert.equal(run.outputs.turns, '');
  assert.equal(run.outputs.total_cost_usd, '');
});

test('main appends the outputs to GITHUB_OUTPUT and escapes a refused path in its annotation', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'classify-reviewer-run-'));
  const out = join(dir, 'github-output');
  const logged: string[] = [];
  t.mock.method(console, 'log', (line: string) => logged.push(line));

  const file = new URL('success-write-denied-absolute.json', FIXTURES).pathname;
  main([file], { GITHUB_OUTPUT: out });
  assert.equal(
    readFileSync(out, 'utf8'),
    'total_cost_usd=1.25\nturns=49\nrate_limited=false\nturn_exhausted=false\nprevented=true\n',
  );
  assert.ok(logged[0].startsWith('::error::the reviewer was refused a write'));

  main([join(dir, 'missing.json')], { GITHUB_OUTPUT: out });
  assert.match(readFileSync(out, 'utf8'), /rate_limited=unknown\n$/);
});

test('a newline in a refused path cannot start a second workflow command', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'classify-reviewer-run-'));
  const file = join(dir, 'run.json');
  const logged: string[] = [];
  t.mock.method(console, 'log', (line: string) => logged.push(line));
  const path = `x\n::warning::injected\n/tmp/code-review/report.json`;
  const text = JSON.stringify([
    result({ permission_denials: [denied('Write', path)] }),
  ]);
  writeFileSync(file, text);
  main([file], {});
  assert.equal(logged[0].split('\n').length, 1);
  assert.match(logged[0], /%0A::warning::injected%0A/);
});
