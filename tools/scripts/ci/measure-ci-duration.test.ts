// Contract Suite for the CI duration measurement's IO half (PRD #1387, issue
// #1393): the project-root walk, the main-tip lookup, and the command line.
// The pure arithmetic is asserted in tools/scripts/lib/ci-duration.test.ts;
// this suite covers what the script does with its inputs and its exit codes.
// Every command-line row runs under offlineEnvironment(): a fake `gh` first on
// PATH records any call, so a regression that reaches for GitHub fails.
//
// Run with: node --test tools/scripts/ci/measure-ci-duration.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  COMMIT_PAGE_SIZE,
  MAX_COMMIT_PAGES,
  mainTipAt,
  projectRootsUnder,
} from './measure-ci-duration.ts';
import { gather, job, prRun, repeat } from '../lib/ci-duration-fixtures.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'measure-ci-duration.ts');

const scratch = mkdtempSync(join(tmpdir(), 'ci-duration-cli-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Runs the script as a child process and returns what it exited with. */
const runCli = (
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): CliResult => {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failed = error as {
      status?: number | null;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: failed.status ?? -1,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? '',
    };
  }
};

/** A PATH whose only `gh` records that it was called, and fails. */
const offlineEnvironment = (): { env: NodeJS.ProcessEnv; marker: string } => {
  const bin = join(scratch, `bin-${Math.random().toString(36).slice(2)}`);
  mkdirSync(bin, { recursive: true });
  const marker = join(bin, 'gh-was-called');
  const gh = join(bin, 'gh');
  writeFileSync(gh, `#!/bin/sh\necho called >> '${marker}'\nexit 1\n`);
  chmodSync(gh, 0o755);
  return { env: { ...process.env, PATH: bin }, marker };
};

/** Ten slow Single-Library runs: the window is measurable and the target trips. */
const slowGather = () =>
  gather(
    repeat(10, () => prRun({ jobs: [job('Test', 0, 1200)] })),
    { 'CI runs (`gh run list`)': '10 listed, 10 in the window' },
  );

const writeJson = (name: string, value: unknown): string => {
  const path = join(scratch, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
};

// --------------------------------------------------------- the root walk

test('project roots are every nested project.json, repo-relative, skipping vendored and build trees', () => {
  const tree = join(scratch, 'roots');
  for (const file of [
    'apps/a/project.json',
    'libs/x/project.json',
    'libs/x/y/project.json',
    'node_modules/pkg/project.json',
    'dist/d/project.json',
  ]) {
    mkdirSync(join(tree, dirname(file)), { recursive: true });
    writeFileSync(join(tree, file), '{}');
  }
  assert.deepEqual(projectRootsUnder(tree), ['apps/a', 'libs/x', 'libs/x/y']);
});

test('a project root walk over a missing directory is empty rather than a throw', () => {
  assert.deepEqual(projectRootsUnder(join(scratch, 'missing')), []);
});

// ------------------------------------------------------- the main tip

test('the main tip at a run is the newest commit at or before its creation', () => {
  // Newest first, as listMainCommits returns them.
  const commits = [
    { sha: 'c3', committedAt: Date.parse('2026-10-03T00:00:00Z') },
    { sha: 'c2', committedAt: Date.parse('2026-10-02T00:00:00Z') },
    { sha: 'c1', committedAt: Date.parse('2026-10-01T00:00:00Z') },
  ];
  assert.equal(mainTipAt(commits, '2026-10-02T12:00:00Z'), 'c2');
  // "At or before" is inclusive: a commit landing at the same instant counts.
  assert.equal(mainTipAt(commits, '2026-10-02T00:00:00Z'), 'c2');
  assert.equal(mainTipAt(commits, '2026-09-30T00:00:00Z'), null);
  assert.equal(mainTipAt(commits, 'not a time'), null);
});

// --------------------------------------------------------- the command line

test('--gathered re-measures a saved window offline, prints the report and exits 0', () => {
  const input = writeJson('slow.json', slowGather());
  const { env, marker } = offlineEnvironment();
  const result = runCli(['--gathered', input], env);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# PR CI duration/);
  assert.match(result.stdout, /#1387\b/);
  assert.match(
    result.stdout,
    /A Single-Library Pull Request waits longer than five minutes/,
  );
  assert.equal(existsSync(marker), false, 'a --gathered run must not call gh');
});

test('--out and --json write the report and the summary, and stdout carries no report', () => {
  const input = writeJson('slow-out.json', slowGather());
  const out = join(scratch, 'report.md');
  const json = join(scratch, 'report.json');
  const { env, marker } = offlineEnvironment();
  const result = runCli(
    ['--gathered', input, '--out', out, '--json', json],
    env,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(readFileSync(out, 'utf8'), /^# PR CI duration/);
  assert.equal(JSON.parse(readFileSync(json, 'utf8')).verdict, 'over-target');
  assert.equal(existsSync(marker), false, 'a report run must not call gh');
});

test('--save-gather writes the gather, and re-measuring it gives the same verdict', () => {
  const input = writeJson('slow-save.json', slowGather());
  const saved = join(scratch, 'saved-gather.json');
  const remeasured = join(scratch, 'remeasured.json');
  const { env, marker } = offlineEnvironment();

  assert.equal(
    runCli(['--gathered', input, '--save-gather', saved], env).status,
    0,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(saved, 'utf8')),
    JSON.parse(readFileSync(input, 'utf8')),
  );
  assert.equal(
    runCli(['--gathered', saved, '--json', remeasured], env).status,
    0,
  );
  assert.equal(
    JSON.parse(readFileSync(remeasured, 'utf8')).verdict,
    'over-target',
  );
  assert.equal(
    existsSync(marker),
    false,
    'a save and re-measure must not call gh',
  );
});

test('--no-github reads no CI runs, says so in the evidence, and exits 0 offline', () => {
  const { env, marker } = offlineEnvironment();
  const result = runCli(
    ['--no-github', '--since', '2026-10-12', '--until', '2026-10-26'],
    env,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stdout.includes('- CI runs (`gh run list`): not read — no `gh`'),
  );
  assert.equal(existsSync(marker), false, '--no-github must not call gh');
});

test('a malformed --since is a could-not-run exit of 2, not a measurement', () => {
  const { env, marker } = offlineEnvironment();
  const result = runCli(['--since', 'nope', '--until', '2026-10-01'], env);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /YYYY-MM-DD/);
  assert.equal(existsSync(marker), false, 'a bad window must not reach gh');
});

test('a malformed --until is a could-not-run exit of 2, not a measurement', () => {
  const { env, marker } = offlineEnvironment();
  const result = runCli(['--until', 'nope', '--since', '2026-10-01'], env);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /YYYY-MM-DD/);
  assert.equal(existsSync(marker), false, 'a bad window must not reach gh');
});

test('--gathered pointing at a file that is not JSON exits 2', () => {
  const broken = join(scratch, 'not-json.json');
  writeFileSync(broken, 'this is not json');
  const { env, marker } = offlineEnvironment();
  const result = runCli(['--gathered', broken], env);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /cannot read/);
  assert.equal(existsSync(marker), false, 'a bad gather must not reach gh');
});

test('--days with a valid --gathered still measures and exits 0', () => {
  const input = writeJson('slow-days.json', slowGather());
  const { env, marker } = offlineEnvironment();
  const result = runCli(['--days', '14', '--gathered', input], env);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# PR CI duration/);
  assert.equal(existsSync(marker), false, 'a --gathered run must not call gh');
});

test('--days abc is the could-not-run exit of 2, named as --days, with no RangeError and no gh call', () => {
  const { env, marker } = offlineEnvironment();
  const result = runCli(['--days', 'abc'], env);

  assert.equal(result.status, 2, result.stderr);
  assert.notEqual(result.status, 1, 'a bad flag must not exit 1');
  assert.match(result.stderr, /--days/);
  assert.doesNotMatch(result.stderr, /RangeError/);
  assert.equal(existsSync(marker), false, 'a bad window must not reach gh');
});

for (const [name, args] of [
  [
    '--days 0 is the could-not-run exit of 2: a window of zero days is not a window',
    ['--days', '0'],
  ],
  [
    '--days -3 is the could-not-run exit of 2: a negative window is not a window',
    ['--days', '-3'],
  ],
  [
    '--days 2.5 is the could-not-run exit of 2: a window is a whole number of days',
    ['--days', '2.5'],
  ],
  [
    '--limit zero is the could-not-run exit of 2: a run limit is a whole number',
    ['--limit', 'zero'],
  ],
] as const) {
  test(name, () => {
    const { env, marker } = offlineEnvironment();
    const result = runCli([...args], env);

    assert.equal(result.status, 2, result.stderr);
    assert.equal(existsSync(marker), false, 'a bad flag must not reach gh');
  });
}

test('REPO_ROOT resolves to the repository root whatever the working directory', () => {
  // A child process imports the module from a directory that is not the
  // repository, so the value cannot be the test's own cwd or a re-derivation.
  const printed = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { REPO_ROOT } from ${JSON.stringify(pathToFileURL(SCRIPT).href)}; process.stdout.write(REPO_ROOT);`,
    ],
    { cwd: scratch, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  assert.equal(resolve(printed), resolve(HERE, '../../..'));
  assert.ok(existsSync(join(printed, 'package.json')));
});

// ------------------------------------ the reads, answered by a fake gh

/**
 * The body of a `gh` stand-in that ANSWERS the calls a measurement makes, and
 * logs each call's argv as one JSON line. `auth status` succeeds, so the gather
 * runs; `run list` lists nothing; the commits endpoint is an endless server
 * whose pages are full, unless FAKE_GH_MODE says page 2 is short or unreadable.
 * Written as raw text so the regexes keep their backslashes.
 */
const FAKE_GH_BODY = String.raw`
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + '\n');
if (args[0] === 'auth') process.exit(0);
if (args[0] === 'run' && args[1] === 'list') {
  process.stdout.write('[]');
  process.exit(0);
}
if (args[0] === 'api' && args[1].indexOf('/commits?') !== -1) {
  const page = Number(/[?&]page=(\d+)/.exec(args[1])[1]);
  const mode = process.env.FAKE_GH_MODE;
  if (mode === 'unreadable-second' && page === 2) process.exit(0);
  const full = Number(process.env.FAKE_GH_PAGE_SIZE);
  const size = mode === 'short-second' && page === 2 ? 40 : full;
  const rows = [];
  for (let i = 0; i < size; i += 1) {
    rows.push({
      sha: (page + '-' + i).padEnd(40, '0'),
      commit: { committer: { date: '2026-10-20T10:00:00Z' } },
    });
  }
  process.stdout.write(JSON.stringify(rows));
  process.exit(0);
}
process.exit(1);
`;

type FakeMode = 'endless' | 'short-second' | 'unreadable-second';

/** A PATH whose only `gh` answers, and logs every call it is given. */
const answeringEnvironment = (
  mode: FakeMode = 'endless',
): { env: NodeJS.ProcessEnv; log: string } => {
  const bin = join(scratch, `gh-${Math.random().toString(36).slice(2)}`);
  mkdirSync(bin, { recursive: true });
  const log = join(bin, 'calls.log');
  const gh = join(bin, 'gh');
  // PATH is replaced, so the shebang must name node by its absolute path.
  writeFileSync(gh, `#!${process.execPath}\n${FAKE_GH_BODY}`);
  chmodSync(gh, 0o755);
  return {
    env: {
      ...process.env,
      PATH: bin,
      FAKE_GH_LOG: log,
      FAKE_GH_MODE: mode,
      FAKE_GH_PAGE_SIZE: String(COMMIT_PAGE_SIZE),
    },
    log,
  };
};

/** Every call the fake `gh` was given, as its argv. */
const callsLogged = (log: string): string[][] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[])
    : [];

/** The `page=` of every commits request, in the order they were made. */
const pagesRequested = (log: string): string[] =>
  callsLogged(log)
    .filter((args) => args[0] === 'api' && args[1].includes('/commits?'))
    .map((args) => /[?&]page=(\d+)/.exec(args[1])?.[1] ?? '');

const WINDOW = ['--since', '2026-10-12', '--until', '2026-10-26'];

test('an endless commits server is walked to MAX_COMMIT_PAGES pages and no further, and the bound is named', () => {
  const { env, log } = answeringEnvironment('endless');
  const out = join(scratch, 'endless-gather.json');
  const result = runCli(
    ['--repository', 'owner/repo', ...WINDOW, '--save-gather', out],
    env,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    pagesRequested(log),
    Array.from({ length: MAX_COMMIT_PAGES }, (_, index) => String(index + 1)),
    'the walk must request pages 1..MAX_COMMIT_PAGES; an early break fails here',
  );
  const evidence = JSON.parse(readFileSync(out, 'utf8')).evidence;
  assert.match(
    evidence['`main` commits (Actions API)'],
    new RegExp(`the paging loop hit its ${MAX_COMMIT_PAGES}-page bound`),
  );
});

test('a short page ends the commits walk: a 40-item page 2 stops the walk at page 2 with no bound named', () => {
  const { env, log } = answeringEnvironment('short-second');
  const out = join(scratch, 'short-gather.json');
  const result = runCli(
    ['--repository', 'owner/repo', ...WINDOW, '--save-gather', out],
    env,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(pagesRequested(log), ['1', '2']);
  const evidence = JSON.parse(readFileSync(out, 'utf8')).evidence;
  assert.doesNotMatch(
    evidence['`main` commits (Actions API)'],
    /could not be read|bound/,
  );
});

test('an unreadable page 2 stops the walk and the saved gather names it, so an unreadable page is not read as the end of history', () => {
  const { env, log } = answeringEnvironment('unreadable-second');
  const out = join(scratch, 'unreadable-gather.json');
  const result = runCli(
    ['--repository', 'owner/repo', ...WINDOW, '--save-gather', out],
    env,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(pagesRequested(log), ['1', '2']);
  const evidence = JSON.parse(readFileSync(out, 'utf8')).evidence;
  assert.match(
    evidence['`main` commits (Actions API)'],
    /page 2 could not be read/,
  );
});

test('--repository is passed to gh run list as --repo followed by the repository, so the listing reads the measured repository', () => {
  const { env, log } = answeringEnvironment('unreadable-second');
  const result = runCli(
    [
      '--repository',
      'owner/repo',
      ...WINDOW,
      '--save-gather',
      join(scratch, 'repo-gather.json'),
    ],
    env,
  );

  assert.equal(result.status, 0, result.stderr);
  const runList = callsLogged(log).find(
    (args) => args[0] === 'run' && args[1] === 'list',
  );
  assert.ok(runList, 'gh run list was not called');
  const at = runList.indexOf('--repo');
  assert.notEqual(at, -1, 'gh run list was not given --repo');
  assert.equal(runList[at + 1], 'owner/repo');
});
