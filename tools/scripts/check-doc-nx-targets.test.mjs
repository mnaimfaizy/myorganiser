import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'check-doc-nx-targets.mjs');
const EXEMPTIONS = 'tools/config/doc-nx-targets-exemptions.json';

/**
 * A graph shaped like this workspace's, small enough to read. `email-shell`
 * carries a target whose own name contains a colon, the shape behind #426;
 * `web` carries a configuration; `mobile-feat-auth` has `lint` and nothing else,
 * which is the Agent Guide defect #980's inventory found.
 */
const NODES = {
  backend: {
    data: { root: 'apps/backend', targets: { build: {}, test: {}, lint: {} } },
  },
  web: {
    data: {
      root: 'apps/web',
      targets: {
        build: {},
        lint: {},
        serve: { configurations: { production: {} } },
      },
    },
  },
  'email-shell': {
    data: { root: 'libs/email-shell', targets: { 'eslint:lint': {} } },
  },
  'mobile-feat-auth': {
    data: { root: 'libs/mobile/feat/auth', targets: { lint: {} } },
  },
  'web-e2e': {
    data: {
      root: 'apps/web-e2e',
      targets: { 'e2e-ci--src/e2e/auth.spec.ts': {} },
    },
  },
};

/**
 * The checker reads tracked Markdown, so a fixture needs a real repository — `git ls-files`
 * returns nothing otherwise, and the checker would pass by seeing no corpus at all. The graph
 * is handed in as a file, so no Nx workspace is needed.
 */
function createRepo(t, { exemptions = [], nodes = NODES } = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'doc-nx-targets-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const graphDir = mkdtempSync(join(tmpdir(), 'doc-nx-targets-graph-'));
  t.after(() => rmSync(graphDir, { recursive: true, force: true }));
  const graph = join(graphDir, 'graph.json');
  writeFileSync(graph, JSON.stringify({ graph: { nodes } }));

  // Strips GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE / GIT_COMMON_DIR so this
  // call cannot inherit them from the real repository and resolve there
  // instead — fatal under Husky, which sets them for its own hook process
  // tree. `cwd` alone does not override an inherited GIT_DIR.
  const gitEnv = { ...process.env };
  delete gitEnv.GIT_DIR;
  delete gitEnv.GIT_WORK_TREE;
  delete gitEnv.GIT_INDEX_FILE;
  delete gitEnv.GIT_COMMON_DIR;
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: workspace,
      stdio: 'ignore',
      env: gitEnv,
    });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');

  const repo = { workspace, graph, git };
  write(repo, EXEMPTIONS, JSON.stringify({ schemaVersion: 1, exemptions }));
  return repo;
}

function write({ workspace }, relative, contents) {
  const path = join(workspace, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function run(repo, ...args) {
  repo.git('add', '-A');
  repo.git('commit', '-q', '-m', 'fixture');
  return spawnSync(process.execPath, [CHECKER, repo.graph, ...args], {
    cwd: repo.workspace,
    encoding: 'utf8',
  });
}

const fence = (body, lang = 'bash') => '```' + lang + '\n' + body + '\n```\n';

test('accepts documented commands whose project and target resolve', (t) => {
  const repo = createRepo(t);
  write(
    repo,
    'docs/README.md',
    '# Docs\n\nLint with `yarn nx lint backend`.\n\n' +
      fence('yarn nx run backend:build\nnpx nx test backend --watch'),
  );

  const result = run(repo);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /doc-nx-targets: OK — 3 documented/);
});

// The defect this checker was written for (issue #980): DEVELOPMENT.md taught
// `backend:type-check` in a fenced block, and no such target has ever existed.
test('rejects a fenced `nx run` naming a target the project does not have', (t) => {
  const repo = createRepo(t);
  write(
    repo,
    'DEVELOPMENT.md',
    '# Dev\n\n' + fence('# Check types\nyarn nx run backend:type-check'),
  );

  const result = run(repo);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /DEVELOPMENT\.md:5 → nx run backend:type-check — project `backend` has no target `type-check`/,
  );
});

// Three of the five dead references #980's inventory found were inline, in Agent Guides and
// sub-agent bodies, where the fenced-only reach of `docs:commands:check` never looks.
test('rejects an inline `nx <target> <project>` the project cannot run', (t) => {
  const repo = createRepo(t);
  write(
    repo,
    'libs/mobile/feat/auth/AGENTS.md',
    '## Commands\n\n- Test: `yarn nx test mobile-feat-auth`.\n- Lint: `yarn nx lint mobile-feat-auth`.\n',
  );

  const result = run(repo);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /AGENTS\.md:3 → nx test mobile-feat-auth — project `mobile-feat-auth` has no target `test`/,
  );
  assert.doesNotMatch(result.stderr, /nx lint mobile-feat-auth/);
});

test('rejects an example that names a project which does not exist', (t) => {
  const repo = createRepo(t);
  write(
    repo,
    'docs/agent.md',
    '- Project name and run command (e.g., `yarn nx test tasks`)\n',
  );

  const result = run(repo);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /nx test tasks — no project named `tasks`/);
});

// A word that is no project's target is a command only when a real project follows it.
// That keeps backticked prose out while still catching the #980 defect in its other spelling.
test('fails an unknown target only when a real project follows it', (t) => {
  const repo = createRepo(t);
  write(
    repo,
    'docs/README.md',
    'Run `yarn nx type-check backend`. The brief covers `nx next react-native`.\n',
  );

  const result = run(repo);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /nx type-check backend — project `backend` has no target `type-check`/,
  );
  assert.doesNotMatch(result.stderr, /react-native/);
});

// Issue #426 and the stale Agent Guide in #830: a target whose own name contains a colon.
// Read `email-shell:eslint:lint` as target `eslint`, configuration `lint`, and a live command
// fails; read it only as a target and `web:serve:production` fails. Longest target first.
test('resolves a colon-bearing target before reading a configuration', (t) => {
  const repo = createRepo(t);
  write(
    repo,
    'docs/README.md',
    fence(
      [
        'yarn nx run email-shell:eslint:lint',
        'yarn nx run web:serve:production',
        'yarn nx run web-e2e:e2e-ci--src/e2e/auth.spec.ts',
      ].join('\n'),
    ),
  );

  const result = run(repo);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('rejects the #426 target name once the target is plain `lint`', (t) => {
  const repo = createRepo(t, {
    nodes: {
      'email-shell': {
        data: { root: 'libs/email-shell', targets: { lint: {} } },
      },
    },
  });
  write(
    repo,
    'libs/email-shell/AGENTS.md',
    '- Lint: `yarn nx run email-shell:eslint:lint`\n',
  );

  const result = run(repo);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /project `email-shell` has no target `eslint:lint`/,
  );
});

test('rejects a configuration the target does not have', (t) => {
  const repo = createRepo(t);
  write(repo, 'docs/README.md', fence('yarn nx run web:serve:staging'));

  const result = run(repo);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /target `web:serve` has no configuration `staging`/,
  );
});

test('asserts the targets and projects of run-many and affected', (t) => {
  const repo = createRepo(t);
  write(
    repo,
    'docs/README.md',
    fence(
      [
        'yarn nx run-many -t lint,test -p backend web',
        'yarn nx affected --target=build',
        'yarn nx run-many --targets=lint,typecheck',
        'yarn nx run-many -t lint --projects=backend,ghost',
        'yarn nx affected -t lint --base=origin/main',
      ].join('\n'),
    ),
  );

  const result = run(repo);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /README\.md:4 → nx run-many -t typecheck — no project has a target `typecheck`/,
  );
  assert.match(
    result.stderr,
    /README\.md:5 → nx run-many -p ghost — no project named `ghost`/,
  );
  assert.match(result.stderr, /2 documented Nx reference\(s\) do not resolve/);
});

test('skips what is not a claim about a target', (t) => {
  const repo = createRepo(t);
  write(
    repo,
    'docs/README.md',
    [
      'Placeholders: `yarn nx test <project>`, `yarn nx run <project>:<target>`, `nx run $APP:build`.',
      'Subcommands: `yarn nx graph`, `yarn nx show project ghost`, `yarn nx g @nx/js:library`, `nx reset`.',
      'Prose that merely mentions `nx` or says `the nx test ghost command` mid-span is not a command.',
      '',
      fence('# yarn nx run backend:commented-out\nyarn nx format:check'),
      fence('run: yarn nx run backend:type-check', 'yaml'),
      fence('yarn nx run backend:type-check', ''),
    ].join('\n'),
  );
  // Frozen at their date (ADR 0041) or at their release; a name that was live then stays.
  write(repo, 'docs/research/2026-01-01-old.md', '`yarn nx run ghost:build`\n');
  write(repo, 'CHANGELOG.md', '- `yarn nx run ghost:build`\n');

  const result = run(repo);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /0 documented Nx reference/);
});

test('reads a command split across lines and chained with &&', (t) => {
  const repo = createRepo(t);
  write(
    repo,
    'docs/README.md',
    fence(
      'yarn nx run-many \\\n  -t lint \\\n  -p ghost\ncd apps && yarn nx build web && yarn nx test web',
    ),
  );

  const result = run(repo);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /README\.md:2 → nx run-many -p ghost/);
  assert.match(
    result.stderr,
    /README\.md:5 → nx test web — project `web` has no target `test`/,
  );
  assert.doesNotMatch(result.stderr, /nx build web/);
});

// A merged ADR that records what a command used to be (ADR 0104: the sentence stays true
// even with the target gone) keeps the name, with a written reason.
test('an exemption with a reason suppresses a recorded-history reference', (t) => {
  const repo = createRepo(t, {
    exemptions: [
      {
        file: 'docs/adr/0050-e2e.md',
        claim: 'nx run web:serve:legacy',
        reason:
          'Records the command at the time; the paragraph names its successor.',
      },
    ],
  });
  write(
    repo,
    'docs/adr/0050-e2e.md',
    '`webServer.command` becomes `nx run web:serve:legacy`.\n',
  );

  const result = run(repo);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /1 exempted/);
});

test('fails an exemption that no longer suppresses anything', (t) => {
  const repo = createRepo(t, {
    exemptions: [
      {
        file: 'docs/README.md',
        claim: 'nx run web:serve:production',
        reason: 'Was dead once.',
      },
    ],
  });
  write(repo, 'docs/README.md', '`nx run web:serve:production`\n');

  const result = run(repo);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /stale exemption: docs\/README\.md → nx run web:serve:production/,
  );
});

test('exits 2 on an exemption that carries no written reason', (t) => {
  const repo = createRepo(t, {
    exemptions: [{ file: 'docs/README.md', claim: 'nx test ghost' }],
  });
  write(repo, 'docs/README.md', '`nx test ghost`\n');

  const result = run(repo);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /carries no written reason/);
});

// A check that could not look must not read as "every reference resolves", nor as a
// documentation defect: exit 2 is neither.
test('exits 2 when the project graph is unavailable', (t) => {
  const repo = createRepo(t);
  write(repo, 'docs/README.md', '`yarn nx lint backend`\n');
  repo.graph = join(repo.workspace, 'absent-graph.json');

  const result = run(repo);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /doc-nx-targets: .*not found/);
});

test('--print lists every reference it resolved', (t) => {
  const repo = createRepo(t);
  write(repo, 'docs/README.md', '`yarn nx lint backend`\n');

  const result = run(repo, '--print');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /docs\/README\.md:1 → nx lint backend/);
});

test('reads every shell fence language, tilde fences, and a console prompt', (t) => {
  const repo = createRepo(t);
  write(
    repo,
    'docs/README.md',
    [
      fence('yarn nx test ghost-sh', 'sh'),
      fence('yarn nx test ghost-shell', 'shell'),
      fence('$ nx test ghost-console', 'console'),
      '~~~bash\nyarn nx test ghost-tilde\n~~~\n',
    ].join('\n'),
  );

  const result = run(repo);
  assert.equal(result.status, 1);
  for (const name of ['sh', 'shell', 'console', 'tilde']) {
    assert.match(
      result.stderr,
      new RegExp(`no project named \`ghost-${name}\``),
    );
  }
});

// Everything after the command is not the command. Each of these once read a comment word,
// a log file, or a glued separator as a target or project name.
test('stops a command at a comment, a redirect, and a glued separator', (t) => {
  const repo = createRepo(t);
  write(
    repo,
    'docs/README.md',
    fence(
      [
        'yarn nx run-many -t lint test # every project',
        'yarn nx run-many -t lint \\',
        '  # a note between continued lines',
        '  -p backend > out.log 2>&1',
        'yarn nx build web; yarn nx lint web|tee lint.log',
      ].join('\n'),
    ) + '\nQuoted: `yarn nx run-many --targets="lint,test"`.\n',
  );

  const result = run(repo);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /OK — 8 documented/);
});

test('reads the command after a glued separator', (t) => {
  const repo = createRepo(t);
  write(repo, 'docs/README.md', fence('yarn nx build web; yarn nx test web'));

  const result = run(repo);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /nx test web — project `web` has no target `test`/,
  );
});

test('skips a -p value that selects by tag or directory, and an ellipsis', (t) => {
  const repo = createRepo(t);
  write(
    repo,
    'docs/README.md',
    fence(
      'yarn nx run-many -t lint -p tag:scope:ghost apps/ghost\nyarn nx test …\nyarn nx run ghost...:build',
    ),
  );

  const result = run(repo);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /OK — 1 documented/);
});

test('fails an exemption whose reference is no longer written', (t) => {
  const repo = createRepo(t, {
    exemptions: [
      {
        file: 'docs/README.md',
        claim: 'nx test ghost',
        reason: 'Was written once.',
      },
    ],
  });
  write(repo, 'docs/README.md', 'Nothing here names an Nx command.\n');

  const result = run(repo);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /stale exemption: docs\/README\.md → nx test ghost/,
  );
});

test('exits 2 on a reference exempted twice', (t) => {
  const entry = {
    file: 'docs/README.md',
    claim: 'nx test ghost',
    reason: 'History.',
  };
  const repo = createRepo(t, { exemptions: [entry, entry] });
  write(repo, 'docs/README.md', '`nx test ghost`\n');

  const result = run(repo);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /is exempted twice/);
});
