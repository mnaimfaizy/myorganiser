#!/usr/bin/env node
// Ratchets Declared Targets on `@nx/*` executors against a baseline, so the
// count can only shrink toward Nx's Inferred Targets (ADR 0082).
//
//   node tools/scripts/check-nx-declared-targets.ts [--print]
//
// Nx v23 deprecates executor-based targets in favour of plugin-Inferred
// Targets and removes them in v24. This repo's `project.json` files still
// declare 52 targets on `@nx/*` executors that v24 drops, and every one of
// them already shadows an Inferred Target `nx.json` registers under the same
// name — each target is defined twice. Prose asked contributors not to add
// more and lost once already: `libs/web/pages/vault` was generated with an
// empty `targets` block and a follow-up commit the same day declared `lint`
// and `test` "to match" its siblings. This check is the ratchet prose could
// not be: a target on an `@nx/*` executor that the committed baseline
// (tools/config/nx-declared-targets-baseline.json) does not already name is
// a finding, and a baseline entry with no matching target is a finding too,
// so the baseline can only shrink as later slices remove overrides.
//
// A baseline entry is keyed by project name, target name, and executor
// together — a target that keeps its name but switches executor reads as one
// stale entry and one new one, never a silent substitution.
//
// Not debt, deliberately: a target on an `@nx/*` executor Nx has not
// deprecated — `@nx/js:node` serving a Node app is the case — is covered by
// the baseline file's `notDebt` list, which names the executor with a reason
// and a source (ADR 0083). A `notDebt` entry that covers no target is stale.
//
// Out of scope, deliberately: `nx:run-commands` targets (not an `@nx/*`
// executor), third-party executors such as `@driimus/nx-plugin-openapi`'s
// generator, and an override that sets `options` or `dependsOn` with no
// `executor` key — that shape configures the Inferred Target rather than
// replacing it.
//
// Exit 0 = every `@nx/*` Declared Target matches the baseline exactly.
// Exit 1 = a target not in the baseline, a baseline entry with no
// matching target, or a `notDebt` executor covering no target. Exit 2 = the baseline is missing/malformed, or a tracked
// project.json could not be read.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BASELINE_PATH,
  classifyDeclaredTargets,
  compareBaseline,
  readBaseline,
  type DeclaredTarget,
  type NotDebtExecutor,
  type ProjectTargets,
} from './lib/nx-declared-targets.ts';

const cwd = process.cwd();
const printOnly = process.argv.includes('--print');

const fail: (msg: string) => never = (msg) => {
  console.error(`nx-declared-targets: ${msg}`);
  process.exit(2);
};

let baseline: DeclaredTarget[];
let notDebt: NotDebtExecutor[];
try {
  ({ baseline, notDebt } = readBaseline({ cwd }));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

let files: string[];
try {
  files = execFileSync('git', ['ls-files', '--', '*project.json'], {
    cwd,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f: string) => f.endsWith('project.json'));
} catch (error) {
  fail(
    `git ls-files failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}
if (files.length === 0) fail('no project.json files found');

const projects: ProjectTargets[] = files.map((path) => {
  let json: { name?: string; targets?: Record<string, unknown> | null };
  try {
    json = JSON.parse(readFileSync(join(cwd, path), 'utf8'));
  } catch (error) {
    fail(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { name: json.name ?? path, path, targets: json.targets ?? {} };
});

const { debt, covered, missing, stale, staleNotDebt } = compareBaseline(
  baseline,
  classifyDeclaredTargets(projects),
  notDebt,
);

if (printOnly) {
  console.log(
    `nx-declared-targets: ${baseline.length} baseline entr${baseline.length === 1 ? 'y' : 'ies'} (${BASELINE_PATH})`,
  );
  for (const entry of baseline) {
    console.log(
      `  baseline: ${entry.project} ${entry.target} (${entry.executor})`,
    );
  }
  console.log(
    `nx-declared-targets: ${debt.length} @nx/* Declared Target(s) classified`,
  );
  for (const entry of debt) {
    console.log(
      `  target: ${entry.project} ${entry.target} (${entry.executor}) [${entry.path}]`,
    );
  }
  console.log(
    `nx-declared-targets: ${notDebt.length} notDebt executor(s), covering ${covered.length} target(s)`,
  );
  for (const entry of notDebt) {
    console.log(
      `  notDebt: ${entry.executor} — ${entry.reason} (${entry.source})`,
    );
  }
  for (const entry of covered) {
    console.log(
      `  covered: ${entry.project} ${entry.target} (${entry.executor}) [${entry.path}]`,
    );
  }
}

const findings = [];
for (const entry of missing) {
  findings.push(
    `${entry.project}: target \`${entry.target}\` declares executor \`${entry.executor}\`, ` +
      `which is not in the baseline (${BASELINE_PATH}). A new Declared Target on an ` +
      '@nx/* executor grows the migration debt ADR 0082 asks to shrink — prefer the ' +
      'Inferred Target, or add the entry to the baseline with a decision recorded there.',
  );
}
for (const entry of stale) {
  findings.push(
    `${BASELINE_PATH}: baseline entry ${entry.project} \`${entry.target}\` (${entry.executor}) ` +
      'has no matching target — remove the stale entry so the baseline stays a fact about the tree.',
  );
}

for (const entry of staleNotDebt) {
  findings.push(
    `${BASELINE_PATH}: notDebt entry \`${entry.executor}\` covers no target — remove the ` +
      'stale entry so the list names only executors a project.json still uses.',
  );
}

if (findings.length > 0) {
  console.error(
    'nx-declared-targets: Declared Target baseline drift (ADR 0082)\n',
  );
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log(
  `nx-declared-targets: OK — ${debt.length} @nx/* Declared Target(s) match the ` +
    `${baseline.length}-entry baseline, ${covered.length} target(s) on a not-debt ` +
    `executor (${BASELINE_PATH})`,
);
