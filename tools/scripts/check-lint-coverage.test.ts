import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECKER = join(
  dirname(fileURLToPath(import.meta.url)),
  'check-lint-coverage.ts',
);

// The three target shapes Nx produces in this workspace, reduced to the fields
// the checker reads. Sampled from a real `nx graph` dump.
const EXPLICIT_ESLINT = { executor: '@nx/eslint:lint' };
const INFERRED_ESLINT = {
  executor: 'nx:run-commands',
  options: { command: 'eslint .' },
  metadata: { technologies: ['eslint'] },
};
const NOT_ESLINT = {
  executor: 'nx:run-commands',
  options: { command: 'node tools/scripts/check-something.mjs' },
};

// Each project is `{ targets, eslintConfig? }`. `eslintConfig: true` writes a
// real `eslint.config.js` into the project root, because the checker reads the
// filesystem as its second scope signal and fixtures must be able to drive it.
interface ProjectSpec {
  targets: Record<string, unknown>;
  eslintConfig?: boolean;
}

interface GraphFixture {
  graphFile: string;
  root: string;
}

function writeWorkspace(
  t: TestContext,
  projects: Record<string, ProjectSpec>,
): GraphFixture {
  const root = mkdtempSync(join(tmpdir(), 'lint-coverage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const nodes: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(projects)) {
    const projectRoot = join('libs', name);
    mkdirSync(join(root, projectRoot), { recursive: true });
    if (spec.eslintConfig) {
      writeFileSync(
        join(root, projectRoot, 'eslint.config.js'),
        'module.exports = [];\n',
      );
    }
    nodes[name] = {
      name,
      data: { root: projectRoot.split('\\').join('/'), targets: spec.targets },
    };
  }

  const graphFile = join(root, 'graph.json');
  writeFileSync(graphFile, JSON.stringify({ graph: { nodes } }));
  return { graphFile, root };
}

function runChecker({ graphFile, root }: GraphFixture) {
  return spawnSync(process.execPath, [CHECKER, graphFile, root], {
    encoding: 'utf8',
  });
}

test('accepts a workspace where every ESLint target is named lint', (t) => {
  const ws = writeWorkspace(t, {
    backend: { targets: { lint: EXPLICIT_ESLINT, test: NOT_ESLINT } },
    auth: { targets: { lint: INFERRED_ESLINT }, eslintConfig: true },
  });

  const result = runChecker(ws);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 project\(s\)/);
});

test('rejects a project whose ESLint target is not named lint', (t) => {
  // The #426 defect: nx.json renamed the inferred target to `eslint:lint`, so
  // `nx affected -t lint` could not see this project at all.
  const ws = writeWorkspace(t, {
    backend: { targets: { lint: EXPLICIT_ESLINT } },
    auth: { targets: { 'eslint:lint': INFERRED_ESLINT }, eslintConfig: true },
  });

  const result = runChecker(ws);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /auth/);
  assert.match(result.stderr, /eslint:lint/);
});

test('rejects a non-ESLint lint target that shadows the inferred one', (t) => {
  // The shape this actually takes in a fixed workspace. An explicit
  // `project.json` target REPLACES the inferred one rather than merging, so
  // there is no second ESLint target left in the graph to compare against —
  // only the config on disk reveals that the project should be linted.
  const ws = writeWorkspace(t, {
    web: { targets: { lint: NOT_ESLINT }, eslintConfig: true },
  });

  const result = runChecker(ws);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /web/);
  assert.match(result.stderr, /shadow/i);
});

test('rejects a configured project with no lint target at all', (t) => {
  const ws = writeWorkspace(t, {
    orphan: { targets: { build: NOT_ESLINT }, eslintConfig: true },
  });

  const result = runChecker(ws);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /orphan/);
  assert.match(result.stderr, /never enforced/);
});

test('ignores projects with neither an ESLint target nor a config', (t) => {
  // `api-specs` and `app-api-client` name a `lint` target that verifies OpenAPI
  // artifacts. Generated output is exempt from ESLint on purpose, so neither
  // project is in scope for this check.
  const ws = writeWorkspace(t, {
    'api-specs': { targets: { lint: NOT_ESLINT } },
    backend: { targets: { lint: EXPLICIT_ESLINT } },
  });

  const result = runChecker(ws);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 project\(s\)/);
});

test('reports every offending project, not just the first', (t) => {
  const ws = writeWorkspace(t, {
    auth: { targets: { 'eslint:lint': INFERRED_ESLINT } },
    tools: { targets: { 'eslint:lint': INFERRED_ESLINT } },
    mobile: { targets: { 'eslint:lint': INFERRED_ESLINT } },
  });

  const result = runChecker(ws);

  assert.equal(result.status, 1);
  for (const name of ['auth', 'tools', 'mobile']) {
    assert.match(result.stderr, new RegExp(name));
  }
});

test('exits 2 when the graph file does not exist', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'lint-coverage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runChecker({ graphFile: join(root, 'absent.json'), root });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /not found/);
});

test('exits 2 when the graph file is not a project graph', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'lint-coverage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const graphFile = join(root, 'graph.json');
  writeFileSync(graphFile, JSON.stringify({ unexpected: true }));

  const result = runChecker({ graphFile, root });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /no project nodes/);
});
