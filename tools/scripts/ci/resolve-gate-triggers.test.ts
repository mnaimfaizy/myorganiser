// Contract Suite for the heavy-gate resolver (ADR 0140): the flags a pull
// request's changed paths select, and the fallback that must run more rather
// than less. The defect worth catching is a suite skipped for a path it should
// have selected — a shared input that fails to reach every suite, a rename
// whose old path no longer triggers its gate, or a resolver error that skips
// instead of running everything. The pure parser's rejections are asserted
// alongside, since a config it accepts with a collapsed flag name would share
// one decision between two suites.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  readFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isolateGitEnvironment } from '../lib/git-environment.ts';
import { parseNameStatus } from './resolve-gate-triggers.ts';
import {
  flagName,
  formatFlags,
  parseGateTriggers,
  readGateTriggers,
  resolveSuites,
} from '../lib/gate-triggers.ts';

// Husky runs this suite with the hook's GIT_DIR; see git-environment.ts.
isolateGitEnvironment();

const HERE = dirname(fileURLToPath(import.meta.url));
const RESOLVER = join(HERE, 'resolve-gate-triggers.ts');
const REPO_ROOT = resolve(HERE, '../../..');
const CONFIG_PATH = 'tools/config/gate-triggers.json';

// Each fixture writes its own config, so the suite never depends on the live
// catalogue: a suite added or retuned there cannot change these expectations.
const FIXTURE_CONFIG = {
  schemaVersion: 1,
  sharedInputs: ['.github/workflows/**', 'package.json', CONFIG_PATH],
  suites: [
    {
      id: 'alpha:test',
      ciStep: 'Run alpha suites',
      why: 'Alpha triggers.',
      triggers: ['libs/alpha/**'],
    },
    {
      id: 'beta:check',
      ciStep: 'Check beta',
      why: 'Beta triggers.',
      triggers: ['libs/beta/**'],
    },
  ],
};

const FIXTURE_CONFIG_TEXT = `${JSON.stringify(FIXTURE_CONFIG, null, 2)}\n`;

interface Repo {
  workspace: string;
  base: string;
}

/**
 * The resolver diffs two commits, so every range is a real repository with a
 * base commit and a head commit on top of it. The base always carries the
 * fixture config so the head can change it.
 */
function createRepo(t: TestContext, files: Record<string, string>): Repo {
  const workspace = mkdtempSync(join(tmpdir(), 'resolve-gate-triggers-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  git(workspace, 'init', '-q');
  write(workspace, CONFIG_PATH, FIXTURE_CONFIG_TEXT);
  for (const [path, contents] of Object.entries(files)) {
    write(workspace, path, contents);
  }
  return { workspace, base: commit(workspace, 'base') };
}

/** A directory with no repository, for `--all`, which must not consult git. */
function createWorkspace(t: TestContext, config: string | null): string {
  const workspace = mkdtempSync(join(tmpdir(), 'resolve-gate-triggers-cfg-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  if (config !== null) write(workspace, CONFIG_PATH, config);
  return workspace;
}

function git(workspace: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=test@example.com', '-c', 'user.name=test', ...args],
    { cwd: workspace, encoding: 'utf8' },
  ).trim();
}

function write(workspace: string, relative: string, contents: string): void {
  const path = join(workspace, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function commit(workspace: string, message: string): string {
  git(workspace, 'add', '-A');
  git(workspace, 'commit', '-q', '--allow-empty', '-m', message);
  return git(workspace, 'rev-parse', 'HEAD');
}

function runResolver(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [RESOLVER, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

/** The stdout `name=value` lines as a map, so an assertion names each flag. */
function flagsOf(stdout: string): Record<string, string> {
  return Object.fromEntries(
    stdout
      .trim()
      .split('\n')
      .map((line) => line.split('=') as [string, string]),
  );
}

function assertFlags(
  result: ReturnType<typeof runResolver>,
  expected: Record<string, string>,
): void {
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(flagsOf(result.stdout), expected, result.stderr);
}

const ALL_TRUE = {
  run_all: 'true',
  run_alpha_test: 'true',
  run_beta_check: 'true',
};

test('a path matching one suite trigger sets only that suite flag', (t) => {
  const repo = createRepo(t, { 'libs/alpha/src/index.ts': 'a\n' });
  write(repo.workspace, 'libs/alpha/src/index.ts', 'changed\n');
  commit(repo.workspace, 'alpha change');

  assertFlags(runResolver(repo.workspace, [repo.base, 'HEAD']), {
    run_all: 'false',
    run_alpha_test: 'true',
    run_beta_check: 'false',
  });
});

test('a path matching no trigger sets every suite flag false', (t) => {
  const repo = createRepo(t, { 'docs/notes.md': 'a\n' });
  write(repo.workspace, 'docs/notes.md', 'changed\n');
  commit(repo.workspace, 'docs change');

  assertFlags(runResolver(repo.workspace, [repo.base, 'HEAD']), {
    run_all: 'false',
    run_alpha_test: 'false',
    run_beta_check: 'false',
  });
});

for (const shared of ['package.json', '.github/workflows/ci.yml']) {
  test(`a change to shared input ${shared} sets run_all and every flag`, (t) => {
    const repo = createRepo(t, { [shared]: 'one\n' });
    write(repo.workspace, shared, 'two\n');
    commit(repo.workspace, 'shared change');

    assertFlags(runResolver(repo.workspace, [repo.base, 'HEAD']), ALL_TRUE);
  });
}

test('a change to the gate-trigger config itself sets every flag', (t) => {
  const repo = createRepo(t, {});
  write(
    repo.workspace,
    CONFIG_PATH,
    `${JSON.stringify(FIXTURE_CONFIG, null, 4)}\n`,
  );
  commit(repo.workspace, 'retune config');

  assertFlags(runResolver(repo.workspace, [repo.base, 'HEAD']), ALL_TRUE);
});

test('--all sets run_all and every flag without consulting git', (t) => {
  const workspace = createWorkspace(t, FIXTURE_CONFIG_TEXT);

  const result = runResolver(workspace, ['--all']);

  assertFlags(result, ALL_TRUE);
  assert.doesNotMatch(result.stderr, /fatal|Command failed/);
  // That phrase is written only on the git-error fallback, so its absence shows
  // --all resolved directly rather than arriving at every flag through an error.
  assert.doesNotMatch(result.stderr, /running every heavy suite/);
});

test('a range git cannot diff prints run_all and exits 0', (t) => {
  const repo = createRepo(t, { 'libs/alpha/a.ts': 'a\n' });

  const result = runResolver(repo.workspace, ['1'.repeat(40), '2'.repeat(40)]);

  assertFlags(result, ALL_TRUE);
  assert.match(result.stderr, /running every heavy suite/);
});

test('an absent gate-trigger config exits 2 with nothing on stdout', (t) => {
  const workspace = createWorkspace(t, null);

  const result = runResolver(workspace, ['--all']);

  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /gate-triggers\.json not found/);
});

test('a malformed gate-trigger config exits 2 with nothing on stdout', (t) => {
  const workspace = createWorkspace(t, '{ not json');

  const result = runResolver(workspace, ['--all']);

  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /is not valid JSON/);
});

test('a range that renames a file into a trigger path selects that suite', (t) => {
  const repo = createRepo(t, {
    'libs/gamma/src/index.ts': 'a\n',
    'libs/alpha/src/.keep': '',
  });
  git(
    repo.workspace,
    'mv',
    'libs/gamma/src/index.ts',
    'libs/alpha/src/index.ts',
  );
  commit(repo.workspace, 'move into alpha');

  assertFlags(runResolver(repo.workspace, [repo.base, 'HEAD']), {
    run_all: 'false',
    run_alpha_test: 'true',
    run_beta_check: 'false',
  });
});

// The defect `--name-only -M` had: with rename detection on, git reports a
// rename under its new path only, so moving a file out of a trigger path
// skipped the suite over the tree it just left.
test('a range that renames a file out of a trigger path still selects that suite', (t) => {
  const repo = createRepo(t, {
    'libs/alpha/src/index.ts': 'a\n',
    'libs/gamma/src/.keep': '',
  });
  git(
    repo.workspace,
    'mv',
    'libs/alpha/src/index.ts',
    'libs/gamma/src/index.ts',
  );
  commit(repo.workspace, 'move out of alpha');

  assertFlags(runResolver(repo.workspace, [repo.base, 'HEAD']), {
    run_all: 'false',
    run_alpha_test: 'true',
    run_beta_check: 'false',
  });
});

test('both sides of a rename are read from one --name-status record', () => {
  assert.deepEqual(
    parseNameStatus('R100\0libs/alpha/a.ts\0libs/gamma/a.ts\0'),
    ['libs/alpha/a.ts', 'libs/gamma/a.ts'],
  );
  assert.deepEqual(parseNameStatus('C75\0a.ts\0b.ts\0M\0c.ts\0'), [
    'a.ts',
    'b.ts',
    'c.ts',
  ]);
  assert.deepEqual(parseNameStatus('M\0x.ts\0A\0y.ts\0D\0z.ts\0'), [
    'x.ts',
    'y.ts',
    'z.ts',
  ]);
  assert.deepEqual(parseNameStatus(''), []);
});

// -- pure parser -------------------------------------------------------------

const suite = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  ciStep: 'Run it',
  why: 'Because.',
  triggers: ['libs/alpha/**'],
  ...overrides,
});

/** A copy of a suite with one key removed, so a field can be shown missing. */
const without = (
  object: Record<string, unknown>,
  key: string,
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));

const validRaw = (): Record<string, unknown> => ({
  schemaVersion: 1,
  sharedInputs: ['package.json'],
  suites: [suite('alpha:test')],
});

test('parseGateTriggers rejects an unknown schemaVersion', () => {
  assert.throws(
    () => parseGateTriggers({ ...validRaw(), schemaVersion: 2 }),
    /expected "schemaVersion": 1, found 2/,
  );
});

test('parseGateTriggers rejects an empty suites array', () => {
  assert.throws(
    () => parseGateTriggers({ ...validRaw(), suites: [] }),
    /expected a non-empty "suites" array/,
  );
});

test('parseGateTriggers rejects a suite with empty triggers', () => {
  assert.throws(
    () =>
      parseGateTriggers({
        ...validRaw(),
        suites: [suite('alpha:test', { triggers: [] })],
      }),
    /suites\[0\]: alpha:test: triggers: expected a non-empty array of globs/,
  );
});

test('parseGateTriggers rejects a suite with no ciStep', () => {
  assert.throws(
    () =>
      parseGateTriggers({
        ...validRaw(),
        suites: [without(suite('alpha:test'), 'ciStep')],
      }),
    /alpha:test: ciStep names the Test job step/,
  );
});

test('parseGateTriggers rejects a suite with no why', () => {
  assert.throws(
    () =>
      parseGateTriggers({
        ...validRaw(),
        suites: [without(suite('alpha:test'), 'why')],
      }),
    /alpha:test: why records the reason for these globs/,
  );
});

test('parseGateTriggers rejects a duplicate suite id', () => {
  assert.throws(
    () =>
      parseGateTriggers({
        ...validRaw(),
        suites: [suite('alpha:test'), suite('alpha:test')],
      }),
    /duplicate suite id alpha:test/,
  );
});

test('parseGateTriggers rejects two ids that collapse to one flag', () => {
  assert.throws(
    () =>
      parseGateTriggers({
        ...validRaw(),
        suites: [suite('tools:test'), suite('tools-test')],
      }),
    /tools-test collapses to output run_tools_test, which another suite already uses/,
  );
});

test('flagName turns a gate name into its step-output flag', () => {
  assert.equal(flagName('tools:test'), 'run_tools_test');
  assert.equal(flagName('openapi:check'), 'run_openapi_check');
});

test('formatFlags writes run_all first and one line per suite', () => {
  const config = parseGateTriggers(FIXTURE_CONFIG);

  const selected = formatFlags(
    resolveSuites({ config, changedPaths: ['libs/alpha/x.ts'] }),
  ).split('\n');
  assert.deepEqual(selected, [
    'run_all=false',
    'run_alpha_test=true',
    'run_beta_check=false',
  ]);

  const everything = formatFlags(
    resolveSuites({ config, changedPaths: [], all: true }),
  );
  assert.equal(everything.split('\n')[0], 'run_all=true');
});

// ADR 0140 item 3 names the shared inputs whose change selects every suite. The
// fixture config above proves the mechanism; this pins the live list, so
// dropping one from gate-triggers.json fails here rather than silently.
test('every live shared input selects every suite', () => {
  const config = readGateTriggers({ cwd: REPO_ROOT });
  const shared = [
    'yarn.lock',
    'tsconfig.base.json',
    'nx.json',
    'package.json',
    '.github/workflows/ci.yml',
    'tools/config/gate-triggers.json',
  ];

  for (const path of shared) {
    const resolution = resolveSuites({ config, changedPaths: [path] });
    assert.equal(resolution.all, true, `${path} must set run_all`);
    for (const suite of resolution.suites) {
      assert.equal(suite.run, true, `${path} must set ${suite.flag}`);
    }
  }
});

test('the live gate-trigger config parses and every suite is a package.json script', () => {
  const config = readGateTriggers({ cwd: REPO_ROOT });
  const scripts = JSON.parse(
    readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
  ).scripts as Record<string, string>;

  assert.ok(config.suites.length > 0);
  for (const entry of config.suites) {
    assert.ok(
      Object.hasOwn(scripts, entry.id),
      `${entry.id} is not a package.json script, so it cannot be run`,
    );
  }
});
