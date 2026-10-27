// Covers the matching rule between a finding's executed evidence and the
// commands a reviewer transcript shows (issue #1039, ADR 0126): one test per
// near-miss the rule names, and one per thing it refuses.
import assert from 'node:assert/strict';
import test from 'node:test';

import { matchExecutedEvidence } from './executed-evidence.ts';

const evidence = (command, exitCode = 0) => ({
  kind: 'executed',
  command,
  exitCode,
  outputExcerpt: '',
  cwd: '.',
});

const ran = (command, exitCode = 0) => ({ command, exitCode });

const status = (e, executions) => matchExecutedEvidence(e, executions).status;

test('a command the transcript shows, with the exit code it shows, ran', () => {
  assert.equal(
    status(evidence('yarn nx test web-vault', 1), [
      ran('git diff main...HEAD --stat'),
      ran('yarn nx test web-vault', 1),
    ]),
    'ran',
  );
});

test('a command no call ran is not-run', () => {
  assert.deepEqual(
    matchExecutedEvidence(evidence('yarn nx test web-vault', 1), [
      ran('git diff main...HEAD --stat'),
      ran('yarn nx lint web-vault', 1),
    ]),
    { status: 'not-run' },
  );
  assert.equal(status(evidence('yarn nx test web-vault', 1), []), 'not-run');
});

test('whitespace between words does not make a different command', () => {
  assert.equal(
    status(evidence('  git   grep -n\tfoo   HEAD '), [
      ran('git grep -n foo HEAD'),
    ]),
    'ran',
  );
});

test('quoting that leaves the same words is the same command', () => {
  const call = [ran(`git grep -n "old name" HEAD -- 'libs/web'`)];
  assert.equal(
    status(evidence(`git grep -n 'old name' HEAD -- libs/web`), call),
    'ran',
  );
  assert.equal(
    status(evidence(`git grep -n --fixed-strings="a b" HEAD`), [
      ran(`git grep -n --fixed-strings='a b' HEAD`),
    ]),
    'ran',
  );
});

test('quoting that changes the words is a different command', () => {
  assert.equal(
    status(evidence('git grep -n old name HEAD'), [
      ran('git grep -n "old name" HEAD'),
    ]),
    'not-run',
  );
});

test('different words are a different command, however close', () => {
  const call = [ran('corepack yarn nx test web-vault')];
  assert.equal(status(evidence('yarn nx test web-vault'), call), 'not-run');
  assert.equal(
    status(evidence('corepack yarn nx test web-vault --watch'), call),
    'not-run',
  );
  assert.equal(status(evidence('corepack yarn nx test web'), call), 'not-run');
});

test('one part of a chained call ran', () => {
  const call = [
    ran('cd apps/backend && yarn nx test backend | tail -n 40; echo done'),
  ];
  for (const part of [
    'cd apps/backend',
    'yarn nx test backend',
    'tail -n 40',
    'echo done',
  ])
    assert.equal(status(evidence(part), call), 'ran', part);
});

test('adjacent parts of a chained call ran, in the order the call ran them', () => {
  const call = [ran('cd apps/backend && yarn nx test backend | tail -n 40')];
  assert.equal(
    status(evidence('yarn nx test backend | tail -n 40'), call),
    'ran',
  );
  assert.equal(
    status(evidence('tail -n 40 | yarn nx test backend'), call),
    'not-run',
  );
  assert.equal(
    status(evidence('cd apps/backend && tail -n 40'), call),
    'not-run',
  );
});

test('parts of two different calls are not one command', () => {
  assert.equal(
    status(evidence('cd apps/backend && yarn nx test backend'), [
      ran('cd apps/backend'),
      ran('yarn nx test backend'),
    ]),
    'not-run',
  );
});

test('a separator inside quotes does not split a command', () => {
  assert.equal(
    status(evidence('git grep -n'), [ran('git grep -n "a && b" HEAD')]),
    'not-run',
  );
});

test('a redirection is where the output went, not what ran', () => {
  const call = [ran('yarn nx test backend 2>&1 | tail -n 40')];
  assert.equal(status(evidence('yarn nx test backend'), call), 'ran');
  assert.equal(
    status(evidence('yarn nx lint backend'), [
      ran('yarn nx lint backend > /tmp/lint.txt 2> /dev/null'),
    ]),
    'ran',
  );
});

test('a quoted angle bracket is a word, not a redirection', () => {
  assert.equal(
    status(evidence('git grep -n HEAD'), [ran(`git grep -n '>' HEAD`)]),
    'not-run',
  );
  assert.equal(
    status(evidence(`git grep -n ">" HEAD`), [ran(`git grep -n '>' HEAD`)]),
    'ran',
  );
});

test('a command that comes to no words matches nothing', () => {
  const call = [ran('yarn nx test backend 2>&1')];
  for (const empty of ['""', '2>&1', ' ; ', '> /dev/null'])
    assert.equal(status(evidence(empty), call), 'not-run', empty);
});

test('the exit code is compared when the evidence is the whole call', () => {
  assert.deepEqual(
    matchExecutedEvidence(evidence('yarn nx test web-vault', 1), [
      ran('yarn nx test web-vault', 0),
    ]),
    { status: 'exit-code-differs', exitCodes: [0] },
  );
});

test('a call whose exit code the transcript does not carry is not compared', () => {
  assert.equal(
    status(evidence('yarn nx test web-vault', 1), [
      ran('yarn nx test web-vault', null),
    ]),
    'ran',
  );
});

test('one part of a chained call has no exit code of its own to compare', () => {
  assert.equal(
    status(evidence('yarn nx test backend', 1), [
      ran('yarn nx test backend 2>&1 | tail -n 40', 0),
    ]),
    'ran',
  );
});

test('a command run more than once ran if any run agrees', () => {
  const twice = [
    ran('yarn nx test web-vault', 1),
    ran('yarn nx test web-vault', 0),
  ];
  assert.equal(status(evidence('yarn nx test web-vault', 0), twice), 'ran');
  assert.deepEqual(
    matchExecutedEvidence(evidence('yarn nx test web-vault', 2), twice),
    { status: 'exit-code-differs', exitCodes: [0, 1] },
  );
});

// --- what a shell reads that a naive split does not ------------------------

test('a backslash at the end of a line continues the command', () => {
  assert.equal(
    status(evidence('yarn nx test backend --runInBand'), [
      ran('yarn nx test backend \\\n  --runInBand'),
    ]),
    'ran',
  );
});

test('an escaped quote does not close the quoted text it is in', () => {
  const call = [ran('git grep -n "a\\"b; rm -rf x" HEAD')];
  assert.equal(status(evidence('rm -rf x" HEAD'), call), 'not-run');
  assert.equal(
    status(evidence(`git grep -n 'a"b; rm -rf x' HEAD`), call),
    'ran',
  );
});

test('a here-document body is text: its call matches whole or not at all', () => {
  const call = [ran('cat > notes.txt <<EOF\nyarn nx test backend\nEOF', 0)];
  assert.equal(status(evidence('yarn nx test backend', 1), call), 'not-run');
  assert.equal(
    status(evidence('cat > notes.txt <<EOF\nyarn nx test backend\nEOF'), call),
    'ran',
  );
});

test('a redirection target may be quoted, and a here-string is one too', () => {
  assert.equal(
    status(evidence('yarn nx lint backend'), [
      ran('yarn nx lint backend >"my file.txt"'),
    ]),
    'ran',
  );
  assert.equal(
    status(evidence('node check.mjs'), [ran('node check.mjs <<< "{}"')]),
    'ran',
  );
});

test('a trailing & is where the command ran, not what ran', () => {
  assert.equal(
    status(evidence('yarn nx test backend'), [ran('yarn nx test backend &')]),
    'ran',
  );
});
