/**
 * Run with: yarn nightly-e2e:rot:test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ROT_ISSUE_CREATE_LABELS,
  ROT_ISSUE_TITLE,
  TRIAGE_STATE_LABELS,
  findOpenRotIssue,
  recoveryAction,
  recoveryComment,
} from './nightly-e2e-rot-issue.ts';

const WORKFLOW = readFileSync('.github/workflows/nightly-e2e.yml', 'utf8');

const jobBlock = (source: string, jobId: string): string => {
  const jobsAt = source.search(/^jobs:\s*$/m);
  assert.notEqual(jobsAt, -1, 'workflow has no jobs:');
  const body = source.slice(jobsAt);
  const start = body.search(new RegExp(`^ {2}${jobId}:\\s*$`, 'm'));
  assert.notEqual(start, -1, `no job named ${jobId}`);
  const rest = body.slice(start + 1);
  const next = rest.search(/^ {2}[a-z0-9][a-z0-9-]*:\s*$/m);
  return next === -1 ? rest : rest.slice(0, next);
};

test('triage state labels are the triage skill state roles', () => {
  assert.deepEqual(TRIAGE_STATE_LABELS, [
    'needs-triage',
    'needs-info',
    'ready-for-agent',
    'ready-for-human',
    'wontfix',
  ]);
});

test('a rot issue with no triage state label closes on recovery', () => {
  assert.equal(recoveryAction([]), 'close');
  assert.equal(recoveryAction(undefined), 'close');
  assert.equal(recoveryAction([{ name: 'github-actions' }]), 'close');
  assert.equal(recoveryAction(['bug', 'tooling']), 'close');
  assert.equal(recoveryAction([{ name: 'bug' }, 'github-actions']), 'close');
});

test('each triage state label keeps the rot issue open', () => {
  for (const name of TRIAGE_STATE_LABELS) {
    assert.equal(recoveryAction([{ name }]), 'comment', name);
    assert.equal(recoveryAction([name, 'github-actions']), 'comment', name);
  }
});

test('a newly created rot issue stays open on the next green nightly', () => {
  assert.deepEqual(ROT_ISSUE_CREATE_LABELS, ['needs-triage', 'github-actions']);
  assert.equal(
    recoveryAction(ROT_ISSUE_CREATE_LABELS.map((name) => ({ name }))),
    'comment',
  );
});

test('findOpenRotIssue matches the fixed title and skips pull requests', () => {
  const issues = [
    { title: 'something else', state: 'open' },
    { title: ROT_ISSUE_TITLE, state: 'open', pull_request: {} },
    { title: ROT_ISSUE_TITLE, state: 'closed' },
    { title: ROT_ISSUE_TITLE, state: 'open', number: 858 },
  ];
  assert.equal(findOpenRotIssue(issues)?.number, 858);
  assert.equal(findOpenRotIssue([]), undefined);
});

test('the recovery comment names the green run', () => {
  const runUrl = 'https://github.com/mnaimfaizy/myorganiser/actions/runs/1';
  const closed = recoveryComment({
    action: 'close',
    runUrl,
    date: '2026-09-23',
  });
  const commented = recoveryComment({
    action: 'comment',
    runUrl,
    date: '2026-09-23',
  });
  assert.match(closed, new RegExp(runUrl));
  assert.match(commented, new RegExp(runUrl));
  assert.match(closed, /closes it/);
  assert.match(commented, /stays open/);
  assert.doesNotMatch(commented, /closes it/);
});

test('Report Success runs only on a scheduled success and can only write issues', () => {
  const job = jobBlock(WORKFLOW, 'report-success');
  const ifLine = job.match(/^ {4}if:.*$/m);
  assert.ok(ifLine, 'Report Success has no if:');
  assert.match(ifLine[0], /success\(\)/);
  assert.match(ifLine[0], /github\.event_name == 'schedule'/);
  assert.doesNotMatch(ifLine[0], /workflow_dispatch/);
  assert.match(job, /needs:\s*e2e/);
  assert.match(job, /issues: write/);
  assert.match(job, /contents: read/);
  assert.doesNotMatch(job, /contents: write/);
  assert.doesNotMatch(job, /pull-requests:/);
  assert.match(job, /nightly-e2e-rot-issue\.(?:mjs|ts)/);
  assert.match(job, /recoveryAction/);
  assert.match(job, /state: 'closed'/);
  assert.match(job, /state_reason: 'completed'/);
});

test('Report Failure still comments on the open issue and labels a new one', () => {
  const job = jobBlock(WORKFLOW, 'report-failure');
  const ifLine = job.match(/^ {4}if:.*$/m);
  assert.ok(ifLine, 'Report Failure has no if:');
  assert.match(ifLine[0], /failure\(\)/);
  assert.match(ifLine[0], /github\.event_name == 'schedule'/);
  assert.match(job, /issues: write/);
  assert.match(job, /contents: read/);
  assert.match(job, /findOpenRotIssue/);
  assert.match(job, /createComment/);
  assert.match(job, /ROT_ISSUE_CREATE_LABELS/);
  assert.match(job, /nightly-e2e-rot-issue\.(?:mjs|ts)/);
});
