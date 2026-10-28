import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isolateGitEnvironment } from './lib/git-environment.ts';

// Husky runs this suite with the hook's GIT_DIR; see git-environment.ts.
isolateGitEnvironment();

const CHECKER = join(
  dirname(fileURLToPath(import.meta.url)),
  'check-test-hygiene.ts',
);

function createWorkspace(t: TestContext) {
  const workspace = mkdtempSync(join(tmpdir(), 'test-hygiene-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  return workspace;
}

function writeFixture(
  workspace: string,
  relativePath: string,
  content: string,
) {
  const file = join(workspace, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

function runChecker(workspace: string, ...args: string[]) {
  return spawnSync(process.execPath, [CHECKER, ...args], {
    cwd: workspace,
    encoding: 'utf8',
  });
}

function git(workspace: string, ...args: string[]) {
  return execFileSync('git', args, {
    cwd: workspace,
    encoding: 'utf8',
  });
}

function initializeRepository(workspace: string) {
  git(workspace, 'init', '--quiet');
  git(workspace, 'config', 'user.email', 'test@example.com');
  git(workspace, 'config', 'user.name', 'Test');
}

test('accepts a file with a direct Jest assertion', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'direct.test.ts',
    "test('direct', () => { expect(1).toBe(1); });\n",
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS — no mechanical issues/);
});

test('accepts a called local helper whose exported body asserts', (t) => {
  const workspace = createWorkspace(t);
  writeFixture(
    workspace,
    'assertions.ts',
    [
      'export function expectAllowed(value: string): void {',
      "  expect(value).toBe('allowed');",
      '}',
      '',
    ].join('\n'),
  );
  const file = writeFixture(
    workspace,
    'helper.test.ts',
    [
      "import { expectAllowed } from './assertions';",
      '',
      "test('helper', () => {",
      "  expectAllowed('allowed');",
      '});',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /no-assertions/);
});

test('rejects a helper name when its exported body has no assertion', (t) => {
  const workspace = createWorkspace(t);
  writeFixture(
    workspace,
    'assertions.ts',
    'export function expectAllowed(): boolean { return true; }\n',
  );
  const file = writeFixture(
    workspace,
    'false-helper.test.ts',
    [
      "import { expectAllowed } from './assertions';",
      '',
      "test('false helper', () => { expectAllowed(); });",
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR no-assertions/);
});

// Assertion credit used to be decided by the first braced block after the
// declaration, which is the body only when nothing earlier in the signature
// carries one. Ordinary TypeScript breaks that: an inline parameter type, a
// braced default, a destructured parameter, or an object return type all put a
// brace in front of the body. Each shape below silently stripped credit from
// every spec that called the helper, turning a real assertion into a
// no-assertions error.
const SIGNATURE_SHAPES = [
  [
    'an inline object parameter type and a braced default',
    'export function expectAllowed(\n  value: string,\n  options: { sandbox?: boolean } = {},\n): void {\n  expect(value).toBe(options.sandbox ? true : true);\n}\n',
  ],
  [
    'a destructured parameter',
    'export function expectAllowed({ value }: { value: string }): void {\n  expect(value).toBe(true);\n}\n',
  ],
  [
    'an object return type',
    'export function expectAllowed(value: string): { ok: boolean } {\n  expect(value).toBe(true);\n  return { ok: true };\n}\n',
  ],
  [
    'an arrow with a braced default',
    'export const expectAllowed = (options: { a?: number } = {}): void => {\n  expect(options).toBeDefined();\n};\n',
  ],
  [
    'a generic and an object parameter',
    'export function expectAllowed<T>(options: { value: T }): void {\n  expect(options.value).toBe(true);\n}\n',
  ],
];

for (const [shape, source] of SIGNATURE_SHAPES) {
  test(`credits a helper that asserts despite ${shape}`, (t) => {
    const workspace = createWorkspace(t);
    writeFixture(workspace, 'assertions.ts', source);
    const file = writeFixture(
      workspace,
      'shape.test.ts',
      [
        "import { expectAllowed } from './assertions';",
        '',
        "test('helper', () => {",
        "  expectAllowed('allowed');",
        '});',
        '',
      ].join('\n'),
    );

    const result = runChecker(workspace, file);

    assert.equal(result.status, 0, result.stdout);
    assert.doesNotMatch(result.stdout, /no-assertions/);
  });
}

test('still rejects a non-asserting helper that carries a braced signature', (t) => {
  const workspace = createWorkspace(t);
  writeFixture(
    workspace,
    'assertions.ts',
    'export function expectAllowed(options: { a?: number } = {}): number {\n  return options.a ?? 1;\n}\n',
  );
  const file = writeFixture(
    workspace,
    'still-false-helper.test.ts',
    [
      "import { expectAllowed } from './assertions';",
      '',
      "test('false helper', () => { expectAllowed(); });",
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR no-assertions/);
});

test('--all checks tracked Jest files, excludes E2E, and prints concise output', (t) => {
  const workspace = createWorkspace(t);
  initializeRepository(workspace);
  writeFixture(
    workspace,
    'libs/example/src/valid.test.ts',
    "test('valid', () => { expect(true).toBe(true); });\n",
  );
  writeFixture(
    workspace,
    'libs/example/src/invalid.spec.tsx',
    "test('invalid', () => { console.info('missing'); });\n",
  );
  writeFixture(
    workspace,
    'apps/web-e2e/src/e2e/ignored.spec.ts',
    "test('e2e', () => { console.info('not Jest'); });\n",
  );
  writeFixture(
    workspace,
    'tools/scripts/lib/widget.test.ts',
    "import assert from 'node:assert/strict';\n" +
      "import test from 'node:test';\n" +
      "test('widget', () => { assert.ok(true); });\n",
  );
  git(workspace, 'add', '.');

  const result = runChecker(workspace, '--all');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /invalid\.spec\.tsx/);
  assert.doesNotMatch(result.stdout, /valid\.test\.ts\n\s+PASS/);
  assert.doesNotMatch(result.stdout, /ignored\.spec\.ts/);
  assert.doesNotMatch(result.stdout, /widget\.test\.ts/);
  assert.match(
    result.stdout,
    /Checked 2 Jest files: 1 error\(s\), 0 warning\(s\)/,
  );
});

test('--staged checks only staged added or modified Jest files', (t) => {
  const workspace = createWorkspace(t);
  initializeRepository(workspace);
  writeFixture(
    workspace,
    'staged.test.ts',
    "test('staged', () => { expect(true).toBe(true); });\n",
  );
  writeFixture(
    workspace,
    'unstaged.test.ts',
    "test('unstaged', () => { expect(true).toBe(true); });\n",
  );
  git(workspace, 'add', '.');
  git(workspace, 'commit', '--quiet', '-m', 'baseline');

  writeFixture(
    workspace,
    'staged.test.ts',
    "test('staged', () => { console.info('missing'); });\n",
  );
  writeFixture(
    workspace,
    'unstaged.test.ts',
    "test('unstaged', () => { console.info('missing'); });\n",
  );
  git(workspace, 'add', 'staged.test.ts');

  const result = runChecker(workspace, '--staged');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /staged\.test\.ts/);
  assert.doesNotMatch(result.stdout, /unstaged\.test\.ts/);
});

test('--staged succeeds when no Jest files are staged', (t) => {
  const workspace = createWorkspace(t);
  initializeRepository(workspace);
  writeFixture(workspace, 'README.md', '# Fixture\n');
  git(workspace, 'add', 'README.md');

  const result = runChecker(workspace, '--staged');

  assert.equal(result.status, 0);
  assert.match(result.stdout, /No staged Jest files to check/);
});

test('weak assertion warnings remain non-blocking', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'warning.test.ts',
    "test('warning', () => { expect('value').toBeDefined(); });\n",
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /WARN\s+weak-assertions/);
});

test('explicit E2E paths remain skipped', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'apps/web-e2e/src/e2e/ignored.spec.ts',
    "test('e2e', () => { console.info('not Jest'); });\n",
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /SKIPPED \(E2E spec/);
});

test('explicit tools/scripts Contract Suite paths remain skipped', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'tools/scripts/lib/widget.test.ts',
    "import assert from 'node:assert/strict';\n" +
      "import test from 'node:test';\n" +
      "test('widget', () => { assert.ok(true); });\n",
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /SKIPPED \(Contract Suite/);
});

test('a Jest spec under tools/scripts is still checked, not skipped as a Contract Suite', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'tools/scripts/copilot-hooks/__tests__/widget.spec.ts',
    "test('widget', () => { console.info('no expect call'); });\n",
  );

  const result = runChecker(workspace, file);

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /SKIPPED/);
  assert.match(result.stdout, /no-assertions/);
});

test('missing input remains a bad invocation', (t) => {
  const workspace = createWorkspace(t);

  const result = runChecker(workspace);

  assert.equal(result.status, 2);
  assert.match(result.stdout, /Usage:/);
});
