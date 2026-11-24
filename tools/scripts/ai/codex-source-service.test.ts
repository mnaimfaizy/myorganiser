import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { captureSource } from './codex-source-snapshot.ts';

test('the service exposes only the guarded snapshot through bounded reads and searches', (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'codex-source-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const worktree = join(temp, 'worktree');
  const outside = join(temp, 'outside');
  mkdirSync(worktree);
  mkdirSync(outside);
  writeFileSync(join(worktree, 'source.txt'), 'hello fixture marker\n');
  writeFileSync(join(worktree, '.env.local'), 'secret fixture marker\n');
  writeFileSync(join(outside, 'private.txt'), 'outside fixture marker\n');
  symlinkSync(
    outside,
    join(worktree, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const snapshot = join(temp, 'snapshot.json');
  const repository = fileURLToPath(new URL('../../../', import.meta.url));
  assert.deepEqual(captureSource(worktree, repository, snapshot), [
    'source.txt',
  ]);
  assert.doesNotMatch(readFileSync(snapshot, 'utf8'), /secret|outside/);

  const requests = [
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    { id: 2, method: 'tools/list' },
    {
      id: 3,
      method: 'tools/call',
      params: { name: 'read_source', arguments: { path: 'source.txt' } },
    },
    {
      id: 4,
      method: 'tools/call',
      params: { name: 'find_filename', arguments: { query: 'source' } },
    },
    {
      id: 5,
      method: 'tools/call',
      params: { name: 'find_content', arguments: { query: 'fixture' } },
    },
    {
      id: 6,
      method: 'tools/call',
      params: {
        name: 'read_source',
        arguments: { path: '../outside/private.txt' },
      },
    },
    {
      id: 7,
      method: 'tools/call',
      params: { name: 'read_source', arguments: { path: '.env.local' } },
    },
    {
      id: 8,
      method: 'tools/call',
      params: { name: 'write_file', arguments: { path: 'source.txt' } },
    },
  ];
  const child = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('./codex-source-service.ts', import.meta.url)),
      snapshot,
    ],
    {
      input:
        requests.map((request) => JSON.stringify(request)).join('\n') + '\n',
      encoding: 'utf8',
    },
  );
  assert.equal(child.status, 0, child.stderr);
  const responses = child.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    responses[1].result.tools.map((tool: { name: string }) => tool.name),
    ['read_source', 'find_filename', 'find_content'],
  );
  assert.match(responses[2].result.content[0].text, /hello fixture marker/);
  assert.match(responses[3].result.content[0].text, /source.txt/);
  assert.match(responses[4].result.content[0].text, /fixture marker/);
  for (const response of responses.slice(5))
    assert.equal(response.result.isError, true);
  assert.equal(
    readFileSync(join(worktree, 'source.txt'), 'utf8'),
    'hello fixture marker\n',
  );
});
