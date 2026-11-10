/**
 * Balances the blocking E2E lane's shards by duration (ADR 0050, issue #1381).
 *
 * Playwright's own `--shard=k/n` cuts the suite by test **count**, in file
 * order. That put every quick `account-*` and `admin-*` test in shard 1 and
 * the `vault-*` tests in shard 3, so the shards' spec times sat at 76s, 211s
 * and 248s on every run, and the lane waited on the slowest. This module cuts
 * by measured duration instead: each spec file carries a weight from
 * `apps/web-e2e/shard-weights.json`, and files go to shards slowest first,
 * each to the shard with the least weight so far (longest-processing-time
 * first). A shard is a list of whole files, which Playwright receives as
 * anchored file filters.
 *
 * **Every spec file runs.** The file list comes from the test directory on
 * disk, not from the weights file, and a file with no weight is assigned at
 * `DEFAULT_WEIGHT_SECONDS`. A new spec therefore lands in some shard the day
 * it is added, and the weights file only decides which one. The Contract
 * Suite asserts that the disk listing here is the same set of files
 * `playwright test --list` reports, so the two cannot quietly disagree about
 * what a spec file is.
 *
 * The plan is deterministic: the same files, weights and shard count give the
 * same shards on every runner, which is what lets each matrix job compute
 * its own shard with no job in front of it handing the plan out.
 *
 * Run the tests with: node --test tools/scripts/lib/e2e-shard-plan.test.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { escapeRegExp } from './workflow-yaml.ts';

/** The Playwright test directory, relative to the repository root. */
export const E2E_TEST_DIR = 'apps/web-e2e/src/e2e';

/** The committed per-file weights, relative to the repository root. */
export const SHARD_WEIGHTS_FILE = 'apps/web-e2e/shard-weights.json';

/**
 * The weight of a spec file the weights file does not list yet. Ten seconds
 * is about the median file in the measured suite, so a new file neither
 * crowds a shard nor hides in one.
 */
export const DEFAULT_WEIGHT_SECONDS = 10;

/**
 * Playwright's default `testMatch`, `**\/*.@(spec|test).?(c|m)[jt]s?(x)`, as a
 * regular expression over a file name. The config does not override it.
 */
export const SPEC_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/;

/** One shard of the plan: its files, sorted, and their summed weight. */
export interface Shard {
  readonly files: string[];
  readonly seconds: number;
}

/** A `k/n` shard argument, 1-based like Playwright's `--shard`. */
export interface ShardArg {
  readonly current: number;
  readonly total: number;
}

/** Parses `2/4` into `{ current: 2, total: 4 }`, or throws. */
export function parseShardArg(value: string): ShardArg {
  const match = /^(\d+)\/(\d+)$/.exec(value.trim());
  const current = match ? Number(match[1]) : Number.NaN;
  const total = match ? Number(match[2]) : Number.NaN;
  if (!(total >= 1 && current >= 1 && current <= total)) {
    throw new Error(`expected a shard as k/n with 1 <= k <= n, got "${value}"`);
  }
  return { current, total };
}

/**
 * Every spec file under `testDir`, as a POSIX path relative to it, sorted.
 * Helper directories are walked like any other: Playwright would collect a
 * spec file from them too.
 */
export function listSpecFiles(testDir: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && SPEC_FILE.test(entry.name)) {
        files.push(relative(testDir, path).split(sep).join('/'));
      }
    }
  };
  walk(testDir);
  return files.sort();
}

/**
 * Reads the weights file's `files` map. Throws on a weight that is not a
 * finite, non-negative number, because a typo there would otherwise skew a
 * shard silently rather than fail.
 */
export function readShardWeights(path: string): Record<string, number> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const files =
    parsed && typeof parsed === 'object' && 'files' in parsed
      ? (parsed as { files: unknown }).files
      : undefined;
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error(`${path}: expected an object with a "files" map`);
  }
  const weights: Record<string, number> = {};
  for (const [file, seconds] of Object.entries(files)) {
    if (
      typeof seconds !== 'number' ||
      !Number.isFinite(seconds) ||
      seconds < 0
    ) {
      throw new Error(
        `${path}: "${file}" must weigh a non-negative number of seconds`,
      );
    }
    weights[file] = seconds;
  }
  return weights;
}

/** A file's weight: its measured seconds, or the default when unmeasured. */
export function weightOf(
  file: string,
  weights: Readonly<Record<string, number>>,
): number {
  return Object.hasOwn(weights, file) ? weights[file] : DEFAULT_WEIGHT_SECONDS;
}

/**
 * Splits `files` into `total` shards balanced by weight. Heaviest file first,
 * ties by name; each goes to the lightest shard so far, ties to the lowest
 * index. Input order does not matter. A shard can be empty only when there
 * are fewer files than shards.
 */
export function planShards(
  files: readonly string[],
  weights: Readonly<Record<string, number>>,
  total: number,
): Shard[] {
  if (!Number.isInteger(total) || total < 1) {
    throw new Error(`expected a positive whole number of shards, got ${total}`);
  }
  const bins = Array.from({ length: total }, () => ({
    files: [] as string[],
    seconds: 0,
  }));
  const ordered = [...new Set(files)].sort(
    (a, b) =>
      weightOf(b, weights) - weightOf(a, weights) ||
      (a < b ? -1 : a > b ? 1 : 0),
  );
  for (const file of ordered) {
    let lightest = 0;
    for (let i = 1; i < bins.length; i++) {
      if (bins[i].seconds < bins[lightest].seconds) lightest = i;
    }
    bins[lightest].files.push(file);
    bins[lightest].seconds += weightOf(file, weights);
  }
  return bins.map((bin) => ({ files: bin.files.sort(), seconds: bin.seconds }));
}

/**
 * The Playwright CLI filter that selects exactly one spec file. Playwright
 * reads a positional argument as a regular expression over the absolute
 * path, so a bare `vault.spec.ts` would also select `multi-user-vault.spec.ts`;
 * anchoring at a path separator and the end of the string selects only it.
 */
export function fileFilter(file: string): string {
  return `(^|/)${escapeRegExp(file)}$`;
}
