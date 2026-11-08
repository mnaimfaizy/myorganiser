// Contracts for the shared exemption reader (ADR 0135): the envelope errors
// every checker's exemption list reports, and the two entry shapes.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  exemptionKey,
  readClaimExemptions,
  readPathExemptions,
} from './exemptions.ts';

const LIST = 'list.json';

class Failed extends Error {}
const fail = (message: string): never => {
  throw new Failed(message);
};

function workspace(content?: string): string {
  const cwd = mkdtempSync(join(tmpdir(), 'exemptions-'));
  mkdirSync(join(cwd, 'docs'));
  writeFileSync(join(cwd, 'docs', 'a.md'), '');
  if (content !== undefined) writeFileSync(join(cwd, LIST), content);
  return cwd;
}

function read(content: string | undefined, requireFile = true) {
  const cwd = workspace(content);
  try {
    return readClaimExemptions({
      cwd,
      path: LIST,
      schemaVersion: 1,
      fail,
      requireFile,
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('a missing file fails, calling the list a required artifact', () => {
  assert.throws(() => read(undefined), /list\.json not found — .*required/u);
});

test('an empty file fails as invalid JSON', () => {
  assert.throws(() => read(''), /list\.json is not valid JSON/u);
});

test('a file with comment lines fails as invalid JSON', () => {
  assert.throws(
    () => read('// why\n{"schemaVersion":1,"exemptions":[]}'),
    /not valid JSON/u,
  );
});

test('a wrong schemaVersion and a non-array exemptions both fail', () => {
  assert.throws(
    () => read('{"schemaVersion":2,"exemptions":[]}'),
    /expected "schemaVersion": 1, found 2/u,
  );
  assert.throws(
    () => read('{"schemaVersion":1,"exemptions":{}}'),
    /expected an "exemptions" array/u,
  );
});

test('a valid claim entry is returned trimmed', () => {
  const entry = { file: ' docs/a.md ', claim: ' x ', reason: ' because ' };
  assert.deepEqual(
    read(JSON.stringify({ schemaVersion: 1, exemptions: [entry] })),
    [{ file: 'docs/a.md', claim: 'x', reason: 'because' }],
  );
});

test('an entry with no reason, or listed twice, fails', () => {
  const entry = { file: 'docs/a.md', claim: 'x', reason: 'r' };
  assert.throws(
    () =>
      read(
        JSON.stringify({
          schemaVersion: 1,
          exemptions: [{ ...entry, reason: ' ' }],
        }),
      ),
    /carries no written reason/u,
  );
  assert.throws(
    () =>
      read(JSON.stringify({ schemaVersion: 1, exemptions: [entry, entry] })),
    /is exempted twice/u,
  );
});

test('a documenting file that is gone fails only when required', () => {
  const gone = JSON.stringify({
    schemaVersion: 1,
    exemptions: [{ file: 'docs/gone.md', claim: 'x', reason: 'r' }],
  });
  assert.throws(() => read(gone), /does not exist/u);
  assert.equal(read(gone, false).length, 1);
});

test('a path entry list maps each path to its reason', () => {
  const cwd = workspace(
    JSON.stringify({
      schemaVersion: 1,
      exemptions: [{ path: 'docs/a.md', reason: 'r' }],
    }),
  );
  try {
    const map = readPathExemptions({
      cwd,
      path: LIST,
      schemaVersion: 1,
      fail,
    });
    assert.deepEqual([...map], [['docs/a.md', 'r']]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('exemptionKey joins file and claim with a NUL', () => {
  assert.equal(exemptionKey('a', 'b'), 'a\0b');
});
