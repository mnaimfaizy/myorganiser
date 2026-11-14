// Contracts for `nodeQaDeps(root).isSymlink`, the real machine's check that
// refuses a symlinked `node_modules` (qa-stack-executor.ts). Every case runs
// against a temporary directory that is removed afterwards. Only the link
// test is about links; nothing here starts a process, container or listener.
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { nodeQaDeps } from './qa-node-deps.ts';

function withTempRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'qa-node-deps-'));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('nodeQaDeps.isSymlink', () => {
  test('reports a symbolic link to a directory as a symlink', () => {
    withTempRoot((root) => {
      const target = join(root, 'real-node-modules');
      const link = join(root, 'node_modules');
      mkdirSync(target);
      symlinkSync(target, link, 'dir');
      assert.equal(nodeQaDeps(root).isSymlink(link), true);
    });
  });

  test('reports a dangling symbolic link as a symlink, because it does not follow the link', () => {
    withTempRoot((root) => {
      const link = join(root, 'node_modules');
      symlinkSync(join(root, 'missing-target'), link, 'dir');
      assert.equal(nodeQaDeps(root).isSymlink(link), true);
    });
  });

  test('reports a real directory as not a symlink', () => {
    withTempRoot((root) => {
      const dir = join(root, 'node_modules');
      mkdirSync(dir);
      assert.equal(nodeQaDeps(root).isSymlink(dir), false);
    });
  });

  test('reports a missing path as not a symlink', () => {
    withTempRoot((root) => {
      assert.equal(
        nodeQaDeps(root).isSymlink(join(root, 'node_modules')),
        false,
      );
    });
  });

  test('rethrows a lookup error that is not ENOENT, such as a path under a regular file (ENOTDIR)', () => {
    withTempRoot((root) => {
      const file = join(root, 'not-a-directory');
      writeFileSync(file, '');
      assert.throws(
        () => nodeQaDeps(root).isSymlink(join(file, 'node_modules')),
        (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOTDIR',
      );
    });
  });
});
