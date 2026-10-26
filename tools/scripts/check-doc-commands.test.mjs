import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isolateGitEnvironment } from './lib/git-environment.ts';

// Husky runs this suite with the hook's GIT_DIR; see git-environment.ts.
isolateGitEnvironment();

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'check-doc-commands.mjs');

/**
 * The checker reads tracked Markdown, so a fixture needs a real repository. Each workspace is a
 * throwaway git repo with the files committed — `git ls-files` returns nothing otherwise, and the
 * checker would pass by seeing no corpus at all.
 */
function createRepo(t) {
  const workspace = mkdtempSync(join(tmpdir(), 'doc-commands-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: workspace,
      stdio: 'ignore',
    });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  return { workspace, git };
}

function write(workspace, relative, contents) {
  const path = join(workspace, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function commitAll({ workspace, git }) {
  execFileSync('git', ['add', '-A'], {
    cwd: workspace,
    stdio: 'ignore',
  });
  execFileSync('git', ['commit', '-q', '-m', 'fixture'], {
    cwd: workspace,
    stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_COMMITTER_NAME: 'T' },
  });
  void git;
}

const run = (workspace) =>
  spawnSync(process.execPath, [CHECKER], { cwd: workspace, encoding: 'utf8' });

const fence = (body) => '```bash\n' + body + '\n```\n';

test('accepts a documented command whose paths all exist', (t) => {
  const repo = createRepo(t);
  write(repo.workspace, 'tools/scripts/thing.mjs', '// thing\n');
  write(
    repo.workspace,
    'docs/README.md',
    '# Docs\n\n' + fence('node tools/scripts/thing.mjs'),
  );
  commitAll(repo);

  const result = run(repo.workspace);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /doc-commands: OK/);
});

test('rejects a documented command naming a script that does not exist', (t) => {
  const repo = createRepo(t);
  write(
    repo.workspace,
    'docs/README.md',
    '# Docs\n\n' + fence('node tools/scripts/gone.mjs'),
  );
  commitAll(repo);

  const result = run(repo.workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/README\.md → tools\/scripts\/gone\.mjs/);
});

// The defect this checker was written for (issue #534): the input to a rebuild command was a
// design export that had never been committed, and the filename contains spaces, so a
// whitespace-split tokenizer reports a name nobody wrote.
test('keeps a quoted filename whole and fails on the missing export', (t) => {
  const repo = createRepo(t);
  write(repo.workspace, 'tools/scripts/build.mjs', '// build\n');
  write(
    repo.workspace,
    'docs/vault/README.md',
    '# Vault\n\n' +
      fence(
        'node tools/scripts/build.mjs "<export-dir>" "Vault Trust Boundary.dc.html" docs/vault/page.html',
      ),
  );
  commitAll(repo);

  const result = run(repo.workspace);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Vault Trust Boundary\.dc\.html/);
  // The placeholder is a hole for the reader, not a claim about a file.
  assert.doesNotMatch(result.stderr, /export-dir/);
});

test('skips placeholders, variables, and globs', (t) => {
  const repo = createRepo(t);
  write(
    repo.workspace,
    'docs/README.md',
    '# Docs\n\n' +
      fence(
        [
          'yarn nx test <project-name>',
          'eslint libs/**/*.ts',
          'cat docs/$SLUG/notes.md',
        ].join('\n'),
      ),
  );
  commitAll(repo);

  const result = run(repo.workspace);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

// A generated path is legitimately absent from a clean tree. Deferring to .gitignore keeps that
// judgement in one place rather than in an opt-out list someone has to remember to prune.
test('accepts a documented path that git ignores as a build output', (t) => {
  const repo = createRepo(t);
  write(repo.workspace, '.gitignore', 'libs/web-ui/storybook-static\n');
  write(
    repo.workspace,
    'docs/README.md',
    '# Docs\n\n' + fence('npx serve libs/web-ui/storybook-static'),
  );
  commitAll(repo);

  const result = run(repo.workspace);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('ignores prose outside a shell fence and comments inside one', (t) => {
  const repo = createRepo(t);
  write(
    repo.workspace,
    'docs/README.md',
    'See `tools/scripts/absent.mjs` for details.\n\n' +
      '```ts\nimport x from "tools/scripts/also-absent.mjs";\n```\n\n' +
      fence('# tools/scripts/commented-out.mjs\necho hello'),
  );
  commitAll(repo);

  const result = run(repo.workspace);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
