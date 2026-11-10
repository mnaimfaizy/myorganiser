// EXPERIMENT ONLY — DO NOT MERGE (issue #1493).
// Run with: node --test tools/scripts/ci/e2e-workers-experiment.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseTop,
  parseVmstat,
  roleOf,
  summarizeBlob,
  summarizeCpu,
  summarizeExperiment,
} from './e2e-workers-experiment.ts';

const blob = (workers: number, attempts: [string, string, number, number][]) =>
  [
    { method: 'onConfigure', params: { config: { workers } } },
    {
      method: 'onProject',
      params: {
        project: {
          name: 'chromium',
          suites: [
            {
              title: 'a.spec.ts',
              entries: [
                { title: 'first', testId: 't1' },
                { title: 'second', testId: 't2' },
              ],
            },
          ],
        },
      },
    },
    ...attempts.flatMap(([testId, status, start, duration], i) => [
      {
        method: 'onTestBegin',
        params: { testId, result: { id: `r${i}`, startTime: start } },
      },
      {
        method: 'onTestEnd',
        params: {
          test: { testId, expectedStatus: 'passed' },
          result: { id: `r${i}`, duration, status },
        },
      },
    ]),
    { method: 'onEnd', params: { result: { status: 'passed' } } },
  ]
    .map((e) => JSON.stringify(e))
    .join('\n');

test('a blob report gives spec wall, serial time, flaky and failed tests', () => {
  const report = summarizeBlob(
    blob(2, [
      ['t1', 'failed', 1000, 500],
      ['t1', 'passed', 2000, 400],
      ['t2', 'timedOut', 1200, 3000],
      ['t2', 'failed', 4300, 100],
    ]),
    '7',
    'control-e2e-blob-report-3',
  );
  assert.equal(report.workers, 2);
  assert.equal(report.role, 'control');
  assert.equal(report.shard, '3');
  assert.equal(report.specWallMs, 4400 - 1000);
  assert.equal(report.serialMs, 4000);
  assert.deepEqual(report.flaky, ['a.spec.ts › first']);
  assert.deepEqual(report.failed, ['a.spec.ts › second']);
});

test('artifact names map to a role and shard', () => {
  assert.deepEqual(roleOf('e2e-blob-report-2'), { role: 'e2e', shard: '2' });
  assert.deepEqual(roleOf('nightly-blob-report-webkit'), {
    role: 'nightly',
    shard: 'webkit',
  });
});

test('vmstat columns are read by name and the since-boot row is dropped', () => {
  const text = [
    'procs -----------memory---------- ---swap-- -----io---- -system-- -------cpu------- -----timestamp-----',
    ' r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st gu                 UTC',
    ' 1  0      0 100000   1000  20000    0    0     1     1   10   10  5  1 94  0  0  0 2026-11-17 10:00:00',
    ' 6  0      0 100000   1000  20000    0    0     1     1   10   10 80 15  5  0  1  0 2026-11-17 10:00:02',
  ].join('\n');
  const rows = parseVmstat(text);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    atMs: Date.parse('2026-11-17T10:00:02Z'),
    r: 6,
    busy: 95,
    steal: 1,
  });
});

test('top frames sum %CPU per process family', () => {
  const text = [
    '@@ 100',
    'top - 10:00:00 up 1 min,  0 users,  load average: 1.0, 1.0, 1.0',
    '    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND',
    '   10 runner    20   0  1000   100   10 R  90.0   1.0   0:01.00 next-server (v16)',
    '   11 runner    20   0  1000   100   10 R  40.0   1.0   0:01.00 /home/runner/.cache/ms-playwright/chromium_headless_shell-1200/chrome-linux/headless_shell --type=renderer',
    '   12 runner    20   0  1000   100   10 R  30.0   1.0   0:01.00 /home/runner/.cache/ms-playwright/chromium_headless_shell-1200/chrome-linux/headless_shell --type=gpu',
    '   13 runner    20   0  1000   100   10 S  20.0   1.0   0:01.00 node /work/node_modules/playwright/cli.js',
  ].join('\n');
  const [frame] = parseTop(text);
  assert.equal(frame.atMs, 100_000);
  assert.equal(frame.byCommand.get('next-server'), 90);
  assert.equal(frame.byCommand.get('browser'), 70);
  assert.equal(frame.byCommand.get('node'), 20);
});

test('CPU is summarised only inside the spec window', () => {
  const rows = [
    { atMs: 0, r: 9, busy: 100, steal: 0 },
    { atMs: 10, r: 2, busy: 50, steal: 0 },
    { atMs: 20, r: 6, busy: 90, steal: 2 },
  ];
  const cpu = summarizeCpu('x', 4, rows, [], 5, 25);
  assert.equal(cpu.samples, 2);
  assert.equal(cpu.busyP50, 70);
  assert.equal(cpu.runQueueMax, 6);
  assert.equal(cpu.saturatedShare, 0.5);
});

test('the ratio pairs a 2-worker shard with the 1-worker shard of the same run', () => {
  const one = summarizeBlob(
    blob(1, [['t1', 'passed', 0, 1000]]),
    '9',
    'control-e2e-blob-report-1',
  );
  const two = summarizeBlob(
    blob(2, [['t1', 'passed', 0, 600]]),
    '9',
    'e2e-blob-report-1',
  );
  const other = summarizeBlob(
    blob(1, [['t1', 'passed', 0, 2000]]),
    '8',
    'e2e-blob-report-1',
  );
  const summary = summarizeExperiment([one, two, other], {});
  assert.deepEqual(summary.pairedRatios, [
    { runId: '9', shard: '1', ratio: 0.6 },
  ]);
  assert.equal(summary.specWall['1']['1'], 1.5);
  assert.equal(summary.specWall['2']['1'], 0.6);
});
