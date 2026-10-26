import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECKER = join(
  dirname(fileURLToPath(import.meta.url)),
  'check-feature-index.ts',
);

const FEATURE_INDEX = join('docs', 'features', 'README.md');
const DASHBOARD_ROOT = join('apps', 'web', 'src', 'app', 'dashboard');
const EXCLUSIONS_CONFIG = join(
  'tools',
  'config',
  'feature-index-exclusions.json',
);

function createWorkspace(t: TestContext): string {
  const workspace = mkdtempSync(join(tmpdir(), 'feature-index-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  return workspace;
}

function writeFeatureIndex(workspace: string, rows: string[]): void {
  const path = join(workspace, FEATURE_INDEX);
  mkdirSync(dirname(path), { recursive: true });
  const table = [
    '| Feature | Status | Vault-backed | Docs |',
    '| ------- | ------ | ------------ | ---- |',
    ...rows.map((name) => `| ${name} | ✅ | Yes | — |`),
  ].join('\n');
  writeFileSync(
    path,
    `# Feature documentation\n\n## Features Index\n\n${table}\n`,
  );
}

function writeDashboardRoute(workspace: string, slug: string): void {
  const path = join(workspace, DASHBOARD_ROOT, slug, 'page.tsx');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'export default function Page() { return null; }\n');
}

function writeExclusionsConfig(
  workspace: string,
  exclusions: unknown[] = [],
): void {
  const path = join(workspace, EXCLUSIONS_CONFIG);
  mkdirSync(dirname(path), { recursive: true });
  const config = {
    schemaVersion: 1,
    comment: 'Test exclusions',
    exclusions,
  };
  writeFileSync(path, JSON.stringify(config, null, 2));
}

function runChecker(workspace: string) {
  return spawnSync(
    process.execPath,
    [CHECKER, FEATURE_INDEX, DASHBOARD_ROOT, EXCLUSIONS_CONFIG],
    {
      cwd: workspace,
      encoding: 'utf8',
    },
  );
}

test('accepts a feature index whose rows resolve to real routes', (t) => {
  const workspace = createWorkspace(t);
  writeFeatureIndex(workspace, ['Tasks', 'Mobile Numbers']);
  writeDashboardRoute(workspace, 'tasks');
  writeDashboardRoute(workspace, 'mobile-numbers');
  writeExclusionsConfig(workspace);

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 feature\(s\) indexed/);
});

test('rejects a stale entry naming a route the app router no longer serves', (t) => {
  const workspace = createWorkspace(t);
  writeFeatureIndex(workspace, ['Tasks', 'Todo']);
  writeDashboardRoute(workspace, 'tasks');
  writeExclusionsConfig(workspace);

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /"Todo"/);
  assert.match(result.stderr, /\/dashboard\/todo/);
});

test('rejects an unindexed route unless it is explicitly excluded', (t) => {
  const workspace = createWorkspace(t);
  writeFeatureIndex(workspace, ['Tasks']);
  writeDashboardRoute(workspace, 'tasks');
  writeDashboardRoute(workspace, 'account');
  writeExclusionsConfig(workspace);

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /account.*no entry/);
});

test('accepts an unindexed route when it is explicitly excluded', (t) => {
  const workspace = createWorkspace(t);
  writeFeatureIndex(workspace, ['Tasks']);
  writeDashboardRoute(workspace, 'tasks');
  writeDashboardRoute(workspace, 'account');
  writeExclusionsConfig(workspace, [
    { route: 'account', reason: 'Platform-level route' },
  ]);

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
});

test('rejects a stale exclusion naming a route that no longer exists', (t) => {
  const workspace = createWorkspace(t);
  writeFeatureIndex(workspace, ['Tasks']);
  writeDashboardRoute(workspace, 'tasks');
  writeExclusionsConfig(workspace, [
    { route: 'account', reason: 'Platform-level route' },
  ]);

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /account.*stale/);
});

test('rejects an exclusion that carries no written reason', (t) => {
  const workspace = createWorkspace(t);
  writeFeatureIndex(workspace, ['Tasks']);
  writeDashboardRoute(workspace, 'tasks');
  writeDashboardRoute(workspace, 'account');
  writeExclusionsConfig(workspace, [{ route: 'account', reason: ' ' }]);

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /account.*no written reason/);
});

test('rejects an exclusion listed twice for the same route', (t) => {
  const workspace = createWorkspace(t);
  writeFeatureIndex(workspace, ['Tasks']);
  writeDashboardRoute(workspace, 'tasks');
  writeDashboardRoute(workspace, 'account');
  writeExclusionsConfig(workspace, [
    { route: 'account', reason: 'Platform-level route' },
    { route: 'account', reason: 'Account settings' },
  ]);

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /account.*listed twice/);
});

test('rejects a stale exclusion naming a route the index now covers', (t) => {
  const workspace = createWorkspace(t);
  writeFeatureIndex(workspace, ['Tasks', 'Account']);
  writeDashboardRoute(workspace, 'tasks');
  writeDashboardRoute(workspace, 'account');
  writeExclusionsConfig(workspace, [
    { route: 'account', reason: 'Platform-level route' },
  ]);

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /account.*now has a feature-index entry/);
});

test('cannot run when the feature index is missing', (t) => {
  const workspace = createWorkspace(t);
  writeDashboardRoute(workspace, 'tasks');
  writeExclusionsConfig(workspace);

  const result = runChecker(workspace);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /not found/);
});

test('cannot run when the dashboard root is missing', (t) => {
  const workspace = createWorkspace(t);
  writeFeatureIndex(workspace, ['Tasks']);
  writeExclusionsConfig(workspace);

  const result = runChecker(workspace);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /not found/);
});

test('cannot run when the exclusions config is missing', (t) => {
  const workspace = createWorkspace(t);
  writeFeatureIndex(workspace, ['Tasks']);
  writeDashboardRoute(workspace, 'tasks');

  const result = runChecker(workspace);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /not found/);
});

test('cannot run when the feature index has no Features Index section', (t) => {
  const workspace = createWorkspace(t);
  writeDashboardRoute(workspace, 'tasks');
  writeExclusionsConfig(workspace);
  const path = join(workspace, FEATURE_INDEX);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '# Feature documentation\n\nNo table here.\n');

  const result = runChecker(workspace);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Features Index/);
});

test('cannot run when the exclusions config is not valid JSON', (t) => {
  const workspace = createWorkspace(t);
  writeFeatureIndex(workspace, ['Tasks']);
  writeDashboardRoute(workspace, 'tasks');
  const path = join(workspace, EXCLUSIONS_CONFIG);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '{ not json');

  const result = runChecker(workspace);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /could not parse/);
});

test('cannot run when the exclusions config has no exclusions array', (t) => {
  const workspace = createWorkspace(t);
  writeFeatureIndex(workspace, ['Tasks']);
  writeDashboardRoute(workspace, 'tasks');
  const path = join(workspace, EXCLUSIONS_CONFIG);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ schemaVersion: 1 }));

  const result = runChecker(workspace);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /no "exclusions" array/);
});
