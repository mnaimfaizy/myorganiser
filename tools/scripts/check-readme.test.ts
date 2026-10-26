import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECKER = join(
  dirname(fileURLToPath(import.meta.url)),
  'check-readme.ts',
);

function createWorkspace(t: TestContext) {
  const workspace = mkdtempSync(join(tmpdir(), 'check-readme-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  return workspace;
}

function writeReadme(workspace: string, diagramContent: string, prose = '') {
  const readmePath = join(workspace, 'README.md');
  writeFileSync(
    readmePath,
    `# MyOrganiser\n\n\`\`\`\nmyorganiser/\n${diagramContent}\n\`\`\`\n${prose}`,
  );
}

// The layout diagram is checked on every run, so a test about links or routes
// still needs one that holds. This is the in-sync pair the first test uses.
const IN_SYNC_DIAGRAM = [
  '├── apps/',
  '│   ├── backend/',
  '│   └── web/',
  '├── libs/',
  '│   ├── core/',
  '│   └── auth/',
  '└── tools/',
].join('\n');

function createInSyncTree(workspace: string) {
  createDirectory(workspace, 'apps/backend');
  createDirectory(workspace, 'apps/web');
  createDirectory(workspace, 'libs/core');
  createDirectory(workspace, 'libs/auth');
}

function createDirectory(workspace: string, path: string) {
  mkdirSync(join(workspace, path), { recursive: true });
}

function runChecker(workspace: string) {
  return spawnSync(process.execPath, [CHECKER], {
    cwd: workspace,
    encoding: 'utf8',
  });
}

test('passes when diagram and filesystem are in sync', (t) => {
  const workspace = createWorkspace(t);
  const diagram = [
    '├── apps/',
    '│   ├── backend/',
    '│   └── web/',
    '├── libs/',
    '│   ├── core/',
    '│   └── auth/',
    '└── tools/',
  ].join('\n');
  writeReadme(workspace, diagram);
  createDirectory(workspace, 'apps/backend');
  createDirectory(workspace, 'apps/web');
  createDirectory(workspace, 'libs/core');
  createDirectory(workspace, 'libs/auth');

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /assertions in sync/);
});

test('rejects a stale app entry in the diagram (reverse direction check)', (t) => {
  const workspace = createWorkspace(t);
  const diagram = [
    '├── apps/',
    '│   ├── backend/',
    '│   ├── deleted-app/',
    '│   └── web/',
    '├── libs/',
    '│   └── core/',
    '└── tools/',
  ].join('\n');
  writeReadme(workspace, diagram);
  createDirectory(workspace, 'apps/backend');
  createDirectory(workspace, 'apps/web');
  createDirectory(workspace, 'libs/core');

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /layout diagram names apps\/deleted-app/);
  assert.match(result.stderr, /does not exist/);
});

test('rejects a stale lib entry in the diagram (reverse direction check)', (t) => {
  const workspace = createWorkspace(t);
  const diagram = [
    '├── apps/',
    '│   └── backend/',
    '├── libs/',
    '│   ├── deleted-lib/',
    '│   └── core/',
    '└── tools/',
  ].join('\n');
  writeReadme(workspace, diagram);
  createDirectory(workspace, 'apps/backend');
  createDirectory(workspace, 'libs/core');

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /layout diagram names libs\/deleted-lib/);
  assert.match(result.stderr, /does not exist/);
});

test('rejects a missing app from the diagram (forward direction check)', (t) => {
  const workspace = createWorkspace(t);
  const diagram = [
    '├── apps/',
    '│   └── backend/',
    '├── libs/',
    '│   └── core/',
    '└── tools/',
  ].join('\n');
  writeReadme(workspace, diagram);
  createDirectory(workspace, 'apps/backend');
  createDirectory(workspace, 'apps/web');
  createDirectory(workspace, 'libs/core');

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /apps\/web exists but is missing/);
});

test('rejects a missing lib from the diagram (forward direction check)', (t) => {
  const workspace = createWorkspace(t);
  const diagram = [
    '├── apps/',
    '│   └── backend/',
    '├── libs/',
    '│   └── core/',
    '└── tools/',
  ].join('\n');
  writeReadme(workspace, diagram);
  createDirectory(workspace, 'apps/backend');
  createDirectory(workspace, 'libs/core');
  createDirectory(workspace, 'libs/auth');

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /libs\/auth exists but is missing/);
});

test('handles compound lib names like web/pages correctly', (t) => {
  const workspace = createWorkspace(t);
  const diagram = [
    '├── apps/',
    '│   └── backend/',
    '├── libs/',
    '│   ├── core/',
    '│   └── web/pages/',
    '└── tools/',
  ].join('\n');
  writeReadme(workspace, diagram);
  createDirectory(workspace, 'apps/backend');
  createDirectory(workspace, 'libs/core');
  createDirectory(workspace, 'libs/web/pages');

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /assertions in sync/);
});

test('respects ignore lists for stale entries', (t) => {
  const workspace = createWorkspace(t);
  const diagram = [
    '├── apps/',
    '│   ├── backend/',
    '│   └── graphify-out/',
    '├── libs/',
    '│   ├── core/',
    '│   └── graphify-out/',
    '└── tools/',
  ].join('\n');
  writeReadme(workspace, diagram);
  createDirectory(workspace, 'apps/backend');
  createDirectory(workspace, 'libs/core');

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
});

// ---------------------------------------------------------------- 1. links resolve
//
// The header claims three checkable classes. These two sections cover the two
// the diagram tests above do not, so the header's claim is asserted whole
// rather than in the one part that happened to be written first.

test('rejects a relative link whose target does not exist', (t) => {
  const workspace = createWorkspace(t);
  writeReadme(workspace, IN_SYNC_DIAGRAM, '\n[Licence](LICENSE)\n');
  createInSyncTree(workspace);

  const result = runChecker(workspace);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /links to LICENSE, which does not exist/);
});

test('rejects a broken href in the raw HTML header', (t) => {
  const workspace = createWorkspace(t);
  writeReadme(workspace, IN_SYNC_DIAGRAM, '\n<img src="docs/logo.svg" />\n');
  createInSyncTree(workspace);

  const result = runChecker(workspace);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /links to docs\/logo\.svg, which does not exist/);
});

test('accepts a relative link whose target exists', (t) => {
  const workspace = createWorkspace(t);
  writeReadme(workspace, IN_SYNC_DIAGRAM, '\n[Licence](LICENSE)\n');
  createInSyncTree(workspace);
  writeFileSync(join(workspace, 'LICENSE'), 'MIT\n');

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
});

test('ignores external, anchor, and mailto links', (t) => {
  const workspace = createWorkspace(t);
  writeReadme(
    workspace,
    IN_SYNC_DIAGRAM,
    '\n[a](https://example.com/nope) [b](#nope) [c](mailto:nope@example.com)\n',
  );
  createInSyncTree(workspace);

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
});

// ---------------------------------------------------------------- 3. routes are real

test('rejects a /dashboard route the app router does not serve', (t) => {
  const workspace = createWorkspace(t);
  writeReadme(workspace, IN_SYNC_DIAGRAM, '\nVisit /dashboard/todo to plan.\n');
  createInSyncTree(workspace);
  createDirectory(workspace, 'apps/web/src/app/dashboard/vault');

  const result = runChecker(workspace);

  assert.equal(result.status, 1, result.stdout);
  assert.match(
    result.stderr,
    /names \/dashboard\/todo, which the app router does not serve/,
  );
});

test('accepts a /dashboard route the app router serves', (t) => {
  const workspace = createWorkspace(t);
  writeReadme(
    workspace,
    IN_SYNC_DIAGRAM,
    '\nVisit /dashboard/vault to plan.\n',
  );
  createInSyncTree(workspace);
  createDirectory(workspace, 'apps/web/src/app/dashboard/vault');

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
});
