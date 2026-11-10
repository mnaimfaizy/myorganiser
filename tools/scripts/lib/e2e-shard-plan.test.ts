// Contract Suite for the E2E shard plan (ADR 0050, issue #1381). The defects
// worth catching are a spec file that no shard runs, a file two shards both
// run, a plan that differs between two matrix jobs, a filter that selects a
// second file whose name ends the same way, and the disk listing drifting
// from what Playwright itself collects.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_WEIGHT_SECONDS,
  E2E_TEST_DIR,
  SAFE_SPEC_PATH,
  SHARD_WEIGHTS_FILE,
  fileFilter,
  listSpecFiles,
  parseShardArg,
  planShards,
  readShardWeights,
} from './e2e-shard-plan.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const REAL_FILES = listSpecFiles(join(REPO_ROOT, E2E_TEST_DIR));
const REAL_WEIGHTS = readShardWeights(join(REPO_ROOT, SHARD_WEIGHTS_FILE));

/** The shard count the lane runs; the workflow suite pins ci.yml to it. */
const LANE_SHARDS = 4;

const union = (shards: { files: string[] }[]): string[] =>
  shards.flatMap((shard) => shard.files).sort();

test('every file lands in exactly one shard', () => {
  const files = [
    'a.spec.ts',
    'b.spec.ts',
    'c.spec.ts',
    'd.spec.ts',
    'e.spec.ts',
  ];
  const shards = planShards(files, { 'a.spec.ts': 30, 'b.spec.ts': 5 }, 3);
  assert.deepEqual(union(shards), files);
});

test('a file the weights file does not list is still assigned, at the default weight', () => {
  const shards = planShards(
    ['known.spec.ts', 'new.spec.ts'],
    { 'known.spec.ts': 50 },
    2,
  );
  assert.deepEqual(shards, [
    { files: ['known.spec.ts'], seconds: 50 },
    { files: ['new.spec.ts'], seconds: DEFAULT_WEIGHT_SECONDS },
  ]);
});

test('a weight for a file that no longer exists plans nothing', () => {
  const shards = planShards(
    ['a.spec.ts'],
    { 'a.spec.ts': 3, 'gone.spec.ts': 99 },
    2,
  );
  assert.deepEqual(union(shards), ['a.spec.ts']);
});

test('the plan does not depend on the order files were listed in', () => {
  const files = ['x.spec.ts', 'y.spec.ts', 'z.spec.ts', 'w.spec.ts'];
  const weights = {
    'x.spec.ts': 4,
    'y.spec.ts': 4,
    'z.spec.ts': 9,
    'w.spec.ts': 1,
  };
  assert.deepEqual(
    planShards(files, weights, 2),
    planShards([...files].reverse(), weights, 2),
  );
});

test('the heaviest files are spread before the light ones fill in', () => {
  const weights = {
    'big1.spec.ts': 40,
    'big2.spec.ts': 40,
    's1.spec.ts': 10,
    's2.spec.ts': 10,
  };
  const shards = planShards(Object.keys(weights), weights, 2);
  assert.deepEqual(
    shards.map((shard) => shard.seconds),
    [50, 50],
  );
});

test('a shard is a positive whole number, k/n with k within n', () => {
  assert.deepEqual(parseShardArg('2/4'), { current: 2, total: 4 });
  for (const bad of ['0/4', '5/4', '4', 'a/b', '1/0']) {
    assert.throws(() => parseShardArg(bad), /k\/n/, bad);
  }
  assert.throws(
    () => planShards(['a.spec.ts'], {}, 0),
    /positive whole number/,
  );
});

test('a file filter selects that file and not one whose name ends the same', () => {
  const filter = new RegExp(fileFilter('vault.spec.ts'), 'gi');
  const matches = (path: string): boolean => {
    filter.lastIndex = 0;
    return filter.test(path);
  };
  assert.ok(matches('/repo/apps/web-e2e/src/e2e/vault.spec.ts'));
  assert.ok(!matches('/repo/apps/web-e2e/src/e2e/multi-user-vault.spec.ts'));
  assert.ok(!matches('/repo/apps/web-e2e/src/e2e/vault.spec.ts.snap'));
  assert.ok(new RegExp(fileFilter('a.b.spec.ts')).test('/x/a.b.spec.ts'));
  assert.ok(!new RegExp(fileFilter('a.b.spec.ts')).test('/x/aXb.spec.ts'));
});

test('a spec path with a character the shell expands inside double quotes is refused', () => {
  for (const unsafe of [
    'a$b.spec.ts',
    'a`b`.spec.ts',
    'a"b.spec.ts',
    'a\\b.spec.ts',
    'a b.spec.ts',
    'a(b).spec.ts',
    'a[b].spec.ts',
  ]) {
    assert.throws(
      () => fileFilter(unsafe),
      /outside \[A-Za-z0-9._\/-\]/,
      unsafe,
    );
  }
});

test('every real spec path is safe to forward through the shell nx composes', () => {
  const unsafe = REAL_FILES.filter((file) => !SAFE_SPEC_PATH.test(file));
  assert.deepEqual(unsafe, []);
  for (const file of REAL_FILES) {
    const filter = fileFilter(file);
    // Inside double quotes these are the only characters the shell treats
    // specially; a filter may carry `\` only before `.` and `$` only last.
    assert.doesNotMatch(filter, /[`"]/, file);
    assert.doesNotMatch(filter.replace(/\\\./g, ''), /\\/, file);
    assert.equal(filter.indexOf('$'), filter.length - 1, file);
  }
});

test('the spec listing walks helper directories and skips non-spec files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-shard-plan-'));
  mkdirSync(join(dir, 'nested'));
  writeFileSync(join(dir, 'top.spec.ts'), '');
  writeFileSync(join(dir, 'nested', 'deep.test.tsx'), '');
  writeFileSync(join(dir, 'nested', 'helper.ts'), '');
  assert.deepEqual(listSpecFiles(dir), ['nested/deep.test.tsx', 'top.spec.ts']);
});

test('the weights file rejects a weight that is not a non-negative number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-shard-weights-'));
  const path = join(dir, 'weights.json');
  writeFileSync(path, JSON.stringify({ files: { 'a.spec.ts': -1 } }));
  assert.throws(() => readShardWeights(path), /non-negative/);
  writeFileSync(path, JSON.stringify({ weights: {} }));
  assert.throws(() => readShardWeights(path), /"files" map/);
});

test('the real plan runs every spec file on disk exactly once, with no empty shard', () => {
  const shards = planShards(REAL_FILES, REAL_WEIGHTS, LANE_SHARDS);
  assert.deepEqual(union(shards), REAL_FILES);
  for (const [index, shard] of shards.entries()) {
    assert.ok(shard.files.length > 0, `shard ${index + 1} is empty`);
  }
});

test('the real plan keeps the shards within 15% of each other', () => {
  const seconds = planShards(REAL_FILES, REAL_WEIGHTS, LANE_SHARDS).map(
    (shard) => shard.seconds,
  );
  const spread =
    (Math.max(...seconds) - Math.min(...seconds)) / Math.max(...seconds);
  assert.ok(
    spread <= 0.15,
    `shard seconds ${seconds.join(', ')} spread ${spread}`,
  );
});

test('the disk listing is exactly the set of files playwright test --list collects', () => {
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const out = execFileSync(
    process.execPath,
    [
      cli,
      'test',
      '-c',
      'apps/web-e2e/playwright.config.ts',
      '--project=chromium',
      '--list',
      '--reporter=json',
    ],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, NX_DAEMON: 'false' },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const report = JSON.parse(out) as {
    config: { rootDir: string };
    suites: { file: string }[];
  };
  assert.equal(
    resolve(report.config.rootDir),
    join(REPO_ROOT, E2E_TEST_DIR),
    'the plan lists specs under the directory Playwright collects from',
  );
  const listed = [...new Set(report.suites.map((suite) => suite.file))].sort();
  assert.deepEqual(REAL_FILES, listed);
});
