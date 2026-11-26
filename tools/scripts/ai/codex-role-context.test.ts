import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { captureRoleContext } from './codex-role-context.ts';
import { screenContext } from './codex-context-guard.ts';
import { protectDirectory } from './codex-private-directory.ts';
import { isolateGitEnvironment } from '../lib/git-environment.ts';

isolateGitEnvironment();

test('secret and path guards reject sensitive context', () => {
  const syntheticToken = 'ghp_' + 'A'.repeat(25);
  assert.throws(
    () => screenContext(process.cwd(), { text: syntheticToken }),
    /rejected/,
  );
  assert.throws(
    () => screenContext(process.cwd(), { text: 'ordinary' }, ['.env.local']),
    /rejected/,
  );
  assert.doesNotThrow(() =>
    screenContext(process.cwd(), { text: 'ordinary' }, ['src/file.ts']),
  );
});

test(
  'temporary context directory can be protected on Windows',
  { skip: process.platform !== 'win32' },
  (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'codex-private-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    protectDirectory(directory);
  },
);

test('Commit context captures the index without unstaged content', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-index-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  function git(...args: string[]) {
    const result = spawnSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
  }
  git('init', '--quiet');
  writeFileSync(join(directory, 'fixture.txt'), 'staged fixture\n');
  git('add', 'fixture.txt');
  writeFileSync(join(directory, 'fixture.txt'), 'unstaged fixture\n');
  const context = captureRoleContext(
    directory,
    'Commit',
    undefined,
    process.cwd(),
  );
  assert.match(context.staged_status, /fixture\.txt/);
  assert.match(context.staged_diff, /staged fixture/);
  assert.doesNotMatch(context.staged_diff, /unstaged fixture/);
  const snapshot = join(directory, 'snapshot.json');
  const contextFile = join(directory, 'context.json');
  writeFileSync(snapshot, '[]');
  writeFileSync(contextFile, JSON.stringify(context));
  const request = {
    id: 1,
    method: 'tools/call',
    params: { name: 'staged_diff', arguments: {} },
  };
  const child = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('./codex-source-service.ts', import.meta.url)),
      snapshot,
      'Commit',
      contextFile,
    ],
    { input: JSON.stringify(request) + '\n', encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  const output = JSON.parse(child.stdout).result.content[0].text;
  assert.match(output, /staged fixture/);
  assert.doesNotMatch(output, /unstaged fixture/);
  assert.throws(
    () => captureRoleContext(directory, 'Unknown'),
    /Unsupported role/,
  );
});
