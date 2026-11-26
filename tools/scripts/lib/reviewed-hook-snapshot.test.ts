import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertReviewedHookEnforcement,
  verifyReviewedHookSnapshot,
  type ReviewedHookManifest,
} from './reviewed-hook-snapshot.ts';

const hash = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

function fixture(
  run: (root: string, manifest: ReviewedHookManifest) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), 'reviewed-hooks-'));
  try {
    mkdirSync(join(root, 'hooks'));
    writeFileSync(join(root, 'hooks', 'definition.json'), 'definition');
    writeFileSync(join(root, 'hooks', 'guard.ts'), 'guard');
    run(root, {
      version: 1,
      roots: ['hooks/definition.json'],
      files: [
        {
          path: 'hooks/definition.json',
          sha256: hash('definition'),
          dependencies: ['hooks/guard.ts'],
        },
        { path: 'hooks/guard.ts', sha256: hash('guard'), dependencies: [] },
      ],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('accepts an intact reviewed inventory with a complete declared graph', () => {
  fixture((root, manifest) =>
    assert.doesNotThrow(() => verifyReviewedHookSnapshot(root, manifest)),
  );
});

test('inventory verification cannot authorize a launch', () => {
  fixture((root, manifest) => {
    verifyReviewedHookSnapshot(root, manifest);
    assert.throws(
      () => assertReviewedHookEnforcement(),
      /refusing Codex dispatch/,
    );
  });
});

test('refuses a changed definition or invoked file', () => {
  for (const name of ['definition.json', 'guard.ts']) {
    fixture((root, manifest) => {
      writeFileSync(join(root, 'hooks', name), 'changed');
      assert.throws(
        () => verifyReviewedHookSnapshot(root, manifest),
        /changed/,
      );
    });
  }
});

test('refuses absent, unreviewed, duplicate and unreachable dependencies', () => {
  fixture((root, manifest) => {
    manifest.files[0].dependencies.push('hooks/missing.ts');
    assert.throws(() => verifyReviewedHookSnapshot(root, manifest), /missing/);
  });
  fixture((root, manifest) => {
    manifest.files.push(manifest.files[1]);
    assert.throws(() => verifyReviewedHookSnapshot(root, manifest), /entry/);
  });
  fixture((root, manifest) => {
    manifest.files[0].dependencies = [];
    assert.throws(
      () => verifyReviewedHookSnapshot(root, manifest),
      /unreachable/,
    );
  });
});

test('refuses path traversal and invalid digests', () => {
  for (const path of [
    '../guard.ts',
    '/guard.ts',
    'hooks/../guard.ts',
    'hooks\\guard.ts',
  ]) {
    fixture((root, manifest) => {
      manifest.files[1].path = path;
      assert.throws(() => verifyReviewedHookSnapshot(root, manifest), /entry/);
    });
  }
  fixture((root, manifest) => {
    manifest.files[1].sha256 = 'not-a-digest';
    assert.throws(() => verifyReviewedHookSnapshot(root, manifest), /entry/);
  });
});

test('refuses a symlink even when it points to the expected bytes', (t) => {
  fixture((root, manifest) => {
    const target = join(root, 'hooks', 'guard.ts');
    rmSync(target);
    try {
      symlinkSync(join(root, 'hooks', 'definition.json'), target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM')
        return t.skip('symlink privilege unavailable');
      throw error;
    }
    manifest.files[1].sha256 = hash('definition');
    assert.throws(() => verifyReviewedHookSnapshot(root, manifest), /symlink/);
  });
});
