import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  OPT_OUT_SCHEMA_VERSION,
  assertGateCoverage,
  gatherFromDisk,
  listCheckers,
  listSuites,
  nodeRuns,
  pipelineInvocations,
  stripComments,
} from './gate-coverage.ts';
import type { GateManifestEntry } from './gate-manifest.ts';

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

const AGGREGATE = 'tools/scripts/run-assertion-gates.ts';

/**
 * An opt-out entry as a fixture writes it: `reason` is optional here on
 * purpose, because several cases below assert that a reasonless entry is
 * rejected rather than honoured.
 */
interface OptOutFixture {
  check: string;
  reason?: string;
}

/** A wired aggregate: the hook invokes `gates:run`, which runs the runner. */
const aggregateOf = (manifest: GateManifestEntry[]) => ({
  script: AGGREGATE,
  manifest,
});

const hook = (text: string) => [{ path: '.husky/pre-commit', text }];

const optOutList = (entries: OptOutFixture[]) =>
  JSON.stringify({ schemaVersion: OPT_OUT_SCHEMA_VERSION, optOut: entries });

test('pipelineInvocations matches a script name exactly, never as a substring', () => {
  const { names } = pipelineInvocations(
    'corepack yarn openapi:artifacts:test\n',
  );

  assert.ok(names.has('openapi:artifacts:test'));
  assert.ok(!names.has('openapi:artifacts'));
});

test('stripComments drops a gate command that only appears in prose', () => {
  const stripped = stripComments(
    '# These also run through `corepack yarn gates:run` in the hook\ncorepack yarn readme:check\n',
  );

  assert.ok(!stripped.includes('gates:run'));
  assert.ok(stripped.includes('readme:check'));
});

test('nodeRuns marks a --test invocation as a test runner, not a checker run', () => {
  assert.deepEqual(nodeRuns('node --test tools/scripts/check-a.test.ts'), [
    { script: 'tools/scripts/check-a.test.ts', isTestRunner: true },
  ]);
  assert.deepEqual(nodeRuns('node tools/scripts/check-a.ts --staged'), [
    { script: 'tools/scripts/check-a.ts', isTestRunner: false },
  ]);
});

test('nodeRuns reports every file a --test invocation runs, not just the first', () => {
  assert.deepEqual(
    nodeRuns(
      'node --test tools/scripts/lib/a.test.ts tools/scripts/lib/b.test.ts',
    ),
    [
      { script: 'tools/scripts/lib/a.test.ts', isTestRunner: true },
      { script: 'tools/scripts/lib/b.test.ts', isTestRunner: true },
    ],
  );
});

test('nodeRuns strips wrapping quotes from a glob token, so the pattern matches real paths', () => {
  assert.deepEqual(
    nodeRuns(
      'node --test \'tools/scripts/*.test.ts\' "tools/scripts/**/*.test.ts"',
    ),
    [
      { script: 'tools/scripts/*.test.ts', isTestRunner: true },
      { script: 'tools/scripts/**/*.test.ts', isTestRunner: true },
    ],
  );
});

test('nodeRuns does not let a --test invocation swallow a later, unrelated node call on the next line', () => {
  const pipeline =
    '      - name: Step A\n' +
    '        run: node --test tools/scripts/a.test.ts\n' +
    '      - name: Step B\n' +
    '        run: node tools/scripts/check-b.ts\n';

  assert.deepEqual(nodeRuns(pipeline), [
    { script: 'tools/scripts/a.test.ts', isTestRunner: true },
    { script: 'tools/scripts/check-b.ts', isTestRunner: false },
  ]);
});

test('listSuites finds *.test.ts anywhere under the scripts directory', (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'gate-coverage-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(join(workspace, 'tools/scripts/lib'), { recursive: true });
  writeFileSync(join(workspace, 'tools/scripts/check-a.ts'), '');
  writeFileSync(join(workspace, 'tools/scripts/check-a.test.ts'), '');
  writeFileSync(join(workspace, 'tools/scripts/lib/helper.test.ts'), '');

  assert.deepEqual(listSuites({ cwd: workspace }), [
    'tools/scripts/check-a.test.ts',
    'tools/scripts/lib/helper.test.ts',
  ]);
});

test('listCheckers finds check-*.ts by filename and excludes contract suites', (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'gate-coverage-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(join(workspace, 'tools/scripts'), { recursive: true });
  for (const name of [
    'check-a.ts',
    'check-a.test.ts',
    'sync-b.ts',
    'run-assertion-gates.ts',
  ]) {
    writeFileSync(join(workspace, 'tools/scripts', name), '');
  }

  assert.deepEqual(listCheckers({ cwd: workspace }), [
    'tools/scripts/check-a.ts',
  ]);
});

// ADR 0135's contract step: a retired `.mjs` checker or suite is still
// listed, so the decision can name it rather than the scan passing over it.
test('listCheckers and listSuites still list a retired .mjs file so it can be named', (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'gate-coverage-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(join(workspace, 'tools/scripts/lib'), { recursive: true });
  for (const name of ['check-a.ts', 'check-b.mjs', 'lib/c.test.mjs']) {
    writeFileSync(join(workspace, 'tools/scripts', name), '');
  }

  assert.deepEqual(listCheckers({ cwd: workspace }), [
    'tools/scripts/check-a.ts',
    'tools/scripts/check-b.mjs',
  ]);
  assert.deepEqual(listSuites({ cwd: workspace }), [
    'tools/scripts/lib/c.test.mjs',
  ]);
});

// Contract case 1 — the defect the gate exists for.
test('an unwired checker is caught and named', () => {
  const report = assertGateCoverage({
    checkers: ['tools/scripts/check-a.ts', 'tools/scripts/check-b.ts'],
    pkgScripts: {
      'a:check': 'node tools/scripts/check-a.ts',
      'b:check': 'node tools/scripts/check-b.ts',
    },
    pipelines: hook('corepack yarn a:check\n'),
    optOut: optOutList([]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 1);
  assert.deepEqual(
    report.unwired.map((entry) => entry.checker),
    ['tools/scripts/check-b.ts'],
  );
  assert.deepEqual(report.unwired[0].npmScripts, ['b:check']);
});

// Contract case 2 — the weak joint. Without this, wiring the aggregate would
// report every checker it runs as unwired, on the very change that wires them.
test('a checker reached only through the aggregate manifest counts as wired', () => {
  const report = assertGateCoverage({
    checkers: ['tools/scripts/check-a.ts'],
    pkgScripts: {
      'a:check': 'node tools/scripts/check-a.ts',
      'gates:run': `node ${AGGREGATE}`,
    },
    pipelines: hook('corepack yarn gates:run\n'),
    optOut: optOutList([]),
    aggregate: aggregateOf([
      {
        id: 'a:check',
        npmScript: 'a:check',
        script: 'tools/scripts/check-a.ts',
        args: [],
      },
    ]),
  });

  assert.equal(report.exitCode, 0);
  assert.deepEqual(
    report.wired.map((entry) => entry.via.map((via) => via.kind)),
    [['aggregate']],
  );
});

test('the aggregate cannot launder a checker while nothing invokes the aggregate', () => {
  const report = assertGateCoverage({
    checkers: ['tools/scripts/check-a.ts'],
    pkgScripts: {
      'a:check': 'node tools/scripts/check-a.ts',
      'gates:run': `node ${AGGREGATE}`,
    },
    pipelines: hook('corepack yarn lint\n'),
    optOut: optOutList([]),
    aggregate: aggregateOf([
      {
        id: 'a:check',
        npmScript: 'a:check',
        script: 'tools/scripts/check-a.ts',
        args: [],
      },
    ]),
  });

  assert.equal(report.exitCode, 1);
  assert.equal(report.aggregate.wired, false);
  assert.deepEqual(
    report.unwired.map((entry) => entry.checker),
    ['tools/scripts/check-a.ts'],
  );
});

// ADR 0135's contract step: the Meta-Gate rejects a `check-*.mjs` by name.
// Wired is not enough — accepting it would let the retired form back in.
test('a check-*.mjs checker is rejected even when it is wired', () => {
  const report = assertGateCoverage({
    checkers: ['tools/scripts/check-a.ts', 'tools/scripts/check-b.mjs'],
    pkgScripts: {
      'a:check': 'node tools/scripts/check-a.ts',
      'b:check': 'node tools/scripts/check-b.mjs',
    },
    pipelines: hook('corepack yarn a:check\ncorepack yarn b:check\n'),
    optOut: optOutList([]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 1);
  assert.deepEqual(report.rejected, ['tools/scripts/check-b.mjs']);
  assert.deepEqual(
    report.wired.map((entry) => entry.checker),
    ['tools/scripts/check-a.ts'],
  );
  assert.deepEqual(report.unwired, []);
});

test('a tree of check-*.ts checkers has nothing rejected', () => {
  const report = assertGateCoverage({
    checkers: ['tools/scripts/check-a.ts'],
    pkgScripts: { 'a:check': 'node tools/scripts/check-a.ts' },
    pipelines: hook('corepack yarn a:check\n'),
    optOut: optOutList([]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 0);
  assert.deepEqual(report.rejected, []);
});

// Contract case 3 — the false pass reproduced while writing the rule.
test('a contract-test script does not satisfy its sibling checker wiring', () => {
  const report = assertGateCoverage({
    checkers: ['tools/scripts/check-openapi-artifacts.ts'],
    pkgScripts: {
      'openapi:artifacts': 'node tools/scripts/check-openapi-artifacts.ts',
      'openapi:artifacts:test':
        'node --test tools/scripts/check-openapi-artifacts.test.ts',
    },
    pipelines: [
      {
        path: '.github/workflows/ci.yml',
        text: '      - name: OpenAPI artifact checker contracts\n        run: corepack yarn openapi:artifacts:test\n',
      },
    ],
    optOut: optOutList([]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 1);
  assert.deepEqual(
    report.unwired.map((entry) => entry.checker),
    ['tools/scripts/check-openapi-artifacts.ts'],
  );
});

// Contract case 4 — an exemption is a decision somebody made.
test('an opt-out with a written reason is honoured', () => {
  const report = assertGateCoverage({
    checkers: ['tools/scripts/check-a.ts'],
    pkgScripts: { 'a:check': 'node tools/scripts/check-a.ts' },
    pipelines: hook('corepack yarn lint\n'),
    optOut: optOutList([
      {
        check: 'check-a.ts',
        reason: 'Superseded by the formatting write step.',
      },
    ]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 0);
  assert.deepEqual(
    report.optedOut.map((entry) => entry.checker),
    ['tools/scripts/check-a.ts'],
  );
});

test('an opt-out without a reason is rejected, not silently honoured', () => {
  const report = assertGateCoverage({
    checkers: ['tools/scripts/check-a.ts'],
    pkgScripts: { 'a:check': 'node tools/scripts/check-a.ts' },
    pipelines: hook('corepack yarn lint\n'),
    optOut: optOutList([
      { check: 'check-a.ts' },
      { check: 'check-a.ts', reason: '   ' },
    ]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 2);
  assert.equal(report.errors.length, 2);
  assert.match(report.errors.join('\n'), /carries no written reason/);
  assert.equal(report.optedOut.length, 0);
});

test('an opt-out may name the npm script of a checker, or a non-gate script', () => {
  const report = assertGateCoverage({
    checkers: ['tools/scripts/check-a.ts'],
    pkgScripts: {
      'a:check': 'node tools/scripts/check-a.ts',
      'format:check': 'nx format:check',
    },
    pipelines: hook('corepack yarn lint\n'),
    optOut: optOutList([
      { check: 'a:check', reason: 'Runs on a monthly schedule instead.' },
      {
        check: 'format:check',
        reason: 'Superseded by the hook formatting write step.',
      },
    ]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 0);
  assert.deepEqual(
    report.optedOut.map((entry) => entry.checker),
    ['tools/scripts/check-a.ts'],
  );
  assert.deepEqual(
    report.declaredNonGates.map((entry) => entry.check),
    ['format:check'],
  );
});

test('an opt-out for a checker that is wired is rejected as a contradiction', () => {
  const report = assertGateCoverage({
    checkers: ['tools/scripts/check-a.ts'],
    pkgScripts: { 'a:check': 'node tools/scripts/check-a.ts' },
    pipelines: hook('corepack yarn a:check\n'),
    optOut: optOutList([
      { check: 'check-a.ts', reason: 'We decided it is not a gate.' },
    ]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 2);
  assert.match(
    report.errors.join('\n'),
    /must not disagree with the pipelines/,
  );
});

test('an opt-out list carrying an unknown schemaVersion is rejected', () => {
  const report = assertGateCoverage({
    checkers: [],
    pipelines: [],
    optOut: JSON.stringify({ schemaVersion: 99, optOut: [] }),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 2);
  assert.match(report.errors.join('\n'), /expected "schemaVersion": 1/);
});

test('an opt-out naming something that no longer exists is rejected', () => {
  const report = assertGateCoverage({
    checkers: ['tools/scripts/check-a.ts'],
    pkgScripts: { 'a:check': 'node tools/scripts/check-a.ts' },
    pipelines: hook('corepack yarn a:check\n'),
    optOut: optOutList([
      { check: 'check-deleted.ts', reason: 'It went away.' },
    ]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 2);
  assert.match(
    report.errors.join('\n'),
    /check-deleted\.ts` is neither a checker/,
  );
});

test('a missing opt-out list is an error, not an empty exemption set', () => {
  const report = assertGateCoverage({
    checkers: [],
    pipelines: [],
    optOut: null,
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 2);
  assert.match(report.errors.join('\n'), /not found/);
});

// Indirection resolves exactly one level.
test('a nested aggregate is an error, not a recursion', () => {
  const report = assertGateCoverage({
    checkers: ['tools/scripts/check-a.ts'],
    pkgScripts: {
      'gates:run': `node ${AGGREGATE}`,
      'inner:run': 'node tools/scripts/run-inner-gates.ts',
    },
    pipelines: hook('corepack yarn gates:run\n'),
    optOut: optOutList([]),
    aggregate: aggregateOf([
      {
        id: 'inner',
        npmScript: 'inner:run',
        script: 'tools/scripts/run-inner-gates.ts',
        args: [],
      },
    ]),
    readSource: (path) =>
      path === 'tools/scripts/run-inner-gates.ts'
        ? "import { runGateManifest } from './lib/gate-manifest.ts';\nrunGateManifest(INNER);\n"
        : null,
  });

  assert.equal(report.exitCode, 2);
  assert.match(
    report.errors.join('\n'),
    /nested aggregate is an error, not a recursion/,
  );
});

test('an aggregate listing itself is an error', () => {
  const report = assertGateCoverage({
    checkers: [],
    pkgScripts: { 'gates:run': `node ${AGGREGATE}` },
    pipelines: hook('corepack yarn gates:run\n'),
    optOut: optOutList([]),
    aggregate: aggregateOf([
      { id: 'self', npmScript: 'gates:run', script: AGGREGATE, args: [] },
    ]),
  });

  assert.equal(report.exitCode, 2);
  assert.match(report.errors.join('\n'), /lists itself in its own manifest/);
});

// `adr:numbering:check` is reached both ways: through the aggregate in the
// hook and as its own CI step. That must be one wired checker, not two
// findings that disagree.
test('a checker wired directly and through the aggregate counts once', () => {
  const report = assertGateCoverage({
    checkers: ['tools/scripts/check-adr-numbering.ts'],
    pkgScripts: {
      'adr:numbering:check': 'node tools/scripts/check-adr-numbering.ts',
      'gates:run': `node ${AGGREGATE}`,
    },
    pipelines: [
      { path: '.husky/pre-commit', text: 'corepack yarn gates:run\n' },
      {
        path: '.github/workflows/ci.yml',
        text: '        run: corepack yarn adr:numbering:check\n',
      },
    ],
    optOut: optOutList([]),
    aggregate: aggregateOf([
      {
        id: 'adr:numbering:check',
        npmScript: 'adr:numbering:check',
        script: 'tools/scripts/check-adr-numbering.ts',
        args: [],
      },
    ]),
  });

  assert.equal(report.exitCode, 0);
  assert.equal(report.wired.length, 1);
  assert.equal(report.unwired.length, 0);
  assert.deepEqual(
    report.wired[0].via.map((via) => via.kind),
    ['pipeline', 'aggregate'],
  );
});

test('a checker invoked directly by path in a workflow counts as wired', () => {
  const report = assertGateCoverage({
    checkers: ['tools/scripts/check-a.ts'],
    pkgScripts: {},
    pipelines: [
      {
        path: '.github/workflows/ci.yml',
        text: '        run: node tools/scripts/check-a.ts --report out.md\n',
      },
    ],
    optOut: optOutList([]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 0);
  assert.deepEqual(
    report.wired.map((entry) => entry.via[0].kind),
    ['direct'],
  );
});

// The suite rule (ADR 0135): `tools:test` is the one runner, so a Contract
// Suite is wired exactly when that script is invoked by a pipeline and its own
// glob reaches the suite. Nothing else counts.

const GLOB = "node --test 'tools/scripts/**/*.test.ts'";

// Suite case 1 — the per-suite scripts are retired, so one still lying around
// does not wire anything, even when a pipeline invokes it.
test('a suite run only by its own wired npm script is caught and named', () => {
  const report = assertGateCoverage({
    checkers: [],
    suites: ['tools/scripts/check-a.test.ts'],
    pkgScripts: { 'a:test': 'node --test tools/scripts/check-a.test.ts' },
    pipelines: hook('corepack yarn a:test\n'),
    optOut: optOutList([]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 1);
  assert.deepEqual(
    report.unwiredSuites.map((entry) => entry.suite),
    ['tools/scripts/check-a.test.ts'],
  );
});

// Suite case 2 — the aggregate manifest resolves checkers, never suites.
test('a suite named in the wired aggregate manifest is not wired by it', () => {
  const report = assertGateCoverage({
    checkers: [],
    suites: ['tools/scripts/check-a.test.ts'],
    pkgScripts: {
      'a:test': 'node --test tools/scripts/check-a.test.ts',
      'gates:run': `node ${AGGREGATE}`,
    },
    pipelines: hook('corepack yarn gates:run\n'),
    optOut: optOutList([]),
    aggregate: aggregateOf([
      {
        id: 'a:test',
        npmScript: 'a:test',
        script: 'tools/scripts/check-a.test.ts',
        args: [],
      },
    ]),
  });

  assert.equal(report.exitCode, 1);
  assert.deepEqual(
    report.unwiredSuites.map((entry) => entry.suite),
    ['tools/scripts/check-a.test.ts'],
  );
});

// Suite case 3 — a workflow step running one suite by path is not a runner
// the Meta-Gate counts; the glob is.
test('a suite run by path in a workflow is not wired by it', () => {
  const report = assertGateCoverage({
    checkers: [],
    suites: ['tools/scripts/copilot-hooks/a.test.ts'],
    pkgScripts: {},
    pipelines: [
      {
        path: '.github/workflows/ci.yml',
        text: '        run: node --test tools/scripts/copilot-hooks/a.test.ts\n',
      },
    ],
    optOut: optOutList([]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 1);
  assert.deepEqual(
    report.unwiredSuites.map((entry) => entry.suite),
    ['tools/scripts/copilot-hooks/a.test.ts'],
  );
});

// Suite case 4 — the one way a suite is wired.
test('a suite reached through the wired tools:test glob counts as wired', () => {
  const report = assertGateCoverage({
    checkers: [],
    suites: ['tools/scripts/lib/check-a.test.ts'],
    pkgScripts: { 'tools:test': GLOB },
    pipelines: hook('corepack yarn tools:test\n'),
    optOut: optOutList([]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 0);
  assert.deepEqual(
    report.wiredSuites.map((entry) => entry.via.map((via) => via.kind)),
    [['glob']],
  );
  assert.deepEqual(report.globTest, {
    script: 'tools:test',
    wired: true,
    reached: ['tools/scripts/lib/check-a.test.ts'],
  });
});

// The glob names `.test.ts` only, so a retired `.test.mjs` suite is reported
// by name instead of being run or silently skipped.
test('a .test.mjs suite is not reached by the tools:test glob', () => {
  const report = assertGateCoverage({
    checkers: [],
    suites: ['tools/scripts/lib/a.test.mjs', 'tools/scripts/lib/b.test.ts'],
    pkgScripts: { 'tools:test': GLOB },
    pipelines: hook('corepack yarn tools:test\n'),
    optOut: optOutList([]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 1);
  assert.deepEqual(
    report.unwiredSuites.map((entry) => entry.suite),
    ['tools/scripts/lib/a.test.mjs'],
  );
});

// The glob cannot launder a suite while nothing invokes `tools:test` itself —
// the same fail-safe shape as "the aggregate cannot launder a checker while
// nothing invokes the aggregate".
test('the glob cannot launder a suite while nothing invokes tools:test', () => {
  const report = assertGateCoverage({
    checkers: [],
    suites: ['tools/scripts/lib/check-a.test.ts'],
    pkgScripts: { 'tools:test': GLOB },
    pipelines: hook('corepack yarn lint\n'),
    optOut: optOutList([]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 1);
  assert.deepEqual(
    report.unwiredSuites.map((entry) => entry.suite),
    ['tools/scripts/lib/check-a.test.ts'],
  );
  assert.equal(report.globTest.wired, false);
});

test('every suite is unwired when package.json has no tools:test script', () => {
  const report = assertGateCoverage({
    checkers: [],
    suites: ['tools/scripts/check-a.test.ts'],
    pkgScripts: {},
    pipelines: hook('corepack yarn tools:test\n'),
    optOut: optOutList([]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 1);
  assert.deepEqual(
    report.unwiredSuites.map((entry) => entry.suite),
    ['tools/scripts/check-a.test.ts'],
  );
  assert.deepEqual(report.globTest.reached, []);
});

// A narrowed glob reaches fewer suites than the full set, and the ones it
// drops must fail rather than stay laundered as wired by assumption.
test('a glob pattern narrowed to one directory leaves a suite outside it unwired', () => {
  const report = assertGateCoverage({
    checkers: [],
    suites: [
      'tools/scripts/check-a.test.ts',
      'tools/scripts/lib/check-b.test.ts',
    ],
    pkgScripts: {
      'tools:test': "node --test 'tools/scripts/*.test.ts'",
    },
    pipelines: hook('corepack yarn tools:test\n'),
    optOut: optOutList([]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 1);
  assert.deepEqual(
    report.wiredSuites.map((entry) => entry.suite),
    ['tools/scripts/check-a.test.ts'],
  );
  assert.deepEqual(
    report.unwiredSuites.map((entry) => entry.suite),
    ['tools/scripts/lib/check-b.test.ts'],
  );
});

// Suite case 5 — an exemption is a decision somebody made, same as a checker.
test('a suite opt-out with a written reason is honoured', () => {
  const report = assertGateCoverage({
    checkers: [],
    suites: ['tools/scripts/check-a.test.ts'],
    pkgScripts: {},
    pipelines: hook('corepack yarn lint\n'),
    optOut: optOutList([
      {
        check: 'check-a.test.ts',
        reason: 'Benchmark contract run by hand only, never in a pipeline.',
      },
    ]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 0);
  assert.deepEqual(
    report.optedOutSuites.map((entry) => entry.suite),
    ['tools/scripts/check-a.test.ts'],
  );
});

// listSuites is recursive (lib/, review/, ai/, ci/, copilot-hooks/), unlike
// the flat listCheckers, so a bare filename for a nested suite must resolve
// by basename rather than the literal SCRIPTS_DIR/<name> path a checker uses.
test('a suite opt-out may name a nested suite by its bare filename', () => {
  const report = assertGateCoverage({
    checkers: [],
    suites: ['tools/scripts/lib/check-a.test.ts'],
    pkgScripts: {},
    pipelines: hook('corepack yarn lint\n'),
    optOut: optOutList([
      {
        check: 'check-a.test.ts',
        reason: 'Benchmark contract run by hand only, never in a pipeline.',
      },
    ]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 0);
  assert.deepEqual(
    report.optedOutSuites.map((entry) => entry.suite),
    ['tools/scripts/lib/check-a.test.ts'],
  );
});

// A bare filename shared by two nested suites has no single target to
// exempt, so it is rejected rather than guessing one.
test('a suite opt-out naming a bare filename shared by two nested suites is rejected as ambiguous', () => {
  const report = assertGateCoverage({
    checkers: [],
    suites: [
      'tools/scripts/lib/check-a.test.ts',
      'tools/scripts/review/check-a.test.ts',
    ],
    pkgScripts: {},
    pipelines: hook('corepack yarn lint\n'),
    optOut: optOutList([{ check: 'check-a.test.ts', reason: 'Not a gate.' }]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 2);
  assert.match(report.errors.join('\n'), /matches more than one suite/);
  assert.deepEqual(report.optedOutSuites, []);
  assert.deepEqual(report.unwiredSuites.map((entry) => entry.suite).sort(), [
    'tools/scripts/lib/check-a.test.ts',
    'tools/scripts/review/check-a.test.ts',
  ]);
});

// Suite case 6 — a reasonless opt-out is rejected, not silently honoured,
// same as a checker.
test('a suite opt-out without a reason is rejected, not silently honoured', () => {
  const report = assertGateCoverage({
    checkers: [],
    suites: ['tools/scripts/check-a.test.ts'],
    pkgScripts: {},
    pipelines: hook('corepack yarn lint\n'),
    optOut: optOutList([{ check: 'check-a.test.ts' }]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 2);
  assert.match(report.errors.join('\n'), /carries no written reason/);
  assert.deepEqual(report.optedOutSuites, []);
});

// A contract-test suite being opted out does not retroactively exempt its
// sibling checker, and vice versa — the two opt-out maps stay independent.
test('a checker opt-out does not exempt its sibling suite', () => {
  const report = assertGateCoverage({
    checkers: ['tools/scripts/check-a.ts'],
    suites: ['tools/scripts/check-a.test.ts'],
    pkgScripts: {},
    pipelines: hook('corepack yarn lint\n'),
    optOut: optOutList([{ check: 'check-a.ts', reason: 'Not a gate.' }]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 1);
  assert.deepEqual(
    report.optedOut.map((entry) => entry.checker),
    ['tools/scripts/check-a.ts'],
  );
  assert.deepEqual(
    report.unwiredSuites.map((entry) => entry.suite),
    ['tools/scripts/check-a.test.ts'],
  );
});

// The false pass the suite rule must not reproduce in the other direction:
// a checker being wired must not launder its own contract suite as wired.
test('a checker being wired does not satisfy its sibling suite wiring', () => {
  const report = assertGateCoverage({
    checkers: ['tools/scripts/check-a.ts'],
    suites: ['tools/scripts/check-a.test.ts'],
    pkgScripts: {
      'a:check': 'node tools/scripts/check-a.ts',
      'a:test': 'node --test tools/scripts/check-a.test.ts',
    },
    pipelines: hook('corepack yarn a:check\n'),
    optOut: optOutList([]),
    aggregate: aggregateOf([]),
  });

  assert.equal(report.exitCode, 1);
  assert.deepEqual(
    report.unwiredSuites.map((entry) => entry.suite),
    ['tools/scripts/check-a.test.ts'],
  );
});

test('every suite in this repository is wired or opted out with a reason', () => {
  const report = assertGateCoverage(gatherFromDisk({ cwd: REPO_ROOT }));

  assert.deepEqual(report.errors, []);
  assert.deepEqual(
    report.unwiredSuites.map((entry) => entry.suite),
    [],
  );
  // A floor, deliberately not an exact count — see the matching comment on
  // the checker-count assertion below.
  assert.ok(
    report.wiredSuites.length >= 50,
    `expected the repository to carry at least fifty suites, found ${report.wiredSuites.length}`,
  );
});

test('every checker in this repository is wired or opted out with a reason', () => {
  const report = assertGateCoverage(gatherFromDisk({ cwd: REPO_ROOT }));

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.rejected, []);
  assert.deepEqual(
    report.unwired.map((entry) => entry.checker),
    [],
  );
  // A floor, deliberately not an exact count: the issue forbids freezing an
  // inventory anywhere, and deleting a checker is not the defect this gate
  // exists to catch. What the floor guards is the enumeration itself — a path
  // bug that found nothing would otherwise pass as "no unwired checkers".
  assert.ok(
    report.wired.length >= 10,
    `expected the repository to carry at least ten checkers, found ${report.wired.length}`,
  );
});
