#!/usr/bin/env node
// Runs every cheap, file-reading Assertion Gate checker (ADR 0043) in one Node
// process, reporting every failure rather than stopping at the first.
//
//   node tools/scripts/run-assertion-gates.ts
//
// Six checkers — readme, OpenAPI artifacts, agent map, vault pages, auth
// pages, and sub-agent sync — ran nowhere, and ADR numbering ran as its own
// `corepack yarn` line; the gate-coverage meta-gate joined them here rather
// than adding a tenth. The environment and feature-index checkers (issue
// #465) were designed alongside this file and wired here from the start.
// Each `corepack yarn` invocation costs roughly 1.3s of process overhead
// against roughly 350ms of actual checker work, so wiring each as its own
// hook line would add about ten seconds to every commit to do about two
// seconds of checking. This is the one line `.husky/pre-commit` calls
// instead.
//
// Each checker still runs as its own `node` subprocess rather than an
// in-process import: several call `process.exit` directly on failure, which
// would kill the aggregate itself before the remaining checkers ran. The
// per-check npm scripts remain for isolated runs.
//
// The manifest (tools/scripts/lib/gate-manifest.ts) is asserted against
// package.json before anything runs: a checker quietly dropped from it would
// be exactly the unwired-gate defect this file exists to close.
//
// CI runs this as one step over the whole tree rather than one named step per
// checker (ADR 0043, issue #1389): under `GITHUB_ACTIONS`, each gate's output
// is wrapped in its own collapsible `::group::` and a failing gate raises its
// own named `::error` annotation, so one step stays as readable as the ~33
// named steps it replaced. Outside Actions — Husky's pre-commit hook — the
// output is unchanged.
//
// Exit 0 = every checker passed. Exit 1 = at least one checker found drift.
// Exit 2 = the manifest itself no longer matches package.json / disk.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GATE_MANIFEST,
  assertManifestAgainstDisk,
  runGateManifest,
} from './lib/gate-manifest.ts';
import { formatGateResult } from './lib/gate-run-output.ts';

const cwd = process.cwd();
const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};

const manifestCheck = assertManifestAgainstDisk(GATE_MANIFEST, { cwd, pkg });
if (!manifestCheck.ok) {
  console.error(
    'gates: the aggregate manifest no longer matches package.json / disk\n',
  );
  for (const finding of manifestCheck.findings) console.error(`  - ${finding}`);
  console.error(
    '\nA checker dropped from this manifest is silently unwired (ADR 0043).' +
      ' Fix tools/scripts/lib/gate-manifest.ts or package.json, whichever is wrong.',
  );
  process.exit(2);
}

const results = runGateManifest(GATE_MANIFEST, { cwd });
const inActions = process.env.GITHUB_ACTIONS === 'true';

let failed = 0;
for (const result of results) {
  const formatted = formatGateResult(result, { inActions });
  if (formatted.groupStart) console.log(formatted.groupStart);
  if (formatted.isFailure) {
    failed += 1;
    for (const line of formatted.body) console.error(line);
  } else {
    for (const line of formatted.body) console.log(line);
  }
  if (formatted.groupEnd) console.log(formatted.groupEnd);
  if (formatted.errorAnnotation) console.log(formatted.errorAnnotation);
}

console.log(
  `\ngates: ${results.length - failed}/${results.length} checks passed`,
);

process.exit(failed > 0 ? 1 : 0);
