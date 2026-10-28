// Structural contracts for the Review Tier wiring that #790 actually failed
// on: the label step must not be able to fail the required check, and an
// empty classifier output must not reach `--tier` or Publish Review.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const REVIEW_TIER = readFileSync('.github/workflows/review-tier.yml', 'utf8');
const CODE_REVIEW = readFileSync('.github/workflows/code-review.yml', 'utf8');
const ACTION = readFileSync('.github/actions/code-reviewer/action.yml', 'utf8');

const jobBlock = (source: string, jobId: string) => {
  const jobsAt = source.search(/^jobs:\s*$/m);
  assert.notEqual(jobsAt, -1, 'workflow has no jobs:');
  const body = source.slice(jobsAt);
  const start = body.search(new RegExp(`^ {2}${jobId}:\\s*$`, 'm'));
  assert.notEqual(start, -1, `no job named ${jobId}`);
  const rest = body.slice(start + 1);
  const next = rest.search(/^ {2}[a-z0-9][a-z0-9-]*:\s*$/m);
  return next === -1 ? rest : rest.slice(0, next);
};

const stepNamed = (job: string, name: string) => {
  const start = job.indexOf(`- name: ${name}`);
  assert.notEqual(start, -1, `no step named ${name}`);
  const rest = job.slice(start);
  const next = rest.search(/\n {6}- name: /);
  return next === -1 ? rest : rest.slice(0, next);
};

test('applying the review:* label cannot fail the Review Tier check', () => {
  const classify = jobBlock(REVIEW_TIER, 'classify');
  const apply = stepNamed(classify, 'Apply the review tier label');
  assert.match(
    apply,
    /continue-on-error:\s*true/,
    'the label is a display of the job output (ADR 0070 item 3); a GraphQL flake must not fail the required check',
  );
  assert.match(apply, /apply-review-tier-label\.ts/);
  assert.doesNotMatch(
    apply,
    /gh label list --search/,
    'GitHub label search is an extra flaky round-trip the closed review:* set does not need',
  );
  // Comments sit above `- name:`, so the step extractor does not see them.
  assert.match(
    classify,
    /104334970928/,
    'run 151 GraphQL flake after classify',
  );
  assert.match(
    classify,
    /104326339851/,
    'run 147 Review Tier job with no runner',
  );
  assert.match(
    classify,
    /104326383163/,
    "same SHA's Agent Review Ran job, not Review Tier",
  );
  assert.match(
    classify,
    /docs\/research\/2026-09-18-review-tier-intermittent-failures\.md/,
  );
});

test('code-review never passes an empty --tier to the validator or publisher', () => {
  const review = jobBlock(CODE_REVIEW, 'review');
  const classify = stepNamed(review, 'Classify the diff');
  assert.match(
    classify,
    /run-review-tier-check\.ts/,
    'both workflows share one classify-then-backfill helper',
  );
  assert.match(
    classify,
    /--mode advisory/,
    'a classifier that dies before finish() must still let the reviewer run',
  );
  assert.match(
    CODE_REVIEW,
    /TIER: \$\{\{ needs\.review\.outputs\.tier \|\| 'review:human' \}\}/,
  );
  assert.match(
    review,
    /tier: \$\{\{ steps\.tier\.outputs\.label \|\| 'review:human' \}\}/,
  );
  assert.match(
    ACTION,
    /if \[ '\$\{\{ inputs\.tier \}\}' = 'null' \]; then/,
    'golden replay passes the sentinel null; empty string is stopped by the workflow || fallback',
  );
  assert.doesNotMatch(
    ACTION,
    /if \[ -z '\$\{\{ inputs\.tier \}\}' \]/,
    'empty-string handling in the action retriggers guard golden replay (ADR 0072)',
  );
});

test('Review Tier and Code Review share one classify-then-backfill helper', () => {
  const reviewTier = stepNamed(
    jobBlock(REVIEW_TIER, 'classify'),
    'Classify the diff',
  );
  const codeReview = stepNamed(
    jobBlock(CODE_REVIEW, 'review'),
    'Classify the diff',
  );
  assert.match(reviewTier, /yarn review:tier:check/);
  assert.match(reviewTier, /run-review-tier-check\.ts/);
  assert.match(reviewTier, /--mode required/);
  assert.match(codeReview, /yarn review:tier:check/);
  assert.match(codeReview, /run-review-tier-check\.ts/);
  assert.match(codeReview, /--mode advisory/);
  assert.doesNotMatch(
    reviewTier,
    /run-review-tier-check\.ts[\s\S]*--base /,
    'the helper does not spawn the classifier; yarn review:tier:check does',
  );
  assert.doesNotMatch(codeReview, /run-review-tier-check\.ts[\s\S]*--base /);
  assert.doesNotMatch(
    reviewTier,
    /grep -q '\^label=review:'/,
    'the backfill lives in the helper, not duplicated shell',
  );
  assert.doesNotMatch(codeReview, /grep -q '\^label=review:'/);
});

// Release Pull Requests are opened as github-actions[bot], and the reviewer's
// action refuses a bot it is not told to allow: v1.0.0 (#863) and v1.1.0
// (#923) both got "no verdict" for it. Dropping or misspelling an entry here
// brings that back silently.
test('the reviewer allows exactly the cursor and github-actions bots', () => {
  const line = ACTION.match(/^\s*allowed_bots:\s*(.+)$/m);
  assert.ok(line, 'action.yml sets no allowed_bots');
  assert.deepEqual(
    line[1]
      .split(',')
      .map((b) => b.trim())
      .sort(),
    ['cursor', 'github-actions'],
  );
});

// allowed_bots takes an actor, not a branch, so the grant to github-actions is
// broader than "release Pull Requests" (#925, decided on #927). What keeps it
// equivalent is that release-pr.yml is the only workflow here that opens a
// Pull Request, and it runs only on a push to release/v*. A second workflow
// that opens one widens the grant and must be looked at, so it fails here.
test('release-pr.yml is the only workflow that opens a Pull Request', () => {
  const dir = '.github/workflows';
  const opens = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .filter((f) =>
      /pulls\.create\b|gh pr create|create-pull-request@/.test(
        readFileSync(`${dir}/${f}`, 'utf8'),
      ),
    );
  assert.deepEqual(opens, ['release-pr.yml']);
  const release = readFileSync(`${dir}/release-pr.yml`, 'utf8');
  const push = release.match(/^ {2}push:\n((?: {4,}.*\n)+)/m);
  assert.ok(push, 'release-pr.yml has no push trigger');
  assert.deepEqual(
    [...push[1].matchAll(/^\s*-\s*'([^']+)'/gm)].map((m) => m[1]),
    ['release/v*'],
  );
});
