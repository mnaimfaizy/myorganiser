import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  HUMAN_OUTPUT,
  applyGithubOutputBackfill,
  backfillReviewTierOutput,
  exitStatusAfterBackfill,
  hasReviewTierLabel,
  runReviewTierCheck,
} from './run-review-tier-check.ts';

test('hasReviewTierLabel only matches a GITHUB_OUTPUT label=review: line', () => {
  assert.equal(hasReviewTierLabel(''), false);
  assert.equal(hasReviewTierLabel('tier=human\n'), false);
  assert.equal(hasReviewTierLabel('label=review:agent\n'), true);
  assert.equal(hasReviewTierLabel('tier=agent\nlabel=review:human\n'), true);
  assert.equal(hasReviewTierLabel('mylabel=review:nope\n'), false);
});

test('backfillReviewTierOutput is a no-op when a label is already present', () => {
  const existing = 'tier=agent\nlabel=review:agent\n';
  assert.deepEqual(backfillReviewTierOutput(existing), {
    text: existing,
    backfilled: false,
  });
});

test('backfillReviewTierOutput writes human when the classifier wrote nothing', () => {
  assert.deepEqual(backfillReviewTierOutput(''), {
    text: HUMAN_OUTPUT,
    backfilled: true,
  });
  assert.deepEqual(backfillReviewTierOutput('other=1'), {
    text: `other=1\n${HUMAN_OUTPUT}`,
    backfilled: true,
  });
});

test('applyGithubOutputBackfill appends and does not rewrite sibling keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-tier-backfill-'));
  const path = join(dir, 'output');
  writeFileSync(path, 'keep=me');
  const warnings = [];
  const first = applyGithubOutputBackfill(path, {
    warn: (msg) => warnings.push(msg),
  });
  assert.equal(first.backfilled, true);
  assert.equal(readFileSync(path, 'utf8'), `keep=me\n${HUMAN_OUTPUT}`);
  const second = applyGithubOutputBackfill(path, {
    warn: (msg) => warnings.push(msg),
  });
  assert.equal(second.backfilled, false);
  assert.equal(warnings.length, 1);
});

test('required mode fails visibly when a silent success wrote no label', () => {
  assert.equal(
    exitStatusAfterBackfill({
      mode: 'required',
      classifierStatus: 0,
      backfilled: true,
    }),
    2,
  );
  assert.equal(
    exitStatusAfterBackfill({
      mode: 'required',
      classifierStatus: 2,
      backfilled: true,
    }),
    2,
  );
  assert.equal(
    exitStatusAfterBackfill({
      mode: 'required',
      classifierStatus: 0,
      backfilled: false,
    }),
    0,
  );
});

test('advisory mode always exits 0 so the reviewer still runs', () => {
  assert.equal(
    exitStatusAfterBackfill({
      mode: 'advisory',
      classifierStatus: 2,
      backfilled: true,
    }),
    0,
  );
  assert.equal(
    exitStatusAfterBackfill({
      mode: 'advisory',
      classifierStatus: 0,
      backfilled: false,
    }),
    0,
  );
});

test('runReviewTierCheck backfills after a crash (null status) in required mode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-tier-run-'));
  const path = join(dir, 'output');
  const status = runReviewTierCheck({
    mode: 'required',
    classifierStatus: null,
    githubOutput: path,
  });
  assert.equal(status, 2);
  assert.equal(readFileSync(path, 'utf8'), HUMAN_OUTPUT);
});

test('runReviewTierCheck advisory swallows a classifier exit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-tier-advisory-'));
  const path = join(dir, 'output');
  writeFileSync(path, 'label=review:human\n');
  const status = runReviewTierCheck({
    mode: 'advisory',
    classifierStatus: 2,
    githubOutput: path,
  });
  assert.equal(status, 0);
  assert.equal(readFileSync(path, 'utf8'), 'label=review:human\n');
});

const SCRIPT = fileURLToPath(
  new URL('./run-review-tier-check.ts', import.meta.url),
);

test('CLI --status required backfills a silent success and exits 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-tier-cli-'));
  const output = join(dir, 'output');
  const result = spawnSync(
    process.execPath,
    [SCRIPT, '--mode', 'required', '--status', '0'],
    {
      env: { ...process.env, GITHUB_OUTPUT: output },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 2);
  assert.equal(readFileSync(output, 'utf8'), HUMAN_OUTPUT);
});

test('CLI refuses --base/--head: yarn review:tier:check is the only classifier entry', () => {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, '--mode', 'required', '--base', 'a', '--head', 'b'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--status <classifier-exit> is required/);
});
