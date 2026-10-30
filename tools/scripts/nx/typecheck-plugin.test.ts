// Contract Suite for the typecheck Inferred Target (ADR 0141). The defect worth
// catching is a project the plugin silently leaves without a program to
// compile: a tsconfig it does not recognise, a spec config it drops, a target
// that is never inferred, or a merge with `@nx/vite/plugin` that lets the wrong
// command win. The live-workspace checks at the bottom assert facts about this
// repo's project graph, so a regression in inference fails here rather than as
// a green `typecheck` that compiled nothing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, matchesGlob, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { TargetConfiguration } from '@nx/devkit';

import { loadProjectGraph, type ProjectGraph } from '../lib/nx-graph.ts';
import {
  DEFAULT_TARGET_NAME,
  FALLBACK_CONFIG_NAME,
  GENERATED_TYPES_TARGET,
  PRODUCTION_CONFIG_NAMES,
  SPEC_CONFIG_NAME,
  createNodesV2,
  typecheckConfigsFor,
  typecheckTargetFor,
  type TypecheckPluginOptions,
} from './typecheck-plugin.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const NX_JSON = join(REPO_ROOT, 'nx.json');
const PLUGIN_SOURCE = './tools/scripts/nx/typecheck-plugin.ts';

const CONFIG_NAMES = [
  ...PRODUCTION_CONFIG_NAMES,
  FALLBACK_CONFIG_NAME,
  SPEC_CONFIG_NAME,
];

type CreateNodesFn = (typeof createNodesV2)[1];
type NodesContext = Parameters<CreateNodesFn>[2];
type NodesResult = Awaited<ReturnType<CreateNodesFn>>;

/** Writes each file under `root`, creating parent directories. */
function writeFiles(root: string, files: Record<string, string>) {
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), body);
  }
}

/** A project root holding empty files of the given names, removed after the test. */
function projectRootWith(t: TestContext, names: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'typecheck-plugin-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFiles(
    root,
    Object.fromEntries(names.map((name) => [name, '// fixture\n'])),
  );
  return root;
}

/** A workspace root with the given files, removed after the test. */
function workspaceWith(t: TestContext, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'typecheck-workspace-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFiles(root, files);
  return root;
}

/**
 * Calls the inference function over fixture project.json files. The plugin
 * reads only `workspaceRoot` from its context, so the context is cast down to
 * that one field rather than inventing an `nxJsonConfiguration`.
 */
async function inferNodes(
  files: string[],
  options: TypecheckPluginOptions | undefined,
  workspaceRoot: string,
): Promise<NodesResult> {
  const context = { workspaceRoot } as NodesContext;
  return await createNodesV2[1](files, options, context);
}

/** The `typecheck` target for a fixture project, asserted to exist. */
function targetOf(projectRoot: string, configs: string[]) {
  const target = typecheckTargetFor({ projectRoot, configs });
  assert.ok(target, 'expected a typecheck target for a project with configs');
  return target;
}

// ---------------------------------------------------------------------------
// Fixture contracts: the plugin's inference over real directories.
// ---------------------------------------------------------------------------

test('a lone tsconfig.lib.json is the production program', (t) => {
  const root = projectRootWith(t, ['tsconfig.lib.json']);

  assert.deepEqual(typecheckConfigsFor(root), ['tsconfig.lib.json']);
});

test('a spec config is checked after the production config it sits beside', (t) => {
  const root = projectRootWith(t, ['tsconfig.spec.json', 'tsconfig.lib.json']);

  assert.deepEqual(typecheckConfigsFor(root), [
    'tsconfig.lib.json',
    'tsconfig.spec.json',
  ]);
});

test('apps/mobile shape: app, web and spec programs, in PRODUCTION_CONFIG_NAMES order', (t) => {
  // ADR 0103 makes tsconfig.web.json a second production program, not an alias
  // for the app one. Written in reverse so an order that followed the
  // filesystem's listing rather than the constant would fail.
  const root = projectRootWith(t, [
    'tsconfig.spec.json',
    'tsconfig.web.json',
    'tsconfig.app.json',
  ]);

  assert.deepEqual(typecheckConfigsFor(root), [
    'tsconfig.app.json',
    'tsconfig.web.json',
    'tsconfig.spec.json',
  ]);
});

test('a Next.js app with only tsconfig.json falls back to it, then its spec config', (t) => {
  // apps/web keeps its one production program in tsconfig.json because
  // `next build` reads that file (#1060).
  const root = projectRootWith(t, ['tsconfig.json', 'tsconfig.spec.json']);

  assert.deepEqual(typecheckConfigsFor(root), [
    'tsconfig.json',
    'tsconfig.spec.json',
  ]);
});

test('tsconfig.json beside a production config is an umbrella, never a fourth program', (t) => {
  const root = projectRootWith(t, ['tsconfig.json', 'tsconfig.lib.json']);

  assert.deepEqual(typecheckConfigsFor(root), ['tsconfig.lib.json']);
});

test('a tools-style project with only a spec config compiles that config', (t) => {
  // The `tools` project has no production program, only tsconfig.spec.json.
  const root = projectRootWith(t, ['tsconfig.spec.json']);

  assert.deepEqual(typecheckConfigsFor(root), ['tsconfig.spec.json']);
});

test('a directory with no recognised tsconfig gets no configs and no target', (t) => {
  // No target is invented for a root with nothing to compile.
  const root = projectRootWith(t, ['README.md']);
  const configs = typecheckConfigsFor(root);

  assert.deepEqual(configs, []);
  assert.equal(
    typecheckTargetFor({ projectRoot: 'libs/none', configs }),
    undefined,
  );
});

test('the target runs each config with cache on and a workspace-relative cwd', () => {
  const target = targetOf('apps/mobile', [
    'tsconfig.app.json',
    'tsconfig.spec.json',
  ]);

  assert.equal(target.cache, true);
  assert.equal(target.options.cwd, 'apps/mobile');
  assert.equal(
    isAbsolute(target.options.cwd),
    false,
    'cwd must be relative to the workspace root, not absolute',
  );
  assert.equal(
    target.options.command,
    'tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.spec.json',
  );
});

test('the cache inputs read the project, its dependencies, and the two workspace files a program depends on', () => {
  const inputs = targetOf('libs/core', ['tsconfig.lib.json']).inputs ?? [];

  assert.ok(inputs.includes('default'), 'own files');
  assert.ok(inputs.includes('^production'), 'dependencies public surface');
  // Neither file sits under a project root, so `default` never reaches them.
  // A global `types` or `paths` change in tsconfig.base.json, or a TypeScript
  // or @types bump in yarn.lock, would otherwise keep a stale cache hit.
  assert.ok(
    inputs.includes('{workspaceRoot}/tsconfig.base.json'),
    'tsconfig.base.json carries every paths alias and the global types',
  );
  assert.ok(
    inputs.includes('{workspaceRoot}/yarn.lock'),
    'yarn.lock pins the TypeScript and @types versions',
  );
  // `production` excludes exactly the spec sources and spec config this target
  // compiles, so it must not be the project-files input.
  assert.ok(
    !inputs.includes('production'),
    'the project inputs must be `default`, not `production`',
  );
});

test('dependsOn is generate-types only when the project.json declares it', async (t) => {
  // Two real project.json files through the inference, one declaring the
  // generated-types target and one with no targets block.
  const workspace = workspaceWith(t, {
    'apps/with-gen/project.json': JSON.stringify({
      name: 'with-gen',
      targets: { [GENERATED_TYPES_TARGET]: { command: 'true' } },
    }),
    'apps/with-gen/tsconfig.json': '{}\n',
    'libs/without-gen/project.json': JSON.stringify({ name: 'without-gen' }),
    'libs/without-gen/tsconfig.lib.json': '{}\n',
  });

  const results = await inferNodes(
    ['apps/with-gen/project.json', 'libs/without-gen/project.json'],
    undefined,
    workspace,
  );
  const targetOfRoot = (entry: NodesResult[number]) => {
    const root = dirname(entry[0]);
    return entry[1].projects?.[root]?.targets?.[DEFAULT_TARGET_NAME];
  };
  const [withGen, withoutGen] = results.map(targetOfRoot);

  assert.deepEqual(withGen?.dependsOn, [GENERATED_TYPES_TARGET]);
  assert.equal(Object.hasOwn(withoutGen ?? {}, 'dependsOn'), false);
});

test('the inference glob reaches project.json and never a bare tsconfig, so tools/scripts gets no typecheck target', () => {
  // `tools/scripts` has no project.json, so the plugin never infers a
  // `typecheck` target there, even though Nx's package.json inference still
  // gives it a graph node. Nx passes the plugin only the files this glob
  // matches, so the glob is the whole mechanism: a bare tsconfig root never
  // reaches inference, and a project.json root always does.
  const [pattern] = createNodesV2;

  assert.equal(pattern, '**/project.json');
  assert.equal(matchesGlob('tools/scripts/tsconfig.json', pattern), false);
  assert.equal(matchesGlob('libs/bare/tsconfig.lib.json', pattern), false);
  assert.equal(matchesGlob('libs/a/project.json', pattern), true);
});

test('createNodesV2 yields one entry per project.json, with the target only where a tsconfig exists', async (t) => {
  const workspace = workspaceWith(t, {
    'libs/a/project.json': '{}\n',
    'libs/a/tsconfig.lib.json': '{}\n',
    'libs/a/tsconfig.spec.json': '{}\n',
    'apps/b/project.json': '{}\n',
    'apps/b/tsconfig.json': '{}\n',
    'libs/none/project.json': '{}\n',
  });
  const files = [
    'libs/a/project.json',
    'apps/b/project.json',
    'libs/none/project.json',
  ];

  const results = await inferNodes(files, undefined, workspace);

  assert.deepEqual(
    results.map(([configFile]) => configFile),
    files,
    'entries are keyed by the project.json they were given',
  );

  const [a, b, none] = results.map(([, result]) => result);
  assert.deepEqual(Object.keys(a?.projects ?? {}), ['libs/a']);
  assert.deepEqual(Object.keys(a?.projects?.['libs/a']?.targets ?? {}), [
    DEFAULT_TARGET_NAME,
  ]);
  assert.equal(
    a?.projects?.['libs/a']?.targets?.[DEFAULT_TARGET_NAME]?.options?.command,
    'tsc --noEmit -p tsconfig.lib.json && tsc --noEmit -p tsconfig.spec.json',
  );
  assert.deepEqual(Object.keys(b?.projects ?? {}), ['apps/b']);
  assert.equal(
    b?.projects?.['apps/b']?.targets?.[DEFAULT_TARGET_NAME]?.options?.command,
    'tsc --noEmit -p tsconfig.json',
  );
  assert.equal(
    none?.projects,
    undefined,
    'a tsconfig-less project has no entry',
  );
});

test('options.targetName renames the target, and undefined options keep typecheck', async (t) => {
  const workspace = workspaceWith(t, {
    'libs/a/project.json': '{}\n',
    'libs/a/tsconfig.lib.json': '{}\n',
  });
  const files = ['libs/a/project.json'];

  const renamed = await inferNodes(
    files,
    { targetName: 'typecheck-lib' },
    workspace,
  );
  const defaulted = await inferNodes(files, undefined, workspace);

  const renamedTargets = renamed[0]?.[1].projects?.['libs/a']?.targets ?? {};
  const defaultedTargets =
    defaulted[0]?.[1].projects?.['libs/a']?.targets ?? {};

  assert.deepEqual(Object.keys(renamedTargets), ['typecheck-lib']);
  assert.deepEqual(Object.keys(defaultedTargets), [DEFAULT_TARGET_NAME]);
  assert.equal(DEFAULT_TARGET_NAME, 'typecheck');
});

// ---------------------------------------------------------------------------
// Live-repo checks: facts about THIS workspace, not fixtures.
// ---------------------------------------------------------------------------

/** Repo-relative roots of every committed project.json. */
function trackedProjectRoots(): string[] {
  const result = spawnSync('git', ['ls-files', '--', '*project.json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout
    .split('\n')
    .filter((file) => file.length > 0)
    .map((file) => dirname(file));
}

/** Repo-relative config list for a project root, as the plugin infers it. */
function liveConfigsOf(root: string): string[] {
  return typecheckConfigsFor(join(REPO_ROOT, root));
}

/** A live project's `typecheck` target from the graph, when it has one. */
function liveTypecheckOf(name: string): TargetConfiguration | undefined {
  const node = graph().nodes[name];
  return node?.data.targets[DEFAULT_TARGET_NAME] as
    | TargetConfiguration
    | undefined;
}

// The Nx project graph is loaded once and only when a live check needs it.
let liveGraph: ProjectGraph | undefined;
function graph(): ProjectGraph {
  liveGraph ??= loadProjectGraph(undefined);
  return liveGraph;
}

test('every tracked project.json whose root has a tsconfig infers at least one program', () => {
  // A project with a tsconfig and an empty inferred list is a project whose
  // program is silently never checked, which is the Gate Coverage hole the
  // workspace script closed.
  const checked: string[] = [];
  for (const root of trackedProjectRoots()) {
    const hasTsconfig = CONFIG_NAMES.some((name) =>
      existsSync(join(REPO_ROOT, root, name)),
    );
    if (!hasTsconfig) continue;

    checked.push(root);
    assert.notDeepEqual(
      liveConfigsOf(root),
      [],
      `${root} has a tsconfig but no program is inferred`,
    );
  }

  assert.ok(checked.length > 0, 'no tracked project carries a tsconfig');
});

test('every live project with a tsconfig carries a typecheck target, except the tools/scripts fixed job', () => {
  const nodes = Object.values(graph().nodes);
  const withConfigButNoTarget = nodes
    .filter(
      (node) =>
        liveConfigsOf(node.data.root).length > 0 &&
        !node.data.targets[DEFAULT_TARGET_NAME],
    )
    .map((node) => node.name)
    .sort();

  // `tools/scripts` has a tsconfig and no project.json, so the plugin does
  // not reach it. It is the fixed job `check-typecheck.ts` runs (ADR 0135), and
  // the one exclusion stated by name here rather than left as a silent gap.
  assert.deepEqual(withConfigButNoTarget, ['scripts']);
  const scripts = graph().nodes.scripts;
  assert.equal(scripts?.data.root, 'tools/scripts');
  assert.equal(
    trackedProjectRoots().includes('tools/scripts'),
    false,
    'tools/scripts must stay without a project.json',
  );
});

test('projects with no tsconfig get no typecheck target', () => {
  // The two shared libraries with no tsconfig at all.
  for (const name of ['api-specs', 'app-api-client']) {
    const node = graph().nodes[name];
    assert.ok(node, `${name} is a project node`);
    assert.equal(liveConfigsOf(node.data.root).length, 0, name);
    assert.equal(liveTypecheckOf(name), undefined, name);
  }
});

test('backend typecheck depends on generate-types, so the generated Prisma client exists first', () => {
  const backend = liveTypecheckOf('backend');

  assert.ok(backend, 'backend has a live typecheck target');
  assert.ok(
    Array.isArray(backend.dependsOn) &&
      backend.dependsOn.includes(GENERATED_TYPES_TARGET),
    'backend typecheck must depend on generate-types',
  );
});

test('mobile typecheck compiles app, web and spec, and the plugin wins the merge with @nx/vite/plugin', () => {
  // `@nx/vite/plugin` also infers a `typecheck` for apps/mobile, and the two
  // merge. The command below is this plugin's, so the plugin must be ordered
  // after the vite plugin in `nx.json`: a reorder that let vite win would drop
  // tsconfig.web.json, the program that compiles the `.web` Platform Variants.
  const mobile = liveTypecheckOf('mobile');

  assert.equal(
    mobile?.options.command,
    'tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.web.json && tsc --noEmit -p tsconfig.spec.json',
  );

  const plugins = (
    JSON.parse(readFileSync(NX_JSON, 'utf8')) as {
      plugins: Array<string | { plugin: string }>;
    }
  ).plugins.map((entry) => (typeof entry === 'string' ? entry : entry.plugin));
  const pluginAt = plugins.indexOf(PLUGIN_SOURCE);
  const viteAt = plugins.indexOf('@nx/vite/plugin');

  assert.notEqual(pluginAt, -1, `${PLUGIN_SOURCE} is registered in nx.json`);
  assert.notEqual(viteAt, -1, '@nx/vite/plugin is registered in nx.json');
  assert.ok(
    pluginAt > viteAt,
    'the typecheck plugin must come after @nx/vite/plugin in nx.json',
  );
});
