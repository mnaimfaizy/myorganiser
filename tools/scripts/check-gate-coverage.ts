#!/usr/bin/env node
// Asserts that every checker in tools/scripts/ is a Wired Gate — invoked by
// some hook or workflow — and names the ones that are not (ADR 0043). Also
// asserts every Contract Suite (`*.test.ts`) under tools/scripts is reached
// by the wired `tools:test` glob, naming each one it does not (ADR 0135), and
// rejects any `check-*.mjs` by name: a checker is TypeScript.
//
//   node tools/scripts/check-gate-coverage.ts
//
// The corollary in ADR 0043 is that a gate that runs nowhere asserts nothing.
// Nine checker scripts were in exactly that state when #438 was designed:
// they existed, they passed, and no pipeline had ever run them. One of the nine
// had been failing on `main` for days with nobody watching, which is the whole
// argument — a green pipeline says nothing about whether a gate looked at
// anything. This is the gate that gates the gates.
//
// The suite rule exists for the same reason one level down: a Contract Suite
// proves a script does what its header claims only while something runs it.
// Four suites and two copilot-hooks suites with no package.json script at all
// were in that state when this rule was added, each waiting on a CI step for
// its own per-suite script. Those scripts are gone (ADR 0135): `tools:test`
// is the one runner, so the suite rule reduces to asserting that it is wired
// and that its glob reaches every suite.
//
// Checkers are found by the `check-*.ts` filename convention, never by a
// `*:check` script-name suffix: `openapi:artifacts` and `component:hygiene`
// carry no such suffix, and the first is one of the two unwired checks that
// motivated the rule. Suites are found by the `*.test.ts` filename convention
// anywhere under tools/scripts, including through lib/, review/, ai/, ci/,
// and copilot-hooks/. Wiring is matched by exact script name — a substring
// match on `yarn openapi:artifacts` also matches a longer script name that
// starts the same way, and reporting an unwired check as wired because some
// other script runs is the exact false pass this file exists to prevent.
//
// A checker the pre-commit hook reaches only through `yarn gates:run` counts
// as wired, resolved through that aggregate's manifest and no deeper. A suite
// counts as wired only when `tools:test`'s own glob reaches it while that
// target is itself wired — resolved from the live glob pattern, not assumed,
// so a pattern narrowed later still fails on the suites it drops. The
// decision itself lives in tools/scripts/lib/gate-coverage.ts; this file is
// IO.
//
// Deliberate non-gates carry an entry with a written reason in
// tools/config/gate-coverage-optout.json.
//
// Exit 0 = every checker is `.ts`, and every checker and suite is wired or
// deliberately opted out. Exit 1 = a `check-*.mjs` exists, or at least one
// checker or suite runs nowhere. Exit 2 = the check could not run.
import {
  OPT_OUT_PATH,
  assertGateCoverage,
  gatherFromDisk,
} from './lib/gate-coverage.ts';

const report = assertGateCoverage(gatherFromDisk());

// The verdict and its exit code both come from the report; this file chooses
// what to print, never what the answer is.
if (report.errors.length) {
  console.error('gate-coverage: the check could not run\n');
  for (const error of report.errors) console.error(`  - ${error}`);
  process.exit(report.exitCode);
}

if (report.rejected.length) {
  console.error(
    'gate-coverage: checker is not TypeScript — check-*.mjs is retired (ADR 0135)\n',
  );
  for (const checker of report.rejected) console.error(`  ${checker}`);
  console.error('\nRename it to `.ts` and give it types.\n');
}

if (
  report.rejected.length ||
  report.unwired.length ||
  report.unwiredSuites.length
) {
  if (report.unwired.length) {
    console.error(
      'gate-coverage: checker is invoked by no hook and no workflow (ADR 0043)\n',
    );
    for (const { checker, npmScripts } of report.unwired) {
      const invocation = npmScripts.length
        ? npmScripts.map((name) => `yarn ${name}`).join(' / ')
        : `node ${checker}`;
      console.error(`  ${checker}`);
      console.error(`    runnable as: ${invocation}`);
    }
  }
  if (report.unwiredSuites.length) {
    console.error(
      `gate-coverage: suite is not reached by the wired \`yarn ${report.globTest.script}\` glob (ADR 0135)\n`,
    );
    for (const { suite } of report.unwiredSuites) {
      console.error(`  ${suite}`);
      console.error(`    runnable as: node --test ${suite}`);
    }
    if (!report.globTest.wired) {
      console.error(
        `\nNote: \`yarn ${report.globTest.script}\` is itself invoked by no pipeline,` +
          '\nso no suite counts as wired.',
      );
    }
  }
  const aggregateScript = report.aggregate.npmScripts[0] ?? 'gates:run';
  console.error(
    '\nA gate that runs nowhere asserts nothing. Wire each checker by its exact' +
      '\nscript name into .husky/pre-commit or a workflow, or declare it in the' +
      '\naggregate manifest (tools/scripts/lib/gate-manifest.ts) so' +
      `\n\`yarn ${aggregateScript}\` runs it. A suite is wired by being a` +
      `\n\`*.test.ts\` file the \`yarn ${report.globTest.script}\` glob reaches. If either` +
      `\nis deliberately not a gate, add an entry to ${OPT_OUT_PATH} with a` +
      '\nwritten reason.',
  );
  if (!report.aggregate.wired) {
    console.error(
      `\nNote: ${report.aggregate.script} is itself invoked by no pipeline, so` +
        '\nnothing its manifest names counts as wired.',
    );
  }
  process.exit(report.exitCode);
}

const throughAggregate = report.wired.filter((entry) =>
  entry.via.some((via) => via.kind === 'aggregate'),
).length;

console.log(
  `gate-coverage: ${report.wired.length} checkers wired ` +
    `(${throughAggregate} reached through \`yarn ${
      report.aggregate.npmScripts[0] ?? 'gates:run'
    }\`), ` +
    `${report.optedOut.length} checkers opted out, ` +
    `${report.declaredNonGates.length} non-gates declared with a reason`,
);

const throughGlob = report.wiredSuites.filter((entry) =>
  entry.via.some((via) => via.kind === 'glob'),
).length;

console.log(
  `gate-coverage: ${report.wiredSuites.length} suites wired ` +
    `(${throughGlob} reached through \`yarn ${report.globTest.script}\`), ` +
    `${report.optedOutSuites.length} suites opted out`,
);
