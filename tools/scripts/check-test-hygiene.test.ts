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
    /Checked 2 Jest files and 1 Contract Suite: 1 error\(s\), 0 warning\(s\)/,
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

test('a tools/scripts Contract Suite with a node:assert call passes', (t) => {
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
  assert.match(result.stdout, /PASS — asserts with node:assert/);
});

test('a tools/scripts Contract Suite with no assertion fails, naming the file', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'tools/scripts/lib/widget.test.ts',
    "import test from 'node:test';\n" +
      "test('widget', () => { console.info('no assertion'); });\n",
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR no-assertions/);
  assert.match(result.stdout, new RegExp(file.replace(/[/\\]/g, '.')));
});

test('a tools/qa Contract Suite with a node:assert call passes', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'tools/qa/lib/widget.test.ts',
    "import assert from 'node:assert/strict';\n" +
      "import test from 'node:test';\n" +
      "test('widget', () => { assert.ok(true); });\n",
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS — asserts with node:assert/);
});

test('a tools/qa Contract Suite with no assertion fails, naming the file', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'tools/qa/lib/widget.test.ts',
    "import test from 'node:test';\n" +
      "test('widget', () => { console.info('no assertion'); });\n",
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR no-assertions/);
  assert.ok(
    result.stdout.includes(file),
    `expected stdout to name ${file}:\n${result.stdout}`,
  );
});

test('a tools/qa spec using node:assert is not a Contract Suite and fails the Jest no-assertions rule', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'tools/qa/lib/widget.spec.ts',
    "import assert from 'node:assert/strict';\n" +
      "import test from 'node:test';\n" +
      "test('widget', () => { assert.ok(true); });\n",
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR no-assertions/);
  assert.match(result.stdout, /No expect\(\) calls found/);
  assert.doesNotMatch(result.stdout, /asserts with node:assert/);
});

test('a tools/scripts Contract Suite passes via a local helper whose exported body asserts', (t) => {
  const workspace = createWorkspace(t);
  writeFixture(
    workspace,
    'tools/scripts/lib/harness.ts',
    "import assert from 'node:assert/strict';\n" +
      'export function expectAllowed(value: string): void {\n' +
      "  assert.equal(value, 'allowed');\n" +
      '}\n',
  );
  const file = writeFixture(
    workspace,
    'tools/scripts/lib/widget.test.ts',
    "import test from 'node:test';\n" +
      "import { expectAllowed } from './harness.ts';\n\n" +
      "test('widget', () => { expectAllowed('allowed'); });\n",
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS — asserts with node:assert/);
});

test('a tools/scripts Contract Suite still fails when its called helper does not assert', (t) => {
  const workspace = createWorkspace(t);
  writeFixture(
    workspace,
    'tools/scripts/lib/harness.ts',
    'export function buildContext(value: string): string {\n' +
      '  return value;\n' +
      '}\n',
  );
  const file = writeFixture(
    workspace,
    'tools/scripts/lib/widget.test.ts',
    "import test from 'node:test';\n" +
      "import { buildContext } from './harness.ts';\n\n" +
      "test('widget', () => { buildContext('allowed'); });\n",
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR no-assertions/);
});

test('a tools/scripts Contract Suite asserting via the test-context t.assert passes', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'tools/scripts/lib/widget.test.ts',
    "import test from 'node:test';\n" +
      "test('widget', (t) => { t.assert.ok(true); });\n",
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS — asserts with node:assert/);
});

test('a tools/scripts Contract Suite whose only call is console.assert fails', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'tools/scripts/lib/widget.test.ts',
    "import test from 'node:test';\n" +
      "test('widget', () => { console.assert(true); });\n",
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR no-assertions/);
});

test('a tools/scripts Contract Suite that calls only foo.assert fails even when it imports node:assert', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'tools/scripts/lib/widget.test.ts',
    "import assert from 'node:assert/strict';\n" +
      "import test from 'node:test';\n" +
      'const foo = { assert: () => true };\n' +
      "test('widget', () => { foo.assert(true); });\n",
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR no-assertions/);
});

test('a tools/scripts Contract Suite with a bare assert() and no node:assert import fails', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'tools/scripts/lib/widget.test.ts',
    "import test from 'node:test';\n" +
      "test('widget', () => { assert(true); });\n",
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR no-assertions/);
});

test('a tools/scripts Contract Suite honours a node:assert import under a renamed local name', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'tools/scripts/lib/widget.test.ts',
    "import { strict as check } from 'node:assert';\n" +
      "import test from 'node:test';\n" +
      "test('widget', () => { check.equal(1, 1); });\n",
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS — asserts with node:assert/);
});

test('a tools/scripts Contract Suite is not credited for a helper whose body calls console.assert', (t) => {
  const workspace = createWorkspace(t);
  writeFixture(
    workspace,
    'tools/scripts/lib/harness.ts',
    "import assert from 'node:assert/strict';\n" +
      'export function expectAllowed(value: string): void {\n' +
      "  console.assert(value === 'allowed');\n" +
      '}\n',
  );
  const file = writeFixture(
    workspace,
    'tools/scripts/lib/widget.test.ts',
    "import test from 'node:test';\n" +
      "import { expectAllowed } from './harness.ts';\n\n" +
      "test('widget', () => { expectAllowed('allowed'); });\n",
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR no-assertions/);
});

test('a Jest spec under tools/scripts is unaffected by the Contract Suite assertion rule', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'tools/scripts/lib/widget.spec.ts',
    "test('widget', () => { expect(true).toBe(true); });\n",
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS — no mechanical issues/);
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

// random-looking-fixture (GitGuardian Generic High Entropy Secret, PR #1513).
// Every random value below is joined at runtime from short pieces, so this
// suite's own source never carries a random-looking literal bound to a
// secret-sounding name: the rule scans this file too.
// Built at runtime from short pieces on purpose: the rule reads literals, so
// a random value written whole here would fail this suite's own hygiene run.
// That runtime gap is the one the checker header declares, not a dodge of it.
const RANDOM_HEX_32 = ['a3f9c2d8', 'e1b74f6a', '9c0d2e5f', '8a1b3c4d'].join('');
const RANDOM_HEX_40 = [
  'a3f9c2d8',
  'e1b74f6a',
  '9c0d2e5f',
  '8a1b3c4d',
  '7f2e0b9a',
].join('');
const RANDOM_HEX_64 = [
  'a3f9c2d8',
  'e1b74f6a',
  '9c0d2e5f',
  '8a1b3c4d',
  '7f2e0b9a',
  'd4c6a1e3',
  '5b8f0c2d',
  'e9a7d3b1',
].join('');
const RANDOM_MIXED_24 = ['Qx4mR9tL', 'p2vHnWc8', 'eYk3Fj7N'].join('');
// A block of 9 characters: one past the period-8 exemption, so it must flag.
const PERIOD_9_BLOCK = ['a3f9c2b1', 'd'].join('');

interface ReportedFinding {
  level: string;
  rule: string;
  line: number;
  message: string;
}

/** Every finding the `--json` report carries, across all checked files. */
function reportedFindings(stdout: string): ReportedFinding[] {
  const report = JSON.parse(stdout) as {
    results: { findings: ReportedFinding[] }[];
  };
  return report.results.flatMap((result) => result.findings);
}

function randomLookingFindings(stdout: string): ReportedFinding[] {
  return reportedFindings(stdout).filter(
    (finding) => finding.rule === 'random-looking-fixture',
  );
}

test('flags a random hex value bound to HEX_TOKEN in a Jest spec, on the binding line', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'hex.test.ts',
    [
      "test('hex', () => {",
      `  const HEX_TOKEN = '${RANDOM_HEX_32}';`,
      '  expect(HEX_TOKEN.length).toBe(32);',
      '});',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, '--json', file);
  const findings = randomLookingFindings(result.stdout);

  assert.equal(result.status, 1, result.stdout);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, 'error');
  assert.equal(findings[0].line, 2);
  assert.match(findings[0].message, /HEX_TOKEN/);
  assert.match(
    findings[0].message,
    /docs\/testing\/README\.md#credentials-in-test-fixtures/,
  );
});

test('flags a random mixed-case value under a quoted access_token key in a Contract Suite that asserts', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'tools/scripts/lib/widget.test.ts',
    [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      '',
      "test('widget', () => {",
      `  const fixture = { 'access_token': '${RANDOM_MIXED_24}' };`,
      '  assert.equal(fixture.access_token.length, 24);',
      '});',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, '--json', file);
  const reported = reportedFindings(result.stdout);
  const findings = randomLookingFindings(result.stdout);

  assert.equal(result.status, 1, result.stdout);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 5);
  assert.match(findings[0].message, /access_token/);
  assert.equal(
    reported.some((finding) => finding.rule === 'no-assertions'),
    false,
  );
});

test('flags a multi-line TEST_KEY binding on the line that names it', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'multiline.test.ts',
    [
      "test('multi-line', () => {",
      '  const TEST_KEY =',
      `    '${RANDOM_HEX_64}';`,
      '  expect(TEST_KEY.length).toBe(64);',
      '});',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, '--json', file);
  const findings = randomLookingFindings(result.stdout);

  assert.equal(result.status, 1, result.stdout);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 2);
  assert.match(findings[0].message, /TEST_KEY/);
});

test('flags base64 of a random mixed-case string under access_token in a Contract Suite that asserts', (t) => {
  const workspace = createWorkspace(t);
  const encoded = Buffer.from(RANDOM_MIXED_24).toString('base64');
  const file = writeFixture(
    workspace,
    'tools/scripts/lib/encoded.test.ts',
    [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      '',
      "test('encoded', () => {",
      `  const fixture = { 'access_token': '${encoded}' };`,
      '  assert.equal(fixture.access_token.length, 32);',
      '});',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, '--json', file);
  const findings = randomLookingFindings(result.stdout);

  assert.equal(result.status, 1, result.stdout);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 5);
  assert.match(findings[0].message, /access_token/);
});

// Jest specs whose bound value is random-looking in a shape the rule must still
// catch: mixed-case letters with no digit; base64 of random text, which decodes
// to one unbroken run, or to a run split by a separator that is not itself
// readable; a period-9 block, just past the period-8 exemption; and a
// 17-character hex value, not a multiple of four, so not base64 at all.
const FLAGGED_FIXTURES: [string, string, string][] = [
  [
    'a mixed-case letters-only value bound to SECRET_KEY',
    'SECRET_KEY',
    `const SECRET_KEY = '${['QxRmTpLw', 'KjNbVcHg'].join('')}';`,
  ],
  [
    'base64 of a random string bound to SECRET_KEY',
    'SECRET_KEY',
    `const SECRET_KEY = '${Buffer.from(['a3f9c2d8', 'e1b74f6a'].join('')).toString('base64')}';`,
  ],
  [
    'base64 of a random hex pair joined by a hyphen bound to SECRET_KEY',
    'SECRET_KEY',
    `const SECRET_KEY = '${Buffer.from(['a3f9c2d8', '-', 'e1b74f6a'].join('')).toString('base64')}';`,
  ],
  [
    'base64 of a random hex pair joined by a dot bound to SECRET_KEY',
    'SECRET_KEY',
    `const SECRET_KEY = '${Buffer.from(['a3f9c2d8', '.', 'e1b74f6a'].join('')).toString('base64')}';`,
  ],
  [
    'base64 of a UUID-shaped value bound to sessionToken',
    'sessionToken',
    `const sessionToken = '${Buffer.from(['a3f9c2d8', '-', 'e1b7', '-', '4f6a', '-', '9c0d', '-', '2e5f8a1b', '3c4d'].join('')).toString('base64')}';`,
  ],
  [
    'a period-9 block repeated twice bound to SECRET_KEY',
    'SECRET_KEY',
    `const SECRET_KEY = '${PERIOD_9_BLOCK + PERIOD_9_BLOCK}';`,
  ],
  [
    'a 17-character random hex value bound to SECRET_KEY',
    'SECRET_KEY',
    `const SECRET_KEY = '${['a3f9c2d8', 'e1b74f6a', '9'].join('')}';`,
  ],
  [
    'a random lowercase one-case value bound to SECRET_KEY',
    'SECRET_KEY',
    `const SECRET_KEY = '${['qwmzkxpv', 'bnrtyhgl'].join('')}';`,
  ],
  [
    'a random uppercase one-case value bound to SECRET_KEY',
    'SECRET_KEY',
    `const SECRET_KEY = '${['QWMZKXPV', 'BNRTYHGL'].join('')}';`,
  ],
  [
    'base64 of a readable-looking run with a 16-letter piece bound to SECRET_KEY',
    'SECRET_KEY',
    `const SECRET_KEY = '${Buffer.from(['qwmzkxpv', 'bnrtyhgl', '-', 'zxcvbnma', 'sdfghjkl'].join('')).toString('base64')}';`,
  ],
  [
    'base64 of a run with a 15-letter piece and an 8-digit piece bound to SECRET_KEY',
    'SECRET_KEY',
    `const SECRET_KEY = '${Buffer.from(['kqzvbwxn', 'mtrplgh', '-', '48213907', '-', 'zxqvbfjt', 'w'].join('')).toString('base64')}';`,
  ],
];

for (const [shape, name, binding] of FLAGGED_FIXTURES) {
  test(`flags ${shape}, on the binding line`, (t) => {
    const workspace = createWorkspace(t);
    const file = writeFixture(
      workspace,
      'flagged.test.ts',
      [
        "test('flagged fixture', () => {",
        `  ${binding}`,
        '  expect(1).toBe(1);',
        '});',
        '',
      ].join('\n'),
    );

    const result = runChecker(workspace, '--json', file);
    const findings = randomLookingFindings(result.stdout);

    assert.equal(result.status, 1, result.stdout);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].line, 2);
    assert.match(findings[0].message, new RegExp(name));
  });
}

// Each row is a Jest spec whose only fixture is the shape under test. The
// expect() call keeps the no-assertions rule out of the way, so exit 0 means
// the fixture itself was accepted.
const EXEMPT_FIXTURES: [string, string][] = [
  [
    'a periodic value (period 8) bound to SECRET_KEY',
    `const SECRET_KEY = '${['0f1e2d3c', '0f1e2d3c', '0f1e2d3c', '0f1e2d3c'].join('')}';`,
  ],
  [
    'a sequential run bound to apiKey',
    `const apiKey = '${['01234567', '89abcdef'].join('')}';`,
  ],
  [
    'canonical base64 of printable text bound to credentialId',
    `const credentialId = '${Buffer.from('address-ct-123').toString('base64')}';`,
  ],
  [
    'a random value bound to a neutral name (commitSha)',
    `const commitSha = '${RANDOM_HEX_40}';`,
  ],
  [
    'a single-case letters value bound to wrappedMasterKey',
    `const wrappedMasterKey = '${['WRAPPEDKEY', 'WRAPPEDKEY'].join('')}';`,
  ],
  [
    'a padded periodic value bound to authTag',
    `const authTag = '${'A'.repeat(22)}==';`,
  ],
  [
    'a hyphenated value bound to token',
    `const config = { token: '${['valid', 'unsubscribe', 'token', '1234'].join('-')}' };`,
  ],
];

for (const [shape, binding] of EXEMPT_FIXTURES) {
  test(`passes ${shape}`, (t) => {
    const workspace = createWorkspace(t);
    const file = writeFixture(
      workspace,
      'exempt.test.ts',
      [
        "test('exempt fixture', () => {",
        `  ${binding}`,
        '  expect(1).toBe(1);',
        '});',
        '',
      ].join('\n'),
    );

    const result = runChecker(workspace, '--json', file);

    assert.equal(result.status, 0, result.stdout);
    assert.deepEqual(randomLookingFindings(result.stdout), []);
  });
}
