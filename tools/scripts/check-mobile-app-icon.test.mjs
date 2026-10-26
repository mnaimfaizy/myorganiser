import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
import {
  BRAND_MARK,
  ROLES,
  TOKENS,
  planMobileAppIcon,
} from './lib/mobile-app-icon.ts';

// Each fixture workspace holds copies of the real BrandMark and token build,
// the text outputs planned from them, a placeholder file at every PNG path
// (the check asserts only that a PNG exists), and whatever drift the test
// plants afterwards.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const CHECKER = join(HERE, 'check-mobile-app-icon.mjs');

const MASTER = (appearance) =>
  `apps/mobile/app-icon/app-icon-${appearance}.svg`;
const RES = 'apps/mobile/android/app/src/main/res';
const FOREGROUND = `${RES}/drawable/ic_launcher_foreground.xml`;
const MONOCHROME = `${RES}/drawable/ic_launcher_monochrome.xml`;
const BACKGROUND = `${RES}/values/ic_launcher_background.xml`;

function createWorkspace(t) {
  const workspace = mkdtempSync(join(tmpdir(), 'mobile-app-icon-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const write = (relative, contents) => {
    const path = join(workspace, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  };
  for (const source of [BRAND_MARK, TOKENS, ROLES]) {
    write(source, readFileSync(join(REPO_ROOT, source)));
  }
  const { files, rasters } = planMobileAppIcon({ root: workspace });
  for (const { path, content } of files) write(path, content);
  for (const { path } of rasters) write(path, 'placeholder PNG');
  const edit = (relative, pattern, to) => {
    const path = join(workspace, relative);
    const before = readFileSync(path, 'utf8');
    assert.match(before, pattern, `fixture ${relative} lacks ${pattern}`);
    writeFileSync(path, before.replace(pattern, to));
  };
  return { workspace, write, edit, rasters };
}

const run = (cwd) =>
  spawnSync(process.execPath, [CHECKER], { cwd, encoding: 'utf8' });

// The output paths a failing run names, in the order it names them.
const named = (stderr) =>
  [...stderr.matchAll(/^ {2}- (\S+): /gm)].map((match) => match[1]);

test('passes when the committed outputs are what the generator writes', (t) => {
  const { workspace } = createWorkspace(t);
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /9 outputs match their sources, 13 PNGs present/);
});

test('fails every output drawing the shield when its path changes, naming the command', (t) => {
  const { workspace, edit } = createWorkspace(t);
  edit(BRAND_MARK, /L28 3 L28 19/, 'L28 3 L28 21');
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.deepEqual(named(result.stderr), [
    MASTER('light'),
    MASTER('dark'),
    MASTER('tinted'),
    FOREGROUND,
    MONOCHROME,
  ]);
  assert.match(result.stderr, /yarn mobile:app-icon:generate/);
});

test('fails the outputs carrying the brand gradient when a gradient token changes', (t) => {
  const { workspace, edit } = createWorkspace(t);
  edit(
    TOKENS,
    /export const colorSecondary = "#[0-9a-fA-F]{6}"/,
    'export const colorSecondary = "#123456"',
  );
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.deepEqual(named(result.stderr), [
    MASTER('light'),
    MASTER('dark'),
    FOREGROUND,
  ]);
});

test('fails only the dark master when the dark background role changes', (t) => {
  const { workspace, edit } = createWorkspace(t);
  edit(
    ROLES,
    /(export const roleDark = \{\s*background: )"#[0-9a-fA-F]{6}"/,
    '$1"#123456"',
  );
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.deepEqual(named(result.stderr), [MASTER('dark')]);
});

test('fails the light master and the launcher background when the light background role changes', (t) => {
  const { workspace, edit } = createWorkspace(t);
  edit(
    ROLES,
    /(export const roleLight = \{\s*background: )"#[0-9a-fA-F]{6}"/,
    '$1"#123456"',
  );
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.deepEqual(named(result.stderr), [MASTER('light'), BACKGROUND]);
});

test('fails a missing text output', (t) => {
  const { workspace } = createWorkspace(t);
  rmSync(join(workspace, MONOCHROME));
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ic_launcher_monochrome\.xml: missing/);
});

test('fails a missing PNG', (t) => {
  const { workspace, rasters } = createWorkspace(t);
  rmSync(join(workspace, rasters[0].path));
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.deepEqual(named(result.stderr), [rasters[0].path]);
});

test('does not compare PNG contents, as its header declares', (t) => {
  const { workspace, write, rasters } = createWorkspace(t);
  write(rasters[0].path, 'different placeholder');
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('exits 2 when a source value cannot be read', (t) => {
  const { workspace, edit } = createWorkspace(t);
  edit(BRAND_MARK, /strokeWidth=\{3\}/, 'strokeWidth={width}');
  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Could not read the check width/);
});
