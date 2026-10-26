#!/usr/bin/env node
// Asserts Gate Coverage for ESLint: every project that should be linted is
// reachable from the target name the gates actually run.
//
//   node tools/scripts/check-lint-coverage.ts [graphFile] [workspaceRoot]
//
// CI (`nx affected -t lint`) and `.husky/pre-commit` both select targets *named*
// `lint`. A project whose ESLint target carries any other name is not failed by
// those gates — it is skipped, and the run goes green because the project is
// invisible. That is how `libs/auth`, `libs/email-shell`, `tools`, `apps/mobile`,
// and `apps/web-e2e` went unlinted from the day each was created: an
// `@nx/eslint/plugin` rename to `targetName: "eslint:lint"`, carried into the
// repo unremarked by an unrelated feature PR (issue #426).
//
// Fixing `nx.json` closed that instance. This is the standing assertion, because
// the failure is silent by construction: nothing about a green pipeline
// distinguishes "linted and clean" from "never looked at".
//
// A project is in scope if EITHER holds:
//
//   a. Nx reports an ESLint-backed target for it, under any name.
//   b. Its root carries an `eslint.config.*`.
//
// (b) is not redundant. An explicit `project.json` target *replaces* the
// inferred one of the same name rather than merging with it, so a project whose
// `lint` runs something other than ESLint has no ESLint target left in the graph
// at all — it would satisfy (a) vacuously. Reading the config off disk is what
// makes the shadowing case detectable.
//
// For every project in scope, `lint` must exist and must run ESLint.
//
// Out of scope: projects with neither signal. `api-specs` and `app-api-client`
// name a `lint` target that verifies OpenAPI artifacts instead; generated output
// is exempt from ESLint on purpose, and neither carries a config, so neither is
// a finding.
//
// Known gap: a project with no local `eslint.config.*` that inherits the root
// config AND declares a non-ESLint `lint` target is invisible to both signals.
// No project is in that shape today; closing it would mean resolving ESLint's
// own config cascade per project, which costs more than it currently buys.
//
// Exit 0 = every lintable project is in the gate. Exit 1 = drift. Exit 2 = the
// check could not run.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { GraphUnavailableError, loadProjectGraph } from './lib/nx-graph.ts';

const GATE_TARGET = 'lint';
const CONFIG_NAMES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
];

const fail: (msg: string) => never = (msg) => {
  console.error(`lint-coverage: ${msg}`);
  process.exit(2);
};

// Both inputs are overridable so the check itself can be exercised against
// fixtures without an Nx workspace.
const GRAPH_ARG = process.argv[2];
const WORKSPACE_ROOT = resolve(process.argv[3] ?? process.cwd());

// Nx renders an explicit executor target and an inferred one differently, so
// recognise both rather than matching on a single field.
function isEslintTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const { executor, metadata, options } = target as {
    executor?: unknown;
    metadata?: { technologies?: unknown } | null;
    options?: { command?: unknown } | null;
  };
  if (executor === '@nx/eslint:lint') return true;
  const technologies = metadata?.technologies;
  if (Array.isArray(technologies) && technologies.includes('eslint'))
    return true;
  const command = options?.command;
  return /^eslint\b/.test(typeof command === 'string' ? command : '');
}

function hasEslintConfig(projectRoot: string | undefined): boolean {
  if (!projectRoot) return false;
  return CONFIG_NAMES.some((name) =>
    existsSync(join(WORKSPACE_ROOT, projectRoot, name)),
  );
}

let nodes;
try {
  ({ nodes } = loadProjectGraph(GRAPH_ARG));
} catch (error) {
  if (error instanceof GraphUnavailableError) fail(error.message);
  throw error;
}

const findings = [];
let covered = 0;

for (const [name, node] of Object.entries(nodes)) {
  const targets = node.data?.targets ?? {};
  const eslintTargets = Object.keys(targets).filter((t) =>
    isEslintTarget(targets[t]),
  );
  const configured = hasEslintConfig(node.data?.root);

  // Neither signal: generated or config-only projects land here.
  if (eslintTargets.length === 0 && !configured) continue;

  if (eslintTargets.includes(GATE_TARGET)) {
    covered += 1;
    continue;
  }

  if (targets[GATE_TARGET]) {
    const shadowed =
      eslintTargets.length > 0
        ? `shadows \`${eslintTargets.join('`, `')}\``
        : 'shadows the target the ESLint plugin would otherwise infer';
    findings.push(
      `${name}: \`${GATE_TARGET}\` is not ESLint-backed and ${shadowed} — ` +
        `the gate runs the wrong target and the project is never linted`,
    );
  } else if (eslintTargets.length > 0) {
    findings.push(
      `${name}: ESLint runs as \`${eslintTargets.join('`, `')}\`, not \`${GATE_TARGET}\` — ` +
        `\`nx affected -t ${GATE_TARGET}\` cannot see this project`,
    );
  } else {
    findings.push(
      `${name}: has an \`eslint.config.*\` but no \`${GATE_TARGET}\` target — ` +
        `its rules are written and never enforced`,
    );
  }
}

if (findings.length > 0) {
  console.error(
    `lint-coverage: ${findings.length} project(s) can be linted but are outside the gate.`,
  );
  for (const finding of findings) console.error(`  - ${finding}`);
  console.error(
    `lint-coverage: every ESLint target must be named \`${GATE_TARGET}\`. See issue #426.`,
  );
  process.exit(1);
}

console.log(
  `lint-coverage: ${covered} project(s) with an ESLint target, all reachable as \`${GATE_TARGET}\`.`,
);
