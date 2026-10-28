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
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  APP_LOGO,
  ICONS_DIR,
  TOKENS,
  renderWebAppIcons,
} from './lib/web-app-icons.ts';

// Each fixture workspace holds copies of the real AppLogo and token build, the
// icons rendered from them, and whatever drift the test plants afterwards.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const CHECKER = join(HERE, 'check-web-app-icons.ts');
const ALL_ICONS = [
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
  'apple-touch-icon.png',
];

async function createWorkspace(t: TestContext) {
  const workspace = mkdtempSync(join(tmpdir(), 'web-app-icons-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const write = (relative: string, contents: string | Buffer) => {
    const path = join(workspace, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  };
  for (const source of [APP_LOGO, TOKENS]) {
    write(source, readFileSync(join(REPO_ROOT, source)));
  }
  for (const { path, png } of await renderWebAppIcons({ root: workspace })) {
    write(path, png);
  }
  const edit = (relative: string, from: string, to: string) => {
    const path = join(workspace, relative);
    const before = readFileSync(path, 'utf8');
    assert.ok(before.includes(from), `fixture ${relative} lacks ${from}`);
    writeFileSync(path, before.replace(from, to));
  };
  return { workspace, write, edit };
}

const run = (cwd: string) =>
  spawnSync(process.execPath, [CHECKER], { cwd, encoding: 'utf8' });

function setToken(
  workspace: string,
  edit: (relative: string, from: string, to: string) => void,
  name: string,
  hex: string,
) {
  const match = new RegExp(`export const ${name} = "#[0-9a-fA-F]{6}"`).exec(
    readFileSync(join(workspace, TOKENS), 'utf8'),
  );
  assert.ok(match, `fixture token build lacks ${name}`);
  const line = match[0];
  edit(TOKENS, line, `export const ${name} = "${hex}"`);
}

const staleIcons = (stderr: string) =>
  ALL_ICONS.filter((name) => stderr.includes(`${ICONS_DIR}/${name}`));

test('passes when the committed icons are what the generator renders', async (t) => {
  const { workspace } = await createWorkspace(t);
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /4 icons match/);
});

test('fails every icon when SHIELD_PATH changes without a re-run, naming the command', async (t) => {
  const { workspace, edit } = await createWorkspace(t);
  edit(APP_LOGO, 'L28 3 L28 19', 'L28 3 L28 21');
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.deepEqual(staleIcons(result.stderr), ALL_ICONS);
  assert.match(result.stderr, /yarn web:app-icons:generate/);
});

test('fails every icon when a gradient colour token changes', async (t) => {
  const { workspace, edit } = await createWorkspace(t);
  setToken(workspace, edit, 'colorSecondary', '#123456');
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.deepEqual(staleIcons(result.stderr), ALL_ICONS);
});

test('fails only the plated icons when the plate colour token changes', async (t) => {
  const { workspace, edit } = await createWorkspace(t);
  setToken(workspace, edit, 'colorSurface', '#123456');
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.deepEqual(staleIcons(result.stderr), [
    'icon-512-maskable.png',
    'apple-touch-icon.png',
  ]);
});

test('fails a missing icon', async (t) => {
  const { workspace } = await createWorkspace(t);
  rmSync(join(workspace, ICONS_DIR, 'apple-touch-icon.png'));
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /apple-touch-icon\.png: missing/);
});

test('fails an icon committed at the wrong size', async (t) => {
  const { workspace, write } = await createWorkspace(t);
  const path = `${ICONS_DIR}/icon-192.png`;
  write(
    path,
    await sharp(readFileSync(join(workspace, path)))
      .resize(96)
      .png()
      .toBuffer(),
  );
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /icon-192\.png: is 96 × 96, expected 192 × 192/);
});

test('passes the same pixels encoded to different bytes', async (t) => {
  const { workspace, write } = await createWorkspace(t);
  const path = `${ICONS_DIR}/icon-512.png`;
  const original = readFileSync(join(workspace, path));
  const reencoded = await sharp(original)
    .png({ compressionLevel: 0 })
    .toBuffer();
  assert.notDeepEqual(reencoded, original);
  write(path, reencoded);
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('exits 2 when a source value cannot be read', async (t) => {
  const { workspace, edit } = await createWorkspace(t);
  edit(APP_LOGO, 'export const SHIELD_PATH', 'const SHIELD_PATH');
  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Could not read the shield path/);
});
