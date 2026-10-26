import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { cleanGitEnv } from './testing/git-fixture-env.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CHECKER_SOURCE = join(SCRIPT_DIR, 'check-component-hygiene.mjs');
const SCAN_SOURCE = join(SCRIPT_DIR, 'lib', 'source-scan.ts');

function writeFixture(workspace, relativePath, content) {
  const file = join(workspace, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return relativePath;
}

/**
 * The exemption list as it appears in the checker's source, however many
 * entries it holds. Matching the whole literal — not the empty-array spelling —
 * is what lets a fixture start from a known list rather than from whatever this
 * repo currently exempts. Lazy to the first `];`, which no entry contains.
 */
const EXEMPTIONS_LITERAL = /const EXPORT_BASENAME_EXEMPTIONS = \[[\s\S]*?\];/;

function spliceExemptions(source, literal) {
  // The match is what is asserted, not that the text changed: splicing `[]`
  // into a checker whose list is already empty is a no-op, and that is the
  // state this repo is usually in.
  assert.ok(
    EXEMPTIONS_LITERAL.test(source),
    'exemption splice did not match source',
  );
  return source.replace(
    EXEMPTIONS_LITERAL,
    `const EXPORT_BASENAME_EXEMPTIONS = ${literal};`,
  );
}

function createWorkspace(t) {
  const workspace = mkdtempSync(join(tmpdir(), 'component-hygiene-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  // A fixture workspace inherits none of this repo's exemptions. They name
  // paths under `libs/`, which a workspace holding two scripts does not have,
  // and the checker rejects an exemption naming a file that is gone — so the
  // first real entry added to the checker would otherwise fail every test in
  // this file at startup, which is how a documented mechanism ended up
  // unusable. What each test exempts is what it splices in for itself.
  writeFixture(
    workspace,
    'tools/scripts/check-component-hygiene.mjs',
    spliceExemptions(readFileSync(CHECKER_SOURCE, 'utf8'), '[]'),
  );
  writeFixture(
    workspace,
    'tools/scripts/lib/source-scan.ts',
    readFileSync(SCAN_SOURCE, 'utf8'),
  );

  return workspace;
}

function runChecker(workspace, ...args) {
  const checkerPath = join(
    workspace,
    'tools/scripts/check-component-hygiene.mjs',
  );
  return spawnSync(process.execPath, [checkerPath, ...args], {
    cwd: workspace,
    encoding: 'utf8',
  });
}

function git(workspace, ...args) {
  return execFileSync('git', args, {
    cwd: workspace,
    encoding: 'utf8',
    env: cleanGitEnv(),
  });
}

function initializeRepository(workspace) {
  git(workspace, 'init', '--quiet');
  git(workspace, 'config', 'user.email', 'test@example.com');
  git(workspace, 'config', 'user.name', 'Test');
}

test('explicit feature fixture with warning exits 0 and reports warning in advisory mode', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/WarningComponent.tsx',
    [
      "import * as React from 'react';",
      '',
      'export function WarningComponent() {',
      '  const handleClick = () => {};',
      '  return <button onClick={handleClick}>Click</button>;',
      '}',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /handler-not-memoized/);
  assert.match(result.stdout, /0 error\(s\), 1 warning\(s\)/);
});

test('feature fixture with warning exits 1 with --max-warnings=0 while retaining warning output', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/WarningComponent.tsx',
    [
      "import * as React from 'react';",
      '',
      'export function WarningComponent() {',
      '  const handleClick = () => {};',
      '  return <button onClick={handleClick}>Click</button>;',
      '}',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, '--max-warnings=0', file);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /handler-not-memoized/);
  assert.match(result.stdout, /0 error\(s\), 1 warning\(s\)/);
});

test('strict JSON warning exits 1 and produces exact top-level keys', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/WarningComponent.tsx',
    [
      "import * as React from 'react';",
      '',
      'export function WarningComponent() {',
      '  const handleClick = () => {};',
      '  return <button onClick={handleClick}>Click</button>;',
      '}',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, '--json', '--max-warnings=0', file);

  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(parsed), ['errors', 'warnings', 'results']);
  assert.equal(parsed.errors, 0);
  assert.equal(parsed.warnings, 1);
  assert.equal(parsed.results.length, 1);
  assert.equal(parsed.results[0].file, file);
  assert.equal(parsed.results[0].findings[0].rule, 'handler-not-memoized');
});

test('error fixture exits 1 in advisory and strict modes', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/ErrorComponent.tsx',
    [
      "import { Button } from '@myorganiser/web-ui/src/lib/components/button/Button';",
      '',
      'export function ErrorComponent() {',
      '  return <Button />;',
      '}',
      '',
    ].join('\n'),
  );

  const advisoryResult = runChecker(workspace, file);
  assert.equal(advisoryResult.status, 1);
  assert.match(advisoryResult.stdout, /deep-import/);

  const strictResult = runChecker(workspace, '--max-warnings=0', file);
  assert.equal(strictResult.status, 1);
  assert.match(strictResult.stdout, /deep-import/);
});

test('CLI misuse exits 2 and prints usage information', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/Component.tsx',
    'export function Component() { return <div />; }\n',
  );

  const cases = [
    ['--unknown'],
    ['--max-warnings=1'],
    ['--all', '--staged'],
    ['--all', file],
    ['--staged', file],
  ];

  for (const args of cases) {
    const result = runChecker(workspace, ...args);
    assert.equal(
      result.status,
      2,
      `Expected exit code 2 for args: ${args.join(' ')}`,
    );
    assert.match(result.stderr, /Usage:/);
  }
});

test('empty staged selection exits 0 in text and JSON modes', (t) => {
  const workspace = createWorkspace(t);
  initializeRepository(workspace);
  writeFixture(workspace, 'README.md', '# Readme\n');
  git(workspace, 'add', 'README.md');

  const textResult = runChecker(workspace, '--staged');
  assert.equal(textResult.status, 0);
  assert.equal(textResult.stdout.trim(), 'No staged component files to check.');

  const jsonResult = runChecker(workspace, '--staged', '--json');
  assert.equal(jsonResult.status, 0);
  const parsed = JSON.parse(jsonResult.stdout);
  assert.deepEqual(parsed, { errors: 0, warnings: 0, results: [] });
});

test('--staged inspects staged added/modified files and ignores unstaged files', (t) => {
  const workspace = createWorkspace(t);
  initializeRepository(workspace);

  const modifiedFile = writeFixture(
    workspace,
    'libs/web/pages/todos/src/ModifiedComponent.tsx',
    'export function ModifiedComponent() { return <div />;\n }\n',
  );
  git(workspace, 'add', modifiedFile);
  git(workspace, 'commit', '--quiet', '-m', 'initial');

  writeFixture(
    workspace,
    modifiedFile,
    [
      "import * as React from 'react';",
      '',
      'export function ModifiedComponent() {',
      '  const handleClick = () => {};',
      '  return <button onClick={handleClick}>Click</button>;',
      '}',
      '',
    ].join('\n'),
  );
  git(workspace, 'add', modifiedFile);

  const addedFile = writeFixture(
    workspace,
    'libs/web/pages/todos/src/AddedComponent.tsx',
    'export function AddedComponent() { return <div />; }\n',
  );
  git(workspace, 'add', addedFile);

  const unstagedFile = writeFixture(
    workspace,
    'libs/web/pages/todos/src/UnstagedComponent.tsx',
    "import { Button } from '@myorganiser/web-ui/src/lib/components/button/Button';\nexport function UnstagedComponent() { return <Button />; }\n",
  );

  const result = runChecker(workspace, '--staged', '--json');

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  const resultFiles = parsed.results.map((r) => r.file);

  assert.ok(resultFiles.includes(addedFile));
  assert.ok(resultFiles.includes(modifiedFile));
  assert.equal(resultFiles.length, 2);
  assert.ok(!resultFiles.includes(unstagedFile));

  const modifiedResult = parsed.results.find((r) => r.file === modifiedFile);
  assert.ok(modifiedResult);
  assert.ok(
    modifiedResult.findings.some((f) => f.rule === 'handler-not-memoized'),
  );
});

test('--staged handles renamed files with spaces in destination path', (t) => {
  const workspace = createWorkspace(t);
  initializeRepository(workspace);

  const oldPath = writeFixture(
    workspace,
    'libs/web/pages/todos/src/OldComponent.tsx',
    'export function OldComponent() { return <div />; }\n',
  );
  git(workspace, 'add', oldPath);
  git(workspace, 'commit', '--quiet', '-m', 'initial');

  const newPath = 'libs/web/pages/todos/src/New Component With Spaces.tsx';
  git(workspace, 'mv', oldPath, newPath);

  const result = runChecker(workspace, '--staged', '--json');

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  const resultFiles = parsed.results.map((r) => r.file);
  assert.deepEqual(resultFiles, [newPath]);
  assert.ok(!resultFiles.includes(oldPath));
});

test('--staged ignores deleted component files and out-of-scope files', (t) => {
  const workspace = createWorkspace(t);
  initializeRepository(workspace);

  const componentPath = writeFixture(
    workspace,
    'libs/web/pages/todos/src/ToDelete.tsx',
    'export function ToDelete() { return <div />; }\n',
  );
  git(workspace, 'add', componentPath);
  git(workspace, 'commit', '--quiet', '-m', 'initial');

  git(workspace, 'rm', componentPath);

  writeFixture(workspace, 'README.md', '# Readme\n');
  writeFixture(
    workspace,
    'libs/web/pages/todos/src/Component.test.tsx',
    "test('noop', () => {});\n",
  );
  writeFixture(
    workspace,
    'libs/web/pages/todos/src/Component.stories.tsx',
    'export default {};\n',
  );
  writeFixture(workspace, 'tools/scripts/something.js', 'console.log();\n');

  git(
    workspace,
    'add',
    'README.md',
    'libs/web/pages/todos/src/Component.test.tsx',
    'libs/web/pages/todos/src/Component.stories.tsx',
    'tools/scripts/something.js',
  );

  const result = runChecker(workspace, '--staged', '--json');

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed, { errors: 0, warnings: 0, results: [] });
  assert.doesNotMatch(result.stderr, /unreadable/);
});

test('--staged outside a Git repository fails with nonzero exit code', (t) => {
  const workspace = createWorkspace(t);

  const result = runChecker(workspace, '--staged');

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /No staged component files to check/);
});

test('vault UI component is inspected rather than skipped', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/vault-ui/src/lib/ExampleNotice.tsx',
    [
      "import * as React from 'react';",
      '',
      'export function ExampleNotice() {',
      '  const handleClick = () => {};',
      '  return <button onClick={handleClick}>Click</button>;',
      '}',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, file);

  // The regression this guards: the whole library used to fall out of
  // scopeOf() and report SKIPPED, so nothing in it was ever inspected.
  assert.doesNotMatch(result.stdout, /SKIPPED/);
  assert.match(result.stdout, /handler-not-memoized/);
});

test('vault UI component is checked against primitive rules too, not only feature rules', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/vault-ui/src/lib/TemplateClassNotice.tsx',
    [
      "import * as React from 'react';",
      '',
      'export interface TemplateClassNoticeProps {',
      '  className?: string;',
      '}',
      '',
      'export function TemplateClassNotice({ className }: TemplateClassNoticeProps) {',
      '  return <div className={`flex ${className}`}>hi</div>;',
      '}',
      '',
    ].join('\n'),
  );

  // classname-not-cn is a primitive rule. A Vault UI Component filed under the
  // feature scope would not be checked for it, which is what the declarative
  // SCOPE_RULES table exists to prevent.
  const result = runChecker(workspace, file);

  assert.match(result.stdout, /classname-not-cn/);
});

test('vault UI component missing from its own barrel is reported', (t) => {
  const workspace = createWorkspace(t);
  writeFixture(
    workspace,
    'libs/web/vault-ui/src/index.ts',
    "export * from './lib/SomethingElse';\n",
  );
  const file = writeFixture(
    workspace,
    'libs/web/vault-ui/src/lib/UnexportedNotice.tsx',
    [
      "import * as React from 'react';",
      '',
      'export function UnexportedNotice() {',
      '  return <div>hi</div>;',
      '}',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /missing-barrel-export/);
  assert.match(result.stdout, /libs\/web\/vault-ui\/src\/index\.ts/);
});

test('a hook beside the components is not inspected as a component', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/vault-ui/src/lib/useSomething.ts',
    ['export function useSomething() {', '  return 1;', '}', ''].join('\n'),
  );

  const result = runChecker(workspace, file);

  // This library keeps hooks and copy modules beside its components. A .ts
  // hook reporting PASS as a component would be a false clean.
  assert.match(result.stdout, /SKIPPED/);
});

function writeWebLibraryProject(workspace, lib, tags) {
  writeFixture(
    workspace,
    `libs/web/${lib}/project.json`,
    `${JSON.stringify({ name: `web-${lib}`, tags }, null, 2)}\n`,
  );
}

const FEATURE_LIBRARY_TAGS = ['type:feature', 'scope:web', 'tier:agent'];

test('a component in a type:feature scope:web library is inspected as a Feature Library Component', (t) => {
  const workspace = createWorkspace(t);
  writeWebLibraryProject(workspace, 'example-places', FEATURE_LIBRARY_TAGS);
  writeFixture(
    workspace,
    'libs/web/example-places/src/index.ts',
    "export * from './lib/PlaceNotice/PlaceNotice';\n",
  );
  const file = writeFixture(
    workspace,
    'libs/web/example-places/src/lib/PlaceNotice/PlaceNotice.tsx',
    [
      "import * as React from 'react';",
      '',
      'export interface PlaceNoticeProps {',
      '  className?: string;',
      '}',
      '',
      'export function PlaceNotice({ className }: PlaceNoticeProps) {',
      '  const handleClick = () => {};',
      '  return <button className={`flex ${className}`} onClick={handleClick}>hi</button>;',
      '}',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, '--json', file);
  const report = JSON.parse(result.stdout);

  // The regression this guards: a new shared feature library fell out of
  // scopeOf() and its components were never inspected. The scope comes from
  // the project tags, not a hard-coded library name.
  assert.equal(report.results[0].scope, 'feature-library');
  const rules = report.results[0].findings.map((finding) => finding.rule);
  // One primitive rule and one feature rule: the scope takes both sets.
  assert.ok(rules.includes('classname-not-cn'), rules.join(', '));
  assert.ok(rules.includes('handler-not-memoized'), rules.join(', '));
  assert.ok(!rules.includes('missing-barrel-export'), rules.join(', '));
});

test('a Feature Library compound root missing from its own barrel is reported, a part beside it is not', (t) => {
  const workspace = createWorkspace(t);
  writeWebLibraryProject(workspace, 'example-places', FEATURE_LIBRARY_TAGS);
  writeFixture(
    workspace,
    'libs/web/example-places/src/index.ts',
    "export * from './lib/SomethingElse';\n",
  );
  const root = writeFixture(
    workspace,
    'libs/web/example-places/src/lib/PlaceNotice/PlaceNotice.tsx',
    [
      "import * as React from 'react';",
      '',
      'export function PlaceNotice() {',
      '  return <div>hi</div>;',
      '}',
      '',
    ].join('\n'),
  );
  const part = writeFixture(
    workspace,
    'libs/web/example-places/src/lib/PlaceNotice/PlaceNoticeBody.tsx',
    [
      "import * as React from 'react';",
      '',
      'export function PlaceNoticeBody() {',
      '  return <div>body</div>;',
      '}',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, '--json', root, part);
  const report = JSON.parse(result.stdout);
  const byFile = Object.fromEntries(
    report.results.map((entry) => [
      entry.file,
      entry.findings.map((finding) => finding.rule),
    ]),
  );

  assert.equal(result.status, 1);
  assert.deepEqual(byFile[root], ['missing-barrel-export']);
  assert.match(
    report.results[0].findings[0].message,
    /libs\/web\/example-places\/src\/index\.ts/,
  );
  assert.deepEqual(byFile[part], []);
});

test('a libs/web library not tagged type:feature + scope:web stays out of scope', (t) => {
  const workspace = createWorkspace(t);
  writeWebLibraryProject(workspace, 'example-data', [
    'type:data-access',
    'scope:web',
  ]);
  const file = writeFixture(
    workspace,
    'libs/web/example-data/src/lib/DataNotice.tsx',
    [
      "import * as React from 'react';",
      '',
      'export function DataNotice() {',
      '  return <div>hi</div>;',
      '}',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, file);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /SKIPPED/);
  assert.match(result.stderr, /nothing was checked/i);
});

test('a .ts module in a Feature Library is not inspected as a component', (t) => {
  const workspace = createWorkspace(t);
  writeWebLibraryProject(workspace, 'example-places', FEATURE_LIBRARY_TAGS);
  const file = writeFixture(
    workspace,
    'libs/web/example-places/src/lib/placeForm.ts',
    ['export const PLACE_FORM_DEFAULTS = {};', ''].join('\n'),
  );

  const result = runChecker(workspace, file);

  assert.match(result.stdout, /SKIPPED/);
});

test('--all collects Feature Library Components', (t) => {
  const workspace = createWorkspace(t);
  writeWebLibraryProject(workspace, 'example-places', FEATURE_LIBRARY_TAGS);
  writeFixture(
    workspace,
    'libs/web/example-places/src/index.ts',
    "export * from './lib/PlaceNotice';\n",
  );
  writeFixture(
    workspace,
    'libs/web/example-places/src/lib/PlaceNotice.tsx',
    [
      "import * as React from 'react';",
      '',
      'export function PlaceNotice() {',
      '  const handleClick = () => {};',
      '  return <button onClick={handleClick}>Click</button>;',
      '}',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, '--all', '--json');
  const report = JSON.parse(result.stdout);

  assert.deepEqual(
    report.results.map((entry) => [entry.file, entry.scope]),
    [['libs/web/example-places/src/lib/PlaceNotice.tsx', 'feature-library']],
  );
  assert.equal(report.warnings, 1);
});

test('an apostrophe in JSX text does not mask the rest of the file', (t) => {
  const workspace = createWorkspace(t);
  const body = Array.from(
    { length: 40 },
    (_, index) => `        <span>row ${index}</span>`,
  ).join('\n');
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/ApostropheComponent.tsx',
    [
      "import * as React from 'react';",
      '',
      'export function ApostropheComponent() {',
      '  return (',
      '    <div>',
      "      <p>Replace this device's vault?</p>",
      body,
      '    </div>',
      '  );',
      '}',
      '',
      'export function SecondComponent() {',
      '  const handleClick = () => {};',
      '  return <button onClick={handleClick}>Click</button>;',
      '}',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, file);

  // The apostrophe in "device's" used to open a string that ran to the next
  // apostrophe far below, blanking real code from the masked copy. That left
  // brace and paren scanning unbalanced and made one 15-line JSX block measure
  // as 451 lines. Code after the apostrophe must still be seen.
  assert.doesNotMatch(result.stdout, /oversized-jsx/);
  assert.match(result.stdout, /handler-not-memoized/);
});

test('expression-bodied member call is reported as handler-not-memoized', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/MemberCallComponent.tsx',
    [
      "import * as React from 'react';",
      '',
      'export function MemberCallComponent() {',
      '  const cloud = { connect() {} };',
      '  return <button onClick={() => void cloud.connect()}>Connect</button>;',
      '}',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, '--json', file);

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.warnings, 1);
  assert.equal(parsed.results[0].findings[0].rule, 'handler-not-memoized');
});

test('thin wrapper calling a useCallback binding with extra arguments is not a finding', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/ThinWrapperComponent.tsx',
    [
      "import * as React from 'react';",
      '',
      'interface ThinWrapperComponentProps { id: string }',
      'export function ThinWrapperComponent({ id }: ThinWrapperComponentProps) {',
      '  const handleDelete = React.useCallback((_id: string) => {}, []);',
      '  return <button onClick={() => handleDelete(id)}>Delete</button>;',
      '}',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, '--json', file);

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.warnings, 0);
  assert.equal(parsed.results[0].findings.length, 0);
});

test('unparenthesized local arrow called from a thin wrapper is still a finding', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/BareParamWrapperComponent.tsx',
    [
      "import * as React from 'react';",
      '',
      'interface BareParamWrapperComponentProps { id: string }',
      'export function BareParamWrapperComponent({ id }: BareParamWrapperComponentProps) {',
      '  const handleDelete = _id => {};',
      '  return <button onClick={() => handleDelete(id)}>Delete</button>;',
      '}',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, '--json', file);

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.warnings, 1);
  assert.equal(parsed.results[0].findings[0].rule, 'handler-not-memoized');
});

test('thin wrapper calling an unmemoized local function is still a finding', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/UnmemoizedWrapperComponent.tsx',
    [
      "import * as React from 'react';",
      '',
      'interface UnmemoizedWrapperComponentProps { id: string }',
      'export function UnmemoizedWrapperComponent({ id }: UnmemoizedWrapperComponentProps) {',
      '  const handleDelete = (_id: string) => {};',
      '  return <button onClick={() => handleDelete(id)}>Delete</button>;',
      '}',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, '--json', file);

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.warnings, 1);
  assert.equal(parsed.results[0].findings[0].rule, 'handler-not-memoized');
});

test('expression-bodied setter wrapper is not a finding', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/SetterWrapperComponent.tsx',
    [
      "import * as React from 'react';",
      '',
      'export function SetterWrapperComponent() {',
      '  const [open, setOpen] = React.useState(false);',
      '  return <button onClick={() => setOpen(true)}>{String(open)}</button>;',
      '}',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, '--json', file);

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.warnings, 0, JSON.stringify(parsed.results[0]?.findings));
  assert.equal(parsed.results[0].findings.length, 0);
});

test('inline function expression with a statement body is reported as handler-not-memoized', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/InlineFnComponent.tsx',
    [
      "import * as React from 'react';",
      '',
      'export function InlineFnComponent() {',
      '  return (',
      '    <button',
      '      onClick={function () {',
      "        window.alert('clicked');",
      '      }}',
      '    >',
      '      Click',
      '    </button>',
      '  );',
      '}',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, '--json', file);

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.warnings, 1);
  assert.equal(parsed.results[0].findings[0].rule, 'handler-not-memoized');
  assert.match(parsed.results[0].findings[0].message, /inline/i);
});

test('inline arrow with a statement body is reported as handler-not-memoized', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/InlineArrowComponent.tsx',
    [
      "import * as React from 'react';",
      '',
      'export function InlineArrowComponent() {',
      '  return (',
      '    <button',
      '      onClick={() => {',
      "        window.alert('clicked');",
      '      }}',
      '    >',
      '      Click',
      '    </button>',
      '  );',
      '}',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, '--json', file);

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.warnings, 1);
  assert.equal(parsed.results[0].findings[0].rule, 'handler-not-memoized');
  assert.match(parsed.results[0].findings[0].message, /inline/i);
});

test('summary distinguishes a run that skipped everything from a clean run', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/some-other-lib/src/Thing.tsx',
    ['export function Thing() {', '  return <div>hi</div>;', '}', ''].join(
      '\n',
    ),
  );

  const result = runChecker(workspace, file);

  // "0 error(s), 0 warning(s)" alone is what let a whole unchecked library
  // look green. The summary has to say nothing was inspected, and the exit
  // code has to agree with it: a run that checked nothing did not pass.
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /0 file\(s\) inspected, 1 skipped as out of scope/,
  );
  assert.match(result.stderr, /nothing was checked/i);
});

test('all-skipped run in JSON mode exits 1 without changing the top-level keys', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/some-other-lib/src/Thing.tsx',
    ['export function Thing() {', '  return <div>hi</div>;', '}', ''].join(
      '\n',
    ),
  );

  const result = runChecker(workspace, '--json', file);

  assert.equal(result.status, 1);
  // The exit code carries the signal; the JSON shape is a published contract
  // and a consumer can already see every result carrying `skipped`.
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(parsed), ['errors', 'warnings', 'results']);
  assert.equal(parsed.results.length, 1);
  assert.ok(parsed.results[0].skipped);
  assert.match(result.stderr, /nothing was checked/i);
});

test('mixed run with one clean in-scope file exits 0 despite a skipped file', (t) => {
  const workspace = createWorkspace(t);
  const skippedFile = writeFixture(
    workspace,
    'libs/some-other-lib/src/Thing.tsx',
    ['export function Thing() {', '  return <div>hi</div>;', '}', ''].join(
      '\n',
    ),
  );
  const checkedFile = writeFixture(
    workspace,
    'libs/web/pages/todos/src/CleanComponent.tsx',
    [
      "import * as React from 'react';",
      '',
      'export function CleanComponent() {',
      '  return <div>clean</div>;',
      '}',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, skippedFile, checkedFile);

  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stderr, /nothing was checked/i);
});

test('mixed run exits on the merits of the file it did check', (t) => {
  const workspace = createWorkspace(t);
  const skippedFile = writeFixture(
    workspace,
    'libs/some-other-lib/src/Thing.tsx',
    ['export function Thing() {', '  return <div>hi</div>;', '}', ''].join(
      '\n',
    ),
  );
  const checkedFile = writeFixture(
    workspace,
    'libs/web/ui/src/lib/components/broken/broken.tsx',
    [
      "import * as React from 'react';",
      '',
      'const Broken = React.forwardRef<HTMLDivElement, { label: string }>(',
      '  ({ label }, ref) => <div ref={ref}>{label}</div>,',
      ');',
      '',
      'export { Broken };',
      '',
    ].join('\n'),
  );

  const result = runChecker(workspace, skippedFile, checkedFile);

  assert.equal(result.status, 1);
  // Failing for its own reason, not for having skipped anything.
  assert.match(result.stdout, /forwardref-displayname/);
  assert.doesNotMatch(result.stderr, /nothing was checked/i);
});

function exportBasenameFindings(workspace, file) {
  const result = runChecker(workspace, '--json', file);
  const parsed = JSON.parse(result.stdout);
  const findings = parsed.results[0]?.findings ?? [];
  return {
    status: result.status,
    stderr: result.stderr,
    findings: findings.filter((f) => f.rule === 'export-basename'),
    all: findings,
  };
}

function setExportBasenameExemptions(workspace, literal) {
  const checkerPath = join(
    workspace,
    'tools/scripts/check-component-hygiene.mjs',
  );
  const source = readFileSync(checkerPath, 'utf8');
  writeFileSync(checkerPath, spliceExemptions(source, literal));
}

test('feature components/ file whose export matches the basename is clean', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/components/MatchName.tsx',
    'export function MatchName() { return <div />; }\n',
  );

  const { status, findings } = exportBasenameFindings(workspace, file);
  assert.equal(status, 0);
  assert.equal(findings.length, 0);
});

test('feature components/ file that exports no matching component is an error', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/components/AddItemFormFields.tsx',
    [
      'export function AddItemMetadataFields() { return <div />; }',
      'export function AddItemDetailsFields() { return <div />; }',
      '',
    ].join('\n'),
  );

  const { status, findings } = exportBasenameFindings(workspace, file);
  assert.equal(status, 1);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /AddItemFormFields/);
  assert.match(findings[0].message, /AddItemDetailsFields/);
});

test('feature components/ file with a matching export plus another component is an error', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/components/AddressDetailLoading.tsx',
    [
      'export function AddressDetailLoading() { return <div />; }',
      'export function AddressDetailNotFound() { return <div />; }',
      '',
    ].join('\n'),
  );

  const { status, findings } = exportBasenameFindings(workspace, file);
  assert.equal(status, 1);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /more than one/);
});

test('feature file outside components/ may export more than one component', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/page.tsx',
    [
      'export function AddressesPage() { return <div />; }',
      'export function Extra() { return <div />; }',
      '',
    ].join('\n'),
  );

  const { status, findings } = exportBasenameFindings(workspace, file);
  assert.equal(status, 0);
  assert.equal(findings.length, 0);
});

test('kebab-case feature filename maps to PascalCase export', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/components/task-add-dialog.tsx',
    'export function TaskAddDialog() { return <div />; }\n',
  );

  const { status, findings } = exportBasenameFindings(workspace, file);
  assert.equal(status, 0);
  assert.equal(findings.length, 0);
});

test('default export matching the basename counts as the component', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/components/LandingContent.tsx',
    'export default function LandingContent() { return <div />; }\n',
  );

  const { status, findings } = exportBasenameFindings(workspace, file);
  assert.equal(status, 0);
  assert.equal(findings.length, 0);
});

test('camelCase helper plus matching component is not a second component export', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/components/DynamicBreadcrumb.tsx',
    [
      'export function getBreadcrumbItems() { return []; }',
      'export function DynamicBreadcrumb() { return <div />; }',
      '',
    ].join('\n'),
  );

  const { status, findings } = exportBasenameFindings(workspace, file);
  assert.equal(status, 0);
  assert.equal(findings.length, 0);
});

test('primitive compound file passes when the basename matches the root export', (t) => {
  const workspace = createWorkspace(t);
  writeFixture(
    workspace,
    'libs/web/ui/src/index.ts',
    "export * from './lib/components/Card/Card';\n",
  );
  const file = writeFixture(
    workspace,
    'libs/web/ui/src/lib/components/Card/Card.tsx',
    [
      'const Card = () => <div />;',
      'const CardHeader = () => <div />;',
      'export { Card, CardHeader };',
      '',
    ].join('\n'),
  );

  const { findings } = exportBasenameFindings(workspace, file);
  assert.equal(findings.length, 0);
});

test('primitive file with no basename-matching root is an error', (t) => {
  const workspace = createWorkspace(t);
  writeFixture(
    workspace,
    'libs/web/ui/src/index.ts',
    "export * from './lib/components/Card/Card';\n",
  );
  const file = writeFixture(
    workspace,
    'libs/web/ui/src/lib/components/Card/Card.tsx',
    'export function CardHeader() { return <div />; }\n',
  );

  const { status, findings } = exportBasenameFindings(workspace, file);
  assert.equal(status, 1);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /compound root/);
});

test('vault-ui camelCase module is not treated as a Vault UI Component basename', (t) => {
  const workspace = createWorkspace(t);
  writeFixture(
    workspace,
    'libs/web/vault-ui/src/index.ts',
    "export * from './lib/session';\n",
  );
  const file = writeFixture(
    workspace,
    'libs/web/vault-ui/src/lib/session.tsx',
    'export function VaultSessionProvider() { return <div />; }\n',
  );

  const { findings } = exportBasenameFindings(workspace, file);
  assert.equal(findings.length, 0);
});

test('a reasoned exemption skips the export-basename rule', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/components/AddItemFormFields.tsx',
    [
      'export function AddItemMetadataFields() { return <div />; }',
      'export function AddItemDetailsFields() { return <div />; }',
      '',
    ].join('\n'),
  );
  setExportBasenameExemptions(
    workspace,
    JSON.stringify([
      {
        path: 'libs/web/pages/todos/src/components/AddItemFormFields.tsx',
        reason: 'test fixture: deliberate multi-export',
      },
    ]),
  );

  const { findings } = exportBasenameFindings(workspace, file);
  assert.equal(findings.length, 0);
});

test('an exemption without a reason is rejected', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/components/MatchName.tsx',
    'export function MatchName() { return <div />; }\n',
  );
  setExportBasenameExemptions(
    workspace,
    JSON.stringify([{ path: file, reason: '' }]),
  );

  const result = runChecker(workspace, file);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /written reason/);
});

test('an exemption naming a file that is gone is rejected', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/components/MatchName.tsx',
    'export function MatchName() { return <div />; }\n',
  );
  setExportBasenameExemptions(
    workspace,
    JSON.stringify([
      {
        path: 'libs/web/pages/todos/src/components/Gone.tsx',
        reason: 'used to be a compound file',
      },
    ]),
  );

  const result = runChecker(workspace, file);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not exist/);
});

// --- --all and --staged agree on the same file -------------------------------

/**
 * The verdict on a file is a fact about the file, not about which flag selected
 * it. It was not: `collectAll` walked `.tsx` while `scopeOf` admits every file
 * under a feature `src/`, so a `.ts` module was inspected by the pre-commit
 * `--staged` run and never collected by CI's repo-wide `--all` run. A
 * `components/index.ts` barrel therefore blocked a commit while the gate that
 * is supposed to be stricter stayed green.
 */
function resultFor(parsed, file) {
  // `--all` reports the paths `path.join` built, which are backslash-separated
  // on Windows; `--staged` reports what git printed. Same file either way.
  const posix = (value) => value.replace(/\\/g, '/');
  return parsed.results.find((r) => posix(r.file) === posix(file));
}

function findingsFor(parsed, file) {
  return (resultFor(parsed, file)?.findings ?? []).map((f) => f.rule).sort();
}

test('--all and --staged reach the same verdict on the same .ts file', (t) => {
  const workspace = createWorkspace(t);
  initializeRepository(workspace);

  const hook = writeFixture(
    workspace,
    'libs/web/pages/todos/src/hooks/useTodoDeepImport.ts',
    [
      "import { Button } from '@myorganiser/web-ui/src/lib/components/button/Button';",
      '',
      'export const useTodoDeepImport = () => Button;',
      '',
    ].join('\n'),
  );
  git(workspace, 'add', hook);

  const staged = JSON.parse(runChecker(workspace, '--staged', '--json').stdout);
  const all = JSON.parse(runChecker(workspace, '--all', '--json').stdout);

  assert.deepEqual(findingsFor(all, hook), ['deep-import']);
  assert.deepEqual(findingsFor(staged, hook), findingsFor(all, hook));
});

test('--all collects a feature components barrel, as --staged already did', (t) => {
  const workspace = createWorkspace(t);
  initializeRepository(workspace);

  writeFixture(
    workspace,
    'libs/web/pages/todos/src/components/TodoCard.tsx',
    'export function TodoCard() { return <div />; }\n',
  );
  const barrel = writeFixture(
    workspace,
    'libs/web/pages/todos/src/components/index.ts',
    "export * from './TodoCard';\n",
  );
  git(workspace, 'add', barrel);

  const staged = JSON.parse(runChecker(workspace, '--staged', '--json').stdout);
  const all = JSON.parse(runChecker(workspace, '--all', '--json').stdout);

  assert.ok(resultFor(all, barrel), '--all did not collect the barrel');
  assert.deepEqual(findingsFor(staged, barrel), []);
  assert.deepEqual(findingsFor(all, barrel), []);
});

// --- a re-export barrel is not a Feature Component ---------------------------

test('a components/ re-export barrel is not held to the basename rule', (t) => {
  const workspace = createWorkspace(t);
  const barrel = writeFixture(
    workspace,
    'libs/web/pages/todos/src/components/index.ts',
    [
      "export * from './TodoCard';",
      "export { TodoRow } from './TodoRow';",
      "export type { TodoRowProps } from './TodoRow';",
      "export * as todoPolicy from './policy';",
      '',
    ].join('\n'),
  );

  const { status, findings } = exportBasenameFindings(workspace, barrel);

  assert.equal(status, 0);
  assert.equal(findings.length, 0);
});

test('an index file that declares a component is still held to the basename rule', (t) => {
  const workspace = createWorkspace(t);
  const file = writeFixture(
    workspace,
    'libs/web/pages/todos/src/components/index.tsx',
    [
      "export * from './TodoCard';",
      'export function TodoList() { return <div />; }',
      '',
    ].join('\n'),
  );

  const { findings } = exportBasenameFindings(workspace, file);

  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /must export a React component/);
});

// --- the exemption mechanism is usable ---------------------------------------

test('a fixture workspace starts from an empty exemption list', (t) => {
  const workspace = createWorkspace(t);
  const copied = readFileSync(
    join(workspace, 'tools/scripts/check-component-hygiene.mjs'),
    'utf8',
  );

  assert.match(copied, /const EXPORT_BASENAME_EXEMPTIONS = \[\];/);
});

test('the real checker validates its own exemption list against this repo', () => {
  // Run the checker where its exemptions are written to be resolved — this
  // working tree — rather than in a fixture. The staleness assertion runs
  // before any file is inspected, so an out-of-scope argument is enough to
  // reach it: the run fails for having checked nothing, and must not fail for
  // an exemption naming a file that is gone.
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: SCRIPT_DIR,
    encoding: 'utf8',
  }).trim();
  const result = spawnSync(process.execPath, [CHECKER_SOURCE, 'README.md'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.doesNotMatch(result.stderr, /EXPORT_BASENAME_EXEMPTIONS/);
  assert.match(result.stderr, /nothing was checked/i);
});
