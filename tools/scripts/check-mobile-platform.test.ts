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

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'check-mobile-platform.ts');

/**
 * The checker reads tracked TypeScript/JavaScript under apps/mobile and
 * libs/mobile, so a fixture needs a real repository. `git ls-files` returns
 * nothing otherwise and the checker would pass by seeing no corpus at all —
 * the failure mode a gate must never have.
 */
function createRepo(t: TestContext): string {
  const workspace = mkdtempSync(join(tmpdir(), 'mobile-platform-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], {
    cwd: workspace,
    stdio: 'ignore',
  });
  return workspace;
}

function write(workspace: string, relative: string, contents: string): void {
  const path = join(workspace, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function writeExemptions(workspace: string, exemptions: unknown[] = []): void {
  write(
    workspace,
    'tools/config/mobile-platform-exemptions.json',
    JSON.stringify({ schemaVersion: 1, exemptions }, null, 2),
  );
}

function commitAll(workspace: string): void {
  execFileSync('git', ['add', '-A'], {
    cwd: workspace,
    stdio: 'ignore',
  });
}

const run = (workspace: string, ...args: string[]) =>
  spawnSync(process.execPath, [CHECKER, ...args], {
    cwd: workspace,
    encoding: 'utf8',
  });

function writeBaseTsconfig(
  workspace: string,
  paths: Record<string, string[]> = {},
): void {
  write(
    workspace,
    'tsconfig.base.json',
    JSON.stringify({ compilerOptions: { paths } }, null, 2),
  );
}

/** Aliases shaped like the real repo's: one library with a Portable Entry Point, one without. */
const PORTABLE_PATHS = {
  '@myorganiser/auth': ['libs/auth/src/index.ts'],
  '@myorganiser/auth/portable': ['libs/auth/src/portable.ts'],
  '@myorganiser/design-tokens': ['libs/design-tokens/src/index.ts'],
};

/**
 * A workspace carrying an empty exemption list, a `tsconfig.base.json` with
 * `paths`, plus `files`.
 */
function scaffold(
  t: TestContext,
  files: Record<string, string> = {},
  exemptions: unknown[] = [],
  paths: Record<string, string[]> = {},
): string {
  const workspace = createRepo(t);
  writeExemptions(workspace, exemptions);
  writeBaseTsconfig(workspace, paths);
  for (const [path, contents] of Object.entries(files)) {
    write(workspace, path, contents);
  }
  commitAll(workspace);
  return workspace;
}

test('passes an empty corpus', (t) => {
  const workspace = scaffold(t);
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 file\(s\) scanned/);
});

test('passes clean React Native source', (t) => {
  const workspace = scaffold(t, {
    'apps/mobile/src/app/App.tsx': `import { View } from 'react-native';
export default function App() {
  return <View />;
}
`,
    'libs/mobile/ui/src/theme.ts': `export const theme = { color: 'blue' };
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('fails a bare react-native subpath reached through `from`', (t) => {
  const workspace = scaffold(t, {
    'libs/mobile/utils/src/index.ts': `import { TurboModuleRegistry } from 'react-native/Libraries/TurboModule/TurboModuleRegistry';
export { TurboModuleRegistry };
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /imports 'react-native\/Libraries\/TurboModule\/TurboModuleRegistry' — a bare react-native\/ subpath/,
  );
});

test('fails a bare react-native subpath reached through `require`', (t) => {
  const workspace = scaffold(t, {
    'apps/mobile/some.config.js': `const transformer = require('react-native/jest/assetFileTransformer.js');
module.exports = transformer;
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /requires 'react-native\/jest\/assetFileTransformer\.js' — a bare react-native\/ subpath/,
  );
});

// `require.resolve` is a property access on `require` rather than a call to it,
// so it needs its own clause. `apps/mobile/jest.config.ts` held exactly this
// call, exempted by name, until React Native 0.87 moved the transformer out of
// the package; no file in the repo holds one now.
test('fails a bare react-native subpath reached through `require.resolve`', (t) => {
  const workspace = scaffold(t, {
    'apps/mobile/some.config.ts': `module.exports = {
  transform: {
    '^.+\\\\.(png)$': require.resolve('react-native/jest/assetFileTransformer.js'),
  },
};
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /resolves 'react-native\/jest\/assetFileTransformer\.js' — a bare react-native\/ subpath/,
  );
});

// An import specifier's propertyName names a member of the *other* module. It
// can never reach the ambient global, so aliasing one to a banned name is not a
// violation — `import { window as win } from './local'` is somebody else's
// export called `window`, not a browser API.
test('does not flag an import specifier merely aliased from a banned global name', (t) => {
  const workspace = scaffold(t, {
    'apps/mobile/src/thing.ts': `import { window as win, document as doc } from './local-module';

export const size = win;
export const root = doc;
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

// Skipping the declaration but not its later uses was a false positive that
// would have failed the pre-commit gate on ordinary shadowing code.
test('does not flag later references to a local that shadows a banned global', (t) => {
  const workspace = scaffold(t, {
    'apps/mobile/src/shadow.ts': `export function log(window: number) {
  console.log(window);
  return window;
}

export function pick(document: string[]) {
  return document.length;
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('does not flag a local const shadowing a banned global, nor its uses', (t) => {
  const workspace = scaffold(t, {
    'apps/mobile/src/localvar.ts': `const localStorage = new Map<string, string>();

export function put(k: string, v: string) {
  localStorage.set(k, v);
  return localStorage.size;
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

// An ambient re-declaration names the real global rather than shadowing it, so
// it must not buy the file a pass — otherwise `declare global` is the one-line
// way to switch the rule off.
test('still flags a global re-declared via `declare global`', (t) => {
  const workspace = scaffold(t, {
    'apps/mobile/src/ambient.ts': `declare global {
  const localStorage: { getItem(k: string): string };
}

export function use() {
  return localStorage.getItem('k');
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /references the browser global `localStorage`/);
});

test('still flags a global re-declared via a top-level `declare const`', (t) => {
  const workspace = scaffold(t, {
    'apps/mobile/src/ambient-const.ts': `declare const window: { innerWidth: number };

export const w = window.innerWidth;
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /references the browser global `window`/);
});

// The shadow suppression is per name, not per file: a file that shadows one
// banned name must still be held to the others.
test('still flags a different banned global in a file that shadows one', (t) => {
  const workspace = scaffold(t, {
    'apps/mobile/src/mixed.ts': `export function log(window: number) {
  return window;
}

export const stored = localStorage.getItem('k');
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /references the browser global `localStorage`/);
  assert.doesNotMatch(result.stderr, /references the browser global `window`/);
});

// The same reasoning for a re-export, where the propertyName sits on an
// ExportSpecifier instead.
test('does not flag a re-exported specifier aliased from a banned global name', (t) => {
  const workspace = scaffold(t, {
    'apps/mobile/src/reexport.ts': `export { window as win } from './local-module';
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

// And again for a destructuring rename, where the propertyName sits on a
// BindingElement and names a member of the object being destructured.
test('does not flag a destructuring rename of a banned global name', (t) => {
  const workspace = scaffold(t, {
    'libs/mobile/core/src/destructure.ts': `export function pick(foo: { window: number; document: string }) {
  const { window: myWindow, document: myDocument } = foo;
  return { myWindow, myDocument };
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

// The counterpart: a shorthand destructure declares a local of the banned name,
// so uses of it afterwards are that local — but the rule must still be live for
// the name in a file that never destructures it.
test('still flags the real global in a file that destructures a same-named property elsewhere', (t) => {
  const workspace = scaffold(t, {
    'libs/mobile/core/src/mixed.ts': `export function pick(foo: { window: number }) {
  const { window: myWindow } = foo;
  return myWindow;
}
export function leak() {
  return document.title;
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /references the browser global `document`/);
});

// A shorthand property is a key and a live read at once, so unlike every other
// name slot it must still be checked against the surrounding scope.
test('flags a banned global referenced through object shorthand', (t) => {
  const workspace = scaffold(t, {
    'libs/mobile/core/src/shorthand.ts': `export function capture() {
  return { window, localStorage };
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /references the browser global `window`/);
  assert.match(result.stderr, /references the browser global `localStorage`/);
});

// ...but a shorthand that reads a genuine local is still a local.
test('does not flag object shorthand reading a local that shadows a banned name', (t) => {
  const workspace = scaffold(t, {
    'libs/mobile/core/src/shorthand-local.ts': `export function capture(window: number) {
  return { window };
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

// Two positions the old kind-by-kind enumeration never listed. Neither occurs
// in the corpus today; both would have been silent false positives.
test('does not flag a JSX attribute or a qualified type name spelled like a banned global', (t) => {
  const workspace = scaffold(t, {
    'libs/mobile/ui/src/Attr.tsx': `import { View } from 'react-native';
export const Attr = () => <View window={1} document="x" />;
`,
    'libs/mobile/core/src/qualified.ts': `declare namespace Config {
  export type window = string;
}
export type Alias = Config.window;
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

// The `right` match is pinned to QualifiedName: BinaryExpression carries one
// too, and a blanket check would excuse the most ordinary reference there is.
test('flags a banned global on the right of a binary expression', (t) => {
  const workspace = scaffold(t, {
    'libs/mobile/core/src/binary.ts': `export function pick(fallback: unknown) {
  return fallback || document;
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /references the browser global `document`/);
});

// A naive substring match on \`react-native/\` hits all three of these — each
// is a reference to the separate \`@react-native/*\` scope one character in.
test('does not flag the @react-native/ scope: babel preset, metro config, vite alias', (t) => {
  const workspace = scaffold(t, {
    'apps/mobile/.babelrc.js': `module.exports = {
  presets: [['module:@react-native/babel-preset', { useTransformReactJSX: true }]],
};
`,
    'apps/mobile/metro.config.js': `const { getDefaultConfig } = require('@react-native/metro-config');
module.exports = getDefaultConfig(__dirname);
`,
    'apps/mobile/vite.config.mts': `export default {
  resolve: {
    alias: {
      '@react-native/assets-registry/registry':
        'react-native-web/dist/modules/AssetRegistry/index',
    },
  },
};
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('fails a bare window reference', (t) => {
  const workspace = scaffold(t, {
    'libs/mobile/hooks/src/useViewport.ts': `export function useViewport() {
  return window.innerWidth;
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /references the browser global `window`/);
});

test('fails localStorage and sessionStorage the same way as window', (t) => {
  const workspace = scaffold(t, {
    'libs/mobile/utils/src/storage.ts': `export function readBoth() {
  return [localStorage.getItem('a'), sessionStorage.getItem('b')];
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /references the browser global `localStorage`/);
  assert.match(result.stderr, /references the browser global `sessionStorage`/);
});

// This is the shape a checker written as an import scan would miss —
// localStorage and crypto.subtle are ambient, reached without an import.
test('fails an ambient global with no import in sight', (t) => {
  const workspace = scaffold(t, {
    'libs/mobile/feat/vault/src/leak.ts': `export function stash(key: string, value: string) {
  localStorage.setItem(key, value);
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /references the browser global `localStorage`/);
});

test('fails crypto.subtle and the optional-chained form', (t) => {
  const workspace = scaffold(t, {
    'libs/mobile/feat/vault/src/leak.ts': `export async function encrypt() {
  if (typeof globalThis.crypto?.subtle === 'undefined') throw new Error('no subtle');
  return globalThis.crypto.subtle.digest('SHA-256', new Uint8Array());
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1);
  const matches = result.stderr.match(/references `crypto\.subtle`/g) ?? [];
  assert.equal(matches.length, 2);
});

// `crypto` gets the same shadow protection the bare globals get: a file that
// declares its own binding is not reaching WebCrypto.
test('does not flag crypto.subtle reached through a locally-declared crypto', (t) => {
  const workspace = scaffold(t, {
    'libs/mobile/utils/src/mock.ts': `const crypto = {
  subtle: { digest: async () => new Uint8Array() },
};
export async function digest() {
  return crypto.subtle.digest();
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

// Shadowing is per name here too: a local `crypto` buys nothing for `window`.
test('shadowing crypto does not suppress the other banned globals', (t) => {
  const workspace = scaffold(t, {
    'libs/mobile/utils/src/mixed-crypto.ts': `const crypto = { subtle: null };
export function leak() {
  return [crypto.subtle, window.innerWidth];
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /references the browser global `window`/);
  assert.doesNotMatch(result.stderr, /references `crypto\.subtle`/);
});

// `foo.window` is a member name, not the global; `foo.crypto.subtle` was treated
// as the global for any object at all, which contradicted that for no reason.
test('does not flag crypto.subtle reached off an object that is not the global', (t) => {
  const workspace = scaffold(t, {
    'libs/mobile/utils/src/adapter.ts': `export function digest(platform: {
  crypto: { subtle: { digest: () => Promise<Uint8Array> } };
}) {
  return platform.crypto.subtle.digest();
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('does not flag window or document used as a property or parameter name', (t) => {
  const workspace = scaffold(t, {
    'libs/mobile/ui/src/mock.ts': `export function describeScreen({ window }: { window: number }) {
  const config = { window, document: 'unused' };
  return config;
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

// `.window`/`.document` alone is somebody's own property name — e.g. a
// screen config object — and must stay unflagged even though it shares a
// spelling with the property-name shapes above.
test('does not flag window or document reached off an arbitrary object', (t) => {
  const workspace = scaffold(t, {
    'libs/mobile/screens/src/config.ts': `export function describe(screen: { window: number; document: string }) {
  return screen.window + screen.document.length;
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

// Qualifying a banned global through `globalThis` or `self` reaches the same
// ambient global a bare reference does — it must not read as "just another
// object's property" the way `screen.window` above does.
test('fails a browser global qualified through globalThis or self', (t) => {
  const workspace = scaffold(t, {
    'libs/mobile/utils/src/leak.ts': `export function stash(key: string, value: string) {
  globalThis.localStorage.setItem(key, value);
  return self.window.innerWidth + globalThis.document.title.length;
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /references the browser global `localStorage`/);
  assert.match(result.stderr, /references the browser global `window`/);
  assert.match(result.stderr, /references the browser global `document`/);
});

test('fails a bare react-native subpath reached through dynamic import()', (t) => {
  const workspace = scaffold(t, {
    'libs/mobile/utils/src/lazy.ts': `export async function load() {
  return import('react-native/Libraries/TurboModule/TurboModuleRegistry');
}
`,
  });
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /dynamically imports 'react-native\/Libraries\/TurboModule\/TurboModuleRegistry' — a bare react-native\/ subpath/,
  );
});

test('exempts a file by path, skipping every rule for it', (t) => {
  const workspace = scaffold(
    t,
    {
      'apps/mobile/src/main-web.tsx': `import * as ReactDOM from 'react-dom/client';
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(null);
`,
    },
    [
      {
        path: 'apps/mobile/src/main-web.tsx',
        reason: 'The Vite web entry point; not a variant of anything else.',
      },
    ],
  );
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('cannot run when an exemption names a file that no longer exists', (t) => {
  const workspace = scaffold(t, {}, [
    {
      path: 'apps/mobile/src/gone.ts',
      reason: 'Used to be a Platform Variant; the file has since been deleted.',
    },
  ]);
  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /does not exist/);
});

test('cannot run when an exemption carries no reason', (t) => {
  const workspace = scaffold(t, {
    'apps/mobile/src/main-web.tsx': `export {};\n`,
  });
  write(
    workspace,
    'tools/config/mobile-platform-exemptions.json',
    JSON.stringify({
      schemaVersion: 1,
      exemptions: [{ path: 'apps/mobile/src/main-web.tsx', reason: '' }],
    }),
  );
  commitAll(workspace);
  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /carries no written reason/);
});

test('cannot run when the exemption list is missing', (t) => {
  const workspace = createRepo(t);
  write(workspace, 'apps/mobile/src/App.tsx', 'export {};\n');
  commitAll(workspace);
  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not found/);
});

test('cannot run when the exemption list has the wrong schema version', (t) => {
  const workspace = createRepo(t);
  write(
    workspace,
    'tools/config/mobile-platform-exemptions.json',
    JSON.stringify({ schemaVersion: 2, exemptions: [] }),
  );
  commitAll(workspace);
  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /expected "schemaVersion": 1/);
});

test('--print reports scanned count and exemptions with reasons', (t) => {
  const workspace = scaffold(
    t,
    {
      'apps/mobile/src/main-web.tsx': `export {};\n`,
    },
    [{ path: 'apps/mobile/src/main-web.tsx', reason: 'The web entry point.' }],
  );
  const result = run(workspace, '--print');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 file\(s\) scanned/);
  assert.match(result.stdout, /exempt: apps\/mobile\/src\/main-web\.tsx/);
  assert.match(result.stdout, /The web entry point\./);
});

test('fails a main-entry import of a library that has a Portable Entry Point', (t) => {
  const workspace = scaffold(
    t,
    {
      'libs/mobile/feat/auth/src/api/client.ts': `import { buildRefreshTokenRequest } from '@myorganiser/auth';
export { buildRefreshTokenRequest };
`,
    },
    [],
    PORTABLE_PATHS,
  );
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /client\.ts:1: imports '@myorganiser\/auth' — its main entry point\. Import '@myorganiser\/auth\/portable' instead/,
  );
});

// A type-only import still loads the whole barrel into the native typecheck
// program, and a re-export or a require still loads it into the Metro bundle,
// so no form of naming the main entry is safer than another.
test('fails a main-entry reach through import type, export from, require, and import()', (t) => {
  const workspace = scaffold(
    t,
    {
      'libs/mobile/feat/vault/src/a.ts': `import type { AuthClientType } from '@myorganiser/auth';
export type { AuthClientType };
`,
      'libs/mobile/feat/vault/src/b.ts': `export * from '@myorganiser/auth';
`,
      'apps/mobile/src/c.js': `module.exports = require('@myorganiser/auth');
`,
      'apps/mobile/src/d.ts': `export const load = () => import('@myorganiser/auth');
`,
    },
    [],
    PORTABLE_PATHS,
  );
  const result = run(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /a\.ts:1: imports '@myorganiser\/auth'/);
  assert.match(result.stderr, /b\.ts:1: imports '@myorganiser\/auth'/);
  assert.match(result.stderr, /c\.js:1: requires '@myorganiser\/auth'/);
  assert.match(
    result.stderr,
    /d\.ts:1: dynamically imports '@myorganiser\/auth'/,
  );
});

test('passes an import through the Portable Entry Point', (t) => {
  const workspace = scaffold(
    t,
    {
      'libs/mobile/feat/auth/src/api/client.ts': `import { buildRefreshTokenRequest } from '@myorganiser/auth/portable';
export { buildRefreshTokenRequest };
`,
    },
    [],
    PORTABLE_PATHS,
  );
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

// The library list is read from tsconfig.base.json, never written down in the
// checker: a library without a Portable Entry Point has nothing to route
// around, so importing it whole is not a finding.
test('passes a main-entry import of a library with no Portable Entry Point', (t) => {
  const workspace = scaffold(
    t,
    {
      'libs/mobile/ui/src/theme.ts': `import { tokens } from '@myorganiser/design-tokens';
export const theme = tokens;
`,
    },
    [],
    PORTABLE_PATHS,
  );
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('opts a library in as soon as its Portable Entry Point appears in tsconfig.base.json', (t) => {
  const files = {
    'libs/mobile/ui/src/theme.ts': `import { tokens } from '@myorganiser/design-tokens';
export const theme = tokens;
`,
  };
  const before = scaffold(t, files, [], PORTABLE_PATHS);
  assert.equal(run(before).status, 0);

  const after = scaffold(t, files, [], {
    ...PORTABLE_PATHS,
    '@myorganiser/design-tokens/portable': [
      'libs/design-tokens/src/portable.ts',
    ],
  });
  const result = run(after);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /imports '@myorganiser\/design-tokens' — its main entry point/,
  );
});

test('does not treat a lookalike specifier as the main entry', (t) => {
  const workspace = scaffold(
    t,
    {
      'libs/mobile/utils/src/index.ts': `import { a } from '@myorganiser/auth-extras';
import { b } from '@myorganiser/auth/portable';
export { a, b };
`,
    },
    [],
    PORTABLE_PATHS,
  );
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

test('an exempted Platform Variant may import a main entry point', (t) => {
  const workspace = scaffold(
    t,
    {
      'libs/mobile/feat/vault/src/crypto.web.ts': `import type { AuthClientType } from '@myorganiser/auth';
export type { AuthClientType };
`,
    },
    [
      {
        path: 'libs/mobile/feat/vault/src/crypto.web.ts',
        reason: 'The vault crypto Platform Variant.',
      },
    ],
    PORTABLE_PATHS,
  );
  const result = run(workspace);
  assert.equal(result.status, 0, result.stderr);
});

// Reading no aliases would mean deriving no libraries and passing every import:
// a silent pass is the failure a gate must never have.
test('cannot run when tsconfig.base.json is missing', (t) => {
  const workspace = createRepo(t);
  writeExemptions(workspace);
  write(workspace, 'apps/mobile/src/App.tsx', 'export {};\n');
  commitAll(workspace);
  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /tsconfig\.base\.json/);
});

test('cannot run when tsconfig.base.json carries no paths', (t) => {
  const workspace = createRepo(t);
  writeExemptions(workspace);
  write(
    workspace,
    'tsconfig.base.json',
    JSON.stringify({ compilerOptions: {} }),
  );
  commitAll(workspace);
  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /compilerOptions\.paths/);
});

test('--print lists the Portable Entry Points it derived', (t) => {
  const workspace = scaffold(t, {}, [], PORTABLE_PATHS);
  const result = run(workspace, '--print');
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /portable: @myorganiser\/auth → @myorganiser\/auth\/portable/,
  );
  assert.doesNotMatch(result.stdout, /portable: @myorganiser\/design-tokens/);
});
