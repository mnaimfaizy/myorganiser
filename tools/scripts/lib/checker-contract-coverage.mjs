/**
 * The decision behind `checker-contracts:check`
 * (`tools/scripts/check-checker-contracts.mjs`): a ratchet holding
 * contract-suite coverage for `tools/scripts/check-*.mjs` checkers to a fixed
 * baseline, so the count of untested checkers can only shrink (ADR 0085).
 *
 * ADR 0085's finding is that "state your direction in the header" is not
 * enough — `check-readme.mjs` stated its direction in exactly the fixed form
 * the convention asked for and still had it wrong, because nothing made the
 * claim true. A contract suite is what makes it true. This checker does not
 * grade what a suite asserts; it asserts only that one exists, the same way
 * `check-lint-coverage.mjs` asserts a source file has *a* test, not that the
 * test is any good.
 *
 * Coverage is file adjacency: `tools/scripts/check-x.mjs` "has a contract
 * suite" iff `tools/scripts/check-x.test.mjs` exists. This is the same
 * convention the rest of the checkers already use for their own tests, and
 * it is what `--test` filters on in `tools/scripts/lib/gate-coverage.mjs`.
 *
 * A baseline entry is keyed by the checker's own path — one string, one
 * checker — because unlike `nx-declared-targets-baseline.json` there is no
 * composite fact to key on: a checker either has a suite or it does not.
 * `compareBaseline` reports `missing` (a checker with no suite and no
 * baseline entry — new, untracked debt) and `stale` (a baseline entry naming
 * a checker that is no longer debt, whether because it gained a suite or
 * because the checker itself is gone). Both directions are asserted; neither
 * is omitted, which is the header claim this file's own contract suite
 * (`tools/scripts/check-checker-contracts.test.mjs`) proves true.
 *
 * Deliberately no written-reason opt-out list, unlike
 * `tools/config/gate-coverage-optout.json`. ADR 0085 rejects "not worth
 * testing" as a per-checker judgment call — that is exactly the discretion
 * the baseline exists to remove. Debt is recorded, not excused.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readBaselineEnvelope } from './baseline-file.mjs';

export const BASELINE_PATH = join(
  'tools',
  'config',
  'checker-contract-baseline.json',
);
export const SCHEMA_VERSION = 1;
// `.ts` from ADR 0135's expand step, ahead of any checker actually migrating
// there: a `.replace(/\.mjs$/, '.test.mjs')` on a `check-x.ts` path matches
// nothing and returns the checker's own path unchanged, so `hasContractSuite`
// would test whether the checker itself exists rather than its suite — always
// true — and silently report every `.ts` checker as covered.
export const CHECKER_PATH_PATTERN = /^tools\/scripts\/check-[^/]+\.(mjs|ts)$/;

/** Does `checkerPath` (e.g. `tools/scripts/check-x.mjs` or `check-x.ts`) have a sibling contract suite? */
export function hasContractSuite(
  checkerPath,
  { cwd = process.cwd(), exists = existsSync } = {},
) {
  const testPath = checkerPath.replace(/\.(mjs|ts)$/, '.test.$1');
  return exists(join(cwd, testPath));
}

/** Every checker paired with whether it carries a contract suite. */
export function classifyCheckers(checkers, opts = {}) {
  return checkers.map((checker) => ({
    checker,
    covered: hasContractSuite(checker, opts),
  }));
}

/**
 * Reads and validates the baseline file, returning the array of checker
 * paths it names. Throws on any error — the caller decides the exit code.
 */
export function readBaseline({
  cwd = process.cwd(),
  path = BASELINE_PATH,
} = {}) {
  const parsed = readBaselineEnvelope({
    cwd,
    path,
    schemaVersion: SCHEMA_VERSION,
  });

  const seen = new Set();
  const entries = [];
  parsed.baseline.forEach((entry, index) => {
    const at = `${path}[${index}]`;
    const checker = typeof entry === 'string' ? entry.trim() : '';
    if (!checker) {
      throw new Error(`${at}: entry must be a non-empty checker path`);
    }
    if (
      /\.test\.(mjs|ts)$/.test(checker) ||
      !CHECKER_PATH_PATTERN.test(checker)
    ) {
      throw new Error(
        `${at}: "${checker}" is not a tools/scripts/check-*.{mjs,ts} path`,
      );
    }
    if (seen.has(checker)) {
      throw new Error(`${at}: "${checker}" is duplicated in the baseline`);
    }
    seen.add(checker);
    entries.push(checker);
  });

  return entries;
}

/**
 * Compares the baseline against the classified checkers.
 *
 * `debt` is every checker with no contract suite. `missing` is debt absent
 * from the baseline — new, untracked debt. `stale` is a baseline entry that
 * is no longer debt, whether the checker gained a suite or was removed
 * entirely — both report the same way, exactly like
 * `nx-declared-targets.mjs`'s `stale`. The baseline can only shrink: nothing
 * here ever grows it silently.
 */
export function compareBaseline(baselineCheckers, classified) {
  const debt = classified
    .filter((entry) => !entry.covered)
    .map((entry) => entry.checker);
  const debtSet = new Set(debt);
  const baselineSet = new Set(baselineCheckers);
  const missing = debt.filter((checker) => !baselineSet.has(checker));
  const stale = baselineCheckers.filter((checker) => !debtSet.has(checker));
  return { debt, missing, stale };
}
