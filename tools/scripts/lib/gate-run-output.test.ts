import assert from 'node:assert/strict';
import test from 'node:test';

import type { GateManifestEntry } from './gate-manifest.ts';
import {
  escapeData,
  escapeProperty,
  formatGateResult,
} from './gate-run-output.ts';

function entryFor(id: string): GateManifestEntry {
  return {
    id,
    npmScript: id,
    script: 'tools/scripts/check-fixture.ts',
    args: [],
  };
}

const PLAIN_ID = 'readme:check';

test('a passing gate outside GitHub Actions prints only its check line', () => {
  const formatted = formatGateResult(
    { entry: entryFor(PLAIN_ID), status: 0, stdout: 'ok\n', stderr: '' },
    { inActions: false },
  );

  assert.deepEqual(formatted.body, [`  ✓ ${PLAIN_ID}`]);
  assert.equal(formatted.isFailure, false);
  assert.equal(formatted.groupStart, undefined);
  assert.equal(formatted.groupEnd, undefined);
  assert.equal(formatted.errorAnnotation, undefined);
});

test('a passing gate inside GitHub Actions is grouped and never annotated', () => {
  const formatted = formatGateResult(
    { entry: entryFor(PLAIN_ID), status: 0, stdout: 'ok\n', stderr: '' },
    { inActions: true },
  );

  assert.deepEqual(formatted.body, [`  ✓ ${PLAIN_ID}`]);
  assert.equal(formatted.isFailure, false);
  assert.equal(formatted.groupStart, `::group::${PLAIN_ID}`);
  assert.equal(formatted.groupEnd, '::endgroup::');
  assert.equal(formatted.errorAnnotation, undefined);
});

test('a failing gate with stdout and stderr keeps both streams indented under its line', () => {
  const formatted = formatGateResult(
    {
      entry: entryFor(PLAIN_ID),
      status: 1,
      stdout: 'checked 3 files\n',
      stderr: 'missing README\n',
    },
    { inActions: false },
  );

  assert.equal(formatted.body.length, 3);
  assert.equal(formatted.body[0], `  ✗ ${PLAIN_ID} (exit 1)`);
  assert.equal(formatted.body[1], '      checked 3 files');
  assert.equal(formatted.body[2], '      missing README');
  assert.equal(formatted.isFailure, true);
  assert.equal(formatted.groupStart, undefined);
  assert.equal(formatted.groupEnd, undefined);
  assert.equal(formatted.errorAnnotation, undefined);
});

test('a failing gate with empty stderr adds no entry for that stream', () => {
  const formatted = formatGateResult(
    {
      entry: entryFor(PLAIN_ID),
      status: 1,
      stdout: 'checked 3 files\n',
      stderr: '',
    },
    { inActions: false },
  );

  assert.equal(formatted.body.length, 2);
  assert.equal(formatted.body[0], `  ✗ ${PLAIN_ID} (exit 1)`);
  assert.equal(formatted.body[1], '      checked 3 files');
  assert.equal(formatted.isFailure, true);
});

test('a failing gate inside GitHub Actions gets a group and a named error annotation', () => {
  const id = 'format-check';
  const formatted = formatGateResult(
    { entry: entryFor(id), status: 1, stdout: '', stderr: 'boom\n' },
    { inActions: true },
  );

  assert.equal(formatted.isFailure, true);
  assert.equal(formatted.groupStart, `::group::${id}`);
  assert.equal(formatted.groupEnd, '::endgroup::');
  assert.equal(
    formatted.errorAnnotation,
    `::error title=${id}::${id} failed (exit 1)`,
  );
});

test('escapeData escapes percent first so the escapes are not double-escaped', () => {
  assert.equal(escapeData('100% done\r\n'), '100%25 done%0D%0A');
});

test('escapeProperty also escapes colon and comma on top of escapeData', () => {
  assert.equal(
    escapeProperty('100% done\r\n: a, b'),
    '100%25 done%0D%0A%3A a%2C b',
  );
  assert.equal(
    escapeProperty('agents:sync:check (subagents), v2'),
    'agents%3Async%3Acheck (subagents)%2C v2',
  );
});

test('a colon-bearing id is escaped in the annotation title but not in the body line', () => {
  const id = 'agents:sync:check (subagents)';
  const formatted = formatGateResult(
    { entry: entryFor(id), status: 1, stdout: '', stderr: '' },
    { inActions: true },
  );

  assert.equal(formatted.body[0], `  ✗ ${id} (exit 1)`);
  assert.equal(
    formatted.errorAnnotation,
    `::error title=agents%3Async%3Acheck (subagents)::${id} failed (exit 1)`,
  );
});
