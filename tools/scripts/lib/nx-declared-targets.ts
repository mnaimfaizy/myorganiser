/**
 * The decision behind `nx:targets:check` (`tools/scripts/check-nx-declared-targets.ts`):
 * a ratchet holding Declared Targets on `@nx/*` executors to a fixed baseline,
 * so the count can only shrink toward Nx's Inferred Targets (ADR 0082).
 *
 * A target is in scope only when its `project.json` entry names an executor
 * in the `@nx/` namespace. Three shapes are deliberately out of scope and
 * never appear in `classifyDeclaredTargets`'s output:
 *   - `nx:run-commands` targets, which are not Nx-plugin executors at all.
 *   - Third-party executors (`@driimus/nx-plugin-openapi:...`), which carry
 *     no Inferred Target migration path in Nx's own plugin set.
 *   - An override that declares `dependsOn` or `options` with no `executor`
 *     key — that shape configures the Inferred Target rather than replacing
 *     it, since Nx merges the two by target name; it is not a Declared Target.
 *
 * A baseline entry is keyed by project name, target name, and executor
 * together (`keyOf`), so a target that keeps its name but changes executor
 * reads as one baseline entry going stale and one new entry appearing, never
 * as a silent substitution.
 *
 * Debt is an `@nx/*` executor Nx has deprecated in favour of an inferred
 * plugin (ADR 0083, sharpening ADR 0082 decision 1). An `@nx/*` executor Nx
 * still ships as its own answer is not debt, and the file's `notDebt` list
 * names it by executor with a written `reason` and the `source` that shows
 * Nx has not deprecated it. Unlike a baseline entry, each `notDebt` entry is
 * its own decision, which is why it carries a reason. A target on a listed
 * executor is covered, not classified; a listed executor that covers no
 * target is stale, exactly like a baseline entry with no target, so the list
 * cannot outlive the last target that needed it.
 */
import { join } from 'node:path';

import { readBaselineEnvelope } from './baseline-file.ts';

export const BASELINE_PATH = join(
  'tools',
  'config',
  'nx-declared-targets-baseline.json',
);
export const SCHEMA_VERSION = 1;
export const NX_EXECUTOR_PREFIX = '@nx/';

/** One `@nx/*` Declared Target, as a baseline entry names it. */
export interface DeclaredTarget {
  project: string;
  target: string;
  executor: string;
}

/** A Declared Target found on the tree, with the `project.json` that declares it. */
export interface ClassifiedTarget extends DeclaredTarget {
  path: string;
}

/** An `@nx/*` executor Nx still ships as its own answer, with why. */
export interface NotDebtExecutor {
  executor: string;
  reason: string;
  source: string;
}

/** The composite key a baseline entry and a classified target are compared by. */
export const keyOf = (entry: DeclaredTarget): string =>
  `${entry.project}::${entry.target}::${entry.executor}`;

export interface ReadBaselineOptions {
  cwd?: string;
  path?: string;
}

export interface DeclaredTargetBaseline {
  baseline: DeclaredTarget[];
  notDebt: NotDebtExecutor[];
}

/**
 * Reads and validates the baseline file, returning `{ baseline, notDebt }`.
 * `notDebt` is optional and defaults to empty. Throws on any error — the
 * caller decides the exit code and message.
 */
export function readBaseline({
  cwd = process.cwd(),
  path = BASELINE_PATH,
}: ReadBaselineOptions = {}): DeclaredTargetBaseline {
  const parsed = readBaselineEnvelope({
    cwd,
    path,
    schemaVersion: SCHEMA_VERSION,
  });

  const seen = new Set<string>();
  const entries: DeclaredTarget[] = [];
  parsed.baseline.forEach((raw, index) => {
    const at = `${path}[${index}]`;
    // A baseline entry is whatever the JSON file holds: every field is read
    // through its own `typeof` guard below rather than trusted.
    const entry = (raw ?? {}) as Record<string, unknown>;
    const project =
      typeof entry.project === 'string' ? entry.project.trim() : '';
    const target = typeof entry.target === 'string' ? entry.target.trim() : '';
    const executor =
      typeof entry.executor === 'string' ? entry.executor.trim() : '';
    if (!project || !target || !executor) {
      throw new Error(
        `${at}: entry requires non-empty "project", "target", and "executor"`,
      );
    }
    if (!executor.startsWith(NX_EXECUTOR_PREFIX)) {
      throw new Error(
        `${at}: executor "${executor}" is not in the ${NX_EXECUTOR_PREFIX} namespace`,
      );
    }
    const key = keyOf({ project, target, executor });
    if (seen.has(key)) {
      throw new Error(
        `${at}: ${project} \`${target}\` (${executor}) is duplicated in the baseline`,
      );
    }
    seen.add(key);
    entries.push({ project, target, executor });
  });

  const notDebt = readNotDebt(parsed.notDebt ?? [], path);
  const notDebtExecutors = new Set(notDebt.map((entry) => entry.executor));
  for (const entry of entries) {
    if (notDebtExecutors.has(entry.executor)) {
      throw new Error(
        `${path}: ${entry.project} \`${entry.target}\` (${entry.executor}) is listed in both "baseline" and "notDebt" — an executor is either debt or not`,
      );
    }
  }
  return { baseline: entries, notDebt };
}

function readNotDebt(raw: unknown, path: string): NotDebtExecutor[] {
  if (!Array.isArray(raw)) {
    throw new Error(`${path}: expected "notDebt" to be an array`);
  }
  const seen = new Set<string>();
  return (raw as unknown[]).map((item, index) => {
    const at = `${path} notDebt[${index}]`;
    const entry = (item ?? {}) as Record<string, unknown>;
    const [executor, reason, source] = ['executor', 'reason', 'source'].map(
      (field) => {
        const value = entry[field];
        return typeof value === 'string' ? value.trim() : '';
      },
    ) as [string, string, string];
    if (!executor || !reason || !source) {
      throw new Error(
        `${at}: entry requires non-empty "executor", "reason", and "source"`,
      );
    }
    if (!executor.startsWith(NX_EXECUTOR_PREFIX)) {
      throw new Error(
        `${at}: executor "${executor}" is not in the ${NX_EXECUTOR_PREFIX} namespace`,
      );
    }
    if (seen.has(executor)) {
      throw new Error(`${at}: executor "${executor}" is duplicated in notDebt`);
    }
    seen.add(executor);
    return { executor, reason, source };
  });
}

/**
 * Every Declared Target on an `@nx/*` executor across the given projects.
 * `projects` is `{ name, path, targets }[]`, `targets` being the raw
 * `project.json` `targets` object.
 */
export interface ProjectTargets {
  name: string;
  path: string;
  /** The raw `project.json` `targets` object. */
  targets?: Record<string, unknown> | null;
}

export function classifyDeclaredTargets(
  projects: readonly ProjectTargets[],
): ClassifiedTarget[] {
  const entries: ClassifiedTarget[] = [];
  for (const project of projects) {
    const targets = project.targets ?? {};
    for (const [target, raw] of Object.entries(targets)) {
      const config = (raw ?? {}) as Record<string, unknown>;
      const executor =
        typeof config.executor === 'string' ? config.executor : undefined;
      if (!executor || !executor.startsWith(NX_EXECUTOR_PREFIX)) continue;
      entries.push({
        project: project.name,
        target,
        executor,
        path: project.path,
      });
    }
  }
  return entries.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

/**
 * Compares the baseline against the classified targets. Targets on a
 * `notDebt` executor are split out as `covered` first; `debt` is the rest.
 * `staleNotDebt` is a `notDebt` entry covering no target. `missing` is a
 * classified target absent from the baseline — a new `@nx/*` Declared Target.
 * `stale` is a baseline entry with no matching classified target — the
 * baseline claiming a target that is no longer there. The baseline can only
 * shrink: an entry can leave it, but nothing here ever grows it silently.
 */
export interface DeclaredTargetComparison {
  debt: ClassifiedTarget[];
  covered: ClassifiedTarget[];
  missing: ClassifiedTarget[];
  stale: DeclaredTarget[];
  staleNotDebt: NotDebtExecutor[];
}

export function compareBaseline(
  baseline: readonly DeclaredTarget[],
  actual: readonly ClassifiedTarget[],
  notDebt: readonly NotDebtExecutor[] = [],
): DeclaredTargetComparison {
  const notDebtExecutors = new Set(notDebt.map((entry) => entry.executor));
  const covered = actual.filter((entry) =>
    notDebtExecutors.has(entry.executor),
  );
  const debt = actual.filter((entry) => !notDebtExecutors.has(entry.executor));
  const baselineKeys = new Set(baseline.map(keyOf));
  const debtKeys = new Set(debt.map(keyOf));
  const missing = debt.filter((entry) => !baselineKeys.has(keyOf(entry)));
  const stale = baseline.filter((entry) => !debtKeys.has(keyOf(entry)));
  const coveredExecutors = new Set(covered.map((entry) => entry.executor));
  const staleNotDebt = notDebt.filter(
    (entry) => !coveredExecutors.has(entry.executor),
  );
  return { debt, covered, missing, stale, staleNotDebt };
}
