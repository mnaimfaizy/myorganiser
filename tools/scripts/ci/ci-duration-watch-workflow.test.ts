// Contract Suite for the weekly PR CI duration watch (PRD #1387, issue #1393):
// the pr-ci-duration-watch.yml workflow, the package script it documents, and
// the gate-coverage opt-out that says the measure is deliberately not a gate.
// The defects worth catching are a token that can do more than open one issue,
// a pull request trigger that hands a fork a write token, a title copied into
// YAML where it can drift from the module that owns it, a recovery path that is
// named but not called, an output file renamed on one side only, a cron that
// stops being weekly, and an install step added back to a job that needs none.
// The workflow is sliced as text, the same way the other workflow Contract
// Suites slice it, so these assertions are about the file as written.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { escapeRegExp, jobBlock, stepNamed } from '../lib/workflow-yaml.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const WORKFLOW_TEXT = readFileSync(
  join(REPO_ROOT, '.github/workflows/pr-ci-duration-watch.yml'),
  'utf8',
);

/** Lines that are not YAML comments, so a comment cannot satisfy or trip an assertion. */
const uncommented = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

const WORKFLOW = uncommented(WORKFLOW_TEXT);

/** The lines of a top-level block, from its `key:` line to the next column-0 key. */
function topLevel(text: string, key: string): string {
  const lines = text.split('\n');
  const at = lines.findIndex((line) =>
    new RegExp(`^${escapeRegExp(key)}:`).test(line),
  );
  if (at === -1) throw new Error(`no top-level ${key}: block`);
  const body = [lines[at]];
  for (const line of lines.slice(at + 1)) {
    if (line !== '' && !/^\s/.test(line)) break;
    body.push(line);
  }
  return body.join('\n');
}

/** The `key: value` pairs of a permissions block, as `key: value` strings. */
const permissionsOf = (block: string): string[] =>
  block
    .split('\n')
    .map((line) => /^\s+([a-z-]+: [a-z]+)$/.exec(line)?.[1])
    .filter((pair): pair is string => pair !== undefined)
    .sort();

const ON = topLevel(WORKFLOW, 'on');
const PERMISSIONS = topLevel(WORKFLOW, 'permissions');
const WATCH = jobBlock(WORKFLOW, 'watch');
const MEASURE_STEP = stepNamed(WATCH, 'Measure PR CI duration');
const REPORT_STEP = stepNamed(WATCH, 'Report through the watch issue');

test('the watch is scheduled weekly, on Monday, as written', () => {
  const cron = /^\s*- cron: '([^']+)'$/m.exec(ON)?.[1];
  assert.ok(cron, 'the schedule has no cron line');
  assert.equal(cron, '23 9 * * 1');
  const dayOfWeek = cron.split(' ')[4];
  assert.match(dayOfWeek, /^\d$/, 'the day-of-week field is one day, not *');
});

test('the watch can also be run on demand', () => {
  assert.match(ON, /^ {2}workflow_dispatch:/m);
});

test('the watch has no pull request trigger, so a fork never gets its token', () => {
  assert.doesNotMatch(ON, /pull_request/);
  assert.doesNotMatch(WORKFLOW, /pull_request_target/);
});

test('the token is exactly the top-level read grants plus issues write, with no override', () => {
  assert.deepEqual(permissionsOf(PERMISSIONS), [
    'actions: read',
    'contents: read',
    'issues: write',
  ]);
  // One permissions key: a job-level block would override the grant above.
  assert.equal((WORKFLOW.match(/^\s*permissions:/gm) ?? []).length, 1);
  assert.doesNotMatch(WORKFLOW, /write-all|read-all/);
  const writes = WORKFLOW.split('\n')
    .filter((line) => /:\s*write$/.test(line))
    .map((line) => line.trim());
  assert.deepEqual(writes, ['issues: write']);
  for (const grant of [
    'contents: write',
    'pull-requests: write',
    'packages:',
    'id-token:',
    'deployments:',
  ]) {
    assert.doesNotMatch(WORKFLOW, new RegExp(escapeRegExp(grant)), grant);
  }
});

test('the watch job pins its runner image', () => {
  assert.match(WATCH, /^ {4}runs-on: ubuntu-24\.04\s*$/m);
});

test('the measure step runs the measure script directly, with the outputs the report reads', () => {
  // The step's run is a block scalar, which runOf does not read, so the step
  // text is asserted directly.
  assert.match(
    MEASURE_STEP,
    /node tools\/scripts\/ci\/measure-ci-duration\.ts/,
  );
  assert.match(MEASURE_STEP, /--out ci-duration\.md/);
  assert.match(MEASURE_STEP, /--json ci-duration\.json/);
  // The report step reads the JSON the measure step writes, so a rename on
  // either side must fail here.
  assert.match(REPORT_STEP, /readFileSync\('ci-duration\.json'/);
});

test('the workflow command and the package script name the same measure file', () => {
  const stepPath = /node (tools\/\S+\.ts)/.exec(MEASURE_STEP)?.[1];
  assert.ok(stepPath, 'the measure step names no script path');
  const pkg = JSON.parse(
    readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
  ) as {
    scripts?: Record<string, string>;
  };
  const script = pkg.scripts?.['ci:duration:measure'];
  assert.ok(script, 'package.json has no ci:duration:measure script');
  const scriptPath = /node (tools\/\S+\.ts)/.exec(script)?.[1];
  assert.equal(stepPath, scriptPath);
});

test('the watch installs nothing and enables no Corepack, which is why it is cheap', () => {
  // Every package-manager entry point, not two literal phrases: a bare
  // `yarn` installs under Berry, `npm ci` installs without saying "install",
  // and `corepack  enable` with two spaces is the same step. The measure's
  // import graph is Node built-ins and repo-local modules, so the whole
  // family belongs out of this workflow.
  assert.doesNotMatch(WORKFLOW, /\b(yarn|npm|pnpm|npx|bun|corepack)\b/);
});

test('the report step imports the watch module, and the title lives only there', () => {
  assert.match(REPORT_STEP, /tools\/scripts\/lib\/ci-duration-watch-issue\.ts/);
  // Whole source, comments included: a copy of the title anywhere in the
  // YAML is the drift the module exists to prevent.
  assert.doesNotMatch(WORKFLOW_TEXT, /PR CI is over its five-minute target/);
  assert.doesNotMatch(WORKFLOW_TEXT, /\[automation\]/);
});

test('the report step names the five functions it uses', () => {
  for (const name of [
    'breachReport',
    'recoveryComment',
    'watchAction',
    'lastReportedState',
    'findOpenWatchIssue',
  ]) {
    assert.match(REPORT_STEP, new RegExp(`\\b${name}\\b`), name);
  }
});

test('the report step calls the recovery path: gate, comment and close', () => {
  // Naming a function is not wiring it. Each call site is asserted.
  assert.match(REPORT_STEP, /recoveryComment\(\{/);
  assert.match(REPORT_STEP, /recoveryAction\(/);
  assert.match(REPORT_STEP, /lastReportedState\(/);
  // The recovery returns early once a recovery is already on the issue.
  assert.match(
    REPORT_STEP,
    /if \(lastReportedState\(\{[^}]*\}\) === 'recovered'\)/,
  );
  // The recovery body is the comment the recovery posts.
  assert.match(
    REPORT_STEP,
    /issues\.createComment\(\{(?:(?!\}\);)[\s\S])*?body: recoveryComment\(\{/,
  );
  assert.match(REPORT_STEP, /issues\.update\(\{[\s\S]*?state: 'closed'/);
});

test('package.json defines ci:duration:measure over the measure script', () => {
  const pkg = JSON.parse(
    readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };
  const script = pkg.scripts?.['ci:duration:measure'];
  assert.ok(script, 'package.json has no ci:duration:measure script');
  assert.match(script, /tools\/scripts\/ci\/measure-ci-duration\.ts/);
});

test('the gate-coverage opt-out records a written reason for the measure', () => {
  const optOut = JSON.parse(
    readFileSync(
      join(REPO_ROOT, 'tools/config/gate-coverage-optout.json'),
      'utf8',
    ),
  ) as { optOut: { check?: string; reason?: string }[] };
  const entry = optOut.optOut.find(
    (item) => item.check === 'ci:duration:measure',
  );
  assert.ok(entry, 'no opt-out entry for ci:duration:measure');
  assert.ok(entry.reason?.trim(), 'the opt-out entry needs a non-empty reason');
});
