import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  collectClaims,
  deniesExistence,
  isModuleIdentifier,
  isRepoPath,
} from './check-doc-file-refs.mjs';
import { isolateGitEnvironment } from './lib/git-environment.mjs';

// Husky runs this suite with the hook's GIT_DIR; see git-environment.mjs.
isolateGitEnvironment();

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'check-doc-file-refs.mjs');

function createRepo(t) {
  const workspace = mkdtempSync(join(tmpdir(), 'doc-file-refs-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, { cwd: workspace, stdio: 'ignore' });
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

function emptyExemptions() {
  return JSON.stringify({ schemaVersion: 1, exemptions: [] }, null, 2) + '\n';
}

function commitAll({ workspace }) {
  execFileSync('git', ['add', '-A'], { cwd: workspace, stdio: 'ignore' });
  execFileSync('git', ['commit', '-q', '-m', 'fixture'], {
    cwd: workspace,
    stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_COMMITTER_NAME: 'T' },
  });
}

const run = (workspace, ...args) =>
  spawnSync(process.execPath, [CHECKER, ...args], {
    cwd: workspace,
    encoding: 'utf8',
  });

test('isRepoPath only anchors at known roots and rejects spaces and ellipsis', () => {
  assert.equal(
    isRepoPath('libs/web-vault-ui/src/lib/reconcileRunner.tsx'),
    true,
  );
  assert.equal(isRepoPath('src/index.ts'), false);
  assert.equal(isRepoPath('libs/**'), false);
  assert.equal(isRepoPath('docs/adr/0053-…'), false);
});

test('isModuleIdentifier is camelCase or PascalCase only', () => {
  assert.equal(isModuleIdentifier('migrationRunner'), true);
  assert.equal(isModuleIdentifier('vaultGate'), true);
  assert.equal(isModuleIdentifier('reconcileRunner'), true);
  assert.equal(isModuleIdentifier('ComponentBuilder'), true);
  assert.equal(isModuleIdentifier('session'), false);
  assert.equal(isModuleIdentifier('AGENTS'), false);
  assert.equal(isModuleIdentifier('JWT'), false);
});

test('deniesExistence catches a negative file-ref and ignores a nearby "not"', () => {
  assert.equal(deniesExistence('This app has no `proxy.ts`.'), true);
  assert.equal(
    deniesExistence(
      'Do not introduce `package-lock.json` or `pnpm-lock.yaml` changes.',
    ),
    true,
  );
  assert.equal(
    deniesExistence('Do **not** invent `docs/backend/GUIDELINES.md`.'),
    true,
  );
  assert.equal(
    deniesExistence('There is no tracked `docs/qa/` home for plans.'),
    true,
  );
  assert.equal(
    deniesExistence(
      '`reconcileRunner` is checked even though §1 lists them as not Vault UI Components.',
    ),
    false,
  );
});

test('collectClaims treats a trailing-slash libs directory plus camelCase name as a module file-ref', () => {
  const text =
    'every `.tsx` under `libs/web-vault-ui/src/lib/`, so `session`, `vaultGate` and `migrationRunner` are checked.\n';
  const exists = (path) => path === 'libs/web-vault-ui/src/lib';
  const isDirectory = (path) => path === 'libs/web-vault-ui/src/lib';
  const claims = collectClaims(text, { exists, isDirectory });
  assert.deepEqual(
    claims
      .filter((c) => c.kind === 'module')
      .map((c) => c.claim)
      .sort(),
    [
      'libs/web-vault-ui/src/lib/migrationRunner',
      'libs/web-vault-ui/src/lib/vaultGate',
    ],
  );
  assert.equal(
    claims.some((c) => c.claim.endsWith('/session')),
    false,
  );
});

test('collectClaims does not attach identifiers to a directory without a trailing slash', () => {
  const text =
    'Files live under `libs/web-vault-ui/src/lib` including `migrationRunner`.\n';
  const exists = (path) => path === 'libs/web-vault-ui/src/lib';
  const isDirectory = (path) => path === 'libs/web-vault-ui/src/lib';
  const claims = collectClaims(text, { exists, isDirectory });
  assert.deepEqual(
    claims.filter((c) => c.kind === 'module'),
    [],
  );
});

test('collectClaims does not attach identifiers from a different sentence', () => {
  const text =
    '`ComponentBuilder` is a specialist. Every `.tsx` under `libs/web-vault-ui/src/lib/` is checked.\n';
  const exists = (path) => path === 'libs/web-vault-ui/src/lib';
  const isDirectory = (path) => path === 'libs/web-vault-ui/src/lib';
  const claims = collectClaims(text, { exists, isDirectory });
  assert.equal(
    claims.some((c) => c.claim.endsWith('/ComponentBuilder')),
    false,
  );
});

test('collectClaims does not attach identifiers from a different list item', () => {
  const text = [
    '- New or edited component behavior in `libs/web-ui/` → `ComponentBuilder`',
    '- New or updated Storybook story → `StorybookCurator`',
  ].join('\n');
  const exists = (path) => path === 'libs/web-ui';
  const isDirectory = (path) => path === 'libs/web-ui';
  const claims = collectClaims(text, { exists, isDirectory });
  assert.equal(
    claims.some((c) => c.claim.endsWith('/StorybookCurator')),
    false,
  );
});

test('accepts a documented path that exists', (t) => {
  const repo = createRepo(t);
  write(
    repo.workspace,
    'tools/config/doc-file-refs-exemptions.json',
    emptyExemptions(),
  );
  write(
    repo.workspace,
    'libs/web-vault-ui/src/lib/reconcileRunner.tsx',
    '// runner\n',
  );
  write(
    repo.workspace,
    'docs/README.md',
    'See `libs/web-vault-ui/src/lib/reconcileRunner.tsx`.\n',
  );
  commitAll(repo);

  const result = run(repo.workspace);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /doc-file-refs: OK/);
});

// The defect this checker was written for (issue #744 / PR #743): an ADR
// addendum named a module `migrationRunner` next to the real directory.
test('rejects migrationRunner next to a real libs directory when the module is missing', (t) => {
  const repo = createRepo(t);
  write(
    repo.workspace,
    'tools/config/doc-file-refs-exemptions.json',
    emptyExemptions(),
  );
  write(
    repo.workspace,
    'libs/web-vault-ui/src/lib/reconcileRunner.tsx',
    '// runner\n',
  );
  write(repo.workspace, 'libs/web-vault-ui/src/lib/vaultGate.tsx', '// gate\n');
  write(
    repo.workspace,
    'docs/adr/0014.md',
    'every `.tsx` under `libs/web-vault-ui/src/lib/`, so `vaultGate` and `migrationRunner` are checked.\n',
  );
  commitAll(repo);

  const result = run(repo.workspace);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(
    result.stderr,
    /docs\/adr\/0014\.md → libs\/web-vault-ui\/src\/lib\/migrationRunner/,
  );
  assert.doesNotMatch(result.stderr, /vaultGate/);
});

test('rejects a backticked repo path that does not exist', (t) => {
  const repo = createRepo(t);
  write(
    repo.workspace,
    'tools/config/doc-file-refs-exemptions.json',
    emptyExemptions(),
  );
  write(
    repo.workspace,
    'docs/README.md',
    'See `libs/web-vault-ui/src/lib/migrationRunner.tsx`.\n',
  );
  commitAll(repo);

  const result = run(repo.workspace);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /docs\/README\.md → libs\/web-vault-ui\/src\/lib\/migrationRunner\.tsx/,
  );
});

test('resolves a docs/adr/NNNN shorthand to the unique numbered file', (t) => {
  const repo = createRepo(t);
  write(
    repo.workspace,
    'tools/config/doc-file-refs-exemptions.json',
    emptyExemptions(),
  );
  write(
    repo.workspace,
    'docs/adr/0010-sandcastle-local-only-integration.md',
    '# ADR 0010\n',
  );
  write(repo.workspace, 'docs/sandcastle/RUNBOOK.md', 'See `docs/adr/0010`.\n');
  commitAll(repo);

  const result = run(repo.workspace);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('skips a negative existence claim', (t) => {
  const repo = createRepo(t);
  write(
    repo.workspace,
    'tools/config/doc-file-refs-exemptions.json',
    emptyExemptions(),
  );
  write(
    repo.workspace,
    'AGENTS.md',
    'This app has no `apps/web/src/proxy.ts`.\n',
  );
  commitAll(repo);

  const result = run(repo.workspace);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('skips Research Briefs under docs/research/', (t) => {
  const repo = createRepo(t);
  write(
    repo.workspace,
    'tools/config/doc-file-refs-exemptions.json',
    emptyExemptions(),
  );
  write(
    repo.workspace,
    'docs/research/2026-01-01-old.md',
    'This brief named `libs/does-not-exist/gone.ts` on purpose.\n',
  );
  write(repo.workspace, 'docs/README.md', 'Nothing to claim.\n');
  commitAll(repo);

  const result = run(repo.workspace);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('skips fenced code, placeholders, CLI flags, and identifiers with no nearby directory', (t) => {
  const repo = createRepo(t);
  write(
    repo.workspace,
    'tools/config/doc-file-refs-exemptions.json',
    emptyExemptions(),
  );
  write(
    repo.workspace,
    'docs/README.md',
    [
      'The `ComponentBuilder` sub-agent is a role, not a file-ref.',
      '',
      'Flags like `--print` and packages like `@myorganiser/design-tokens` stay prose.',
      '',
      '```ts',
      'import { missing } from "libs/does-not-exist/gone.ts";',
      '```',
      '',
      'Globs: `libs/**` and `apps/web/src/app/**`.',
    ].join('\n'),
  );
  commitAll(repo);

  const result = run(repo.workspace);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('an exemption suppresses a missing claim and a stale exemption fails', (t) => {
  const repo = createRepo(t);
  write(
    repo.workspace,
    'tools/config/doc-file-refs-exemptions.json',
    JSON.stringify(
      {
        schemaVersion: 1,
        exemptions: [
          {
            file: 'docs/adr/old.md',
            claim: 'libs/gone/old.ts',
            reason: 'Superseded path kept as recorded history.',
          },
        ],
      },
      null,
      2,
    ) + '\n',
  );
  write(
    repo.workspace,
    'docs/adr/old.md',
    'Used to live at `libs/gone/old.ts`.\n',
  );
  commitAll(repo);

  const suppressed = run(repo.workspace);
  assert.equal(suppressed.status, 0, suppressed.stdout + suppressed.stderr);

  write(
    repo.workspace,
    'docs/adr/old.md',
    'The path was removed from this ADR.\n',
  );
  commitAll(repo);
  const stale = run(repo.workspace);
  assert.equal(stale.status, 1);
  assert.match(
    stale.stderr,
    /stale exemption: docs\/adr\/old\.md → libs\/gone\/old\.ts/,
  );
});

test('skips a documented path that git ignores as a build output', (t) => {
  const repo = createRepo(t);
  write(
    repo.workspace,
    'tools/config/doc-file-refs-exemptions.json',
    emptyExemptions(),
  );
  write(repo.workspace, '.gitignore', 'libs/web-ui/storybook-static\n');
  write(
    repo.workspace,
    'docs/README.md',
    'Serve `libs/web-ui/storybook-static` after the build.\n',
  );
  commitAll(repo);

  const result = run(repo.workspace);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('fails closed when the exemption list is missing', (t) => {
  const repo = createRepo(t);
  write(repo.workspace, 'docs/README.md', 'Hi.\n');
  commitAll(repo);

  const result = run(repo.workspace);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /doc-file-refs-exemptions\.json not found/);
});
