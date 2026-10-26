import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const CHECKER = 'tools/scripts/check-review-concurrency.ts';
const WORKFLOW = '.github/workflows/code-review.yml';

/**
 * The checker reads a fixed path, so each case runs it in a throwaway
 * directory holding a doctored copy of the real workflow. That keeps the
 * fixtures honest — they are the committed file with one edit — and means a
 * change to the real workflow's shape breaks these tests rather than passing
 * against a fixture that no longer resembles it.
 */
const runOn = (mutate: (source: string) => string = (s) => s) => {
  const dir = mkdtempSync(join(tmpdir(), 'review-concurrency-'));
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  writeFileSync(
    join(dir, WORKFLOW),
    mutate(readFileSync(WORKFLOW, 'utf8')),
    'utf8',
  );
  try {
    const stdout = execFileSync(
      process.execPath,
      [join(process.cwd(), CHECKER)],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { code: 0, out: stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

test('the committed workflow passes', () => {
  const { code, out } = runOn();
  assert.equal(code, 0, out);
  assert.match(out, /OK — 3 trigger/);
});

// Each of these is a bug that actually shipped. #687 and #690 lost their
// reviews to label runs, #693 to a GitGuardian comment, and #694's own inert
// group cancelled itself and reported a passing review as cancelled.
test('a label run sharing the review group is caught', () => {
  const { code, out } = runOn((s) =>
    s.replace(
      "(github.event.action == 'labeled' && github.event.label.name != 'agent-review') || ",
      '',
    ),
  );
  assert.equal(code, 1, out);
  assert.match(out, /re-review label/);
});

test('a comment run sharing the review group is caught', () => {
  const { code, out } = runOn((s) =>
    s.replace(
      / \|\| \(github\.event_name == 'issue_comment' && !\(startsWith[^\n]*?author_association\)\)\)/,
      ')',
    ),
  );
  assert.equal(code, 1, out);
  assert.match(out, /re-review command|negate it/);
});

test('dropping the authorization list from the group is caught', () => {
  const { code, out } = runOn((s) => {
    const auth =
      ' && contains(fromJSON(\'["OWNER","MEMBER","COLLABORATOR"]\'), github.event.comment.author_association)';
    // Remove it from the group only, leaving the job `if:` intact.
    const i = s.indexOf('  group: code-review-');
    const end = s.indexOf('\n', i);
    return s.slice(0, i) + s.slice(i, end).replace(auth, '') + s.slice(end);
  });
  assert.equal(code, 1, out);
  assert.match(out, /associations allowed to request a review/);
});

test('a shared inert group is caught', () => {
  const { code, out } = runOn((s) =>
    s.replace("format('-inert-{0}', github.run_id)", "'-inert'"),
  );
  assert.equal(code, 1, out);
  assert.match(out, /unique per run/);
});

test('no inert group at all is caught', () => {
  const { code, out } = runOn((s) =>
    s.replace("format('-inert-{0}', github.run_id)", "''"),
  );
  assert.equal(code, 1, out);
  assert.match(out, /no distinct suffix/);
});

// The checker asserts the group against literals it reads out of the `if:`.
// If the `if:` stops naming them it must say so, not silently check nothing.
test('an `if:` that no longer names a trigger is reported, not ignored', () => {
  const { code, out } = runOn((s) =>
    s.replace(
      "github.event.label.name == 'agent-review'",
      'github.event.label.name != null',
    ),
  );
  assert.equal(code, 1, out);
  assert.match(out, /no longer names the re-review label/);
});

// The extraction has to be bounded and unique, or it reads a `group:` that
// belongs to something else and asserts against the wrong string.
test('a second top-level concurrency block cannot run', () => {
  const { code, out } = runOn((s) => `${s}\nconcurrency:\n  group: other\n`);
  assert.equal(code, 2, out);
  assert.match(out, /assumes exactly one/);
});

test('a workflow with no concurrency block cannot run', () => {
  const { code, out } = runOn((s) =>
    s.replace(/^concurrency:\n(?:[ \t]+.*\n|\n)*/m, ''),
  );
  assert.equal(code, 2, out);
  assert.match(out, /no top-level `concurrency:` block/);
});
