// Contract Suite for the blocking E2E lane's jobs in .github/workflows/ci.yml
// (ADR 0050, issue #1381). The defects worth catching are the shard count in
// the matrix drifting from the `/N` the plan and the job name use, so a shard's
// files never run or run twice; the shard step going back to Playwright's
// count-based `--shard`; `--with-deps` returning to an install the author
// waits on; the required `E2E Report` growing back into a merge job, or
// passing when a shard failed; and the HTML report becoming a job every
// pull request waits on, or a required check.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { jobBlock, stepNamed } from '../lib/workflow-yaml.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const CI = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
const REVIEW_PAGES = readFileSync(
  join(REPO_ROOT, 'tools/scripts/check-review-pages.ts'),
  'utf8',
);

const E2E = jobBlock(CI, 'e2e');
const LIVE = jobBlock(CI, 'e2e-live-logout');
const REPORT = jobBlock(CI, 'e2e-report');
const HTML = jobBlock(CI, 'e2e-html-report');

/** A job's own `if:`; a job's `if:` sits at four spaces. */
const jobIf = (job: string): string | undefined =>
  job.match(/^ {4}if: (.+)$/m)?.[1]?.trim();

/** The matrix's shard list, e.g. `[1, 2, 3, 4]`. */
const matrixShards = (): number[] => {
  const list = E2E.match(/^ {8}shard: \[([\d,\s]+)\]$/m)?.[1];
  assert.ok(list, 'the e2e job must carry a `shard: [..]` matrix');
  return list.split(',').map((entry) => Number(entry.trim()));
};

/** The contexts `check-review-pages.ts` states the ruleset requires. */
const requiredChecks = (): string[] => {
  const body = REVIEW_PAGES.match(
    /export const REQUIRED_CHECK_CONTEXTS = \[([\s\S]*?)\];/,
  )?.[1];
  assert.ok(body, 'REQUIRED_CHECK_CONTEXTS must be a literal array');
  return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1]);
};

test('the matrix runs shards 1..N and every `/N` in the job agrees with it', () => {
  const shards = matrixShards();
  const total = shards.length;
  assert.deepEqual(
    shards,
    Array.from({ length: total }, (_, index) => index + 1),
  );
  assert.match(
    E2E,
    new RegExp(
      `^ {4}name: E2E Chromium \\(shard \\$\\{\\{ matrix\\.shard \\}\\}/${total}\\)$`,
      'm',
    ),
  );
  const run = stepNamed(E2E, 'Run E2E shard');
  assert.match(
    run,
    new RegExp(`SHARD: \\$\\{\\{ matrix\\.shard \\}\\}/${total}$`, 'm'),
  );
});

test("each shard runs the planned spec files, not Playwright's count-based --shard", () => {
  const run = stepNamed(E2E, 'Run E2E shard');
  assert.match(
    run,
    /node tools\/scripts\/ci\/e2e-shard-plan\.ts --shard "\$SHARD"/,
  );
  assert.match(
    run,
    /corepack yarn nx run web-e2e:e2e --reporter=blob "\$\{files\[@\]\}"/,
  );
  assert.match(run, /set -euo pipefail/);
  assert.doesNotMatch(run, /--shard=/);
});

test('no Chromium install the author waits on pulls apt packages', () => {
  for (const [name, job] of [
    ['e2e', E2E],
    ['e2e-live-logout', LIVE],
  ] as const) {
    const step = stepNamed(job, 'Install Playwright Chromium');
    assert.match(
      step,
      /run: corepack yarn playwright install chromium$/m,
      name,
    );
    assert.doesNotMatch(step, /--with-deps/, name);
  }
});

test("E2E Report is a thin gate over the shards' result", () => {
  assert.match(REPORT, /^ {4}name: E2E Report$/m);
  assert.match(REPORT, /^ {4}needs:\n {6}- e2e$/m);
  assert.equal(
    jobIf(REPORT),
    "${{ !cancelled() && needs.e2e.result != 'skipped' }}",
  );
  assert.doesNotMatch(
    REPORT,
    /uses:/,
    'the gate checks out and installs nothing',
  );
  const step = stepNamed(REPORT, 'Require every E2E shard to pass');
  assert.match(step, /SHARDS_RESULT: \$\{\{ needs\.e2e\.result \}\}/);
  assert.match(step, /if \[ "\$SHARDS_RESULT" != 'success' \]; then/);
  assert.match(step, /exit 1/);
});

test('the HTML report runs only when a shard failed, and is not a required check', () => {
  assert.match(HTML, /^ {4}name: E2E HTML Report$/m);
  assert.match(HTML, /^ {4}needs:\n {6}- e2e$/m);
  assert.equal(
    jobIf(HTML),
    "${{ !cancelled() && needs.e2e.result == 'failure' }}",
  );
  stepNamed(HTML, 'Merge into a single HTML report');
  const required = requiredChecks();
  assert.ok(required.includes('E2E Report'));
  assert.ok(!required.includes('E2E HTML Report'));
});
