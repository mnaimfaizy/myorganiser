/**
 * The gather layer's pure parts: which pushes a branch's workflow runs
 * represent, and what git does when it cannot serve a range.
 *
 * The first test is the one that decides whether the published rate means
 * anything. The review runs again on the same head whenever somebody asks it
 * to, and a pair of runs at one head has no push between it — so reading two
 * runs as two pushes compares a report with itself and reports every finding
 * in it as ignored.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { commitsBetween, pushesFromRuns } from './measure-noise.ts';
import { acknowledgementsIn } from './noise.ts';
import { isolateGitEnvironment } from '../lib/git-environment.ts';

// Husky runs this suite with the hook's GIT_DIR; see git-environment.ts.
isolateGitEnvironment();

const run = (databaseId: number, headSha: string, createdAt: string) => ({
  databaseId,
  headBranch: 'feat/a',
  headSha,
  createdAt,
});

test('two runs at the same head are one push, and the newest run wins', () => {
  const pushes = pushesFromRuns([
    run(3, 'bbb', '2026-09-08T12:00:00Z'),
    run(1, 'aaa', '2026-09-08T10:00:00Z'),
    // The re-run: same head, later, because somebody added `agent-review`.
    run(2, 'aaa', '2026-09-08T11:00:00Z'),
  ]);
  assert.deepEqual(
    pushes.map((p) => [p.headSha, p.databaseId]),
    [
      ['aaa', 2],
      ['bbb', 3],
    ],
  );
});

test('pushes come back oldest first whatever order the runs arrive in', () => {
  const pushes = pushesFromRuns([
    run(2, 'bbb', '2026-09-09T10:00:00Z'),
    run(3, 'ccc', '2026-09-10T10:00:00Z'),
    run(1, 'aaa', '2026-09-08T10:00:00Z'),
  ]);
  assert.deepEqual(
    pushes.map((p) => p.headSha),
    ['aaa', 'bbb', 'ccc'],
  );
  assert.deepEqual(pushesFromRuns(), []);
});

// A sha this clone does not have — a deleted branch, a force-push, a shallow
// checkout — is `null` rather than an empty list. The two mean different
// things: no commits acknowledged anything, versus nobody could look.
test('a range git cannot serve reads as null, not as no commits', () => {
  assert.equal(commitsBetween(null, 'abc'), null);
  assert.equal(commitsBetween('abc', null), null);
  assert.equal(commitsBetween('0'.repeat(40), '1'.repeat(40)), null);
});

/**
 * A repository built for the test, two commits deep, the second carrying an
 * acknowledgement marker in its body.
 *
 * Not this repository: `HEAD~1..HEAD` is one commit on a branch checkout and
 * `1 + N` on the merge ref CI checks out, so an assertion about the range's
 * length would pass here and fail on every pull request. A range whose
 * contents the test wrote is the only one it can assert against.
 */
const repoWithCommits = (messages: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'noise-commits-'));
  const run = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
    });
  run('init', '--quiet', '--initial-branch=main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  const shas: string[] = [];
  messages.forEach((message, i) => {
    writeFileSync(join(dir, 'a.txt'), `${i}\n`);
    run('add', 'a.txt');
    run('commit', '--quiet', '--no-gpg-sign', '-m', message);
    shas.push(run('rev-parse', 'HEAD').trim());
  });
  return { dir, shas };
};

test('a range git can serve comes back as commits with their messages', () => {
  const { dir, shas } = repoWithCommits([
    'feat(a): the first commit',
    'fix(a): the second commit\n\nReview-ack: 0123456789ab — real, deferred\n',
  ]);
  const commits = commitsBetween(shas[0]!, shas[1]!, dir);
  assert.equal(commits!.length, 1);
  assert.equal(commits![0].sha, shas[1]);
  assert.match(commits![0].message!, /fix\(a\): the second commit/);
  // The marker survives the trip out of git, which is the whole reason the
  // commits are read at all.
  assert.deepEqual([...acknowledgementsIn(commits).keys()], ['0123456789ab']);
  rmSync(dir, { recursive: true, force: true });
});

// A push is usually several commits, and a body with blank lines in it is the
// normal case: the record separator is what keeps two commits from reading as
// one message.
test('a push of several commits is one entry each', () => {
  const { dir, shas } = repoWithCommits([
    'feat(a): one',
    'feat(a): two\n\nA body.\n\nWith a blank line.\n',
    'feat(a): three\n\nReview-ack: ffffffffffff\n',
  ]);
  const commits = commitsBetween(shas[0]!, shas[2]!, dir);
  assert.deepEqual(
    commits!.map((c) => c.sha),
    [shas[2], shas[1]],
  );
  assert.match(commits![1].message!, /With a blank line/);
  assert.deepEqual([...acknowledgementsIn(commits).keys()], ['ffffffffffff']);
  rmSync(dir, { recursive: true, force: true });
});
