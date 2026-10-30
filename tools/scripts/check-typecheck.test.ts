// Contract Suite for `tools/scripts/check-typecheck.ts` (ADR 0141). The defect
// worth catching is a green typecheck that checked nothing: the fixed
// `tools/scripts` config passing when it is missing, a TS18003 "no inputs" run
// reported as a type error or hiding one, `nx run-many` succeeding over a target
// no project carries, a failed project listing read as an empty success, or the
// path-gated `--tools-scripts-only` step building a project graph it does not
// need. Per-project inference is asserted in `nx/typecheck-plugin.test.ts`; this
// suite drives the checker's own verdicts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'check-typecheck.ts');
const REPO_ROOT = resolve(HERE, '..', '..');
const TOOLS_SCRIPTS_CONFIG = join('tools', 'scripts', 'tsconfig.json');

// A killed run skips every `t.after`, and a leftover deliberate type error in
// the live tools/scripts tree would fail the real fixed job on every later run,
// CI included. Removing both fixtures at load makes the next run self-heal.
for (const name of ['tmp-typecheck-fixture.ts', 'tmp-direct-run-fixture.ts']) {
  rmSync(join(REPO_ROOT, 'tools', 'scripts', name), { force: true });
}

/** A strict config whose `include` matches every .ts file under its directory. */
const CONFIG_BODY = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
  include: ['**/*.ts'],
});

/**
 * A fixture workspace under REPO_ROOT, so `npx` resolves TypeScript from the
 * repo's own node_modules. `config` is written as `tools/scripts/tsconfig.json`;
 * pass `null` to leave the file out.
 */
function fixtureWorkspace(t: TestContext, config: string | null = CONFIG_BODY) {
  const root = mkdtempSync(join(REPO_ROOT, '.tmp-typecheck-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (config !== null) {
    mkdirSync(join(root, 'tools', 'scripts'), { recursive: true });
    writeFileSync(join(root, TOOLS_SCRIPTS_CONFIG), config);
  }
  return root;
}

/**
 * Runs the checker with `cwd` as the workspace root, which is how it finds
 * `tools/scripts/tsconfig.json` and the Nx workspace.
 */
function runChecker(
  cwd: string,
  args: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
) {
  return spawnSync(process.execPath, [CHECKER, ...args], {
    cwd,
    encoding: 'utf8',
    env,
  });
}

/** The real npx, resolved before a stub shadows it on PATH. */
const REAL_NPX = spawnSync('sh', ['-c', 'command -v npx'], {
  encoding: 'utf8',
}).stdout.trim();

interface NpxStub {
  /** Shell body for `npx tsc ...`. Defaults to exit 0. */
  tsc?: string;
  /** Shell body for `npx nx show projects ...`. Defaults to two projects. */
  show?: string;
  /** Shell body for `npx nx run-many ...`. Defaults to exit 0. */
  runMany?: string;
}

const TWO_PROJECTS = `echo '["libs/a","libs/b"]'`;

/**
 * Puts an `npx` stub first on PATH, the same technique the gate-trigger suite
 * uses for `node`. Each invocation is appended to a log, so a test can assert
 * what ran as well as what it returned.
 */
function stubNpx(t: TestContext, stub: NpxStub) {
  const dir = mkdtempSync(join(tmpdir(), 'typecheck-npx-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  const log = join(dir, 'npx.log');
  mkdirSync(bin);
  writeFileSync(log, '');
  const script = [
    '#!/bin/sh',
    `echo "$*" >> '${log}'`,
    'case "$1" in',
    `  tsc) ${stub.tsc ?? 'exit 0'} ;;`,
    '  nx)',
    '    case "$2" in',
    `      show) ${stub.show ?? TWO_PROJECTS} ;;`,
    `      run-many) ${stub.runMany ?? 'exit 0'} ;;`,
    '      *) exit 98 ;;',
    '    esac ;;',
    '  *) exit 99 ;;',
    'esac',
    '',
  ].join('\n');
  const npx = join(bin, 'npx');
  writeFileSync(npx, script);
  chmodSync(npx, 0o755);
  return {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
    invocations: () => readFileSync(log, 'utf8').split('\n').filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// The fixed job: `tools/scripts/tsconfig.json`, compiled by real tsc.
// ---------------------------------------------------------------------------

test('--tools-scripts-only passes on the real tree and names the config it compiled', () => {
  const result = runChecker(REPO_ROOT, ['--tools-scripts-only']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tools\/scripts\/tsconfig\.json compiles clean/);
});

test('--tools-scripts-only fails and names a tools/scripts .ts file with a type error', (t) => {
  // tools/scripts has no broken .ts file of its own, so this one is written
  // into the real directory and removed after. The config under test sits at a
  // fixed path, so a fixture workspace could not stand in for it.
  const fixture = join(
    REPO_ROOT,
    'tools',
    'scripts',
    'tmp-typecheck-fixture.ts',
  );
  writeFileSync(fixture, 'const n: number = "string";\n');
  t.after(() => rmSync(fixture, { force: true }));

  const result = runChecker(REPO_ROOT, ['--tools-scripts-only']);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /tmp-typecheck-fixture\.ts/);
  assert.match(result.stderr, /error TS/);
});

test('node runs a valid tools/scripts .ts fixture directly, with no build step', (t) => {
  // The other half of ADR 0135's expand step: a .ts file with no type errors
  // must be directly executable by `node`, the same way every other
  // tools/scripts script is. engines.node's >=22.18 floor is the first Node 22 that strips
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

test('TS18003 alone is a vacuous pass: a config whose include matches nothing exits 0', (t) => {
  // The fixture's tools/scripts holds only tsconfig.json, so `include` matches
  // no file and tsc reports TS18003. That is nothing to typecheck, not a type
  // error, so the checker normalises it to a pass.
  const workspace = fixtureWorkspace(t);

  const result = runChecker(workspace, ['--tools-scripts-only']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /compiles clean/);
});

test('TS18003 does not hide a config-level error (TS5023) from the same config', (t) => {
  // TS18003 cannot pair with a type error from one config: a config with no
  // inputs has nothing to type-check. What can pair with it is a config-level
  // error such as an unknown compiler option (TS5023). The normalisation
  // applies only when TS18003 is the sole diagnostic, so that pairing must fail.
  const workspace = fixtureWorkspace(
    t,
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, notARealOption: true },
      include: ['**/*.ts'],
    }),
  );

  const result = runChecker(workspace, ['--tools-scripts-only']);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /TS5023/);
  assert.match(result.stderr, /2 error\(s\)/);
});

test('exits 2 when tools/scripts/tsconfig.json does not exist', (t) => {
  // A missing config means the check could not run, not that nothing was wrong.
  const workspace = fixtureWorkspace(t, null);

  const result = runChecker(workspace, ['--tools-scripts-only']);

  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stderr, /not found/);
});

test('a tsc that exits non-zero with no diagnostic exits 2, not 1', (t) => {
  // Exit 2 means the check could not run. A non-zero tsc that printed no
  // `error TS` line never looked at a type, so reporting it as 1 would tell the
  // reader their types are broken when the compiler never checked them.
  const workspace = fixtureWorkspace(t);
  const npx = stubNpx(t, {
    tsc: `echo 'could not determine executable' >&2; exit 1`,
  });

  const result = runChecker(workspace, ['--tools-scripts-only'], npx.env);

  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stderr, /tsc exited 1 with no diagnostic/);
  assert.match(result.stderr, /could not determine executable/);
});

test('--tools-scripts-only never invokes nx, so the path-gated CI step builds no graph', (t) => {
  // The pull-request step runs this flag on a path filter. If it built a
  // project graph, a tree with a broken Nx setup would fail a change that
  // touched only tools/scripts.
  const workspace = fixtureWorkspace(t);
  const loud = `echo 'nx must not run here' >&2; exit 9`;
  const npx = stubNpx(t, { show: loud, runMany: loud });

  const result = runChecker(workspace, ['--tools-scripts-only'], npx.env);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.includes('nx must not run here'), false);
  assert.equal(
    npx.invocations().some((line) => line.startsWith('nx ')),
    false,
    'the fixed job must not reach nx',
  );
});

// ---------------------------------------------------------------------------
// The Nx half: `nx show projects -t typecheck`, then `nx run-many`. The npx
// stub drives the outcomes the real workspace cannot produce on demand.
// ---------------------------------------------------------------------------

test('exits 2 when no project carries the typecheck target', (t) => {
  // `nx run-many` over a target nobody has succeeds while checking nothing.
  // An empty list is the vacuous-pass guard, so run-many must not run either.
  const workspace = fixtureWorkspace(t);
  const npx = stubNpx(t, { show: `echo '[]'` });

  const result = runChecker(workspace, [], npx.env);

  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stderr, /no project has a `typecheck` target/);
  assert.equal(
    npx.invocations().some((line) => line.startsWith('nx run-many')),
    false,
    'run-many must not run over an empty project list',
  );
});

test('exits 2 when nx run-many is killed by a signal, naming the signal', (t) => {
  // A signal kill is the one non-zero run-many outcome the list probe cannot
  // rule out. Exit 1 would say a type error, but nothing was checked to
  // completion, so the checker reports it as a check that could not run.
  const workspace = fixtureWorkspace(t);
  const npx = stubNpx(t, { runMany: 'kill -TERM $$' });

  const result = runChecker(workspace, [], npx.env);

  assert.equal(result.status, 2, result.stdout);
  assert.match(
    result.stderr,
    /run-many -t typecheck was killed on signal SIGTERM/,
  );
});

test('exits 2 when nx show projects exits non-zero', (t) => {
  const workspace = fixtureWorkspace(t);
  const npx = stubNpx(t, { show: `echo 'boom' >&2; exit 1` });

  const result = runChecker(workspace, [], npx.env);

  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stderr, /nx show projects -t typecheck failed: boom/);
});

test('exits 2 when nx show projects prints something other than a JSON list', (t) => {
  // The list is parsed, not scraped: a changed output format must not read as
  // an empty success.
  const workspace = fixtureWorkspace(t);
  const npx = stubNpx(t, { show: `echo 'libs/a, libs/b'` });

  const result = runChecker(workspace, [], npx.env);

  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stderr, /did not print a JSON list/);
});

test('a failed run-many task exits 1, because the list probe already ruled out every could-not-run case', (t) => {
  // Decision pinned here: the `nx show projects` probe runs first and exits 2
  // for an nx that cannot start, a workspace it cannot read, or a list it will
  // not print. So by the time run-many runs, a non-zero exit can only be a
  // failed task, and a failed task is a type error (exit 1). This test is the
  // existing run-many case, renamed to say so rather than duplicated.
  const workspace = fixtureWorkspace(t);
  const npx = stubNpx(t, { runMany: 'exit 1' });

  const result = runChecker(workspace, [], npx.env);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /`nx run-many -t typecheck` failed/);
  const calls = npx.invocations();
  const probeAt = calls.findIndex((line) =>
    line.startsWith('nx show projects'),
  );
  const runAt = calls.findIndex((line) => line.startsWith('nx run-many'));
  assert.notEqual(runAt, -1, 'run-many must have run');
  assert.ok(
    probeAt !== -1 && probeAt < runAt,
    'the first list probe must come before the first run-many',
  );
});

test('exits 0 when both halves pass, and the summary names the project count', (t) => {
  const workspace = fixtureWorkspace(t);
  const npx = stubNpx(t, {});

  const result = runChecker(workspace, [], npx.env);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 project\(s\) compile clean/);
  assert.match(result.stdout, /tools\/scripts\/tsconfig\.json compiles clean/);
  assert.ok(
    npx
      .invocations()
      .some((line) => line.startsWith('nx run-many -t typecheck')),
    'run-many must run once the list is non-empty',
  );
});

test('full mode reports a tools/scripts type error even when the Nx half is healthy', (t) => {
  // The fixed job is the real tsc here, in a fixture whose config has one
  // broken file. A healthy nx stub must not hide it, and run-many must still
  // have run: both halves run before either verdict.
  const workspace = fixtureWorkspace(t);
  writeFileSync(
    join(workspace, 'tools', 'scripts', 'broken.ts'),
    'const n: number = "string";\n',
  );
  assert.notEqual(REAL_NPX, '', 'could not resolve the real npx');
  const npx = stubNpx(t, { tsc: `exec '${REAL_NPX}' "$@"` });

  const result = runChecker(workspace, [], npx.env);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /broken\.ts/);
  assert.match(result.stderr, /error TS/);
  assert.ok(
    npx
      .invocations()
      .some((line) => line.startsWith('nx run-many -t typecheck')),
    'run-many must still run when the fixed job fails',
  );
});

test('full mode reports a failing run-many even when the fixed job is healthy', (t) => {
  const workspace = fixtureWorkspace(t);
  const npx = stubNpx(t, { runMany: 'exit 1' });

  const result = runChecker(workspace, [], npx.env);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /`nx run-many -t typecheck` failed/);
  assert.ok(
    npx
      .invocations()
      .some((line) => line.startsWith('tsc -p tools/scripts/tsconfig.json')),
    'the fixed job must still run when run-many fails',
  );
});
