/**
 * Run with: node --test tools/scripts/lib/pr-door-line.test.ts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { checkDoorLine, suppliedBodyFrom } from './pr-door-line.ts';

const NO_DOOR_MESSAGE = 'The body has no Door line';
const UNREADABLE_MESSAGE = 'The Merge Train cannot read this Door line';
const ACCEPTED_FORM = 'Write it as';

const body = (...lines: string[]): string => lines.join('\n');

test('passes when the body is the runner fallback (null)', () => {
  assert.deepEqual(checkDoorLine({ suppliedBody: null }), { ok: true });
});

test('passes a readable two-way Door, with or without trailing text', () => {
  assert.deepEqual(
    checkDoorLine({
      suppliedBody: body('## Merge danger', '**Door:** two-way'),
    }),
    { ok: true },
  );
  assert.deepEqual(
    checkDoorLine({
      suppliedBody: body('## Merge danger', '**Door:** two-way — text'),
    }),
    { ok: true },
  );
});

test('passes a one-way Door: the gate checks readability, not the value', () => {
  assert.deepEqual(
    checkDoorLine({
      suppliedBody: body(
        '## Merge danger',
        '**Door:** one-way — a migration drops a column',
      ),
    }),
    { ok: true },
  );
});

test('holds the PR #1532 drift and quotes the line verbatim', () => {
  const drifted = '**Door:** two-way. The branch adds no Prisma migration…';
  const result = checkDoorLine({
    suppliedBody: body('## Merge danger', drifted),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.message.includes(UNREADABLE_MESSAGE), result.message);
  assert.ok(result.message.includes(drifted), result.message);
  assert.ok(result.message.includes(ACCEPTED_FORM), result.message);
  assert.ok(result.message.includes('**Door:** one-way'), result.message);
  assert.ok(!result.message.includes(NO_DOOR_MESSAGE), result.message);
});

test('holds near-miss Door fields as unreadable', () => {
  for (const nearMiss of ['- **Door:** two-way', '**Door**: two-way']) {
    const result = checkDoorLine({
      suppliedBody: body('## Merge danger', nearMiss),
    });

    assert.equal(result.ok, false, nearMiss);
    if (result.ok) continue;
    assert.ok(result.message.includes(UNREADABLE_MESSAGE), nearMiss);
    assert.ok(result.message.includes(nearMiss), nearMiss);
    assert.ok(!result.message.includes(NO_DOOR_MESSAGE), nearMiss);
  }
});

test('holds a Door line written outside the form boundary as unreadable', () => {
  for (const malformed of [
    '**Door:** two-way —text',
    '**door:** two-way',
    '**Door:**',
  ]) {
    const result = checkDoorLine({
      suppliedBody: body('## Merge danger', malformed),
    });

    assert.equal(result.ok, false, malformed);
    if (result.ok) continue;
    assert.ok(result.message.includes(UNREADABLE_MESSAGE), malformed);
    assert.ok(result.message.includes(malformed), malformed);
    assert.ok(!result.message.includes(NO_DOOR_MESSAGE), malformed);
  }
});

test('holds a body with no Merge danger section with the no-Door message', () => {
  const result = checkDoorLine({
    suppliedBody: body('## Why', 'Some reasoning.'),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.message.includes(NO_DOOR_MESSAGE), result.message);
  assert.ok(!result.message.includes(UNREADABLE_MESSAGE), result.message);
});

test('holds a Door line under a sibling heading as absent', () => {
  const result = checkDoorLine({
    suppliedBody: body('## Merge danger', '## Other', '**Door:** two-way'),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.message.includes(NO_DOOR_MESSAGE), result.message);
  assert.ok(!result.message.includes(UNREADABLE_MESSAGE), result.message);
});

test('holds a Merge danger section that has no Door line', () => {
  const result = checkDoorLine({
    suppliedBody: body(
      '## Merge danger',
      '**Blast radius:** the vault import path',
    ),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.message.includes(NO_DOOR_MESSAGE), result.message);
  assert.ok(!result.message.includes(UNREADABLE_MESSAGE), result.message);
});

test('holds an empty supplied body with the no-Door message', () => {
  const result = checkDoorLine({ suppliedBody: '' });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.message.includes(NO_DOOR_MESSAGE), result.message);
});

test('reads --body-file and passes its path, even when --body is also set', () => {
  const calls: string[] = [];
  const text = body('## Merge danger', '**Door:** one-way — drops a column');

  const supplied = suppliedBodyFrom(
    { body: '## Inline', bodyFile: '/work/body.md' },
    (path) => {
      calls.push(path);
      return text;
    },
  );

  assert.equal(supplied, text);
  assert.deepEqual(calls, ['/work/body.md']);
});

test('returns --body without reading any file when only --body is set', () => {
  const calls: string[] = [];

  const supplied = suppliedBodyFrom(
    { body: '## Why', bodyFile: null },
    (path) => {
      calls.push(path);
      return 'unused';
    },
  );

  assert.equal(supplied, '## Why');
  assert.deepEqual(calls, []);
});

test('returns null and reads nothing when neither body option is set', () => {
  const calls: string[] = [];

  const supplied = suppliedBodyFrom({ body: null, bodyFile: null }, (path) => {
    calls.push(path);
    return 'unused';
  });

  assert.equal(supplied, null);
  assert.deepEqual(calls, []);
});

test('propagates a read error from --body-file', () => {
  assert.throws(
    () =>
      suppliedBodyFrom({ body: null, bodyFile: '/work/missing.md' }, () => {
        throw new Error('ENOENT: no such file');
      }),
    /ENOENT/,
  );
});
