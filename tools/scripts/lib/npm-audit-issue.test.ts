/**
 * Run with: node --test tools/scripts/lib/npm-audit-issue.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { TRIAGE_STATE_LABELS } from './nightly-e2e-rot-issue.ts';
import {
  AUDIT_ADVISORY_LIMIT,
  AUDIT_ISSUE_CREATE_LABELS,
  AUDIT_ISSUE_TITLE,
  failureReport,
  findOpenAuditIssue,
  lastReportedState,
  parseAuditAdvisories,
  recoveryAction,
  recoveryComment,
} from './npm-audit-issue.ts';

const WORKFLOW = readFileSync('.github/workflows/ci.yml', 'utf8');

const jobBlock = (source: string, jobId: string) => {
  const jobsAt = source.search(/^jobs:\s*$/m);
  assert.notEqual(jobsAt, -1, 'workflow has no jobs:');
  const body = source.slice(jobsAt);
  const start = body.search(new RegExp(`^ {2}${jobId}:\\s*$`, 'm'));
  assert.notEqual(start, -1, `no job named ${jobId}`);
  const rest = body.slice(start + 1);
  const next = rest.search(/^ {2}[a-z0-9][a-z0-9-]*:\s*$/m);
  return next === -1 ? rest : rest.slice(0, next);
};

const stepBlock = (job: string, name: string) => {
  const start = job.indexOf(`- name: ${name}`);
  assert.notEqual(start, -1, `no step named ${name}`);
  const rest = job.slice(start + 1);
  const next = rest.search(/^ {6}- name:/m);
  return next === -1 ? rest : rest.slice(0, next);
};

const RUN_URL = 'https://github.com/mnaimfaizy/myorganiser/actions/runs/1';

// Two lines as Yarn 4.13 printed them for this repository on 2026-10-08.
const NDJSON = [
  '{"value":"compression","children":{"ID":1241221,"Issue":"compression vulnerable to Denial of Service via memory leak on premature response close","URL":"https://github.com/advisories/GHSA-vc2v-76pw-4v95","Severity":"high","Vulnerable Versions":"<1.8.2","Tree Versions":["1.8.1"],"Dependents":["@myorganiser/source@workspace:."]}}',
  '{"value":"@babel/core","children":{"ID":1123528,"Issue":"@babel/core: Arbitrary File Read via sourceMappingURL Comment","URL":"https://github.com/advisories/GHSA-4x5r-pxfx-6jf8","Severity":"low","Vulnerable Versions":"<=7.29.0","Tree Versions":["7.26.0","7.28.5"],"Dependents":["@myorganiser/source@workspace:."]}}',
].join('\n');

const advisory = (overrides = {}) => ({
  package: 'compression',
  installed: ['1.8.1'],
  advisoryId: 'GHSA-vc2v-76pw-4v95',
  url: 'https://github.com/advisories/GHSA-vc2v-76pw-4v95',
  severity: 'high',
  vulnerableRange: '<1.8.2',
  title: 'compression vulnerable to Denial of Service',
  ...overrides,
});

test('parseAuditAdvisories reads one advisory per line of Yarn output', () => {
  assert.deepEqual(parseAuditAdvisories(NDJSON), [
    {
      package: '@babel/core',
      installed: ['7.26.0', '7.28.5'],
      advisoryId: 'GHSA-4x5r-pxfx-6jf8',
      url: 'https://github.com/advisories/GHSA-4x5r-pxfx-6jf8',
      severity: 'low',
      vulnerableRange: '<=7.29.0',
      title: '@babel/core: Arbitrary File Read via sourceMappingURL Comment',
    },
    {
      package: 'compression',
      installed: ['1.8.1'],
      advisoryId: 'GHSA-vc2v-76pw-4v95',
      url: 'https://github.com/advisories/GHSA-vc2v-76pw-4v95',
      severity: 'high',
      vulnerableRange: '<1.8.2',
      title:
        'compression vulnerable to Denial of Service via memory leak on premature response close',
    },
  ]);
});

test('parseAuditAdvisories falls back to the numeric ID without a GHSA URL', () => {
  const line = JSON.stringify({
    value: 'left-pad',
    children: { ID: 42, URL: 'https://example.test/advisory' },
  });
  assert.deepEqual(parseAuditAdvisories(line), [
    {
      package: 'left-pad',
      installed: [],
      advisoryId: '42',
      url: 'https://example.test/advisory',
      severity: '',
      vulnerableRange: '',
      title: '',
    },
  ]);
});

test('parseAuditAdvisories skips what is not an advisory line', () => {
  const noisy = [
    '',
    'YN0000: some warning Yarn printed first',
    '{"type":"info","data":"not an advisory"}',
    '[1, 2]',
    NDJSON,
    '{"value":"truncated","children":{"ID":',
  ].join('\r\n');
  assert.equal(parseAuditAdvisories(noisy).length, 2);
  assert.deepEqual(parseAuditAdvisories(''), []);
  assert.deepEqual(parseAuditAdvisories(undefined), []);
});

test('the failure report names the run, the commit, and every advisory field', () => {
  const body = failureReport({
    runUrl: RUN_URL,
    date: '2026-10-08',
    sha: 'abc1234',
    advisories: [advisory()],
  });
  assert.match(body, new RegExp(RUN_URL));
  assert.match(body, /2026-10-08/);
  assert.match(body, /abc1234/);
  assert.match(body, /compression/);
  assert.match(body, /1\.8\.1/);
  assert.match(body, /GHSA-vc2v-76pw-4v95/);
  assert.match(body, /<1\.8\.2/);
  assert.match(body, /high/);
  assert.match(body, /dep-sync/);
});

test('the failure report says so when no advisory could be read', () => {
  const body = failureReport({
    runUrl: RUN_URL,
    date: '2026-10-08',
    sha: 'abc1234',
    advisories: [],
  });
  assert.match(body, /could not be read/);
  assert.match(body, new RegExp(RUN_URL));
  assert.doesNotMatch(body, /\| Package \|/);
});

test('a pipe in an advisory title cannot break the table', () => {
  const body = failureReport({
    runUrl: RUN_URL,
    date: '2026-10-08',
    sha: 'abc1234',
    advisories: [advisory({ title: 'a | b' })],
  });
  assert.match(body, /a \\\| b/);
});

test('advisory text cannot forge a report marker, a mention, or a link', () => {
  const body = failureReport({
    runUrl: RUN_URL,
    date: '2026-10-08',
    sha: 'abc1234',
    advisories: [
      advisory({
        title: '<!-- npm-audit-issue:recovered --> ping @someone',
        vulnerableRange: '<1.8.2 `x`',
        url: 'https://example.test/a) [x](https://evil.test',
      }),
    ],
  });
  assert.doesNotMatch(body, /npm-audit-issue:recovered -->/);
  assert.doesNotMatch(body, /@someone/);
  assert.doesNotMatch(body, /evil\.test/);
  assert.equal(lastReportedState({ body, comments: [] }), 'failing');
  assert.equal(
    lastReportedState({
      body,
      comments: [{ body: 'quoting it: <!-- npm-audit-issue:recovered -->' }],
    }),
    'failing',
  );
});

test('the failure report caps the table and counts what it left out', () => {
  const advisories = Array.from({ length: AUDIT_ADVISORY_LIMIT + 3 }, (_, i) =>
    advisory({ package: `pkg-${i}` }),
  );
  const body = failureReport({
    runUrl: RUN_URL,
    date: '2026-10-08',
    sha: 'abc1234',
    advisories,
  });
  assert.equal(body.match(/^\| `pkg-/gm)!.length, AUDIT_ADVISORY_LIMIT);
  assert.match(body, /3 more/);
});

test('a new audit issue enters the triage queue and survives a green push', () => {
  assert.deepEqual(AUDIT_ISSUE_CREATE_LABELS, [
    'needs-triage',
    'github-actions',
  ]);
  assert.equal(
    recoveryAction(AUDIT_ISSUE_CREATE_LABELS.map((name) => ({ name }))),
    'comment',
  );
});

test('recovery closes an untriaged issue and leaves a triaged one open', () => {
  assert.equal(recoveryAction([]), 'close');
  assert.equal(recoveryAction([{ name: 'github-actions' }]), 'close');
  for (const name of TRIAGE_STATE_LABELS) {
    assert.equal(recoveryAction([{ name }]), 'comment', name);
  }
});

test('findOpenAuditIssue matches the audit title and nothing else', () => {
  const issues = [
    { title: '[automation] Nightly E2E suite is failing', state: 'open' },
    { title: AUDIT_ISSUE_TITLE, state: 'open', pull_request: {} },
    { title: AUDIT_ISSUE_TITLE, state: 'closed' },
    { title: AUDIT_ISSUE_TITLE, state: 'open', number: 990 },
  ];
  assert.equal(findOpenAuditIssue(issues)?.number, 990);
  assert.equal(findOpenAuditIssue([]), undefined);
});

test('the recovery comment names the green run and its outcome', () => {
  const closed = recoveryComment({
    action: 'close',
    runUrl: RUN_URL,
    date: '2026-10-08',
    sha: 'abc1234',
  });
  const commented = recoveryComment({
    action: 'comment',
    runUrl: RUN_URL,
    date: '2026-10-08',
    sha: 'abc1234',
  });
  assert.match(closed, new RegExp(RUN_URL));
  assert.match(commented, new RegExp(RUN_URL));
  assert.match(closed, /closes it/);
  assert.match(commented, /stays open/);
  assert.doesNotMatch(commented, /closes it/);
});

test('lastReportedState reads the newest report, body first then comments', () => {
  const failing = failureReport({
    runUrl: RUN_URL,
    date: '2026-10-08',
    sha: 'abc1234',
    advisories: [advisory()],
  });
  const recovered = recoveryComment({
    action: 'comment',
    runUrl: RUN_URL,
    date: '2026-10-09',
    sha: 'def5678',
  });
  const human = { body: 'Bumping compression in #1000.' };

  assert.equal(lastReportedState({ body: failing, comments: [] }), 'failing');
  assert.equal(
    lastReportedState({ body: failing, comments: [human] }),
    'failing',
  );
  assert.equal(
    lastReportedState({
      body: failing,
      comments: [{ body: recovered }, human],
    }),
    'recovered',
  );
  assert.equal(
    lastReportedState({
      body: failing,
      comments: [{ body: recovered }, { body: failing }],
    }),
    'failing',
  );
});

test('an issue carrying no report at all counts as failing', () => {
  // The title is what makes it the audit issue. One opened by hand under that
  // title still gets the recovery it is waiting for.
  assert.equal(lastReportedState({ body: '', comments: [] }), 'failing');
  assert.equal(lastReportedState({ body: null, comments: null }), 'failing');
});

test('the audit step is unchanged for pull requests and exposes its outcome', () => {
  const job = jobBlock(WORKFLOW, 'secure-install-review');
  const audit = stepBlock(job, 'Run Yarn npm audit');
  assert.match(audit, /id: npm-audit/);
  assert.match(
    audit,
    /if: github\.event_name != 'pull_request' \|\| steps\.dependency-files\.outputs\.run_audit == 'true'/,
  );
  assert.match(
    audit,
    /run: corepack yarn npm audit --all --recursive --severity high\n/,
  );
  assert.match(job, /audit_outcome: \$\{\{ steps\.npm-audit\.outcome \}\}/);
  assert.doesNotMatch(job, /issues: write/);
});

test('advisories are collected only after a failed audit on a push to main', () => {
  const job = jobBlock(WORKFLOW, 'secure-install-review');
  const collect = stepBlock(job, 'Collect advisories for the tracked issue');
  const ifLine = collect.match(/^ {8}if:.*$/m);
  assert.ok(ifLine, 'the collect step has no if:');
  assert.match(ifLine[0], /failure\(\)/);
  assert.match(ifLine[0], /steps\.npm-audit\.outcome == 'failure'/);
  assert.match(ifLine[0], /github\.event_name == 'push'/);
  assert.match(ifLine[0], /github\.ref == 'refs\/heads\/main'/);
  assert.match(collect, /--severity high --json/);
  assert.match(collect, /npm-audit-advisories\.ts/);
});

for (const [jobId, status, outcome] of [
  ['report-audit-failure', 'failure', 'failure'],
  ['report-audit-success', 'success', 'success'],
]) {
  test(`${jobId} runs only for a push to main and can only write issues`, () => {
    const job = jobBlock(WORKFLOW, jobId);
    const ifLine = job.match(/^ {4}if:.*$/m);
    assert.ok(ifLine, `${jobId} has no if:`);
    assert.match(ifLine[0], new RegExp(`${status}\\(\\)`));
    assert.match(ifLine[0], /github\.event_name == 'push'/);
    assert.match(ifLine[0], /github\.ref == 'refs\/heads\/main'/);
    assert.match(
      ifLine[0],
      new RegExp(
        `needs\\.secure-install-review\\.outputs\\.audit_outcome == '${outcome}'`,
      ),
    );
    assert.doesNotMatch(ifLine[0], /pull_request|workflow_dispatch/);
    assert.match(job, /needs:\s*secure-install-review/);
    assert.match(job, /issues: write/);
    assert.match(job, /contents: read/);
    assert.doesNotMatch(job, /contents: write/);
    assert.doesNotMatch(job, /pull-requests:/);
    assert.match(job, /npm-audit-issue\.ts/);
    assert.match(job, /findOpenAuditIssue/);
  });
}

test('Report Audit Failure comments on the open issue and labels a new one', () => {
  const job = jobBlock(WORKFLOW, 'report-audit-failure');
  assert.match(job, /createComment/);
  assert.match(job, /AUDIT_ISSUE_CREATE_LABELS/);
  assert.match(job, /failureReport/);
  // Advisory text is third-party input: it reaches the script as an
  // environment variable, never interpolated into the script source.
  assert.match(
    job,
    /ADVISORIES: \$\{\{ needs\.secure-install-review\.outputs\.advisories \}\}/,
  );
  assert.match(job, /process\.env\.ADVISORIES/);
});

test('Report Audit Success reports a recovery once and closes an untriaged issue', () => {
  const job = jobBlock(WORKFLOW, 'report-audit-success');
  assert.match(job, /lastReportedState/);
  assert.match(job, /recoveryAction/);
  assert.match(job, /state: 'closed'/);
  assert.match(job, /state_reason: 'completed'/);
});
