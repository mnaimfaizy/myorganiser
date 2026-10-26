import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'check-typecheck.mjs');
const REPO_ROOT = resolve(HERE, '..', '..');

function writeGraph(t, nodes, dir) {
  const target = dir ?? mkdtempSync(join(tmpdir(), 'typecheck-test-'));
  if (!dir) t.after(() => rmSync(target, { recursive: true, force: true }));
  const file = join(target, 'graph.json');
  writeFileSync(file, JSON.stringify({ graph: { nodes } }));
  return file;
}

function runChecker(graphFile, workspaceRoot) {
  return spawnSync(process.execPath, [CHECKER, graphFile, workspaceRoot], {
    encoding: 'utf8',
  });
}

test('exits 2 when the graph file does not exist', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'typecheck-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runChecker(join(dir, 'absent.json'), REPO_ROOT);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /not found/);
});

test('exits 2 when no project in the graph has a tsconfig', (t) => {
  // Reporting success here would be the exact defect this script exists for:
  // a green result that means "nothing was looked at". Run against an empty
  // workspace, not REPO_ROOT: the real tree always carries
  // tools/scripts/tsconfig.json (a fixed job, not graph-discovered — see
  // below), which would otherwise give this fixture a config to find.
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'typecheck-test-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const graph = writeGraph(t, {
    ghost: { name: 'ghost', data: { root: 'does/not/exist', targets: {} } },
  });

  const result = runChecker(graph, workspaceRoot);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /no project tsconfigs/);
});

test('reaches tools/scripts/tsconfig.json as a fixed job, not through the graph', (t) => {
  // tools/scripts is deliberately not a Declared Nx Target (ADR 0135), so no
  // graph node names it; this asserts the checker still finds the real
  // config outside the graph loop. Run against REPO_ROOT, where the config
  // lives, with a graph that names no other tsconfig so only this job runs.
  const graph = writeGraph(t, {
    ghost: { name: 'ghost', data: { root: 'does/not/exist', targets: {} } },
  });

  const result = runChecker(graph, REPO_ROOT);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 project config\(s\) compile clean/);
});

test('fails naming a tools/scripts .ts fixture with a type error', (t) => {
  // tools/scripts has no .ts files of its own yet, so this writes one
  // directly into the real directory (cleaned up after) rather than standing
  // up a second fixture tree — the config under test lives at a fixed path,
  // not one this test controls.
  const fixture = join('tools', 'scripts', 'tmp-typecheck-fixture.ts');
  const absoluteFixture = join(REPO_ROOT, fixture);
  writeFileSync(absoluteFixture, 'const n: number = "string";\n');
  t.after(() => rmSync(absoluteFixture, { force: true }));

  const graph = writeGraph(t, {
    ghost: { name: 'ghost', data: { root: 'does/not/exist', targets: {} } },
  });

  const result = runChecker(graph, REPO_ROOT);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /tmp-typecheck-fixture\.ts/);
  assert.match(result.stderr, /error TS/);
});

test('node runs a valid tools/scripts .ts fixture directly, with no build step', (t) => {
  // The other half of ADR 0135's expand step: a .ts file with no type errors
  // must be directly executable by `node`, the same way check-*.mjs files
  // are today. engines.node's >=22.18 floor is the first Node 22 that strips
  // types by default, so this needs no flag.
  const fixture = join('tools', 'scripts', 'tmp-direct-run-fixture.ts');
  const absoluteFixture = join(REPO_ROOT, fixture);
  writeFileSync(absoluteFixture, 'const n: number = 1;\nconsole.log(n);\n');
  t.after(() => rmSync(absoluteFixture, { force: true }));

  const result = spawnSync(process.execPath, [absoluteFixture], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '1');
});

test('accepts a project whose tsconfig compiles', (t) => {
  // A real project, compiled by the real tsc. `design-tokens` is two source
  // files and one config, so this stays quick while still proving the spawn,
  // the cwd, and the exit-code plumbing all line up.
  const graph = writeGraph(t, {
    'design-tokens': {
      name: 'design-tokens',
      data: { root: 'libs/design-tokens', targets: {} },
    },
  });

  const result = runChecker(graph, REPO_ROOT);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /compile clean/);
});

test('exits 1 and names the config when a project has a type error', (t) => {
  // The fixture lives under the repo root so `npx tsc` resolves TypeScript from
  // the workspace's own node_modules; a temp directory elsewhere would send npx
  // to the registry.
  const dir = mkdtempSync(join(REPO_ROOT, '.tmp-typecheck-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(
    join(dir, 'tsconfig.lib.json'),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
      include: ['broken.ts'],
    }),
  );
  writeFileSync(join(dir, 'broken.ts'), 'export const n: number = "string";\n');

  const graph = writeGraph(
    t,
    {
      broken: {
        name: 'broken',
        data: { root: dir.slice(REPO_ROOT.length + 1), targets: {} },
      },
    },
    dir,
  );

  const result = runChecker(graph, REPO_ROOT);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /broken\.ts/);
  assert.match(result.stderr, /error TS/);
  assert.match(result.stderr, /1 error\(s\)/);
});

test('checks a tsconfig.web.json, the react-native-web program', (t) => {
  // apps/mobile type-checks two programs (ADR 0103): tsconfig.app.json is the
  // native one, and tsconfig.web.json is the only config that compiles the
  // `.web` Platform Variants. A checker that skipped it would leave
  // crypto.web.ts gated by nothing, which is what it was before ADR 0103.
  const dir = mkdtempSync(join(REPO_ROOT, '.tmp-typecheck-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(
    join(dir, 'tsconfig.web.json'),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
      include: ['broken.web.ts'],
    }),
  );
  writeFileSync(
    join(dir, 'broken.web.ts'),
    'export const n: number = "string";\n',
  );

  const graph = writeGraph(
    t,
    {
      web: {
        name: 'web',
        data: { root: dir.slice(REPO_ROOT.length + 1), targets: {} },
      },
    },
    dir,
  );

  const result = runChecker(graph, REPO_ROOT);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /tsconfig\.web\.json/);
  assert.match(result.stderr, /broken\.web\.ts/);
});

test('checks a bare tsconfig.json when a project has no production config', (t) => {
  // apps/web is a Next.js app: its production program is
  // `tsconfig.json` itself, with no `tsconfig.app.json` beside it. A checker
  // that knew only the suffixed names compiled its spec program and nothing
  // else, so a production type error no spec imported passed the gate (#1060).
  const dir = mkdtempSync(join(REPO_ROOT, '.tmp-typecheck-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
      include: ['broken.ts'],
    }),
  );
  writeFileSync(join(dir, 'broken.ts'), 'export const n: number = "string";\n');
  // The spec program is clean, as apps/web's was: only the production
  // program can report this error.
  writeFileSync(
    join(dir, 'tsconfig.spec.json'),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
      include: ['clean.spec.ts'],
    }),
  );
  writeFileSync(join(dir, 'clean.spec.ts'), 'export const n: number = 1;\n');

  const graph = writeGraph(
    t,
    {
      next: {
        name: 'next',
        data: { root: dir.slice(REPO_ROOT.length + 1), targets: {} },
      },
    },
    dir,
  );

  const result = runChecker(graph, REPO_ROOT);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /tsconfig\.json \(1\)/);
  assert.match(result.stderr, /broken\.ts/);
  // 3, not 2: WORKSPACE_ROOT is REPO_ROOT (see the comment above), which
  // always carries the real tools/scripts/tsconfig.json as a third, passing
  // fixed job alongside this fixture's two.
  assert.match(result.stderr, /1 of 3 config\(s\)/);
});

test('leaves tsconfig.json alone when a production config exists', (t) => {
  // Beside a `tsconfig.lib.json`, `tsconfig.json` is the editor's umbrella
  // config, not a program anyone ships. Compiling it as well would check the
  // same files twice, under options the project does not build with.
  const dir = mkdtempSync(join(REPO_ROOT, '.tmp-typecheck-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
      include: ['broken.ts'],
    }),
  );
  writeFileSync(join(dir, 'broken.ts'), 'export const n: number = "string";\n');
  writeFileSync(
    join(dir, 'tsconfig.lib.json'),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
      include: ['clean.ts'],
    }),
  );
  writeFileSync(join(dir, 'clean.ts'), 'export const n: number = 1;\n');

  const graph = writeGraph(
    t,
    {
      lib: {
        name: 'lib',
        data: { root: dir.slice(REPO_ROOT.length + 1), targets: {} },
      },
    },
    dir,
  );

  const result = runChecker(graph, REPO_ROOT);

  assert.equal(result.status, 0, result.stderr);
  // 2, not 1: WORKSPACE_ROOT is REPO_ROOT, which always carries the real
  // tools/scripts/tsconfig.json as a second, passing fixed job.
  assert.match(result.stdout, /2 project config\(s\) compile clean/);
});
