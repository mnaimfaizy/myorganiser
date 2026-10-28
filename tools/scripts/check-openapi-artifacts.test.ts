import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECKER = join(
  dirname(fileURLToPath(import.meta.url)),
  'check-openapi-artifacts.ts',
);

// Neutral fixture roots, passed to the checker as argv[2] and argv[3].
const CLIENT = join('generated', 'client');
const SPEC = join('generated', 'spec.yaml');
const VERSION = '9.9.9';

function createWorkspace(t: TestContext) {
  const workspace = mkdtempSync(join(tmpdir(), 'openapi-artifacts-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeFileSync(
    join(workspace, 'package.json'),
    JSON.stringify({ name: 'fixture', version: VERSION }),
  );
  return workspace;
}

function writeSpec(workspace: string, version: string = VERSION) {
  mkdirSync(join(workspace, 'generated'), { recursive: true });
  writeFileSync(
    join(workspace, SPEC),
    `openapi: 3.0.0\ninfo:\n  title: fixture\n  version: ${version}\npaths: {}\n`,
  );
}

function writeClient(
  workspace: string,
  {
    files,
    versions,
  }: { files?: string[]; versions?: Record<string, string> } = {},
) {
  const names = files ?? ['api.ts', 'base.ts', 'configuration.ts'];
  mkdirSync(join(workspace, CLIENT, '.openapi-generator'), { recursive: true });
  writeFileSync(
    join(workspace, CLIENT, '.openapi-generator/FILES'),
    `${names.join('\n')}\n`,
  );
  for (const name of names) {
    const version = versions?.[name] ?? VERSION;
    writeFileSync(
      join(workspace, CLIENT, name),
      `/*\n * The version of the OpenAPI document: ${version}\n */\nexport const x = 1;\n`,
    );
  }
}

function runChecker(workspace: string) {
  return spawnSync(process.execPath, [CHECKER, CLIENT, SPEC], {
    cwd: workspace,
    encoding: 'utf8',
  });
}

test('accepts a spec and client at the current version', (t) => {
  const workspace = createWorkspace(t);
  writeSpec(workspace);
  writeClient(workspace);

  const result = runChecker(workspace);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /spec and 3 generated file\(s\) present at version 9\.9\.9/,
  );
});

test('rejects a generated file that was deleted', (t) => {
  const workspace = createWorkspace(t);
  writeSpec(workspace);
  writeClient(workspace);
  rmSync(join(workspace, CLIENT, 'api.ts'));

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /api\.ts is missing/);
  assert.match(result.stderr, /yarn openapi:sync/);
});

test('rejects a generated file that is empty', (t) => {
  const workspace = createWorkspace(t);
  writeSpec(workspace);
  writeClient(workspace);
  writeFileSync(join(workspace, CLIENT, 'api.ts'), '');

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /api\.ts is empty/);
});

test('rejects a client stamped with a stale spec version', (t) => {
  const workspace = createWorkspace(t);
  writeSpec(workspace);
  writeClient(workspace, { versions: { 'base.ts': '0.3.0' } });

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /base\.ts is not stamped with version 9\.9\.9/);
});

test('rejects a spec left behind at an older version', (t) => {
  const workspace = createWorkspace(t);
  writeSpec(workspace, '0.3.0');
  writeClient(workspace);

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /is at 0\.3\.0, expected 9\.9\.9/);
});

test('reads info.version rather than any nested version key', (t) => {
  const workspace = createWorkspace(t);
  mkdirSync(join(workspace, 'generated'), { recursive: true });
  writeFileSync(
    join(workspace, SPEC),
    `openapi: 3.0.0\ninfo:\n  title: fixture\n  version: 0.3.0\npaths:\n  /x:\n    get:\n      parameters:\n        - name: version\n          version: ${VERSION}\n`,
  );
  writeClient(workspace);

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /is at 0\.3\.0, expected 9\.9\.9/);
});

test('cannot run when the generator manifest is absent', (t) => {
  const workspace = createWorkspace(t);
  writeSpec(workspace);

  const result = runChecker(workspace);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /FILES not found/);
});

test('cannot run when the spec is absent', (t) => {
  const workspace = createWorkspace(t);
  writeClient(workspace);

  const result = runChecker(workspace);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /spec\.yaml not found/);
});
