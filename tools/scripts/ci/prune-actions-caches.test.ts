// Contract Suite for the cache cleanup CLI (tools/scripts/ci/prune-actions-caches.ts,
// slice #1391). The defect worth catching is a run that deletes more, or
// reports more, than its plan: a listing that stops short and plans from a
// partial view, a dry run that deletes, a read-only token that is retried once
// per entry instead of stopping, a permission refusal that fails a run it should
// warn about, or a non-permission failure that is swallowed. Every `gh` call is
// an injected stub; nothing here spawns `gh` or reads the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CachePlanError,
  MAX_PAGES,
  PAGE_SIZE,
  applyCleanupPlan,
  isPermissionDenied,
  listCaches,
  parseArgs,
  planFromRepository,
  pruneActionsCaches,
} from './prune-actions-caches.ts';

const REPO = 'mnaimfaizy/myorganiser';

type JsonStub = (args: readonly string[]) => unknown;

const listingOf = (entries: readonly unknown[]): unknown => ({
  total_count: entries.length,
  actions_caches: entries,
});

const mainEntry = (id: number): Record<string, unknown> => ({
  id,
  key: `Linux-nx-22-test-${id.toString(16).padStart(40, '0')}`,
  ref: 'refs/heads/main',
  created_at: '2026-10-01T12:00:00Z',
  size_in_bytes: 1000,
});

const prEntry = (id: number): Record<string, unknown> => ({
  ...mainEntry(id),
  ref: 'refs/pull/7/merge',
});

/** A listing stub that answers page N with `pages[N - 1]`, recording each path. */
const pagedStub = (pages: readonly (readonly unknown[])[]) => {
  const paths: string[] = [];
  const ghJsonCall: JsonStub = (args) => {
    const path = args.at(-1) ?? '';
    paths.push(path);
    const page = Number(/page=(\d+)$/.exec(path)?.[1]);
    return listingOf(pages[page - 1] ?? []);
  };
  return { paths, ghJsonCall };
};

test('listCaches reads full pages until a short one and returns every entry', () => {
  const full = Array.from({ length: PAGE_SIZE }, (_, i) => mainEntry(i + 1));
  const short = [mainEntry(101), mainEntry(102), mainEntry(103)];
  const { paths, ghJsonCall } = pagedStub([full, short]);

  const caches = listCaches(REPO, ghJsonCall);

  assert.equal(caches.length, PAGE_SIZE + 3);
  assert.equal(paths.length, 2);
  assert.ok(paths[0].endsWith('per_page=100&page=1'), paths[0]);
  assert.ok(paths[1].endsWith('per_page=100&page=2'), paths[1]);
});

test('listCaches stops at the first page when it is short', () => {
  const { paths, ghJsonCall } = pagedStub([[mainEntry(1), mainEntry(2)]]);
  assert.equal(listCaches(REPO, ghJsonCall).length, 2);
  assert.equal(paths.length, 1);
});

test('listCaches returns an empty list for an empty actions_caches array', () => {
  const { paths, ghJsonCall } = pagedStub([[]]);
  assert.deepEqual(listCaches(REPO, ghJsonCall), []);
  assert.equal(paths.length, 1);
});

test('listCaches keeps one entry for an id that appears on two pages', () => {
  const full = Array.from({ length: PAGE_SIZE }, (_, i) => mainEntry(i + 1));
  const overlap = [mainEntry(PAGE_SIZE), mainEntry(PAGE_SIZE + 1)];
  const { ghJsonCall } = pagedStub([full, overlap]);
  const ids = listCaches(REPO, ghJsonCall).map((c) => c.id);
  assert.equal(ids.length, PAGE_SIZE + 1);
  assert.equal(new Set(ids).size, ids.length);
});

test('listCaches throws when the payload has no actions_caches array', () => {
  assert.throws(
    () => listCaches(REPO, () => ({ total_count: 0 })),
    /page 1 of the cache listing has no actions_caches/,
  );
});

test('listCaches throws, naming the page and index, when an entry lacks a required field', () => {
  for (const field of ['id', 'key', 'ref', 'created_at']) {
    const broken: Record<string, unknown> = { ...mainEntry(2) };
    delete broken[field];
    assert.throws(
      () => listCaches(REPO, () => listingOf([mainEntry(1), broken])),
      /page 1 entry 1 is not a cache entry/,
      `missing ${field}`,
    );
  }
});

test('listCaches reads a non-numeric size_in_bytes as undefined rather than throwing', () => {
  const caches = listCaches(REPO, () =>
    listingOf([{ ...mainEntry(1), size_in_bytes: 'big' }]),
  );
  assert.equal(caches[0].size_in_bytes, undefined);
});

test('pruneActionsCaches deletes each planned entry once, in plan order', () => {
  const calls: string[][] = [];
  const result = pruneActionsCaches({
    repository: REPO,
    closedPullRequest: 7,
    ghJsonCall: () => listingOf([prEntry(11), prEntry(12)]),
    ghCall: (args) => {
      calls.push([...args]);
      return '';
    },
    log: () => undefined,
  });

  const planned = result.plan.deletions.map((d) => d.cache.id);
  assert.deepEqual(
    planned.slice().sort((a, b) => a - b),
    [11, 12],
  );
  assert.equal(calls.length, planned.length);
  assert.deepEqual(
    calls.map((args) => args.at(-1)),
    planned.map((id) => `repos/${REPO}/actions/caches/${id}`),
  );
  for (const args of calls) {
    assert.deepEqual(args.slice(1, 3), ['--method', 'DELETE']);
  }
  assert.equal(result.deleted, planned.length);
  assert.equal(result.permissionDenied, false);
});

test('pruneActionsCaches with dryRun deletes nothing and says it would', () => {
  let deletes = 0;
  const logs: string[] = [];
  const result = pruneActionsCaches({
    repository: REPO,
    closedPullRequest: 7,
    dryRun: true,
    ghJsonCall: () => listingOf([prEntry(11), prEntry(12)]),
    ghCall: () => {
      deletes += 1;
      return '';
    },
    log: (message) => logs.push(message),
  });

  assert.equal(deletes, 0);
  assert.equal(result.deleted, 0);
  assert.ok(logs.length > 0);
  assert.ok(
    logs.every((line) => line.startsWith('would delete ')),
    logs.join('\n'),
  );
  assert.match(result.summary, /Would delete/);
});

test('pruneActionsCaches stops after the first 403 and does not attempt the rest', () => {
  const calls: string[][] = [];
  const result = pruneActionsCaches({
    repository: REPO,
    closedPullRequest: 7,
    ghJsonCall: () => listingOf([prEntry(11), prEntry(12), prEntry(13)]),
    ghCall: (args) => {
      calls.push([...args]);
      throw new Error('gh: Resource not accessible by integration (HTTP 403)');
    },
    log: () => undefined,
  });

  assert.equal(result.permissionDenied, true);
  assert.equal(result.deleted, 0);
  assert.equal(calls.length, 1);
});

// The state the summary's voice has to survive: the token deleted one entry
// and was then refused. Reporting the whole plan as deleted names an entry
// that is still there; reporting none hides the one that is gone.
test('pruneActionsCaches reports a refusal that arrives after a successful delete as a partial run', () => {
  const caches = [
    { ...mainEntry(1), created_at: '2026-10-01T12:00:00Z' },
    {
      ...mainEntry(2),
      key: `Linux-node-22-deps-${'a'.repeat(64)}`,
      created_at: '2026-10-01T12:00:00Z',
    },
    {
      ...mainEntry(3),
      created_at: '2026-10-05T12:00:00Z',
    },
    {
      ...mainEntry(4),
      key: `Linux-node-22-deps-${'b'.repeat(64)}`,
      created_at: '2026-10-05T12:00:00Z',
    },
  ];
  let attempts = 0;
  const result = pruneActionsCaches({
    repository: REPO,
    pruneRef: 'refs/heads/main',
    ghJsonCall: pagedStub([caches]).ghJsonCall,
    ghCall: () => {
      attempts += 1;
      if (attempts === 1) return '';
      throw new Error('gh: Resource not accessible by integration (HTTP 403)');
    },
    log: () => undefined,
  });

  assert.equal(result.plan.deletions.length, 2);
  assert.equal(result.deleted, 1);
  assert.equal(result.permissionDenied, true);
  assert.match(result.summary, /Deleted 1 of 2 planned cache entries/);
  assert.doesNotMatch(result.summary, /Would delete/);
});

test('pruneActionsCaches propagates a delete failure that is not a permission problem', () => {
  assert.throws(
    () =>
      pruneActionsCaches({
        repository: REPO,
        closedPullRequest: 7,
        ghJsonCall: () => listingOf([prEntry(11)]),
        ghCall: () => {
          throw new Error('gh: Server Error (HTTP 500)');
        },
        log: () => undefined,
      }),
    /HTTP 500/,
  );
});

test('isPermissionDenied is true for an Error whose message holds HTTP 403', () => {
  assert.equal(isPermissionDenied(new Error('gh: Forbidden (HTTP 403)')), true);
});

test('isPermissionDenied is true for an error whose stderr says the integration is not accessible', () => {
  const error = Object.assign(new Error('gh failed'), {
    stderr: 'Resource not accessible by integration',
  });
  assert.equal(isPermissionDenied(error), true);
});

test('isPermissionDenied is false for an unrelated Error and for a non-Error value', () => {
  assert.equal(
    isPermissionDenied(new Error('gh: Not Found (HTTP 404)')),
    false,
  );
  assert.equal(isPermissionDenied(42), false);
  assert.equal(isPermissionDenied(null), false);
});

test('parseArgs reads --closed-pull-request as a number', () => {
  assert.equal(
    parseArgs(['--closed-pull-request', '12']).closedPullRequest,
    12,
  );
});

test('parseArgs accumulates a repeated --keep-key and defaults to none', () => {
  assert.deepEqual(parseArgs([]).keepKeys, []);
  assert.deepEqual(
    parseArgs([
      '--prune-ref',
      'refs/heads/main',
      '--keep-key',
      'key-a',
      '--keep-key',
      'key-b',
    ]).keepKeys,
    ['key-a', 'key-b'],
  );
});

test('parseArgs treats --dry-run as a bare switch that consumes no value', () => {
  assert.equal(parseArgs(['--dry-run']).dryRun, true);
  assert.equal(parseArgs([]).dryRun, false);
  assert.equal(parseArgs(['--dry-run', '--repository', REPO]).repository, REPO);
});

test('parseArgs reads --repository and --prune-ref', () => {
  const parsed = parseArgs([
    '--repository',
    REPO,
    '--prune-ref',
    'refs/heads/main',
  ]);
  assert.equal(parsed.repository, REPO);
  assert.equal(parsed.pruneRef, 'refs/heads/main');
});

test('parseArgs throws for an unknown flag', () => {
  assert.throws(() => parseArgs(['--bogus']), /unknown argument --bogus/);
});

test('parseArgs throws when a flag has no value or its value is another flag', () => {
  assert.throws(
    () => parseArgs(['--repository']),
    /--repository needs a value/,
  );
  assert.throws(
    () => parseArgs(['--prune-ref', '--dry-run']),
    /--prune-ref needs a value/,
  );
});

test('parseArgs throws for a non-positive or non-numeric --closed-pull-request', () => {
  for (const bad of ['0', '-3', 'abc', '1.5']) {
    assert.throws(
      () => parseArgs(['--closed-pull-request', bad]),
      /--closed-pull-request needs a number/,
      bad,
    );
  }
});

test('listCaches throws, rather than returning a partial listing, when every page is full', () => {
  let calls = 0;
  const fullPage = Array.from({ length: PAGE_SIZE }, (_, i) =>
    mainEntry(i + 1),
  );
  const ghJsonCall: JsonStub = () => {
    calls += 1;
    return listingOf(fullPage);
  };
  assert.throws(
    () => listCaches(REPO, ghJsonCall),
    (error: unknown) =>
      error instanceof Error &&
      /still full at page 100/.test(error.message) &&
      /refusing to prune/.test(error.message),
  );
  assert.equal(calls, MAX_PAGES);
});

test('pruneActionsCaches propagates a full-listing refusal and deletes nothing', () => {
  const fullPage = Array.from({ length: PAGE_SIZE }, (_, i) =>
    mainEntry(i + 1),
  );
  let deletes = 0;
  assert.throws(
    () =>
      pruneActionsCaches({
        repository: REPO,
        closedPullRequest: 7,
        ghJsonCall: () => listingOf(fullPage),
        ghCall: () => {
          deletes += 1;
          return '';
        },
        log: () => undefined,
      }),
    /refusing to prune/,
  );
  assert.equal(deletes, 0);
});

// The reverted-lockfile case: `--keep-key` must survive both the plan and the
// DELETE calls, or the cleanup deletes the entry the next `main` run restores.
test('pruneActionsCaches keeps a keepKeys key out of both the plan and the DELETE calls', () => {
  const OLD = `Linux-node-22-deps-${'1'.repeat(64)}`;
  const NEW = `Linux-node-22-deps-${'2'.repeat(64)}`;
  const listing = [
    {
      id: 1,
      key: OLD,
      ref: 'refs/heads/main',
      created_at: '2026-10-01T12:00:00Z',
      size_in_bytes: 10,
    },
    {
      id: 2,
      key: NEW,
      ref: 'refs/heads/main',
      created_at: '2026-10-02T12:00:00Z',
      size_in_bytes: 10,
    },
  ];
  const run = (keepKeys?: readonly string[]) => {
    const argv: string[][] = [];
    const result = pruneActionsCaches({
      repository: REPO,
      pruneRef: 'refs/heads/main',
      keepKeys,
      ghJsonCall: () => listingOf(listing),
      ghCall: (args) => {
        argv.push([...args]);
        return '';
      },
      log: () => undefined,
    });
    return {
      planned: result.plan.deletions.map((d) => d.cache.id),
      paths: argv.map((args) => args.at(-1)),
    };
  };

  // Control: without the keep-key the older copy is pruned.
  const control = run([]);
  assert.deepEqual(control.planned, [1]);
  assert.deepEqual(control.paths, [`repos/${REPO}/actions/caches/1`]);

  const kept = run([OLD]);
  assert.deepEqual(kept.planned, []);
  assert.deepEqual(kept.paths, []);
});

// Spawns the real CLI. A stub `gh` first on PATH answers the listing with the
// given JSON, and runs `onDelete` (shell) for a DELETE, so the exit codes and
// stderr annotations are observed end to end.
const CLI = fileURLToPath(
  new URL('./prune-actions-caches.ts', import.meta.url),
);
const SHA_OLD = '1'.repeat(40);
const SHA_NEW = '2'.repeat(40);
const SUPERSEDED_LISTING = {
  total_count: 2,
  actions_caches: [
    {
      id: 1,
      key: `Linux-nx-22-lint-${SHA_OLD}`,
      ref: 'refs/heads/main',
      created_at: '2026-10-01T12:00:00Z',
      size_in_bytes: 10,
    },
    {
      id: 2,
      key: `Linux-nx-22-lint-${SHA_NEW}`,
      ref: 'refs/heads/main',
      created_at: '2026-10-02T12:00:00Z',
      size_in_bytes: 10,
    },
  ],
};

function runCli(
  t: TestContext,
  {
    listing,
    onDelete,
    args,
  }: { listing: unknown; onDelete: string; args: string[] },
): {
  status: number | null;
  stdout: string;
  stderr: string;
  deletes: string[];
  stepSummary: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'prune-caches-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const listingFile = join(dir, 'listing.json');
  const callsFile = join(dir, 'calls.log');
  const summaryFile = join(dir, 'step-summary.md');
  writeFileSync(summaryFile, '');
  writeFileSync(listingFile, JSON.stringify(listing));
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/sh
echo "$*" >> '${callsFile}'
case "$*" in
  *DELETE*) ${onDelete} ;;
  *) cat '${listingFile}' ;;
esac
`,
  );
  chmodSync(join(bin, 'gh'), 0o755);
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_STEP_SUMMARY: summaryFile,
    },
  });
  const calls = existsSync(callsFile) ? readFileSync(callsFile, 'utf8') : '';
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    deletes: calls.split('\n').filter((line) => line.includes('DELETE')),
    stepSummary: readFileSync(summaryFile, 'utf8'),
  };
}

test('the CLI exits 2 and attempts no DELETE when the listing has no actions_caches', (t) => {
  const run = runCli(t, {
    listing: { total_count: 0 },
    onDelete: 'exit 0',
    args: ['--prune-ref', 'refs/heads/main'],
  });
  assert.equal(run.status, 2);
  assert.equal(run.deletes.length, 0);
  assert.match(run.stderr, /has no actions_caches/);
});

test('the CLI exits 1 and reports a partial plan when a DELETE fails with HTTP 500', (t) => {
  const run = runCli(t, {
    listing: SUPERSEDED_LISTING,
    onDelete: "echo 'gh: Server Error (HTTP 500)' >&2; exit 1",
    args: ['--prune-ref', 'refs/heads/main'],
  });
  assert.equal(run.status, 1);
  assert.equal(run.deletes.length, 1);
  assert.match(run.stderr, /applied only in part/);
});

test('the CLI exits 0 with the cache-skipped annotation when a DELETE is refused with HTTP 403', (t) => {
  const run = runCli(t, {
    listing: SUPERSEDED_LISTING,
    onDelete:
      "echo 'gh: Resource not accessible by integration (HTTP 403)' >&2; exit 1",
    args: ['--prune-ref', 'refs/heads/main'],
  });
  assert.equal(run.status, 0);
  assert.equal(run.deletes.length, 1);
  assert.match(run.stderr, /::warning title=Cache cleanup skipped/);
});

test('the CLI exits 2 when neither --closed-pull-request nor --prune-ref is given', (t) => {
  const run = runCli(t, {
    listing: SUPERSEDED_LISTING,
    onDelete: 'exit 0',
    args: [],
  });
  assert.equal(run.status, 2);
  assert.equal(run.deletes.length, 0);
  assert.match(run.stderr, /nothing to clean up/);
});

// Two copies of one dependency-cache family on `main`, the older of which is
// the key a `--keep-key` run protects.
const DEPS_OLD = `Linux-node-22-deps-${'a'.repeat(64)}`;
const DEPS_NEW = `Linux-node-22-deps-${'b'.repeat(64)}`;
const DEPS_LISTING = {
  total_count: 2,
  actions_caches: [
    {
      id: 1,
      key: DEPS_OLD,
      ref: 'refs/heads/main',
      created_at: '2026-10-01T12:00:00Z',
      size_in_bytes: 10,
    },
    {
      id: 2,
      key: DEPS_NEW,
      ref: 'refs/heads/main',
      created_at: '2026-10-02T12:00:00Z',
      size_in_bytes: 10,
    },
  ],
};

// The one assertion that pins `--keep-key` on the path the workflow actually
// takes. Dropping `keepKeys` from the CLI's own call site leaves every
// stub-driven test green, because they call the function directly; only a
// spawned run fails, and the entry it would delete is the one the next push
// on `main` needs after a lockfile revert.
test('the CLI protects a --keep-key entry that is otherwise superseded, and prunes it without the flag', (t) => {
  const control = runCli(t, {
    listing: DEPS_LISTING,
    onDelete: 'exit 0',
    args: ['--prune-ref', 'refs/heads/main'],
  });
  assert.equal(control.status, 0);
  assert.deepEqual(
    control.deletes.map((line) => line.trim().split(/\s+/).at(-1)),
    ['repos/o/r/actions/caches/1'],
  );

  const kept = runCli(t, {
    listing: DEPS_LISTING,
    onDelete: 'exit 0',
    args: ['--prune-ref', 'refs/heads/main', '--keep-key', DEPS_OLD],
  });
  assert.equal(kept.status, 0);
  assert.deepEqual(kept.deletes, []);
  assert.match(kept.stdout, /Nothing to delete\./);
});

test("the CLI deletes a closed pull request's entries and exits 0", (t) => {
  const run = runCli(t, {
    listing: listingOf([prEntry(5), prEntry(6), mainEntry(7)]),
    onDelete: 'exit 0',
    args: ['--closed-pull-request', '7'],
  });
  assert.equal(run.status, 0);
  assert.deepEqual(
    run.deletes.map((line) => line.trim().split(/\s+/).at(-1)),
    ['repos/o/r/actions/caches/5', 'repos/o/r/actions/caches/6'],
  );
  assert.match(run.stdout, /pull request #7 is closed/);
});

test('the CLI with --dry-run deletes nothing and says it would', (t) => {
  const run = runCli(t, {
    listing: SUPERSEDED_LISTING,
    onDelete: 'exit 1',
    args: ['--prune-ref', 'refs/heads/main', '--dry-run'],
  });
  assert.equal(run.status, 0);
  assert.deepEqual(run.deletes, []);
  assert.match(run.stdout, /Would delete 1 cache entry/);
});

// A read-only token deleted nothing, so the summary must not claim it did —
// and must not call it a dry run either, which is a different thing an
// operator may have asked for.
test('the CLI reports a refused run as having deleted none of its plan', (t) => {
  const run = runCli(t, {
    listing: SUPERSEDED_LISTING,
    onDelete:
      "echo 'gh: Resource not accessible by integration (HTTP 403)' >&2; exit 1",
    args: ['--prune-ref', 'refs/heads/main'],
  });
  assert.match(run.stdout, /Deleted none of the 1 cache entry planned/);
  assert.doesNotMatch(run.stdout, /Would delete/);
});

// The summary reaches the job through the script, not through a `tee`
// pipeline: a pipeline would put these exit codes behind `pipefail`.
test('the CLI appends its summary to GITHUB_STEP_SUMMARY as well as stdout', (t) => {
  const run = runCli(t, {
    listing: SUPERSEDED_LISTING,
    onDelete: 'exit 0',
    args: ['--prune-ref', 'refs/heads/main'],
  });
  assert.equal(run.status, 0);
  assert.match(run.stepSummary, /## Actions cache cleanup/);
  assert.equal(run.stepSummary, run.stdout);
});

test('planFromRepository forwards the scope and keepKeys to the selection', () => {
  const { ghJsonCall } = pagedStub([DEPS_LISTING.actions_caches]);
  assert.deepEqual(
    planFromRepository(
      { repository: REPO, pruneRef: 'refs/heads/main' },
      ghJsonCall,
    ).deletions.map(({ cache }) => cache.id),
    [1],
  );
  assert.deepEqual(
    planFromRepository(
      {
        repository: REPO,
        pruneRef: 'refs/heads/main',
        keepKeys: [DEPS_OLD],
      },
      pagedStub([DEPS_LISTING.actions_caches]).ghJsonCall,
    ).deletions,
    [],
  );
  assert.deepEqual(
    planFromRepository(
      { repository: REPO, closedPullRequest: 7 },
      pagedStub([[prEntry(5), mainEntry(6)]]).ghJsonCall,
    ).deletions.map(({ cache }) => cache.id),
    [5],
  );
});

test('applyCleanupPlan deletes nothing on a dry run and stops at a refusal', () => {
  const plan = planFromRepository(
    { repository: REPO, pruneRef: 'refs/heads/main' },
    pagedStub([
      [mainEntry(1), { ...mainEntry(2), created_at: '2026-10-02T12:00:00Z' }],
    ]).ghJsonCall,
  );

  const dryCalls: string[] = [];
  const logged: string[] = [];
  const dry = applyCleanupPlan(REPO, plan, {
    dryRun: true,
    ghCall: (args) => {
      dryCalls.push(args.join(' '));
      return '';
    },
    log: (message) => logged.push(message),
  });
  assert.deepEqual(dryCalls, []);
  assert.equal(dry.deleted, 0);
  assert.equal(dry.permissionDenied, false);
  assert.ok(logged.some((line) => line.startsWith('would delete ')));

  let attempts = 0;
  const refused = applyCleanupPlan(REPO, plan, {
    ghCall: () => {
      attempts += 1;
      throw new Error('gh: Resource not accessible by integration (HTTP 403)');
    },
    log: () => undefined,
  });
  assert.equal(attempts, 1);
  assert.equal(refused.deleted, 0);
  assert.equal(refused.permissionDenied, true);
});

test('pruneActionsCaches wraps a planning failure as a CachePlanError', () => {
  assert.throws(
    () =>
      pruneActionsCaches({
        repository: REPO,
        pruneRef: 'refs/heads/main',
        ghJsonCall: () => ({ total_count: 0 }),
        ghCall: () => '',
        log: () => undefined,
      }),
    (error: unknown) =>
      error instanceof CachePlanError &&
      /has no actions_caches/.test((error as Error).message),
  );
});
