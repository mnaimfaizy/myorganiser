import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECKER = join(
  dirname(fileURLToPath(import.meta.url)),
  'check-env-deployment.ts',
);

const ENV_EXAMPLE = '.env.example';
const DEPLOYMENT_DOCS = join('docs', 'deployment');

function createWorkspace(t: TestContext): string {
  const workspace = mkdtempSync(join(tmpdir(), 'env-deployment-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  return workspace;
}

function writeEnvExample(workspace: string, keys: string[]): void {
  writeFileSync(
    join(workspace, ENV_EXAMPLE),
    keys.map((k) => `${k}=`).join('\n') + '\n',
  );
}

function writeDeploymentDoc(
  workspace: string,
  name: string,
  content: string,
): void {
  const path = join(workspace, DEPLOYMENT_DOCS, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function runChecker(workspace: string) {
  return spawnSync(process.execPath, [CHECKER, ENV_EXAMPLE, DEPLOYMENT_DOCS], {
    cwd: workspace,
    encoding: 'utf8',
  });
}

test('accepts a doc whose fenced env vars are all declared', (t) => {
  const workspace = createWorkspace(t);
  writeEnvExample(workspace, ['FOO_SECRET']);
  writeDeploymentDoc(
    workspace,
    'PLAN.md',
    '# Plan\n\n```bash\nFOO_SECRET=value\n```\n',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 variable\(s\) declared/);
});

test('rejects a fenced var absent from .env.example, naming the var and doc', (t) => {
  const workspace = createWorkspace(t);
  writeEnvExample(workspace, []);
  writeDeploymentDoc(
    workspace,
    'PLAN.md',
    '# Plan\n\n```bash\nMISSING_SECRET=value\n```\n',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /MISSING_SECRET/);
  assert.match(result.stderr, /PLAN\.md/);
});

test('a document with no fenced assignments passes', (t) => {
  const workspace = createWorkspace(t);
  writeEnvExample(workspace, []);
  writeDeploymentDoc(
    workspace,
    'PANEL.md',
    '# Panel\n\nSet `API_BASE_URL` in the dashboard. No fenced code here.\n',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 variable\(s\) declared/);
});

test('ignores an inline single-backtick assignment outside a fence', (t) => {
  const workspace = createWorkspace(t);
  writeEnvExample(workspace, []);
  writeDeploymentDoc(
    workspace,
    'NOTES.md',
    '# Notes\n\nSet `UNDECLARED_INLINE=value` in the dashboard UI.\n',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
});

test('ignores a shell-interpolated reference, not a bare assignment', (t) => {
  const workspace = createWorkspace(t);
  writeEnvExample(workspace, []);
  writeDeploymentDoc(
    workspace,
    'PLAN.md',
    '# Plan\n\n```bash\nif [ -z "$DATABASE_URL" ]; then echo missing; fi\n```\n',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
});

test('cannot run when .env.example is missing', (t) => {
  const workspace = createWorkspace(t);
  writeDeploymentDoc(workspace, 'PLAN.md', '# Plan\n');

  const result = runChecker(workspace);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /\.env\.example not found/);
});

test('cannot run when the deployment docs directory is missing', (t) => {
  const workspace = createWorkspace(t);
  writeEnvExample(workspace, []);

  const result = runChecker(workspace);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /not found/);
});
