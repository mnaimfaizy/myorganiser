#!/usr/bin/env node
// Asserts that a path-gated Covering Gate still runs on every change it
// covers (ADR 0140, ADR 0074).
//
//   node tools/scripts/check-covering-gates.ts [--print]
//
// ADR 0074's rule is that a gate suppresses a finding only when something
// runs it, and the reviewer establishes that by reading a hook, a workflow
// job, or the `yarn gates:run` manifest for the gate's script name. Once a
// heavy suite is path-gated (ADR 0140), reading the name stops being enough:
// the step is there, the workflow does invoke it, and its `if:` was false for
// this pull request. The reviewer would record `wiredBy` truthfully and
// suppress the finding anyway — which is the
// `release-bump-leaves-generated-client-stale` incident, reintroduced through
// a trigger glob instead of a missing hook line.
//
// What it reads: `tools/config/review-obligations.json` for every
// `coveringGate` the catalogue names (ADR 0098), and
// `tools/config/gate-triggers.json` for the suites that are path-gated.
//
// What it asserts (both directions it can): every obligation trigger path
// whose Covering Gate is path-gated is covered by that suite's own triggers
// or by a shared input; and a Covering Gate named only through a non-path
// trigger is not path-gated at all, since there is no path to compare.
//
// What it deliberately omits, and why: a suite in the gate-trigger config
// that no obligation names is not a defect — a heavy suite need not be
// anyone's Covering Gate. Whether a gate is invoked by any pipeline at all
// is `gates:coverage:check`, and whether a `coveringGate` names a real npm
// script is the obligation catalogue's own validation; repeating either here
// would report one defect in two places.
//
// The comparison itself is pure in tools/scripts/lib/covering-gates.ts.
//
// Exit 0 = every path-gated Covering Gate covers its obligation's triggers.
// Exit 1 = at least one does not. Exit 2 = cannot run.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertCoveringGates,
  collectCoveringGateSites,
} from './lib/covering-gates.ts';
import { errorMessage } from './lib/error-message.ts';
import {
  readGateTriggers,
  type GateTriggerConfig,
} from './lib/gate-triggers.ts';

const OBLIGATIONS_PATH = 'tools/config/review-obligations.json';

const cwd = process.cwd();
const printOnly = process.argv.includes('--print');

const fail: (message: string) => never = (message) => {
  console.error(`covering-gates: ${message}`);
  process.exit(2);
};

const readObligations = (): unknown[] => {
  try {
    const parsed = JSON.parse(
      readFileSync(join(cwd, OBLIGATIONS_PATH), 'utf8'),
    ) as { obligations?: unknown };
    if (!Array.isArray(parsed.obligations))
      throw new Error('expected an "obligations" array');
    return parsed.obligations;
  } catch (error) {
    return fail(`${OBLIGATIONS_PATH}: ${errorMessage(error)}`);
  }
};

const readConfig = (): GateTriggerConfig => {
  try {
    return readGateTriggers({ cwd });
  } catch (error) {
    return fail(errorMessage(error));
  }
};

const obligations = readObligations();
const config = readConfig();

const sites = collectCoveringGateSites(obligations);
const { ok, findings, checked } = assertCoveringGates({ sites, config });

if (printOnly) {
  console.log(
    `covering gates named by ${OBLIGATIONS_PATH}: ${
      new Set(sites.map((site) => site.coveringGate)).size
    }`,
  );
  console.log(
    `path-gated suites: ${config.suites.map((s) => s.id).join(', ')}`,
  );
  for (const entry of checked) {
    console.log(
      `  ${entry.gate} must cover ${entry.glob} (${entry.obligationId})`,
    );
  }
  process.exit(ok ? 0 : 1);
}

if (!ok) {
  console.error(
    'covering-gates: a path-gated Covering Gate does not cover its review obligation\n',
  );
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log(
  `covering-gates: ${checked.length} obligation trigger(s) covered by their path-gated Covering Gate`,
);
