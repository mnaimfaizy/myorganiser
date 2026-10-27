/**
 * The decision behind `checker-contracts:check`
 * (`tools/scripts/check-checker-contracts.ts`): a ratchet holding
 * contract-suite coverage for `tools/scripts/check-*.ts` checkers to a fixed
 * baseline, so the count of untested checkers can only shrink (ADR 0085).
 *
 * ADR 0085's finding is that "state your direction in the header" is not
 * enough — `check-readme.ts` stated its direction in exactly the fixed form
 * the convention asked for and still had it wrong, because nothing made the
 * claim true. A contract suite is what makes it true. This checker does not
 * grade what a suite asserts; it asserts only that one exists, the same way
 * `check-lint-coverage.ts` asserts a source file has *a* test, not that the
 * test is any good.
 *
 * Coverage is file adjacency: `tools/scripts/check-x.ts` "has a contract
 * suite" iff the sibling `tools/scripts/check-x.test.ts` exists. A retired
 * `check-*.mjs` is not classified here; the Meta-Gate rejects it by name
 * (ADR 0135). This is the same
 * convention the rest of the checkers already use for their own tests, and
 * it is what `--test` filters on in `tools/scripts/lib/gate-coverage.ts`.
 *
 * A baseline entry is keyed by the checker's own path — one string, one
 * checker — because unlike `nx-declared-targets-baseline.json` there is no
 * composite fact to key on: a checker either has a suite or it does not.
 * `compareBaseline` reports `missing` (a checker with no suite and no
 * baseline entry — new, untracked debt) and `stale` (a baseline entry naming
 * a checker that is no longer debt, whether because it gained a suite or
 * because the checker itself is gone). Both directions are asserted; neither
 * is omitted, which is the header claim this file's own contract suite
 * (`tools/scripts/check-checker-contracts.test.ts`) proves true.
 *
 * Deliberately no written-reason opt-out list, unlike
 * `tools/config/gate-coverage-optout.json`. ADR 0085 rejects "not worth
 * testing" as a per-checker judgment call — that is exactly the discretion
 * the baseline exists to remove. Debt is recorded, not excused.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readBaselineEnvelope } from './baseline-file.ts';

export const BASELINE_PATH = join(
  'tools',
  'config',
  'checker-contract-baseline.json',
);
export const SCHEMA_VERSION = 1;
// `.ts` only since ADR 0135's contract step. A replace that matches nothing
// returns the checker's own path unchanged, so `hasContractSuite` would test
// whether the checker itself exists rather than its suite — always true — and
// silently report it as covered; it therefore refuses any other extension.
export const CHECKER_PATH_PATTERN = /^tools\/scripts\/check-[^/]+\.ts$/;

export interface ContractSuiteOptions {
  cwd?: string;
  exists?: (path: string) => boolean;
}

/** Does `checkerPath` (e.g. `tools/scripts/check-x.ts`) have a sibling contract suite? */
export function hasContractSuite(
  checkerPath: string,
  { cwd = process.cwd(), exists = existsSync }: ContractSuiteOptions = {},
): boolean {
  if (!checkerPath.endsWith('.ts')) return false;
  const testPath = checkerPath.replace(/\.ts$/, '.test.ts');
  return exists(join(cwd, testPath));
}

export interface ClassifiedChecker {
  checker: string;
  covered: boolean;
}

/** Every checker paired with whether it carries a contract suite. */
export function classifyCheckers(
  checkers: readonly string[],
  opts: ContractSuiteOptions = {},
): ClassifiedChecker[] {
  return checkers.map((checker) => ({
    checker,
    covered: hasContractSuite(checker, opts),
  }));
}

/**
 * Reads and validates the baseline file, returning the array of checker
 * paths it names. Throws on any error — the caller decides the exit code.
 */
export interface ReadBaselineOptions {
  cwd?: string;
  path?: string;
}

export function readBaseline({
  cwd = process.cwd(),
  path = BASELINE_PATH,
}: ReadBaselineOptions = {}): string[] {
  const parsed = readBaselineEnvelope({
    cwd,
    path,
    schemaVersion: SCHEMA_VERSION,
  });

  const seen = new Set<string>();
  const entries: string[] = [];
  parsed.baseline.forEach((entry, index) => {
    const at = `${path}[${index}]`;
    const checker = typeof entry === 'string' ? entry.trim() : '';
    if (!checker) {
      throw new Error(`${at}: entry must be a non-empty checker path`);
    }
    if (/\.test\.ts$/.test(checker) || !CHECKER_PATH_PATTERN.test(checker)) {
      throw new Error(
        `${at}: "${checker}" is not a tools/scripts/check-*.ts path`,
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
 * `nx-declared-targets.ts`'s `stale`. The baseline can only shrink: nothing
 * here ever grows it silently.
 */
export interface BaselineComparison {
  debt: string[];
  missing: string[];
  stale: string[];
}

export function compareBaseline(
  baselineCheckers: readonly string[],
  classified: readonly ClassifiedChecker[],
): BaselineComparison {
  const debt = classified
    .filter((entry) => !entry.covered)
    .map((entry) => entry.checker);
  const debtSet = new Set(debt);
  const baselineSet = new Set(baselineCheckers);
  const missing = debt.filter((checker) => !baselineSet.has(checker));
  const stale = baselineCheckers.filter((checker) => !debtSet.has(checker));
  return { debt, missing, stale };
}
