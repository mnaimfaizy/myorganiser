import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECKER = join(
  dirname(fileURLToPath(import.meta.url)),
  'check-env-declared.ts',
);

const ENV_EXAMPLE = '.env.example';
const BACKEND_SRC = join('apps', 'backend', 'src');

function createWorkspace(t: TestContext): string {
  const workspace = mkdtempSync(join(tmpdir(), 'env-declared-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  return workspace;
}

function writeEnvExample(workspace: string, keys: string[]): void {
  writeFileSync(
    join(workspace, ENV_EXAMPLE),
    keys.map((k) => `${k}=`).join('\n') + '\n',
  );
}

function writeBackendFile(
  workspace: string,
  relPath: string,
  content: string,
): void {
  const path = join(workspace, BACKEND_SRC, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function runChecker(workspace: string) {
  return spawnSync(process.execPath, [CHECKER, ENV_EXAMPLE, BACKEND_SRC], {
    cwd: workspace,
    encoding: 'utf8',
  });
}

test('accepts a variable the backend reads that is declared in .env.example', (t) => {
  const workspace = createWorkspace(t);
  writeEnvExample(workspace, ['FOO_SECRET']);
  writeBackendFile(
    workspace,
    'services/foo.ts',
    'const x = process.env.FOO_SECRET;\n',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 variable\(s\) read/);
});

test('rejects a variable the backend reads that is not declared', (t) => {
  const workspace = createWorkspace(t);
  writeEnvExample(workspace, ['FOO_SECRET']);
  writeBackendFile(
    workspace,
    'services/foo.ts',
    'const x = process.env.UNDECLARED_VAR;\n',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /UNDECLARED_VAR/);
  assert.match(result.stderr, /services[\\/]foo\.ts/);
});

test('excludes test files from the read set', (t) => {
  const workspace = createWorkspace(t);
  writeEnvExample(workspace, []);
  writeBackendFile(
    workspace,
    'services/foo.test.ts',
    'const x = process.env.TEST_ONLY_VAR;\n',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
});

test('excludes JEST_WORKER_ID as a test-runner variable', (t) => {
  const workspace = createWorkspace(t);
  writeEnvExample(workspace, []);
  writeBackendFile(
    workspace,
    'utils/passport.ts',
    'if (process.env.JEST_WORKER_ID) { /* noop */ }\n',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
});

test('supports bracket-notation reads', (t) => {
  const workspace = createWorkspace(t);
  writeEnvExample(workspace, []);
  writeBackendFile(
    workspace,
    'services/foo.ts',
    "const x = process.env['BRACKET_VAR'];\n",
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /BRACKET_VAR/);
});

test('follows an alias bound to a bare process.env', (t) => {
  const workspace = createWorkspace(t);
  writeEnvExample(workspace, []);
  writeBackendFile(
    workspace,
    'middleware/globalRateLimit.ts',
    'function f(env = process.env) {\n  return env.ALIASED_VAR;\n}\n',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ALIASED_VAR/);
});

test('follows a destructured binding of process.env', (t) => {
  const workspace = createWorkspace(t);
  writeEnvExample(workspace, []);
  writeBackendFile(
    workspace,
    'services/foo.ts',
    'const { DESTRUCTURED_VAR } = process.env;\n',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /DESTRUCTURED_VAR/);
});

test('cannot run when .env.example is missing', (t) => {
  const workspace = createWorkspace(t);
  writeBackendFile(workspace, 'services/foo.ts', '// empty\n');

  const result = runChecker(workspace);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /\.env\.example not found/);
});

test('cannot run when the backend source root is missing', (t) => {
  const workspace = createWorkspace(t);
  writeEnvExample(workspace, []);

  const result = runChecker(workspace);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /not found/);
});
