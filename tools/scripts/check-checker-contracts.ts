#!/usr/bin/env node
// Ratchets contract-suite coverage for tools/scripts/check-*.ts checkers
// against a shrink-only baseline, so the count of untested checkers can only
// go down (ADR 0085).
//
//   node tools/scripts/check-checker-contracts.ts [--print]
//
// ADR 0043 already asked a checker's header to state which drift direction(s)
// it asserts. Only 5 of 35 non-test checkers did — and check-readme.ts, the
// one that followed the convention best, stated in exactly the fixed form the
// convention asked for that "drift runs both ways" over code that implements
// one direction. Writing a direction down does not make it true; a contract
// suite proving the checker actually fails on the drift its header claims to
// catch is what makes it true. This gate makes carrying one somebody's job.
//
// A checker "has a contract suite" when tools/scripts/check-x.ts has a
// sibling tools/scripts/check-x.test.ts — the same file-adjacency convention
// this codebase's checkers already use for their own tests. A retired
// `check-*.mjs` is left out: `gates:coverage:check` rejects it by name
// (ADR 0135), and classifying it here would only repeat that failure.
// Thirteen of thirty-five checkers had none on the day this baseline was
// seeded; the baseline records that as debt with a direction of travel, and
// this gate asserts both directions of the ratchet: a checker with no suite
// and no baseline entry is new, untracked debt, and a baseline entry naming a
// checker that is no longer debt (it gained a suite, or the checker itself is
// gone) is stale.
//
// This mirrors tools/scripts/check-nx-declared-targets.ts (ADR 0082)
// deliberately — same ratchet shape, including that a baseline entry
// covering nothing fails as stale. Unlike
// tools/config/gate-coverage-optout.json, there is deliberately no
// written-reason opt-out list: a per-checker "not worth testing" judgment
// call is exactly the discretion this baseline exists to remove.
//
// Exit 0 = every checker without a contract suite is in the baseline, and
// every baseline entry still lacks one. Exit 1 = a checker lacks both a
// suite and a baseline entry, or a baseline entry's checker is no longer
// debt. Exit 2 = the baseline is missing/malformed, or no checkers were found.
import { listCheckers } from './lib/gate-coverage.ts';
import {
  BASELINE_PATH,
  classifyCheckers,
  compareBaseline,
  readBaseline,
} from './lib/checker-contract-coverage.ts';

const cwd = process.cwd();
const printOnly = process.argv.includes('--print');

const fail: (msg: string) => never = (msg) => {
  console.error(`checker-contracts: ${msg}`);
  process.exit(2);
};

let baseline: string[];
try {
  baseline = readBaseline({ cwd });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const checkers = listCheckers({ cwd }).filter((checker) =>
  checker.endsWith('.ts'),
);
if (checkers.length === 0) fail('no check-*.ts checkers found');

const classified = classifyCheckers(checkers, { cwd });
const { debt, missing, stale } = compareBaseline(baseline, classified);

if (printOnly) {
  console.log(
    `checker-contracts: ${baseline.length} baseline entr${baseline.length === 1 ? 'y' : 'ies'} (${BASELINE_PATH})`,
  );
  for (const checker of baseline) console.log(`  baseline: ${checker}`);
  console.log(
    `checker-contracts: ${checkers.length} checker(s) classified, ${debt.length} without a contract suite`,
  );
  for (const { checker, covered } of classified) {
    console.log(`  ${covered ? 'covered' : 'debt'}: ${checker}`);
  }
}

const findings = [];
for (const checker of missing) {
  findings.push(
    `${checker}: no contract suite (expected ${checker.replace(/\.ts$/, '.test.ts')}) ` +
      `and no entry in ${BASELINE_PATH}. A checker with no suite proving it fails on the ` +
      'drift its header claims to catch is an unasserted claim (ADR 0085) — add the ' +
      'suite, or add the checker to the baseline as recorded debt.',
  );
}
for (const checker of stale) {
  findings.push(
    `${BASELINE_PATH}: baseline entry ${checker} has no matching checker without a ` +
      'contract suite — remove the stale entry so the baseline can only shrink.',
  );
}

if (findings.length > 0) {
  console.error(
    'checker-contracts: contract-suite coverage baseline drift (ADR 0085)\n',
  );
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log(
  `checker-contracts: OK — ${checkers.length - debt.length}/${checkers.length} checker(s) carry a ` +
    `contract suite, ${debt.length} tracked as debt in the ${baseline.length}-entry baseline (${BASELINE_PATH})`,
);
