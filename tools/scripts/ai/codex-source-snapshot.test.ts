import assert from 'node:assert/strict';
import childProcess, { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { captureSource, loadReadPolicy } from './codex-source-snapshot.ts';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const hook = resolve(repository, 'tools/scripts/copilot-hooks/pre-tool-use.ts');

/** The decision the real read hook reaches for one path, asked one at a time. */
function hookAllows(path: string): boolean {
  const result = spawnSync(process.execPath, [hook], {
    cwd: repository,
    input: JSON.stringify({ toolName: 'read', toolArgs: { path } }),
    encoding: 'utf8',
  });
  const decision = JSON.parse(result.stdout).permissionDecision;
  assert.ok(decision === 'allow' || decision === 'deny', result.stdout);
  return decision === 'allow';
}

const allowed = [
  'README.md',
  '.env.example',
  'apps/backend/.env.example',
  'tools/scripts/copilot-hooks/pre-tool-use.ts',
  'libs/app-api-client/src/api.ts',
  'docs/environment.md',
  'src/secrets.ts',
  'src/credentials-form.tsx',
  'src/key.ts',
  '.sshconfig',
];
const accessorNamed = [
  'process.env',
  'import.meta.env',
  'Deno.env',
  'Bun.env',
].flatMap((name) => [name, `config/${name}`]);
const denied = [
  ...accessorNamed,
  // A path argument gets no accessor exemption, in a directory name either.
  'src/process.env.d/types.ts',
  '.env',
  '.env.local',
  'apps/backend/.env',
  'config/prod.env.bak',
  'config\\staging.ENV',
  '.env.example.d/.env',
  '.ssh',
  'home/.aws/config',
  '.gnupg/ring',
  'keys/id_ed25519',
  '.npmrc',
  '.yarnrc.yml',
  'config/credentials',
  'deploy/secrets/token.txt',
  'certs/server.pem',
  'certs/server.p12',
  'certs/server.key',
  'certs/server.CRT',
];

test('the in-process read policy decides every path as the read hook does', async () => {
  const canRead = await loadReadPolicy(repository);
  for (const [paths, expected] of [
    [allowed, true],
    [denied, false],
  ] as const) {
    for (const path of paths) {
      const fromHook = hookAllows(path);
      assert.equal(canRead(path), fromHook, path);
      assert.equal(fromHook, expected, path);
    }
  }
});

test('capture aborts when the read policy cannot be loaded', async (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'codex-snapshot-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const worktree = join(temp, 'worktree');
  mkdirSync(worktree);
  writeFileSync(join(worktree, 'source.txt'), 'content\n');
  await assert.rejects(
    captureSource(worktree, temp, join(temp, 'snapshot.json')),
    /Could not verify repository read policy/,
  );
});

/** Counts every child process any module starts until the test ends. */
function countChildProcesses(t: TestContext): () => number {
  const mocks = (
    [
      'exec',
      'execFile',
      'execFileSync',
      'execSync',
      'fork',
      'spawn',
      'spawnSync',
    ] as const
  ).map((name) => t.mock.method(childProcess, name));
  // Named imports of a builtin follow the mocked properties only once synced.
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return () => mocks.reduce((sum, mock) => sum + mock.mock.callCount(), 0);
}

// One guard process per directory entry made a launch take minutes.
test('capture starts no child process, however many entries it walks', async (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'codex-snapshot-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const started = countChildProcesses(t);

  spawnSync(process.execPath, ['--version']);
  assert.equal(started(), 1, 'the counter must see a real child process');

  for (const size of [1, 200]) {
    const worktree = join(temp, `worktree-${size}`);
    for (let index = 0; index < size; index++) {
      const directory = join(worktree, `directory-${index}`);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'source.txt'), 'content\n');
    }
    const names = await captureSource(
      worktree,
      repository,
      join(temp, `snapshot-${size}.json`),
    );
    assert.equal(names.length, size);
    assert.equal(started(), 1, `capture of ${size} files started a process`);
  }
});

test('capture leaves out a file named like an env accessor', async (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'codex-snapshot-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const worktree = join(temp, 'worktree');
  mkdirSync(join(worktree, 'config'), { recursive: true });
  for (const name of [...accessorNamed, '.env.example', 'source.txt']) {
    writeFileSync(join(worktree, name), 'content\n');
  }

  const names = await captureSource(
    worktree,
    repository,
    join(temp, 'snapshot.json'),
  );

  assert.deepEqual(names.sort(), ['.env.example', 'source.txt']);
});

test('capture of this repository includes its agent guide', async (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'codex-snapshot-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const started = Date.now();
  const names = await captureSource(
    repository,
    repository,
    join(temp, 'snapshot.json'),
  );
  // Logged only: elapsed time depends on machine load.
  t.diagnostic(`captured ${names.length} files in ${Date.now() - started} ms`);
  assert.ok(names.includes('AGENTS.md'));
});
