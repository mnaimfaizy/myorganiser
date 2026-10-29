// Contract Suite for the wiring between tools/config/gate-triggers.json and
// .github/workflows/ci.yml (ADR 0140). The defect worth catching is a heavy
// suite that the config names but the workflow does not gate correctly: a
// suite whose step is missing or renamed, whose `if:` drops the run-all
// fallback or its own flag, a flag the setup job never exposes, a resolver that
// diffs the wrong range on a pull request, or a Java 21 setup that runs for a
// suite that does not need a JDK. The checks are driven from the config, so
// adding a suite there without wiring it fails here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  RUN_ALL_FLAG,
  flagName,
  readGateTriggers,
  type GateTriggerSuite,
} from '../lib/gate-triggers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const CI = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
const config = readGateTriggers({ cwd: REPO_ROOT });

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const jobBlock = (source: string, jobId: string): string => {
  const jobsAt = source.search(/^jobs:\s*$/m);
  if (jobsAt === -1) throw new Error('workflow has no jobs:');
  const body = source.slice(jobsAt);
  const start = body.search(new RegExp(`^ {2}${jobId}:\\s*$`, 'm'));
  if (start === -1) throw new Error(`no job named ${jobId}`);
  const rest = body.slice(start + 1);
  const next = rest.search(/^ {2}[a-z0-9][a-z0-9-]*:\s*$/m);
  return next === -1 ? rest : rest.slice(0, next);
};

/** A step is matched on its exact name, so a rename cannot hide behind a prefix. */
const stepNamed = (job: string, name: string): string => {
  const header = new RegExp(`^ {6}- name: ${escapeRegExp(name)}\\s*$`, 'm');
  const match = header.exec(job);
  if (!match) throw new Error(`no step named exactly "${name}"`);
  const rest = job.slice(match.index);
  const next = rest.slice(1).search(/\n {6}- name: /);
  return next === -1 ? rest : rest.slice(0, next + 1);
};

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
    /if ! flags="\$\(node tools\/scripts\/ci\/resolve-gate-triggers\.ts[\s\S]*?echo 'run_all=true' >> "\$GITHUB_OUTPUT"/,
    'a resolver that exits non-zero must write run_all=true, never skip',
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
