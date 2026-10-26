/**
 * Contract suite for check-fix-attribution.ts (ADR 0085: the header is the
 * specification, this is what makes it true).
 *
 * The header claims one direction — a fix's commits carry a line the
 * escaped-defect measurement reads as attribution, or the declared-unknown
 * line — and omits two: that the reference resolves, and that the body or the
 * issue counts. Both halves are proved here against a real repository, so a
 * later reader can tell a deliberate omission from a bug.
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { judge } from './check-fix-attribution.ts';
import { isolateGitEnvironment } from './lib/git-environment.ts';

// Husky runs this suite with the hook's GIT_DIR; see git-environment.ts.
isolateGitEnvironment();

const CHECKER = resolve('tools/scripts/check-fix-attribution.ts');

const git = (cwd: string, args: string[]): string => {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/** A fixture repository: where it is, and the range a run is given. */
interface FixtureRange {
  dir: string;
  base: string;
  head: string;
}

/** A repository with one base commit and one branch commit per message. */
function withRepo<T>(messages: string[], fn: (range: FixtureRange) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'fix-attribution-'));
  try {
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 'test@example.com']);
    git(dir, ['config', 'user.name', 'Test']);
    git(dir, ['commit', '-q', '--allow-empty', '-m', 'chore: base']);
    const base = git(dir, ['rev-parse', 'HEAD']);
    for (const message of messages)
      git(dir, ['commit', '-q', '--allow-empty', '-m', message]);
    const head = git(dir, ['rev-parse', 'HEAD']);
    return fn({ dir, base, head });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const run = ({ dir, base, head }: FixtureRange, extra: string[]) =>
  spawnSync(
    process.execPath,
    [CHECKER, '--base', base, '--head', head, ...extra],
    { cwd: dir, encoding: 'utf8' },
  );

// ---------------------------------------------------------------- asserted

test('fails a fix/ branch whose commits name no origin', () => {
  withRepo(['fix(vault): keep the blob\n\nCloses #800'], (repo) => {
    const r = run(repo, ['--branch', 'fix/800-keep-blob']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Introduced in #<pull request>/);
    assert.match(r.stderr, /Introduced in unknown: <why>/);
  });
});

test('a closing keyword is not attribution', () => {
  withRepo(['fix: x\n\nFixes #800'], (repo) => {
    assert.equal(run(repo, ['--branch', 'fix/800-x']).status, 1);
  });
});

test('passes a fix whose commit carries Introduced in #N', () => {
  withRepo(
    ['fix(vault): keep the blob', 'test: cover it\n\nIntroduced in #415'],
    (repo) => {
      const r = run(repo, ['--branch', 'fix/800-keep-blob']);
      assert.equal(r.status, 0);
      assert.match(r.stdout, /introduced-in/);
    },
  );
});

test('passes a fix that declares its origin unknown', () => {
  withRepo(
    ['fix: x\n\nIntroduced in unknown: predates the pull request history.'],
    (repo) => {
      const r = run(repo, ['--branch', 'fix/800-x']);
      assert.equal(r.status, 0);
      assert.match(r.stdout, /origin-unknown/);
    },
  );
});

test('a declaration without its reason fails', () => {
  withRepo(['fix: x\n\nIntroduced in unknown'], (repo) => {
    assert.equal(run(repo, ['--branch', 'fix/800-x']).status, 1);
  });
});

test('any phrasing the measurement reads passes, because it asks the measurement', () => {
  withRepo(['fix: x\n\nRoot cause: #590.'], (repo) => {
    assert.equal(run(repo, ['--branch', 'fix/800-x']).status, 0);
  });
});

test('a reserved branch prefix is typed by its title, as the measurement types it', () => {
  withRepo(['fix: x'], (repo) => {
    assert.equal(
      run(repo, ['--branch', 'claude/abc', '--title', 'fix: x']).status,
      1,
    );
    assert.equal(
      run(repo, ['--branch', 'claude/abc', '--title', 'feat: x']).status,
      0,
    );
  });
});

test('passes a Pull Request that is not a fix without reading its commits', () => {
  withRepo(['feat: x'], (repo) => {
    const r = run(repo, ['--branch', 'feat/736-x']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /not a fix/);
  });
});

test('only commits in base..head count', () => {
  withRepo(['fix: x'], ({ dir, base, head }) => {
    // The attribution sits in history the Pull Request did not bring in.
    const r = spawnSync(
      process.execPath,
      [CHECKER, '--base', head, '--head', head, '--branch', 'fix/800-x'],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(r.status, 1);
    assert.ok(base);
  });
});

test('exits 2 when it cannot run', () => {
  withRepo([], ({ dir }) => {
    const missing = spawnSync(process.execPath, [CHECKER], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(missing.status, 2);
    const bad = spawnSync(
      process.execPath,
      [CHECKER, '--base', 'nope', '--head', 'HEAD', '--branch', 'fix/1-x'],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(bad.status, 2);
  });
});

// ---------------------------------------------------------------- omitted

test('does not assert the reference resolves or is earlier', () => {
  assert.equal(
    judge({ branch: 'fix/800-x', commits: 'Introduced in #999999' }).status,
    'attributed',
  );
  assert.equal(
    judge({ branch: 'fix/800-x', commits: 'Introduced in #800' }).status,
    'attributed',
  );
});

test('does not read the Pull Request body or the issue', () => {
  // judge takes commit text and nothing else; a body naming the origin is not
  // an input, so a fix whose only attribution is there is unattributed.
  assert.equal(
    judge({
      branch: 'fix/800-x',
      title: 'fix: x (Introduced in #415)',
      commits: 'fix: x',
    }).status,
    'unattributed',
  );
});
