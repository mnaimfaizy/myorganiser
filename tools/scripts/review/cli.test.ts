import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { firstLine, parseArgs } from './cli.ts';

const VALIDATE = 'tools/scripts/review/validate-review-report.ts';
const RENDER = 'tools/scripts/review/render-review-report.ts';
const FIXTURE = 'tools/scripts/review/fixtures/sample-report.json';

const run = (script, args) =>
  spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('parseArgs separates positionals from flags and tolerates a bare flag', () => {
  assert.deepEqual(parseArgs(['in.json', '--out', 'o.json', '--no-hunks']), {
    positional: ['in.json'],
    flags: { out: 'o.json', 'no-hunks': null },
  });
});

test('firstLine prefers stderr, then message, then the first non-empty line', () => {
  assert.equal(
    firstLine({ stderr: 'GraphQL: Something went wrong\nmore', message: 'x' }),
    'GraphQL: Something went wrong',
  );
  assert.equal(firstLine(new Error('boom')), 'boom');
  assert.equal(firstLine('plain'), 'plain');
});

test('validator: exit 2 with no input, exit 1 on a rejected report, exit 0 on the fixture', () => {
  assert.equal(run(VALIDATE, []).status, 2);
  const dir = mkdtempSync(join(tmpdir(), 'review-'));
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify({ schemaVersion: 1 }));
  const rejected = run(VALIDATE, [bad]);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /report rejected/);
  const out = join(dir, 'normalized.json');
  const ok = run(VALIDATE, [FIXTURE, '--out', out]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /verdict request-changes/);
  const rendered = run(RENDER, [out, '--no-hunks']);
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /^# Code review — Request changes/);
});

test('validator: --tier pins the classifier output over the envelope, and only a real label', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-'));
  const out = join(dir, 'normalized.json');
  const pinned = run(VALIDATE, [
    FIXTURE,
    '--tier',
    'review:agent',
    '--out',
    out,
  ]);
  assert.equal(pinned.status, 0, pinned.stderr);
  const normalized = JSON.parse(readFileSync(out, 'utf8'));
  assert.notEqual(
    JSON.parse(readFileSync(FIXTURE, 'utf8')).tier,
    'review:agent',
    'the fixture must carry a different tier for the override to be observable',
  );
  assert.equal(normalized.tier, 'review:agent');
  assert.equal(normalized.effectiveTier, 'review:agent');

  const bogus = run(VALIDATE, [FIXTURE, '--tier', 'review:bogus']);
  assert.equal(bogus.status, 1);
  assert.match(bogus.stderr, /tier/);
  assert.equal(run(VALIDATE, [FIXTURE, '--tier']).status, 2);
});

test('validator: --previous carries an id across runs, and refuses a file that is not a normalized report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-'));
  const first = join(dir, 'first.json');
  assert.equal(run(VALIDATE, [FIXTURE, '--out', first]).status, 0);
  const before = JSON.parse(readFileSync(first, 'utf8'));

  // The next run anchors a multi-line finding one line further in, as a
  // reviewer does. Alone, that mints a different id; handed the previous
  // report, the finding is recognised as the one already raised.
  const report = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  for (const f of report.findings)
    if (f.location?.endLine > f.location?.startLine) f.location.startLine += 1;
  const moved = join(dir, 'moved.json');
  writeFileSync(moved, JSON.stringify(report));
  const ids = (args) => {
    const out = join(dir, 'out.json');
    const result = run(VALIDATE, [moved, ...args, '--out', out]);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(readFileSync(out, 'utf8')).findings.map((f) => f.id);
  };
  const located = report.findings.filter(
    (f) => f.location?.endLine > f.location?.startLine,
  ).length;
  assert.ok(located > 0, 'the fixture must carry a multi-line finding');
  assert.deepEqual(
    ids(['--previous', first]),
    before.findings.map((f) => f.id),
  );
  assert.notDeepEqual(
    ids([]),
    before.findings.map((f) => f.id),
  );

  // A report of another vintage lends nothing and is not an error.
  const older = join(dir, 'older.json');
  writeFileSync(older, JSON.stringify({ schemaVersion: 1, findings: [] }));
  assert.deepEqual(ids(['--previous', older]), ids([]));

  // The raw report carries this schema version and no ids: not normalized.
  const raw = run(VALIDATE, [moved, '--previous', FIXTURE]);
  assert.equal(raw.status, 2);
  assert.match(raw.stderr, /is not a normalized report/);
  assert.equal(run(VALIDATE, [moved, '--previous']).status, 2);
});

test('renderer: exit 2 when handed a raw report instead of a normalized one', () => {
  const result = run(RENDER, [FIXTURE]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not a normalized report/);
});
