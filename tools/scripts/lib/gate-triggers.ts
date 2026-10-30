/**
 * The decision behind path-gated heavy suites (ADR 0140): which of CI's
 * expensive `Test` steps a pull request's changed paths actually select.
 *
 * A single-library pull request used to pay for every heavy suite in the
 * `Test` job — `tools:test` at about 34s, the Upstream Brief and checker
 * contracts, and `openapi:check` at about 44s including a Java toolchain
 * setup — none of which its change could break. The globs that decide live
 * in `tools/config/gate-triggers.json` rather than in an `if:` expression
 * written by hand per step, for the reason `lib/glob.ts` gives for its own
 * contents: a rule with two copies drifts, and the drift is silent. One
 * config is also what `covering-gates:check` can read to assert the gate a
 * review obligation names still runs on every change it covers (ADR 0074).
 *
 * Three rules carry the risk here, and the fallback in each is to run more
 * rather than less:
 *
 *   1. **A shared input selects every suite.** A change to a workflow file,
 *      `package.json`, `yarn.lock`, `tsconfig.base.json`, `nx.json`, or this
 *      config itself has repo-wide reach, so no per-suite glob can be trusted
 *      to bound it.
 *   2. **A resolver error selects every suite.** That is the caller's job
 *      (`tools/scripts/ci/resolve-gate-triggers.ts`), but it is the reason
 *      this module throws on a malformed config instead of quietly treating
 *      an unreadable suite list as an empty one — an empty suite list would
 *      skip everything, which is the one outcome that must never follow from
 *      a bug in here.
 *   3. **Skipping a suite never skips a gate.** The cheap, file-reading
 *      Assertion Gates run over the whole tree on every pull request through
 *      `yarn gates:run` (ADR 0043). What a path gate can skip is a Contract
 *      Suite, which proves a checker works, and a drift check whose inputs
 *      the pull request did not touch.
 *
 * Pure: every input is passed in, so the Contract Suite exercises fixtures.
 * Only `readGateTriggers` touches disk.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { errorMessage } from './error-message.ts';
import { globToRegExp } from './glob.ts';

export const GATE_TRIGGERS_PATH = 'tools/config/gate-triggers.json';
export const GATE_TRIGGERS_SCHEMA_VERSION = 1;

/** One heavy suite, and the changed paths that select it. */
export interface GateTriggerSuite {
  /**
   * The gate's name, spelled as a review obligation's `coveringGate` spells
   * it (ADR 0098) — `openapi:check`, not `openapi`. `covering-gates:check`
   * matches on this.
   */
  id: string;
  /** The step this suite is, asserted by the workflow-shape suite. */
  ciStep: string;
  /**
   * The job `ciStep` lives in, when it is not `test`. Most heavy suites are
   * a step inside the `Test` job, so this is omitted there; a suite with a
   * cost worth skipping the job for entirely — the Postgres service the
   * Prisma migration drift check needs — carries its own job instead (ADR
   * 0140, issue #1394), and this is how the workflow-shape suite knows where
   * to look for `ciStep`.
   */
  job?: string;
  /** Why these globs, in the config rather than in a code comment. */
  why: string;
  triggers: string[];
}

export interface GateTriggerConfig {
  schemaVersion: number;
  /** Globs whose change selects every suite, whatever the per-suite globs say. */
  sharedInputs: string[];
  suites: GateTriggerSuite[];
}

/**
 * The GitHub Actions step-output name for a suite.
 *
 * A gate name is not a legal output name — `tools:test` carries a colon — so
 * the mapping is derived here rather than written a second time in the
 * config, where it could disagree with the workflow.
 */
export function flagName(id: string): string {
  return `run_${id.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

/** The output name the all-suites fallback sets. */
export const RUN_ALL_FLAG = 'run_all';

const requireGlobList = (value: unknown, where: string): string[] => {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${where}: expected a non-empty array of globs`);
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim())
      throw new Error(`${where}: a glob is a non-empty string`);
  }
  return value as string[];
};

/**
 * Validates a parsed config, throwing on anything a resolver could not act
 * on. Duplicate suite ids and duplicate flag names both fail: two suites
 * whose names collapse to one output flag would silently share a decision.
 */
export function parseGateTriggers(raw: unknown): GateTriggerConfig {
  const config = raw as Partial<GateTriggerConfig> | null;
  if (!config || typeof config !== 'object')
    throw new Error(`${GATE_TRIGGERS_PATH}: expected a JSON object`);
  if (config.schemaVersion !== GATE_TRIGGERS_SCHEMA_VERSION)
    throw new Error(
      `${GATE_TRIGGERS_PATH}: expected "schemaVersion": ${GATE_TRIGGERS_SCHEMA_VERSION}, found ${JSON.stringify(config.schemaVersion)}`,
    );
  const sharedInputs = requireGlobList(
    config.sharedInputs,
    `${GATE_TRIGGERS_PATH}: sharedInputs`,
  );
  if (!Array.isArray(config.suites) || config.suites.length === 0)
    throw new Error(
      `${GATE_TRIGGERS_PATH}: expected a non-empty "suites" array`,
    );

  const ids = new Set<string>();
  const flags = new Set<string>();
  const suites: GateTriggerSuite[] = config.suites.map((entry, index) => {
    const where = `${GATE_TRIGGERS_PATH}: suites[${index}]`;
    const suite = entry as Partial<GateTriggerSuite> | null;
    if (!suite || typeof suite !== 'object')
      throw new Error(`${where}: expected an object`);
    if (typeof suite.id !== 'string' || !suite.id.trim())
      throw new Error(`${where}: id is the gate name a coveringGate spells`);
    if (typeof suite.ciStep !== 'string' || !suite.ciStep.trim())
      throw new Error(`${where}: ${suite.id}: ciStep names the Test job step`);
    if (
      suite.job !== undefined &&
      (typeof suite.job !== 'string' || !suite.job.trim())
    )
      throw new Error(
        `${where}: ${suite.id}: job, when given, is a non-empty string`,
      );
    if (typeof suite.why !== 'string' || !suite.why.trim())
      throw new Error(
        `${where}: ${suite.id}: why records the reason for these globs`,
      );
    if (ids.has(suite.id))
      throw new Error(`${where}: duplicate suite id ${suite.id}`);
    ids.add(suite.id);
    const flag = flagName(suite.id);
    if (flag === RUN_ALL_FLAG)
      throw new Error(
        `${where}: ${suite.id} collapses to the reserved output ${RUN_ALL_FLAG}`,
      );
    if (flags.has(flag))
      throw new Error(
        `${where}: ${suite.id} collapses to output ${flag}, which another suite already uses`,
      );
    flags.add(flag);
    return {
      id: suite.id,
      ciStep: suite.ciStep,
      ...(suite.job !== undefined ? { job: suite.job } : {}),
      why: suite.why,
      triggers: requireGlobList(
        suite.triggers,
        `${where}: ${suite.id}: triggers`,
      ),
    };
  });

  return {
    schemaVersion: GATE_TRIGGERS_SCHEMA_VERSION,
    sharedInputs,
    suites,
  };
}

/** Reads and validates the live config. Throws; callers decide the fallback. */
export function readGateTriggers({
  cwd = process.cwd(),
}: { cwd?: string } = {}): GateTriggerConfig {
  const absolute = join(cwd, GATE_TRIGGERS_PATH);
  if (!existsSync(absolute))
    throw new Error(
      `${GATE_TRIGGERS_PATH} not found — the gate-trigger config is required`,
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    throw new Error(
      `${GATE_TRIGGERS_PATH} is not valid JSON: ${errorMessage(error)}`,
    );
  }
  return parseGateTriggers(parsed);
}

export interface SuiteDecision {
  id: string;
  flag: string;
  run: boolean;
  /** Why, for the step summary: the glob and the path that matched it. */
  reason: string;
}

export interface TriggerResolution {
  /** `true` when a shared input changed, or when every suite runs for another reason. */
  all: boolean;
  /** The shared-input globs a changed path matched, sorted and de-duplicated. */
  sharedInputs: string[];
  suites: SuiteDecision[];
}

const normalize = (path: string): string =>
  path.replace(/\\/g, '/').replace(/^\.\//, '');

const firstMatch = (
  globs: readonly string[],
  paths: readonly string[],
): { glob: string; path: string } | null => {
  for (const glob of globs) {
    const re = globToRegExp(glob);
    for (const path of paths) if (re.test(path)) return { glob, path };
  }
  return null;
};

/**
 * Which suites a pull request's changed paths select.
 *
 * `all` short-circuits the per-suite globs: when a shared input changed, or
 * when the caller asks for everything (a push to `main`, a resolver error),
 * every suite runs and carries the shared reason.
 */
export function resolveSuites({
  config,
  changedPaths,
  all = false,
}: {
  config: GateTriggerConfig;
  changedPaths: readonly string[];
  all?: boolean;
}): TriggerResolution {
  const paths = changedPaths.map(normalize).filter(Boolean);
  const matchedShared = [
    ...new Set(
      config.sharedInputs.filter((glob) => {
        const re = globToRegExp(glob);
        return paths.some((path) => re.test(path));
      }),
    ),
  ].sort();

  if (all || matchedShared.length > 0) {
    const reason = matchedShared.length
      ? `shared input changed: ${matchedShared.join(', ')}`
      : 'every suite requested';
    return {
      all: true,
      sharedInputs: matchedShared,
      suites: config.suites.map((suite) => ({
        id: suite.id,
        flag: flagName(suite.id),
        run: true,
        reason,
      })),
    };
  }

  return {
    all: false,
    sharedInputs: [],
    suites: config.suites.map((suite) => {
      const hit = firstMatch(suite.triggers, paths);
      return {
        id: suite.id,
        flag: flagName(suite.id),
        run: hit !== null,
        reason: hit
          ? `${hit.path} matches ${hit.glob}`
          : 'no changed path matches its triggers',
      };
    }),
  };
}

/**
 * The resolution as GitHub Actions `name=value` lines, `run_all` first.
 *
 * One format, written once: the workflow appends this to `$GITHUB_OUTPUT`
 * verbatim and also prints it to the step summary, so what a reader sees in
 * the log is what the conditions were evaluated against.
 */
export function formatFlags(resolution: TriggerResolution): string {
  return [
    `${RUN_ALL_FLAG}=${resolution.all}`,
    ...resolution.suites.map((suite) => `${suite.flag}=${suite.run}`),
  ].join('\n');
}
