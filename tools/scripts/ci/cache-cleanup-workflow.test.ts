// Contract Suite for the Actions cache cleanup wiring (slice #1391): the
// cache-cleanup.yml workflow, the cancel-in-progress and affected/whole-tree
// split in ci.yml, and every workflow's cache steps. The defect worth catching
// is a cache the cleanup cannot prune, or a cleanup that can delete what CI is
// about to restore: a cache key cacheFamily does not recognise, a keep-key that
// drifts from ci.yml's dependency key, a `main` run that cancels itself and
// leaves the baseline stale, a push trigger racing the post-step save, or a
// cleanup job that can write to the cache without the scope it needs. The
// workflows are sliced as text, the same way the other workflow Contract
// Suites slice them, so these assertions are about the file as written.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { cacheFamily } from '../lib/actions-cache-cleanup.ts';
import {
  escapeRegExp,
  ifOf,
  jobBlock,
  runOf,
  stepNamed,
} from '../lib/workflow-yaml.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const WORKFLOWS = join(REPO_ROOT, '.github/workflows');
const CI = readFileSync(join(WORKFLOWS, 'ci.yml'), 'utf8');
const CLEANUP = readFileSync(join(WORKFLOWS, 'cache-cleanup.yml'), 'utf8');
const WORKFLOW_FILES = readdirSync(WORKFLOWS)
  .filter((file) => /\.ya?ml$/.test(file))
  .sort();

const indentOf = (line: string): number =>
  line.length - line.trimStart().length;

/** The lines of a top-level block, from its `key:` line to the next column-0 key. */
function topLevel(text: string, key: string): string {
  const lines = text.split('\n');
  const at = lines.findIndex((line) =>
    new RegExp(`^${escapeRegExp(key)}:`).test(line),
  );
  if (at === -1) throw new Error(`no top-level ${key}: block`);
  const body = [lines[at]];
  for (const line of lines.slice(at + 1)) {
    if (line !== '' && !/^\s/.test(line)) break;
    body.push(line);
  }
  return body.join('\n');
}

/** The lines nested under the first `key:` in `block`, deeper than that key. */
function children(block: string, key: string): string {
  const lines = block.split('\n');
  const at = lines.findIndex((line) =>
    new RegExp(`^\\s*${escapeRegExp(key)}:`).test(line),
  );
  if (at === -1) throw new Error(`no ${key}: under the block`);
  const body: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== '' && indentOf(line) <= indentOf(lines[at])) break;
    body.push(line);
  }
  return body.join('\n');
}

/** The value of a `key: value` line in `block`, first match. */
function scalarOf(block: string, key: string): string {
  const value = new RegExp(`^\\s*${escapeRegExp(key)}: (.+)$`, 'm').exec(block);
  if (!value) throw new Error(`no ${key}: value in the block`);
  return value[1].trim();
}

/** The `- item` values listed in `block`. */
const itemsOf = (block: string): string[] =>
  block
    .split('\n')
    .map((line) => /^\s*- (.+)$/.exec(line)?.[1]?.trim())
    .filter((item): item is string => item !== undefined);

/** The `key: value` pairs of a permissions block, as `key: value` strings. */
const permissionsOf = (block: string): string[] =>
  block
    .split('\n')
    .map((line) => /^\s+([a-z-]+: [a-z]+)$/.exec(line)?.[1])
    .filter((pair): pair is string => pair !== undefined)
    .sort();

/** Lines that are not YAML comments, so a comment cannot satisfy or trip an assertion. */
const uncommented = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

const onBlockOf = (text: string): string => uncommented(topLevel(text, 'on'));

const CI_NAME = /^name: (.+)$/m.exec(CI)?.[1]?.trim() ?? '';

const CI_JOB_IDS = [
  ...CI.slice(CI.search(/^jobs:\s*$/m)).matchAll(
    /^ {2}([a-z0-9][a-z0-9-]*):\s*$/gm,
  ),
].map((match) => match[1]);

/** The `key:` value of every `actions/cache` step in one workflow file, joined across lines. */
function cacheKeysOf(text: string): string[] {
  const lines = text.split('\n');
  const keys: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*uses:\s*actions\/cache/.test(line)) return;
    for (let i = index + 1; i < lines.length; i += 1) {
      const current = lines[i];
      if (/^ {6}- /.test(current)) break;
      const key = /^(\s+)key:(.*)$/.exec(current);
      if (!key) continue;
      const parts = [key[2]];
      for (const next of lines.slice(i + 1)) {
        if (next.trim() === '') continue;
        if (indentOf(next) <= key[1].length) break;
        parts.push(next);
      }
      keys.push(parts.join(' ').replace(/\s+/g, ' ').trim());
      break;
    }
  });
  return keys;
}

const SHA40 = '0123456789abcdef0123456789abcdef01234567';
const SHA64 = `${SHA40}0123456789abcdef0123456789abcdef`;

/** A key with its `${{ }}` expressions replaced by the values a runner would produce. */
const normalise = (key: string): string =>
  key.replace(/\$\{\{[\s\S]*?\}\}/g, (expression) => {
    if (/hashFiles\(/.test(expression)) return SHA64;
    if (/github\.sha/.test(expression)) return SHA40;
    if (/runner\.os/.test(expression)) return 'Linux';
    return expression;
  });

test('ci.yml cancels in-progress runs on pull requests only, as an expression', () => {
  const cancel = scalarOf(topLevel(CI, 'concurrency'), 'cancel-in-progress');
  assert.equal(
    cancel,
    "${{ github.ref != 'refs/heads/main' }}",
    'cancel-in-progress must be false on main and true on a pull request',
  );
  assert.notEqual(cancel, 'true');
});

test('ci.yml lint job runs affected projects on a pull request and the whole tree otherwise', () => {
  const job = jobBlock(CI, 'lint');
  const affected = stepNamed(job, 'Lint affected projects');
  assert.equal(ifOf(affected), "github.event_name == 'pull_request'");
  assert.match(runOf(affected), /nx affected -t lint/);

  const every = stepNamed(job, 'Lint every project');
  assert.equal(ifOf(every), "github.event_name != 'pull_request'");
  assert.match(runOf(every), /nx run-many -t lint/);
  assert.doesNotMatch(runOf(every), /affected|--base/);
});

test('ci.yml test job runs affected projects on a pull request and the whole tree otherwise', () => {
  const job = jobBlock(CI, 'test');
  const affected = stepNamed(job, 'Test affected projects');
  assert.equal(ifOf(affected), "github.event_name == 'pull_request'");
  assert.match(runOf(affected), /nx affected -t test/);

  const every = stepNamed(job, 'Test every project');
  assert.equal(ifOf(every), "github.event_name != 'pull_request'");
  assert.match(runOf(every), /nx run-many -t test/);
  assert.doesNotMatch(runOf(every), /affected|--base/);
});

test('no workflow file declares a pull_request_target trigger', () => {
  for (const file of WORKFLOW_FILES) {
    const on = onBlockOf(readFileSync(join(WORKFLOWS, file), 'utf8'));
    assert.doesNotMatch(
      on,
      /pull_request_target/,
      `${file} declares pull_request_target`,
    );
  }
});

test('no workflow file uses a cache write mode, a save or restore action, or a third-party cache action', () => {
  for (const file of WORKFLOW_FILES) {
    const text = uncommented(readFileSync(join(WORKFLOWS, file), 'utf8'));
    assert.doesNotMatch(
      text,
      /^\s*(lookup-only|save-always|cache-mode):/m,
      `${file} sets a cache write mode`,
    );
    assert.doesNotMatch(
      text,
      /uses:\s*actions\/cache\/(save|restore)/,
      `${file} uses a save or restore cache action`,
    );
    for (const line of text.split('\n')) {
      const uses = /^\s*uses:\s*(\S*cache\S*)/i.exec(line)?.[1];
      if (uses === undefined) continue;
      assert.match(
        uses,
        /^actions\/cache@[0-9a-f]{40}$/,
        `${file} uses ${uses}, not actions/cache pinned to a sha`,
      );
    }
  }
});

test('every actions/cache key in every workflow is a family cacheFamily recognises', () => {
  let found = 0;
  for (const file of WORKFLOW_FILES) {
    for (const key of cacheKeysOf(
      readFileSync(join(WORKFLOWS, file), 'utf8'),
    )) {
      found += 1;
      const normalised = normalise(key);
      assert.notEqual(
        cacheFamily(normalised),
        undefined,
        `${file}: cache key "${key}" (normalised "${normalised}") is not recognised by cacheFamily, so the cleanup cannot prune it`,
      );
    }
  }
  assert.ok(found > 0, 'the drift guard found no actions/cache keys to check');
});

test('cache-cleanup.yml triggers only on a closed pull request, a completed CI run on main, and a manual dispatch', () => {
  const on = onBlockOf(CLEANUP);
  const triggers = [...on.matchAll(/^ {2}([a-z_]+):\s*$/gm)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(triggers, [
    'pull_request',
    'workflow_dispatch',
    'workflow_run',
  ]);
  assert.doesNotMatch(
    on,
    /^ {2}push:/m,
    'a push trigger would race the post-step save',
  );
});

test('cache-cleanup.yml pull_request trigger is limited to closed', () => {
  const pullRequest = children(onBlockOf(CLEANUP), 'pull_request');
  assert.deepEqual(itemsOf(children(pullRequest, 'types')), ['closed']);
});

test("cache-cleanup.yml workflow_run trigger names ci.yml's own workflow name, completed, on main only", () => {
  assert.notEqual(CI_NAME, '', 'ci.yml has a top-level name');
  const workflowRun = children(onBlockOf(CLEANUP), 'workflow_run');
  assert.deepEqual(itemsOf(children(workflowRun, 'workflows')), [CI_NAME]);
  assert.deepEqual(itemsOf(children(workflowRun, 'types')), ['completed']);
  assert.deepEqual(itemsOf(children(workflowRun, 'branches')), ['main']);
});

test('cache-cleanup.yml never cancels a cleanup in progress', () => {
  assert.equal(
    scalarOf(topLevel(CLEANUP, 'concurrency'), 'cancel-in-progress'),
    'false',
  );
});

test('cache-cleanup.yml grants the workflow contents: read only', () => {
  const block = topLevel(CLEANUP, 'permissions');
  assert.deepEqual(permissionsOf(block), ['contents: read']);
});

test('cache-cleanup.yml gives each job contents: read and actions: write, and nothing more', () => {
  for (const jobId of ['prune-closed-pull-request', 'prune-main-baselines']) {
    const match = /^ {4}permissions:\s*\n((?: {6}\S.*\n?)+)/m.exec(
      jobBlock(CLEANUP, jobId),
    );
    assert.ok(match, `${jobId} declares no job-level permissions`);
    assert.deepEqual(
      permissionsOf(match[1]),
      ['actions: write', 'contents: read'],
      `${jobId} permissions`,
    );
  }
});

test('the closed-pull-request job runs only on pull_request and passes the closed pull request number', () => {
  const job = jobBlock(CLEANUP, 'prune-closed-pull-request');
  assert.match(job, /^ {4}if: github\.event_name == 'pull_request'\s*$/m);
  const pruning = stepNamed(job, "Delete this pull request's cache entries");
  assert.match(
    pruning,
    /--closed-pull-request '\$\{\{ github\.event\.pull_request\.number \}\}'/,
  );
});

test('the main-baselines job runs only off pull_request and prunes refs/heads/main', () => {
  const job = jobBlock(CLEANUP, 'prune-main-baselines');
  assert.match(job, /^ {4}if: github\.event_name != 'pull_request'\s*$/m);
  assert.match(job, /--prune-ref refs\/heads\/main/);
});

// The CLI's exit codes are the job's result, so nothing may stand between
// them: `set -euo pipefail` because a bare `run:` block ignores a failing
// command that is not the last, and no pipe into `tee` because the script
// appends to `$GITHUB_STEP_SUMMARY` itself — a pipeline would put exit 1 and
// exit 2 behind `pipefail` for no gain.
test('each cleanup step sets -euo pipefail and does not pipe the CLI anywhere', () => {
  const steps = [
    stepNamed(
      jobBlock(CLEANUP, 'prune-closed-pull-request'),
      "Delete this pull request's cache entries",
    ),
    stepNamed(
      jobBlock(CLEANUP, 'prune-main-baselines'),
      'Delete superseded cache entries on main',
    ),
  ];
  for (const step of steps) {
    assert.match(step, /^ {10}set -euo pipefail$/m);
    assert.doesNotMatch(step, /\|\s*tee/);
    assert.doesNotMatch(step, /GITHUB_STEP_SUMMARY/);
  }
});

test('the --keep-key in prune-main-baselines is character-for-character the key of every ci.yml dependency restore step', () => {
  const job = jobBlock(CLEANUP, 'prune-main-baselines');
  const keepKey = /--keep-key '(.+?)' *\\ *$/m.exec(job)?.[1];
  assert.ok(keepKey, 'prune-main-baselines passes a --keep-key');

  const restoreKeys: string[] = [];
  for (const jobId of CI_JOB_IDS) {
    const block = jobBlock(CI, jobId);
    if (!block.includes('- name: Restore dependency cache')) continue;
    const step = stepNamed(block, 'Restore dependency cache');
    const key = /^ {10}key: (.+)$/m.exec(step)?.[1];
    assert.ok(key, `${jobId}: Restore dependency cache has no single-line key`);
    restoreKeys.push(key);
  }

  assert.ok(
    restoreKeys.length > 0,
    'ci.yml has Restore dependency cache steps',
  );
  for (const key of restoreKeys) {
    assert.equal(
      keepKey,
      key,
      'the cleanup keep-key drifted from ci.yml; the cleanup would delete the entry CI restores',
    );
  }
});

test('both cleanup jobs call prune-actions-caches.ts, and that file exists on disk', () => {
  for (const jobId of ['prune-closed-pull-request', 'prune-main-baselines']) {
    assert.match(
      jobBlock(CLEANUP, jobId),
      /node tools\/scripts\/ci\/prune-actions-caches\.ts/,
      `${jobId} does not call the cleanup script`,
    );
  }
  assert.ok(
    existsSync(join(REPO_ROOT, 'tools/scripts/ci/prune-actions-caches.ts')),
    'tools/scripts/ci/prune-actions-caches.ts is missing',
  );
});
