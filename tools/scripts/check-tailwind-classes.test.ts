import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'check-tailwind-classes.ts');
const REPO = join(HERE, '..', '..');

/**
 * The checker compiles a real stylesheet through real Tailwind, so a fixture
 * needs a workspace shaped like the repository: the entry stylesheet at the
 * path the checker reads, the Tailwind config its `@config` points at, and a
 * resolvable `node_modules`. The last is symlinked rather than installed —
 * a per-test install would cost minutes.
 */
function createWorkspace(t: TestContext) {
  const workspace = mkdtempSync(join(tmpdir(), 'tailwind-classes-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  symlinkSync(
    join(REPO, 'node_modules'),
    join(workspace, 'node_modules'),
    'dir',
  );

  write(
    workspace,
    'apps/web/tailwind.config.js',
    `module.exports = {
  content: [],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        brand: { DEFAULT: 'hsl(var(--brand))' },
      },
    },
  },
};
`,
  );
  write(
    workspace,
    'apps/web/src/app/global.css',
    `@config "../../tailwind.config.js";
@import 'tailwindcss';

@layer base {
  :root {
    --border: 214.3 31.8% 91.4%;
    --brand: 262.1 83.3% 57.8%;
  }
}
`,
  );
  return workspace;
}

function write(workspace: string, relative: string, contents: string) {
  const path = join(workspace, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

const component = (classes: string) =>
  `export const C = () => <div className="${classes}" />;\n`;

const run = (workspace: string, ...args: string[]) =>
  spawnSync(process.execPath, [CHECKER, ...args], {
    cwd: workspace,
    encoding: 'utf8',
  });

test('passes when every themed utility resolves', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'libs/web/x.tsx', component('bg-brand border-border'));

  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /themed utilities asserted/);
});

test('fails and names a themed utility that compiles to no CSS', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'libs/web/x.tsx',
    component('bg-brand bg-surface-container-low'),
  );

  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /bg-surface-container-low/);
  // The remedy has to be in the message: adding the name to a Tailwind config
  // by hand is the workaround ADR 0065 exists to stop.
  assert.match(result.stderr, /tokens\.json/);
});

test('does not flag non-colour utilities that merely share a prefix', (t) => {
  const workspace = createWorkspace(t);
  // Every one of these resolves; a suffix allowlist would have to know that,
  // and `text-error` in the same file must still fail.
  write(
    workspace,
    'libs/web/x.tsx',
    component(
      'text-xs text-sm text-base text-lg text-center text-left max-w-md p-4 flex',
    ),
  );

  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('skips arbitrary values', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'libs/web/x.tsx',
    component('bg-[var(--color-surface,#F8FAFC)] text-[#1877F2]'),
  );

  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('scans test files, where a pinned class name is the original defect', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'libs/web/x.spec.tsx',
    `it('x', () => expect(el).toHaveClass('bg-secondary-container'));\n`,
  );

  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /bg-secondary-container/);
});

test('excludes email-shell and mobile, which do not render through Tailwind', (t) => {
  const workspace = createWorkspace(t);
  // Inline CSS property names are class-shaped. They are not Tailwind classes.
  write(
    workspace,
    'libs/email-shell/src/render.ts',
    `export const css = 'border-bottom: 1px solid #eee; text-decoration: none;';\n`,
  );
  write(
    workspace,
    'libs/mobile/ui/src/theme.ts',
    `export const s = { borderTop: 1 }; // 'border-top' appears in RN styling talk\n`,
  );

  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('covers spacing, not only colour', (t) => {
  const workspace = createWorkspace(t);
  // `py-md` and `gap-sm` named design-token steps no config exposes and shipped
  // the same silent way the colour names did.
  write(workspace, 'libs/web/x.tsx', component('py-md gap-sm py-2 gap-2'));

  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /py-md/);
  assert.match(result.stderr, /gap-sm/);
});

test('does not flag hyphenated identifiers that look like margin utilities', (t) => {
  const workspace = createWorkspace(t);
  // `my-` matches any hyphenated identifier. A form field named this way was
  // the only false positive measured, which is why margins are out of scope.
  write(
    workspace,
    'libs/web/x.tsx',
    `export const field = 'my-vault-passphrase';\n`,
  );

  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('--print reports findings without failing', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'libs/web/x.tsx', component('text-on-surface-variant'));

  const result = run(workspace, '--print');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /unresolved: 1/);
  assert.match(result.stdout, /text-on-surface-variant/);
});

test('exits 2 when the entry stylesheet is missing', (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'tailwind-classes-bare-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  symlinkSync(
    join(REPO, 'node_modules'),
    join(workspace, 'node_modules'),
    'dir',
  );

  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /entry stylesheet not found/);
});
