/**
 * Contract suite for check-signing-material.ts (ADR 0085: the header is the
 * specification, this is what makes it true).
 *
 * The header claims one direction — the index holds no forbidden kind — and
 * omits three: history, unstaged and untracked files, and binary kinds under
 * an unlisted name. Each claimed kind is proved to fail, and each omission is
 * proved to pass, against a real repository, so a later reader can tell a
 * deliberate omission from a bug.
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
  FORBIDDEN_EXTENSIONS,
  PUBLIC_DEBUG_KEYSTORE_BLOB,
  isServiceAccountKey,
} from './check-signing-material.ts';
import { isolateGitEnvironment } from './lib/git-environment.ts';

// Husky runs this suite with the hook's GIT_DIR; see git-environment.ts.
isolateGitEnvironment();

const CHECKER = resolve('tools/scripts/check-signing-material.ts');
const DEBUG_KEYSTORE = readFileSync(
  resolve('apps/mobile/android/app/debug.keystore'),
);

// Built as an object, so this file's source holds no quoted `"type"` key the
// checker's own `git grep` could match.
const serviceAccountJson = JSON.stringify(
  {
    type: 'service_account',
    project_id: 'example',
    private_key_id: '0',
    private_key: 'not-a-real-key',
    client_email: 'ci@example.iam.gserviceaccount.com',
  },
  null,
  2,
);

const git = (cwd: string, args: string[]) => {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/** A repository with one innocent commit, handed to `fn`. */
function withRepo<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'signing-material-'));
  try {
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 'test@example.com']);
    git(dir, ['config', 'user.name', 'Test']);
    write(dir, 'README.md', '# fixture\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'chore: base']);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function write(dir: string, path: string, contents: string | Buffer) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), contents);
}

/** Writes `path` and stages it. */
function stage(dir: string, path: string, contents: string | Buffer) {
  write(dir, path, contents);
  git(dir, ['add', '--', path]);
}

const run = (dir: string) =>
  spawnSync(process.execPath, [CHECKER], { cwd: dir, encoding: 'utf8' });

// ---------------------------------------------------------------- asserted

for (const { extension, kind } of FORBIDDEN_EXTENSIONS) {
  test(`fails a staged ${extension} and names its path`, () => {
    withRepo((dir) => {
      const path = `secrets/upload${extension}`;
      stage(dir, path, 'binary-ish contents');
      const r = run(dir);
      assert.equal(r.status, 1);
      assert.match(r.stderr, new RegExp(`${path.replace('.', '\\.')}`));
      assert.match(r.stderr, new RegExp(kind));
    });
  });
}

test('matches an extension case-insensitively', () => {
  withRepo((dir) => {
    stage(dir, 'android/RELEASE.JKS', 'key');
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /android\/RELEASE\.JKS \(Android keystore\)/);
  });
});

test('fails a forbidden file already committed, as CI sees it', () => {
  withRepo((dir) => {
    stage(dir, 'release.keystore', 'key');
    git(dir, ['commit', '-q', '-m', 'chore: oops']);
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /release\.keystore/);
  });
});

test('fails a release keystore renamed debug.keystore', () => {
  withRepo((dir) => {
    stage(dir, 'apps/mobile/android/app/debug.keystore', 'a release key');
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /debug\.keystore \(Android keystore\)/);
  });
});

test('fails service-account JSON under an innocent filename', () => {
  withRepo((dir) => {
    stage(dir, 'config/settings.txt', serviceAccountJson);
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(
      r.stderr,
      /config\/settings\.txt \(Google service-account key\)/,
    );
  });
});

test('names every forbidden path, not only the first', () => {
  withRepo((dir) => {
    stage(dir, 'a.p8', 'key');
    stage(dir, 'b.mobileprovision', 'profile');
    stage(dir, 'c.json', serviceAccountJson);
    const r = run(dir);
    assert.equal(r.status, 1);
    for (const path of ['a.p8', 'b.mobileprovision', 'c.json'])
      assert.match(r.stderr, new RegExp(path.replace('.', '\\.')));
  });
});

// ---------------------------------------------------- the debug keystore

test('pins the blob id of the debug keystore the repository ships', () => {
  const blob = spawnSync(
    'git',
    ['hash-object', 'apps/mobile/android/app/debug.keystore'],
    { encoding: 'utf8' },
  ).stdout.trim();
  assert.equal(blob, PUBLIC_DEBUG_KEYSTORE_BLOB);
});

test('passes when only the public debug keystore is present', () => {
  withRepo((dir) => {
    stage(dir, 'apps/mobile/android/app/debug.keystore', DEBUG_KEYSTORE);
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no signing material/);
  });
});

test('passes the public debug keystore under another name', () => {
  withRepo((dir) => {
    stage(dir, 'other/app/debug.jks', DEBUG_KEYSTORE);
    assert.equal(run(dir).status, 0);
  });
});

// ------------------------------------------------------------ not asserted

test('passes a forbidden file that is only in history', () => {
  withRepo((dir) => {
    stage(dir, 'release.jks', 'key');
    git(dir, ['commit', '-q', '-m', 'chore: oops']);
    git(dir, ['rm', '-q', '--', 'release.jks']);
    assert.equal(run(dir).status, 0);
  });
});

test('passes an untracked forbidden file', () => {
  withRepo((dir) => {
    write(dir, 'release.jks', 'key');
    write(dir, 'sa.json', serviceAccountJson);
    assert.equal(run(dir).status, 0);
  });
});

test('passes a keystore under an unlisted extension', () => {
  withRepo((dir) => {
    stage(dir, 'release.bin', DEBUG_KEYSTORE);
    stage(dir, 'release.pfx', 'key');
    assert.equal(run(dir).status, 0);
  });
});

test('passes JSON that names service_account but carries no key', () => {
  withRepo((dir) => {
    stage(
      dir,
      'docs/example.json',
      JSON.stringify({ type: 'service_account', client_email: 'x' }, null, 2),
    );
    stage(
      dir,
      'docs/notes.md',
      `A key looks like:\n\n${serviceAccountJson}\n\nNever commit one.\n`,
    );
    assert.equal(run(dir).status, 0);
  });
});

// --------------------------------------------------------------- the parser

test('isServiceAccountKey reads only a service-account key', () => {
  assert.equal(isServiceAccountKey(serviceAccountJson), true);
  assert.equal(isServiceAccountKey(`\uFEFF${serviceAccountJson}`), true);
  assert.equal(isServiceAccountKey('not json'), false);
  assert.equal(isServiceAccountKey('null'), false);
  assert.equal(
    isServiceAccountKey(
      JSON.stringify({ type: 'authorized_user', private_key: 'x' }),
    ),
    false,
  );
});
