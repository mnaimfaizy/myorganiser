/**
 * Contract suite for check-content-globs.ts (ADR 0085: the header is the
 * specification, this is what makes it true).
 *
 * The header claims one direction — every Storybook `stories` glob and every
 * Tailwind `content` glob matches at least one file, and a dead one is named
 * with its config — and omits negated content globs and the reverse
 * direction. The claimed direction is proved to fail on drift; the omissions
 * are proved to pass, so a later reader can tell a deliberate omission from a
 * bug.
 */
import { strict as assert } from 'node:assert';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { stripComments, storiesGlobs } from './check-content-globs.ts';

const CHECKER = resolve('tools/scripts/check-content-globs.ts');

const STORYBOOK_MAIN = 'libs/web/ui/.storybook/main.ts';
const TAILWIND_CONFIG = 'apps/web/tailwind.config.js';

const storybookMain = (globs: string[]): string =>
  `const config = {\n  stories: [\n${globs
    .map((g) => `    '${g}',`)
    .join('\n')}\n  ],\n};\nexport default config;\n`;

const tailwindConfig = (content: string[]): string =>
  `module.exports = { content: ${JSON.stringify(content)} };\n`;

/** A tree that passes: one live stories glob, one live content glob. */
const PASSING = {
  [STORYBOOK_MAIN]: storybookMain(['../src/lib/**/*.stories.tsx']),
  'libs/web/ui/src/lib/Button.stories.tsx': 'export default {};\n',
  [TAILWIND_CONFIG]: tailwindConfig(['./src/**/*.{ts,tsx}']),
  'apps/web/src/page.tsx': 'export {};\n',
};

const without = (
  files: Record<string, string>,
  name: string,
): Record<string, string> =>
  Object.fromEntries(Object.entries(files).filter(([key]) => key !== name));

function withWorkspace<T>(
  files: Record<string, string>,
  fn: (result: SpawnSyncReturns<string>) => T,
): T {
  const dir = mkdtempSync(join(tmpdir(), 'content-globs-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), body);
    }
    return fn(
      spawnSync(process.execPath, [CHECKER], { cwd: dir, encoding: 'utf8' }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- asserted

test('passes when every glob matches a file', () => {
  withWorkspace(PASSING, (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2 glob\(s\) across 2 config\(s\) all match/);
    assert.doesNotMatch(r.stderr, /ExperimentalWarning/);
  });
});

test('fails on a stories glob that matches nothing, naming glob and config', () => {
  withWorkspace(
    {
      ...PASSING,
      [STORYBOOK_MAIN]: storybookMain([
        '../src/lib/**/*.stories.tsx',
        '../../vault-ui/src/lib/**/*.stories.tsx',
      ]),
    },
    (r) => {
      assert.equal(r.status, 1);
      assert.match(
        r.stderr,
        /libs\/web\/ui\/\.storybook\/main\.ts: stories glob "\.\.\/\.\.\/vault-ui\/src\/lib\/\*\*\/\*\.stories\.tsx"/,
      );
      assert.doesNotMatch(r.stderr, /"\.\.\/src\/lib\//);
    },
  );
});

test('fails when the files a stories glob reached are deleted', () => {
  const rest = without(PASSING, 'libs/web/ui/src/lib/Button.stories.tsx');
  withWorkspace(rest, (r) => {
    assert.equal(r.status, 1);
    assert.match(
      r.stderr,
      /stories glob "\.\.\/src\/lib\/\*\*\/\*\.stories\.tsx"/,
    );
  });
});

test('fails on a mistyped extglob stories pattern', () => {
  withWorkspace(
    {
      ...PASSING,
      [STORYBOOK_MAIN]: storybookMain([
        '../src/lib/**/*.@(mdx|story.@(ts|tsx))',
      ]),
    },
    (r) => {
      assert.equal(r.status, 1);
      assert.match(r.stderr, /story\.@\(ts\|tsx\)/);
    },
  );
});

test('resolves an extglob stories pattern the way Storybook declares it', () => {
  withWorkspace(
    {
      ...PASSING,
      [STORYBOOK_MAIN]: storybookMain([
        '../src/lib/**/*.@(mdx|stories.@(js|jsx|ts|tsx))',
      ]),
    },
    (r) => assert.equal(r.status, 0, r.stderr),
  );
});

test('fails on a Tailwind content glob that matches nothing, naming glob and config', () => {
  withWorkspace(
    {
      ...PASSING,
      [TAILWIND_CONFIG]: tailwindConfig([
        './src/**/*.{ts,tsx}',
        '../../libs/web-ui/**/*.tsx',
      ]),
    },
    (r) => {
      assert.equal(r.status, 1);
      assert.match(
        r.stderr,
        /apps\/web\/tailwind\.config\.js: content glob "\.\.\/\.\.\/libs\/web-ui\/\*\*\/\*\.tsx"/,
      );
    },
  );
});

test('reads Tailwind content from the object form (content.files)', () => {
  withWorkspace(
    {
      ...PASSING,
      [TAILWIND_CONFIG]:
        'module.exports = { content: { files: ["./nowhere/**/*.tsx"] } };\n',
    },
    (r) => {
      assert.equal(r.status, 1);
      assert.match(r.stderr, /content glob "\.\/nowhere\/\*\*\/\*\.tsx"/);
    },
  );
});

test('resolves globs relative to the config file, not the repo root', () => {
  // `./src/**` matches from the repo root here, but not from apps/web.
  const rest = without(PASSING, 'apps/web/src/page.tsx');
  withWorkspace({ ...rest, 'src/page.tsx': 'export {};\n' }, (r) => {
    assert.equal(r.status, 1);
    assert.match(r.stderr, /apps\/web\/tailwind\.config\.js: content glob/);
  });
});

test('a match inside node_modules does not count', () => {
  const rest = without(PASSING, 'apps/web/src/page.tsx');
  withWorkspace(
    { ...rest, 'apps/web/src/node_modules/pkg/index.tsx': 'export {};\n' },
    (r) => {
      assert.equal(r.status, 1);
      assert.match(r.stderr, /content glob "\.\/src\/\*\*\/\*\.\{ts,tsx\}"/);
    },
  );
});

test('discovers and reads an .mjs Tailwind config', () => {
  withWorkspace(
    {
      ...PASSING,
      'libs/web/other/tailwind.config.mjs':
        'export default { content: ["./src/**/*.tsx"] };\n',
    },
    (r) => {
      assert.equal(r.status, 1);
      assert.match(
        r.stderr,
        /libs\/web\/other\/tailwind\.config\.mjs: content glob "\.\/src\/\*\*\/\*\.tsx"/,
      );
    },
  );
});

test('exits 2 on a TypeScript Tailwind config instead of skipping it', () => {
  withWorkspace(
    {
      ...PASSING,
      'libs/web/other/tailwind.config.ts':
        'export default { content: ["./src/**/*.tsx"] };\n',
    },
    (r) => {
      assert.equal(r.status, 2);
      assert.match(
        r.stderr,
        /libs\/web\/other\/tailwind\.config\.ts: a TypeScript Tailwind config cannot be evaluated/,
      );
    },
  );
});

test('discovers a Storybook main file with any JS/TS extension', () => {
  withWorkspace(
    {
      ...PASSING,
      'libs/web/other/.storybook/main.mts': storybookMain([
        '../src/**/*.stories.tsx',
      ]),
    },
    (r) => {
      assert.equal(r.status, 1);
      assert.match(r.stderr, /libs\/web\/other\/\.storybook\/main\.mts/);
    },
  );
});

test('discovers a second Storybook config without editing the checker', () => {
  withWorkspace(
    {
      ...PASSING,
      'libs/web/other/.storybook/main.ts': storybookMain([
        '../src/**/*.stories.tsx',
      ]),
    },
    (r) => {
      assert.equal(r.status, 1);
      assert.match(r.stderr, /libs\/web\/other\/\.storybook\/main\.ts/);
    },
  );
});

test('exits 2 when no config is found', () => {
  withWorkspace({ 'README.md': '# x\n' }, (r) => {
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no \.storybook\/main\.\* or tailwind\.config\.\*/);
  });
});

test('exits 2 when a stories entry is not a string literal', () => {
  withWorkspace(
    {
      ...PASSING,
      [STORYBOOK_MAIN]:
        "export default { stories: [{ directory: '../src', files: '*.stories.tsx' }] };\n",
    },
    (r) => {
      assert.equal(r.status, 2);
      assert.match(r.stderr, /not a string literal/);
    },
  );
});

// ---------------------------------------------------------------- omitted

test('a negated content glob that excludes nothing passes', () => {
  withWorkspace(
    {
      ...PASSING,
      [TAILWIND_CONFIG]: tailwindConfig([
        './src/**/*.{ts,tsx}',
        '!./src/**/*.generated.tsx',
      ]),
    },
    (r) => assert.equal(r.status, 0, r.stderr),
  );
});

test('a glob narrower than the story files it should reach still passes', () => {
  withWorkspace(
    {
      ...PASSING,
      'libs/web/ui/src/other/Card.stories.tsx': 'export default {};\n',
    },
    (r) => assert.equal(r.status, 0, r.stderr),
  );
});

// ---------------------------------------------------------------- readers

test('stripComments keeps `/**/` inside a string', () => {
  const src = "// a\nconst s = ['../src/**/*.tsx']; /* gone */\n";
  assert.equal(stripComments(src), "\nconst s = ['../src/**/*.tsx']; \n");
});

test('storiesGlobs ignores a commented-out glob', () => {
  const src =
    "export default {\n  stories: [\n    // '../old/**/*.stories.tsx',\n    '../src/**/*.stories.tsx',\n  ],\n};\n";
  assert.deepEqual(storiesGlobs(src), ['../src/**/*.stories.tsx']);
});
