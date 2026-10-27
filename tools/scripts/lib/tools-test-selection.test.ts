import assert from 'node:assert/strict';
import test from 'node:test';

import { selectStagedSuites } from './tools-test-selection.ts';

const SUITES = [
  'tools/scripts/check-a.test.ts',
  'tools/scripts/check-b.test.ts',
  'tools/scripts/lib/widget.test.ts',
];

test('a staged suite file is selected directly', () => {
  const selected = selectStagedSuites({
    stagedFiles: ['tools/scripts/check-a.test.ts'],
    suites: SUITES,
  });

  assert.deepEqual(selected, ['tools/scripts/check-a.test.ts']);
});

test('a staged script selects the suite paired with it by name', () => {
  const selected = selectStagedSuites({
    stagedFiles: ['tools/scripts/check-a.ts'],
    suites: SUITES,
  });

  assert.deepEqual(selected, ['tools/scripts/check-a.test.ts']);
});

// The retired `.mjs` form pairs with nothing: `tools:mjs:check` rejects the
// file itself, so there is no suite for the selection to find.
test('a staged .mjs script selects no suite', () => {
  const selected = selectStagedSuites({
    stagedFiles: ['tools/scripts/lib/widget.mjs'],
    suites: SUITES,
  });

  assert.deepEqual(selected, []);
});

test('a staged script selects its paired suite in a subdirectory', () => {
  const selected = selectStagedSuites({
    stagedFiles: ['tools/scripts/lib/widget.ts'],
    suites: ['tools/scripts/lib/widget.test.ts'],
  });

  assert.deepEqual(selected, ['tools/scripts/lib/widget.test.ts']);
});

test('a staged script with no suite on disk selects nothing', () => {
  const selected = selectStagedSuites({
    stagedFiles: ['tools/scripts/build-agent-map.ts'],
    suites: SUITES,
  });

  assert.deepEqual(selected, []);
});

test('an unrelated commit with no tools/scripts file staged selects nothing', () => {
  const selected = selectStagedSuites({
    stagedFiles: ['libs/web/pages/groceries/groceries-page.tsx', 'README.md'],
    suites: SUITES,
  });

  assert.deepEqual(selected, []);
});

test('staging both a script and its suite selects the suite once, not twice', () => {
  const selected = selectStagedSuites({
    stagedFiles: ['tools/scripts/check-a.ts', 'tools/scripts/check-a.test.ts'],
    suites: SUITES,
  });

  assert.deepEqual(selected, ['tools/scripts/check-a.test.ts']);
});

test("staging two unrelated scripts selects each one's own suite, sorted", () => {
  const selected = selectStagedSuites({
    stagedFiles: ['tools/scripts/check-b.ts', 'tools/scripts/check-a.ts'],
    suites: SUITES,
  });

  assert.deepEqual(selected, [
    'tools/scripts/check-a.test.ts',
    'tools/scripts/check-b.test.ts',
  ]);
});

test('a file outside tools/scripts never pairs, even sharing a basename', () => {
  const selected = selectStagedSuites({
    stagedFiles: ['libs/tools/scripts/check-a.ts'],
    suites: SUITES,
  });

  assert.deepEqual(selected, []);
});

test('a Windows-style staged path is normalized before matching', () => {
  const selected = selectStagedSuites({
    stagedFiles: ['tools\\scripts\\check-a.ts'],
    suites: SUITES,
  });

  assert.deepEqual(selected, ['tools/scripts/check-a.test.ts']);
});
