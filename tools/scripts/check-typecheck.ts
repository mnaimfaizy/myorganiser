#!/usr/bin/env node
// Typechecks the whole tree: every project's Inferred Target `typecheck`, plus
// the `tools/scripts` fixed job.
//
//   node tools/scripts/check-typecheck.ts [--tools-scripts-only]
//
// Nothing in CI ran TypeScript before this script existed. `ci.yml` had no
// `typecheck` target, no `tsc`, and no tsconfig reference, and only 1 of 34
// projects even declared a `typecheck` target. Lint cannot see type errors, and
// most projects transform with babel-jest, which strips types without checking
// them — so a type error could reach `main` and stay there. Two did:
// `libs/mobile/feat/auth` carried a TS2559 pair while `apps/mobile/AGENTS.md`
// documented typecheck as part of mobile's gate, and `libs/web/pages/groceries`
// carried four TS2347 errors in its specs. Both were found only by running the
// compiler by hand.
//
// It used to compile all 73 configs itself, in one workspace-level process, on
// every pull request — 200s whatever the diff touched. ADR 0141 moves that work
// onto a per-project Inferred Target so Nx can cache and select it, and leaves
// this script as the whole-tree entry point: `nx run-many -t typecheck` plus
// the one config no project's target owns. The rules that decide which configs a
// project compiles moved with the work, to `tools/scripts/nx/typecheck-plugin.ts`;
// they are not duplicated here.
//
// `tools/scripts/tsconfig.json` is that fixed job. `tools/scripts` carries no
// `project.json` on purpose (ADR 0135); Nx does infer a `scripts` node there
// from its `package.json`, but the plugin keys inference on `project.json`, so
// that node carries no `typecheck` target and `run-many` cannot reach this
// config. CI runs this half as its own step, path-gated on the
// `typecheck:tools-scripts` triggers (ADR 0140) — which is what
// `--tools-scripts-only` is for, under the `yarn typecheck:tools-scripts`
// script name a gate id has to be. When that config's `include` matches no file
// — as it did before ADR 0135's expand step migrated the first script there —
// `tsc` reports TS18003 ("no inputs were found") rather than a type error;
// that is nothing to compile, not a failure, so it is normalized to a pass
// below rather than reported as 1 broken config.
//
// This checker asserts one direction only: a config that does not compile
// fails. It does not assert that every project *has* a `typecheck` target —
// that is a fact about the plugin's inference, and
// `tools/scripts/nx/typecheck-plugin.test.ts` asserts it against the live
// workspace. What this script does assert is that `run-many` had something to
// run: a tree where no project carries the target is a vacuous pass, which is
// the exact defect the script exists for, so it exits 2 rather than 0.
//
// Generated code must exist before this runs. `apps/backend/src/prisma` is
// gitignored, so a fresh checkout has no `@prisma/client` to compile against.
// The backend's inferred target declares `dependsOn: ['generate-types']`, so
// `run-many` generates it; the plugin header explains why that rule reads the
// project's own targets rather than naming the backend.
//
// Exit 0 = every config compiles. Exit 1 = type errors. Exit 2 = the check
// could not run — a missing `tools/scripts/tsconfig.json`, a compiler or an
// `nx` that would not start, an unreadable project list, or a tree where no
// project carries the target at all.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { errorMessage } from './lib/error-message.ts';

/** The one config no project's `typecheck` target owns — see the file header. */
const TOOLS_SCRIPTS_RELATIVE = join('tools', 'scripts', 'tsconfig.json');

/** The Inferred Target name the plugin registers (`nx.json`). */
const TARGET = 'typecheck';

const WORKSPACE_ROOT = resolve(process.cwd());
const TOOLS_SCRIPTS_ONLY = process.argv.includes('--tools-scripts-only');

const fail: (msg: string) => never = (msg) => {
  console.error(`typecheck: ${msg}`);
  process.exit(2);
};

/**
 * Compiles `tools/scripts/tsconfig.json`.
 *
 * @returns the number of type errors, 0 when the config compiles clean
 */
function runToolsScripts(): number {
  if (!existsSync(join(WORKSPACE_ROOT, TOOLS_SCRIPTS_RELATIVE))) {
    fail(`${TOOLS_SCRIPTS_RELATIVE} not found`);
  }

  const result = spawnSync(
    'npx',
    ['tsc', '-p', TOOLS_SCRIPTS_RELATIVE, '--noEmit'],
    {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    },
  );
  if (result.error) {
    fail(`tsc could not run: ${errorMessage(result.error)}`);
  }

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const errors = output.match(/error TS\d+/g) ?? [];

  // TS18003 ("no inputs were found") means this config's `include` matches no
  // file yet, which is nothing to typecheck rather than a type error.
  // Normalized to a pass only when it is the sole diagnostic: any second
  // diagnostic fails the job. It cannot be a *type* error — a config with no
  // inputs has nothing to type-check — but it can be a config-level one, and
  // a broken `tools/scripts/tsconfig.json` that also happens to match no file
  // must not pass as "nothing to do".
  if (errors.length === 1 && errors[0] === 'error TS18003') return 0;
  if (result.status === 0 && errors.length === 0) return 0;

  // Non-zero with no diagnostic is not a type error — it is `tsc` or `npx`
  // failing to run at all (`could not determine executable`, a signal kill,
  // an unwritable cwd). Reporting that as 1 would tell the reader their types
  // are broken when the compiler never looked at them, which is the exact
  // confusion the exit-2 class exists to prevent.
  if (errors.length === 0) {
    fail(
      `tsc exited ${result.status ?? `on signal ${result.signal}`} with no diagnostic: ${output.trim() || 'no output'}`,
    );
  }

  console.error(
    `typecheck: ${errors.length} error(s) in ${TOOLS_SCRIPTS_RELATIVE}.`,
  );
  console.error(`\n  --- ${TOOLS_SCRIPTS_RELATIVE} (${errors.length}) ---`);
  for (const line of output.split('\n')) {
    if (/error TS\d+/.test(line)) console.error(`  ${line.trim()}`);
  }
  console.error(
    `\ntypecheck: reproduce it with \`npx tsc -p ${TOOLS_SCRIPTS_RELATIVE} --noEmit\`.`,
  );
  return errors.length;
}

/**
 * Runs the Inferred Target over every project that carries it.
 *
 * The project list is read first, and an empty one exits 2: `nx run-many`
 * over a target no project has succeeds while checking nothing, and a green
 * result meaning "nothing was looked at" is the defect this script exists for.
 *
 * That probe is also what makes a non-zero `run-many` unambiguous. An `nx`
 * that cannot start, a workspace it cannot read, or a project list it will
 * not print has already exited 2 by then, so the only thing left for a
 * non-zero *exit code* is a failed task — a type error, exit 1. Nx prints its
 * own failure summary naming the project, so nothing is gained by trying to
 * re-derive it from the exit code here.
 *
 * A signal kill is the one case that survives the probe, and it is not a
 * failed task: an OOM kill or a cancelled runner stopped the compiler rather
 * than finding anything wrong, so it joins the could-not-run class the same
 * way the `tsc` branch above treats it.
 *
 * @returns true when every project's target passed
 */
function runNxTargets(): boolean {
  const listed = spawnSync(
    'npx',
    ['nx', 'show', 'projects', '-t', TARGET, '--json'],
    {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    },
  );
  if (listed.error) fail(`nx could not run: ${errorMessage(listed.error)}`);
  if (listed.status !== 0) {
    fail(
      `nx show projects -t ${TARGET} failed: ${listed.stderr?.trim() || 'no output'}`,
    );
  }

  // `--json` so the list is parsed rather than scraped: `nx show projects`
  // formats differently for a terminal than for a pipe, and a format change
  // that silently yielded an empty list would turn the guard below from a
  // vacuous-pass check into the vacuous pass.
  const raw = (listed.stdout ?? '').trim();
  let projects: string[];
  try {
    projects = JSON.parse(
      raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1),
    ) as string[];
  } catch (error) {
    fail(
      `nx show projects -t ${TARGET} did not print a JSON list: ${errorMessage(error)}`,
    );
  }
  if (!Array.isArray(projects) || projects.length === 0) {
    fail(
      `no project has a \`${TARGET}\` target — tools/scripts/nx/typecheck-plugin.ts is not inferring one`,
    );
  }

  const run = spawnSync('npx', ['nx', 'run-many', '-t', TARGET], {
    cwd: WORKSPACE_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (run.error) fail(`nx could not run: ${errorMessage(run.error)}`);
  if (run.status === null) {
    fail(
      `nx run-many -t ${TARGET} was killed on signal ${run.signal} — nothing was type-checked to completion`,
    );
  }

  if (run.status === 0) {
    console.log(
      `typecheck: ${projects.length} project(s) compile clean via \`nx run-many -t ${TARGET}\`.`,
    );
    return true;
  }
  console.error(
    `typecheck: \`nx run-many -t ${TARGET}\` failed — reproduce one with \`npx nx run <project>:${TARGET}\`.`,
  );
  return false;
}

if (TOOLS_SCRIPTS_ONLY) {
  if (runToolsScripts() > 0) process.exit(1);
  console.log(`typecheck: ${TOOLS_SCRIPTS_RELATIVE} compiles clean.`);
  process.exit(0);
}

// Both halves run before either verdict is reported: a type error in
// tools/scripts must not hide one in a project, or the next push fixes the
// first and discovers the second.
const toolsScriptsErrors = runToolsScripts();
const projectsPassed = runNxTargets();

if (toolsScriptsErrors > 0 || !projectsPassed) process.exit(1);

console.log(`typecheck: ${TOOLS_SCRIPTS_RELATIVE} compiles clean.`);
