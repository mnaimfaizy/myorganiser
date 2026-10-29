// Contract Suite for the wiring between tools/config/gate-triggers.json and
// .github/workflows/ci.yml (ADR 0140). The defect worth catching is a heavy
// suite that the config names but the workflow does not gate correctly: a
// suite whose step is missing or renamed, whose `if:` drops the run-all
// fallback or its own flag, a flag the setup job never exposes, a resolver that
// diffs the wrong range on a pull request, or a Java 21 setup that runs for a
// suite that does not need a JDK. The checks are driven from the config, so
// adding a suite there without wiring it fails here.
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

import {
  RUN_ALL_FLAG,
  flagName,
  readGateTriggers,
  type GateTriggerSuite,
} from '../lib/gate-triggers.ts';
// The job/step slicing shape had seven hand-written copies, and the
// `stepNamed` ones had already drifted into matching a step name by prefix.
// One home: tools/scripts/lib/workflow-yaml.ts.
import { escapeRegExp, jobBlock, stepNamed } from '../lib/workflow-yaml.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const CI = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
const config = readGateTriggers({ cwd: REPO_ROOT });

const ifOf = (step: string): string | undefined =>
  step.match(/^ {8}if: (.+)$/m)?.[1];

/**
 * The OR-terms of a step's `if:`, normalised so a harmless reformat passes:
 * whitespace collapsed, a `${{ }}` wrapper and parentheses removed, terms
 * sorted. An `&&` stays inside a term, so it fails the comparison.
 */
const orTerms = (condition: string | undefined): string[] => {
  assert.ok(condition, 'step has no if:');
  const unwrapped = condition
    .trim()
    .replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, '$1');
  return unwrapped
    .replace(/[()]/g, ' ')
    .split('||')
    .map((term) => term.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .sort();
};

/** The `gate_*` output a suite's flag is exposed as; `run_all` is `gate_run_all`. */
const gateOutputOf = (flag: string): string =>
  flag === RUN_ALL_FLAG ? 'gate_run_all' : flag.replace(/^run_/, 'gate_');

/** The two terms a suite's step must OR: the run-all fallback and its own flag. */
const expectedTerms = (suite: GateTriggerSuite): string[] =>
  [
    "needs.setup.outputs.gate_run_all == 'true'",
    `needs.setup.outputs.${gateOutputOf(flagName(suite.id))} == 'true'`,
  ].sort();

const SETUP = jobBlock(CI, 'setup');
const TEST = jobBlock(CI, 'test');

/**
 * The `run:` script of a step, dedented. A block scalar runs until the first
 * non-blank line indented less than its ten-space body.
 */
function runScriptOf(step: string): string {
  const header = step.search(/^ {8}run: \|\s*$/m);
  assert.notEqual(header, -1, 'step has no run: | block');
  const lines: string[] = [];
  for (const line of step.slice(step.indexOf('\n', header) + 1).split('\n')) {
    if (line.trim() !== '' && !line.startsWith(' '.repeat(10))) break;
    lines.push(line.slice(10));
  }
  return lines.join('\n');
}

/**
 * Runs the gate-trigger step's own script under bash, with `resolverBody` as
 * the `node` on PATH, so the resolver call is the stub and nothing else
 * changes. `eventName` is the GitHub event the step sees; a pull request is
 * the default. Returns what the step wrote to $GITHUB_OUTPUT.
 */
function runGateTriggerStep(
  t: TestContext,
  resolverBody: string,
  eventName = 'pull_request',
): string {
  const dir = mkdtempSync(join(tmpdir(), 'gate-trigger-step-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  const stub = join(bin, 'node');
  const script = join(dir, 'step.sh');
  const output = join(dir, 'github-output');
  const summary = join(dir, 'github-step-summary');
  mkdirSync(bin);
  writeFileSync(stub, `#!/bin/sh\n${resolverBody}\n`);
  chmodSync(stub, 0o755);
  writeFileSync(
    script,
    runScriptOf(stepNamed(SETUP, 'Resolve heavy gate triggers')),
  );
  writeFileSync(output, '');
  writeFileSync(summary, '');

  const result = spawnSync('bash', [script], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      EVENT_NAME: eventName,
      BASE_SHA: 'base',
      HEAD_SHA: 'head',
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return readFileSync(output, 'utf8');
}

test('the setup job resolves gate triggers with the resolver and falls back to run_all', () => {
  const step = stepNamed(SETUP, 'Resolve heavy gate triggers');

  assert.match(step, /id: gate-triggers/);
  assert.match(
    step,
    /node tools\/scripts\/ci\/resolve-gate-triggers\.ts "\$@"/,
  );
  assert.match(
    step,
    /BASE_SHA: \$\{\{ steps\.affected\.outputs\.nx_base \}\}/,
    'the resolver must diff from the affected-context base',
  );
  assert.match(
    step,
    /HEAD_SHA: \$\{\{ steps\.affected\.outputs\.nx_head \}\}/,
    'the resolver must diff to the affected-context head',
  );
  assert.match(
    step,
    /if \[ "\$EVENT_NAME" = 'pull_request' \]; then\n\s*set -- "\$BASE_SHA" "\$HEAD_SHA"\n\s*else/,
    'a pull request must resolve its own range, or every PR runs every suite',
  );
  assert.match(
    step,
    /else\n\s*set -- --all/,
    'a non-pull_request event must resolve with --all, so main keeps its whole-tree run',
  );
  assert.match(
    step,
    /flags="\$\(node tools\/scripts\/ci\/resolve-gate-triggers\.ts "\$@"\)" \|\| flags=''/,
    'a resolver that exits non-zero must not be read as a resolution: its output is discarded',
  );
});

// The fallback is run, not pattern-matched: a `run_all=true` echo moved below
// the closing `fi` would pass every regex above while every PR ran everything.
test('the gate-trigger step writes run_all=true when the resolver exits 2 with no output', (t) => {
  assert.equal(runGateTriggerStep(t, 'exit 2'), 'run_all=true\n');
});

test('the gate-trigger step writes run_all=true when the resolver prints no run_all line', (t) => {
  assert.equal(
    runGateTriggerStep(t, "echo 'garbage'\nexit 0"),
    'run_all=true\n',
  );
});

// A push to main must resolve with --all, not the SHA range: the `else` branch
// is the only thing giving main its whole-tree run. A regex over the YAML would
// still pass if the `set -- --all` line sat outside the branch, so the stub
// echoes the arguments the step actually passed to the resolver.
test('the gate-trigger step resolves a push with --all and not the SHA range', (t) => {
  assert.equal(
    runGateTriggerStep(
      t,
      'shift\nprintf \'run_all=false\\nargs=%s\\n\' "$*"',
      'push',
    ),
    'run_all=false\nargs=--all\n',
  );
});

test('the gate-trigger step resolves a pull request with its base and head SHAs', (t) => {
  assert.equal(
    runGateTriggerStep(
      t,
      'shift\nprintf \'run_all=false\\nargs=%s\\n\' "$*"',
      'pull_request',
    ),
    'run_all=false\nargs=base head\n',
  );
});

test('the gate-trigger step writes the resolver flags and no run_all fallback when they carry one', (t) => {
  assert.equal(
    runGateTriggerStep(t, "printf 'run_all=false\\nrun_tools_test=true\\n'"),
    'run_all=false\nrun_tools_test=true\n',
  );
});

test('the setup job exposes run_all and every suite flag as gate_* outputs', () => {
  const flags = [
    RUN_ALL_FLAG,
    ...config.suites.map((suite) => flagName(suite.id)),
  ];

  for (const flag of flags) {
    const output = gateOutputOf(flag);
    assert.match(
      SETUP,
      new RegExp(
        `^ {6}${escapeRegExp(output)}: \\$\\{\\{ steps\\.gate-triggers\\.outputs\\.${escapeRegExp(flag)} \\}\\}$`,
        'm',
      ),
      `setup job must expose ${output} from steps.gate-triggers.outputs.${flag}`,
    );
  }
});

test('the test job depends on setup, so the gate outputs it reads exist', () => {
  assert.match(TEST, /^ {4}needs: setup$/m);
});

for (const suite of config.suites) {
  test(`${suite.id} runs under the run-all fallback or its own flag via "${suite.ciStep}"`, () => {
    const step = stepNamed(TEST, suite.ciStep);

    assert.deepEqual(
      orTerms(ifOf(step)),
      expectedTerms(suite),
      `the step for ${suite.id} must OR gate_run_all with its own gate output`,
    );
  });
}

test('Setup Java 21 is gated on the openapi:check suite and no other', () => {
  const openapi = config.suites.find((suite) => suite.id === 'openapi:check');
  assert.ok(openapi, 'openapi:check must be a path-gated suite in the config');

  const java = stepNamed(TEST, 'Setup Java 21');

  assert.deepEqual(
    orTerms(ifOf(java)),
    expectedTerms(openapi),
    'a JDK is needed only where openapi-generator-cli runs (ADR 0140)',
  );
  const setupJavaUses = CI.match(/^ {8}uses: actions\/setup-java@/gm) ?? [];
  assert.equal(
    setupJavaUses.length,
    1,
    'actions/setup-java must appear exactly once, in the step gated on openapi:check',
  );
});

test('tools:test is still spelled verbatim in the test job for the Meta-Gate', () => {
  assert.match(TEST, /^ {8}run: corepack yarn tools:test$/m);
});
