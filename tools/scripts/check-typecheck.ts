#!/usr/bin/env node
// Typechecks the production and spec programs of every project that has one.
//
// A project's production program is its `tsconfig.lib.json`,
// `tsconfig.app.json`, or `tsconfig.web.json`; a project with none of those is
// compiled from its `tsconfig.json`. A project with no tsconfig of any of these
// names contributes nothing and is not reported.
//
//   node tools/scripts/check-typecheck.ts [graphFile] [workspaceRoot]
//
// Nothing in CI ran TypeScript before this. `.github/workflows/ci.yml` had no
// `typecheck` target, no `tsc`, and no tsconfig reference, and only 1 of 34
// projects even declared a `typecheck` target. Lint cannot see type errors, and
// most projects transform with babel-jest, which strips types without checking
// them — so a type error could reach `main` and stay there. Two did:
// `libs/mobile/feat/auth` carried a TS2559 pair while `apps/mobile/AGENTS.md`
// documented typecheck as part of mobile's gate, and
// `libs/web/pages/groceries` carried four TS2347 errors in its specs. Both were
// found only by running the compiler by hand.
//
// This is a workspace-level script rather than 30-odd new `project.json`
// targets on purpose. Issue #420 has an open decision about executor-based
// targets versus inferred plugin targets, and hand-declaring a target per
// project would prejudge it. It also matches the nine existing
// `check-*.mjs` scripts.
//
// Spec configs are in scope, not just lib/app. The groceries errors lived only
// in `tsconfig.spec.json`, and `.github/agents/test-reviewer.agent.md` already
// tells sub-agents to run `tsc` over the spec config — the repo treated it as a
// real gate, just an unautomated one.
//
// `tools/scripts/tsconfig.json` is a fixed job, not one discovered through the
// Nx project graph (ADR 0135): `tools/scripts` is deliberately not a Declared
// Nx Target, so it is checked whenever the file exists, outside the
// project-node loop below. Before any script migrates there, its `include`
// matches nothing and `tsc` reports TS18003 ("no inputs were found") rather
// than a type error; that is a vacuous pass, not a failure, so it is
// normalized to one below rather than reported as 1 broken config.
//
// Generated code must exist before this runs. `apps/backend/src/prisma` is
// gitignored, so a fresh checkout has no `@prisma/client` to compile against and
// backend reports 33 errors that say nothing about the diff. `backend:test`
// declares that dependency via `dependsOn`; CI runs `backend:generate-types`
// before this step for the same reason.
//
// Exit 0 = every config compiles. Exit 1 = type errors. Exit 2 = the check
// could not run.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';

import { GraphUnavailableError, loadProjectGraph } from './lib/nx-graph.ts';

// A project's production programs. Every one that exists is checked.
//
// `tsconfig.web.json` is a second production program, not an alias for the
// app one. apps/mobile targets React Native and react-native-web, and ADR 0103
// splits its typecheck in two: `tsconfig.app.json` is the native program, with
// no `dom` and the `.web` Platform Variants excluded, and `tsconfig.web.json`
// is the only config that compiles those variants (`crypto.web.ts`,
// `main-web.tsx`) under `moduleSuffixes`. Without it here, the web half would be
// type-checked only when someone ran `mobile:typecheck` by hand.
const PRODUCTION_CONFIG_NAMES = [
  'tsconfig.lib.json',
  'tsconfig.app.json',
  'tsconfig.web.json',
];

// The production program of a project that has none of the above. A Next.js
// app keeps its one program in `tsconfig.json` because that is the file
// `next build` reads, so apps/web has no `tsconfig.app.json`, and
// apps/web-e2e has no other config at all. Matching only the suffixed
// names compiled the web app's specs and nothing else (#1060).
//
// It is a fallback, not a fourth name: beside a production config,
// `tsconfig.json` is the editor's umbrella over the same files.
const FALLBACK_CONFIG_NAME = 'tsconfig.json';

// Checked alongside whichever production program a project has, because
// production code and specs compile under different options.
const SPEC_CONFIG_NAME = 'tsconfig.spec.json';

// Not an Nx project root, so not discovered by the graph loop below — see the
// file header. `tools-scripts` is a synthetic project name for this job; it
// names nothing in the Nx graph.
const TOOLS_SCRIPTS_RELATIVE = join('tools', 'scripts', 'tsconfig.json');

const fail: (msg: string) => never = (msg) => {
  console.error(`typecheck: ${msg}`);
  process.exit(2);
};

const GRAPH_ARG = process.argv[2];
const WORKSPACE_ROOT = resolve(process.argv[3] ?? process.cwd());

let nodes;
try {
  ({ nodes } = loadProjectGraph(GRAPH_ARG));
} catch (error) {
  if (error instanceof GraphUnavailableError) fail(error.message);
  throw error;
}

const jobs = [];
for (const [name, node] of Object.entries(nodes)) {
  const root = node.data?.root;
  if (!root) continue;
  const has = (config: string) =>
    existsSync(join(WORKSPACE_ROOT, root, config));
  const production = PRODUCTION_CONFIG_NAMES.filter(has);
  const configs = [...production];
  if (production.length === 0 && has(FALLBACK_CONFIG_NAME)) {
    configs.push(FALLBACK_CONFIG_NAME);
  }
  if (has(SPEC_CONFIG_NAME)) configs.push(SPEC_CONFIG_NAME);
  for (const config of configs) {
    jobs.push({ name, config, relative: join(root, config) });
  }
}

if (existsSync(join(WORKSPACE_ROOT, TOOLS_SCRIPTS_RELATIVE))) {
  jobs.push({
    name: 'tools-scripts',
    config: 'tsconfig.json',
    relative: TOOLS_SCRIPTS_RELATIVE,
  });
}

if (jobs.length === 0) fail('no project tsconfigs found');

/** One tsconfig to compile: the project it belongs to and its path from the workspace root. */
interface TypecheckJob {
  name: string;
  config: string;
  relative: string;
}

/** A finished job: `status` is tsc's exit code, `errors` the diagnostics counted in `output`. */
interface TypecheckResult extends TypecheckJob {
  status: number | null;
  errors: number;
  output: string;
}

function runTsc(job: TypecheckJob): Promise<TypecheckResult> {
  return new Promise<TypecheckResult>((resolveJob) => {
    const child = spawn('npx', ['tsc', '-p', job.relative, '--noEmit'], {
      cwd: WORKSPACE_ROOT,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (status) => {
      const errors = output.match(/error TS\d+/g) ?? [];
      // TS18003 ("no inputs were found") means this config's `include` matches
      // no file yet — true of `tools/scripts/tsconfig.json` before any script
      // migrates there (ADR 0135) — which is nothing to typecheck, not a type
      // error. Normalized to a pass only when it is the sole diagnostic: a real
      // type error alongside it still fails the job.
      if (errors.length === 1 && errors[0] === 'error TS18003') {
        resolveJob({ ...job, status: 0, errors: 0, output });
        return;
      }
      resolveJob({ ...job, status, errors: errors.length, output });
    });
  });
}

// tsc is single-threaded and each config is independent, so run a pool rather
// than one compiler after another. Capped to keep CI runners from thrashing.
const limit = Math.max(2, Math.min(availableParallelism?.() ?? 4, 8));
const queue = [...jobs];
const results: TypecheckResult[] = [];

await Promise.all(
  Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      results.push(await runTsc(job));
    }
  }),
);

const failed = results
  .filter((r) => r.status !== 0)
  .sort((a, b) => a.relative.localeCompare(b.relative));

if (failed.length > 0) {
  const total = failed.reduce((n, r) => n + r.errors, 0);
  console.error(
    `typecheck: ${total} error(s) across ${failed.length} of ${results.length} config(s).`,
  );
  for (const r of failed) {
    console.error(`\n  --- ${r.relative} (${r.errors}) ---`);
    for (const line of r.output.split('\n')) {
      if (/error TS\d+/.test(line)) console.error(`  ${line.trim()}`);
    }
  }
  console.error(
    `\ntypecheck: reproduce one with \`npx tsc -p <config> --noEmit\`.`,
  );
  process.exit(1);
}

console.log(
  `typecheck: ${results.length} project config(s) compile clean across ${new Set(results.map((r) => r.name)).size} project(s).`,
);
