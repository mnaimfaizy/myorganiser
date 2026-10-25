/**
 * The decision behind `gates:coverage:check` (`tools/scripts/check-gate-coverage.mjs`):
 * which `check-*.mjs` scripts are Wired Gates, and which run nowhere.
 *
 * ADR 0043's corollary is that a gate nobody runs asserts nothing, so a
 * checker no pipeline invokes is a defect of the same class as a checker that
 * is wrong. Nine checkers were in that state when #438 was designed, and one
 * of them had been failing on `main` for days with nobody watching.
 *
 * Three rules carry all the risk here, and each one is a mistake already made:
 *
 *   1. **Detection is by filename**, `check-*.mjs` in the scripts directory —
 *      never by a `*:check` script-name suffix. `openapi:artifacts` and
 *      `component:hygiene` carry no such suffix, and the first is one of the
 *      two unwired checks that motivated the rule. Selecting on a *name* is
 *      also exactly why `check-lint-coverage.mjs` had to exist.
 *   2. **Matching is exact.** During design a substring match on
 *      `yarn openapi:artifacts` also matched `openapi:artifacts:test` and
 *      reported the unwired check as wired. A contract-test script never
 *      satisfies its sibling checker's wiring requirement — running the
 *      contracts proves the checker works, not that anything runs it.
 *   3. **Indirection resolves exactly one level.** The pre-commit hook calls
 *      one aggregate runner rather than one line per checker (ADR 0043), so a
 *      meta-gate reading only hooks and workflows would report every checker
 *      the aggregate runs as unwired — including on the change that wired
 *      them. A checker the aggregate's manifest names counts as wired, but
 *      only while the aggregate itself is invoked by a pipeline. A manifest
 *      entry that is itself an aggregate is an error, not a recursion.
 *
 * Comments are stripped from pipeline files before matching. Both
 * `.husky/pre-commit` and `.github/workflows/ci.yml` mention gate commands in
 * prose; counting a comment as wiring would mean deleting the run line while
 * its explanation stayed behind left the gate green.
 *
 * Two limits are deliberate, and neither is a bug to be found later:
 *
 *   - Wiring is a text match, so a name inside an `echo` or a step carrying
 *     `if: false` counts. Deciding what a workflow *actually executes* means
 *     evaluating YAML conditions and job graphs; the requirement is the exact
 *     script name in a hook or workflow, and comment stripping already covers
 *     the case that occurs in this repo.
 *   - A nested aggregate is recognised by the shape a runner here has: it
 *     calls `runGateManifest`, or it reads a manifest and spawns. One that
 *     does neither is treated as a leaf, which fails safe — the checkers
 *     behind it report as unwired rather than being laundered as reached.
 *
 * `assertGateCoverage` is pure — every input is passed in, so the contract
 * tests exercise fixtures rather than the repository. `gatherFromDisk` is the
 * only part that reads files.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { GATE_MANIFEST } from './gate-manifest.mjs';

export const SCRIPTS_DIR = 'tools/scripts';
export const OPT_OUT_PATH = 'tools/config/gate-coverage-optout.json';
export const OPT_OUT_SCHEMA_VERSION = 1;
export const AGGREGATE_SCRIPT = 'tools/scripts/run-assertion-gates.mjs';

/**
 * Husky hooks and GitHub workflows — the pipelines that can invoke a gate.
 *
 * Agent hooks (`.cursor/hooks.json`, `.github/hooks/`) are deliberately not
 * pipelines: they fire for one harness's tool calls, so a gate reachable only
 * from there runs for some contributors and never for a commit or a merge.
 */
export const PIPELINE_DIRS = [
  { dir: '.husky', matches: (name) => !name.startsWith('_') },
  { dir: '.github/workflows', matches: (name) => /\.ya?ml$/.test(name) },
];

const normalize = (path) => path.replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * Removes shell and YAML comments. Both use `#`, and both pipeline formats in
 * this repo name gate commands inside comments that must not count as wiring.
 */
export function stripComments(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '$1'))
    .join('\n');
}

/**
 * The `node` invocations a command performs, as `{ script, isTestRunner }`.
 *
 * Flags between `node` and its script are skipped so `node --enable-source-maps
 * x.mjs` still resolves to `x.mjs`. `node --test <file>` is reported as a test
 * runner and never counts as running the file as a checker: `openapi:artifacts:test`
 * runs `check-openapi-artifacts.test.mjs`, which is a contract suite, not a gate.
 *
 * `node --test` accepts more than one file (`node --test a.test.mjs
 * b.test.mjs`), which is how a single Contract Suite script such as
 * `agents:sync:test` runs several files — every trailing non-flag token is
 * reported as its own test-runner run. A non-test invocation keeps the old,
 * narrower behaviour of reporting only the first non-flag token as the
 * script: a trailing argument there is a flag to the checker
 * (`node check-a.mjs --report out.md`), never a second script.
 *
 * `gate-manifest.mjs` has its own `parseNodeSegments`, and these are not the
 * same job. That one reads one package.json command, anchored to `^node` per
 * `&&` segment, and keeps the argument list so the manifest can be compared
 * invocation-for-invocation. This one scans free-form pipeline text, where a
 * `node` call arrives mid-line (`run: node tools/scripts/x.mjs`), and it must
 * tell a checker run from a `--test` run — a distinction the manifest never
 * meets, because no manifest entry is a contract suite.
 */
export function nodeRuns(command) {
  const runs = [];
  // The captured span stops at a newline as well as at a shell metacharacter:
  // a multi-file `node --test a.mjs b.mjs` invocation is always one
  // package.json string (necessarily one line), while pipeline text is
  // free-form YAML/shell where a later, unrelated step's own `node` call
  // sits on a following line with nothing but a newline between it and this
  // one. Capturing across that newline swallowed the next step's tokens —
  // and the literal words of the YAML around it — into this invocation's
  // script list (reported false-wired on a real suite, caught by review).
  const pattern = /\bnode\b([^;&|\n]*)/g;
  for (const match of command.matchAll(pattern)) {
    const tokens = match[1].trim().split(/\s+/).filter(Boolean);
    let index = 0;
    const flags = [];
    while (index < tokens.length && /^-/.test(tokens[index])) {
      flags.push(tokens[index]);
      index += 1;
    }
    if (index >= tokens.length) continue;
    const isTestRunner = flags.some(
      (flag) => flag === '--test' || flag.startsWith('--test='),
    );
    if (!isTestRunner) {
      runs.push({ script: normalize(tokens[index]), isTestRunner: false });
      continue;
    }
    for (; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (/^-/.test(token)) continue;
      runs.push({ script: normalize(token), isTestRunner: true });
    }
  }
  return runs;
}

/**
 * What a pipeline file invokes: package-manager script names matched as whole
 * tokens, scripts run directly through `node`, and suite files run directly
 * through `node --test`.
 */
export function pipelineInvocations(text) {
  const source = stripComments(text);
  const names = new Set();
  const scriptPattern =
    /\b(?:corepack\s+)?(?:yarn|npm|pnpm)\s+(?:run\s+)?([A-Za-z0-9][A-Za-z0-9:@._/-]*)/g;
  for (const [, name] of source.matchAll(scriptPattern)) names.add(name);

  const runs = nodeRuns(source);
  const nodeScripts = new Set(
    runs.filter((run) => !run.isTestRunner).map((run) => run.script),
  );
  const nodeTestScripts = new Set(
    runs.filter((run) => run.isTestRunner).map((run) => run.script),
  );

  return { names, nodeScripts, nodeTestScripts };
}

/** Every `check-*.mjs` in the scripts directory, contract suites excluded. */
export function listCheckers({
  cwd = process.cwd(),
  scriptsDir = SCRIPTS_DIR,
} = {}) {
  const absolute = join(cwd, scriptsDir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith('check-') &&
        entry.name.endsWith('.mjs') &&
        !entry.name.endsWith('.test.mjs'),
    )
    .map((entry) => normalize(`${scriptsDir}/${entry.name}`))
    .sort();
}

/**
 * Every Contract Suite (`*.test.mjs`) anywhere under the scripts directory,
 * `lib/`, `review/`, `ai/`, `ci/`, and `copilot-hooks/` included. A suite is
 * wired or it is not independently of whether the script it tests is a
 * `check-*.mjs` checker (ADR 0135 slice 1) — this list, unlike
 * `listCheckers`, is not filtered to the checker-filename convention.
 */
export function listSuites({
  cwd = process.cwd(),
  scriptsDir = SCRIPTS_DIR,
} = {}) {
  const absolute = join(cwd, scriptsDir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { recursive: true })
    .filter((entry) => entry.endsWith('.test.mjs'))
    .map((entry) => normalize(`${scriptsDir}/${entry}`))
    .sort();
}

/**
 * Reads every input `assertGateCoverage` needs from the working tree.
 * `manifest` defaults to the live aggregate manifest, which is what makes a
 * checker reached only through `yarn gates:run` count as wired.
 */
export function gatherFromDisk({
  cwd = process.cwd(),
  manifest = GATE_MANIFEST,
} = {}) {
  const scriptsDir = SCRIPTS_DIR;
  const optOutPath = OPT_OUT_PATH;
  const aggregateScript = AGGREGATE_SCRIPT;
  const pkgPath = join(cwd, 'package.json');
  const pkgScripts = existsSync(pkgPath)
    ? (JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {})
    : {};

  const pipelines = [];
  for (const { dir, matches } of PIPELINE_DIRS) {
    const absolute = join(cwd, dir);
    if (!existsSync(absolute)) continue;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (!entry.isFile() || !matches(entry.name)) continue;
      pipelines.push({
        path: `${dir}/${entry.name}`,
        text: readFileSync(join(absolute, entry.name), 'utf8'),
      });
    }
  }

  const optOutAbsolute = join(cwd, optOutPath);
  const optOut = existsSync(optOutAbsolute)
    ? readFileSync(optOutAbsolute, 'utf8')
    : null;

  return {
    checkers: listCheckers({ cwd, scriptsDir }),
    suites: listSuites({ cwd, scriptsDir }),
    pkgScripts,
    pipelines,
    optOut,
    optOutPath,
    aggregate: { script: normalize(aggregateScript), manifest },
    readSource: (path) => {
      const absolute = join(cwd, path);
      return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
    },
  };
}

function parseOptOut(raw, optOutPath) {
  if (raw === null || raw === undefined) {
    return {
      entries: [],
      errors: [
        `${optOutPath} not found — the opt-out list is a required artifact, ` +
          'not an optional one. An absent list would silently turn every ' +
          'deliberate non-gate into a failure, or worse, invite the gate to ' +
          'be skipped.',
      ],
    };
  }

  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    return {
      entries: [],
      errors: [`${optOutPath} is not valid JSON: ${error.message}`],
    };
  }

  // The version is read rather than decorative: a future format change must
  // fail loudly here, not be half-understood by an older checker.
  if (parsed?.schemaVersion !== OPT_OUT_SCHEMA_VERSION) {
    return {
      entries: [],
      errors: [
        `${optOutPath}: expected "schemaVersion": ${OPT_OUT_SCHEMA_VERSION}, ` +
          `found ${JSON.stringify(parsed?.schemaVersion)}`,
      ],
    };
  }

  const list = parsed?.optOut;
  if (!Array.isArray(list)) {
    return {
      entries: [],
      errors: [`${optOutPath}: expected an "optOut" array`],
    };
  }

  const errors = [];
  const entries = [];
  const seen = new Set();
  list.forEach((entry, index) => {
    const at = `${optOutPath}[${index}]`;
    const check = typeof entry?.check === 'string' ? entry.check.trim() : '';
    const reason = typeof entry?.reason === 'string' ? entry.reason.trim() : '';
    if (!check) {
      errors.push(`${at}: entry names no checker (\`check\` is required)`);
      return;
    }
    if (!reason) {
      errors.push(
        `${at}: opt-out for \`${check}\` carries no written reason. An opt-out ` +
          'is a decision somebody made; without the reason it is a gap nobody saw.',
      );
      return;
    }
    if (seen.has(check)) {
      errors.push(`${at}: \`${check}\` is opted out twice`);
      return;
    }
    seen.add(check);
    entries.push({ check, reason });
  });

  return { entries, errors };
}

/**
 * Does this source run gates of its own? Either it calls the aggregate helper,
 * or it reads a manifest and spawns — the two shapes a runner takes here. A
 * nested aggregate avoiding both is treated as a leaf, which fails safe: the
 * checkers behind it report unwired instead of being laundered as reached.
 */
function isAggregateSource(source) {
  if (/\brunGateManifest\s*\(/.test(source)) return true;
  return (
    /gate-manifest\.mjs|GATE_MANIFEST/.test(source) &&
    /\bspawn(?:Sync)?\s*\(|\bexecFile(?:Sync)?\s*\(/.test(source)
  );
}

/**
 * Resolves the aggregate runner: whether a pipeline invokes it, and which
 * checkers its manifest reaches. Indirection stops here — a manifest entry
 * that runs a manifest itself is reported as an error rather than followed.
 */
function resolveAggregate({
  aggregate,
  npmScriptsRunning,
  invokedNames,
  invokedPaths,
  readSource,
}) {
  const errors = [];
  const script = normalize(aggregate?.script ?? '');
  const manifest = aggregate?.manifest ?? [];
  const npmScripts = npmScriptsRunning(script);
  const wiredVia = npmScripts.filter((name) => invokedNames.has(name));
  const wired = wiredVia.length > 0 || invokedPaths.has(script);

  const reached = new Set();
  for (const entry of manifest) {
    const entryScript = normalize(entry.script);
    if (entryScript === script) {
      errors.push(
        `${aggregate.script} lists itself in its own manifest (${entry.id}). ` +
          'Indirection resolves exactly one level; a self-referential aggregate is an error.',
      );
      continue;
    }
    const source = readSource(entryScript);
    if (source && isAggregateSource(source)) {
      errors.push(
        `${entryScript} (manifest entry ${entry.id}) runs a gate manifest of its own. ` +
          'Indirection resolves exactly one level; a nested aggregate is an error, not a recursion.',
      );
      continue;
    }
    reached.add(entryScript);
  }

  return { script, wired, wiredVia, reached, errors, npmScripts };
}

/**
 * Decides, for every target in `targets` (checkers or suites), whether some
 * pipeline reaches it — directly, by npm script name, or through the
 * aggregate. Shared between the checker rule and the suite rule so the two
 * are matched by the exact same mechanics (ADR 0135 slice 1): only the
 * `npmScriptsRunning` / `invokedPaths` a caller supplies differ, filtered to
 * non-test or test-runner `node` invocations respectively.
 *
 * Mutates `errors` in place with a contradiction when an opted-out target is
 * actually wired, mirroring the checker rule's existing behaviour.
 */
function classifyTargets({
  targets,
  key,
  npmScriptsRunning,
  invokedNames,
  invokedPaths,
  aggregateState,
  optedOutMap,
  optOutPath,
  errors,
}) {
  const wired = [];
  const unwired = [];
  const optedOut = [];

  for (const target of targets) {
    const npmScripts = npmScriptsRunning(target);
    const via = [];

    for (const name of npmScripts) {
      const files = invokedNames.get(name);
      if (files) via.push({ kind: 'pipeline', name, files });
    }
    const directFiles = invokedPaths.get(target);
    if (directFiles)
      via.push({ kind: 'direct', name: target, files: directFiles });
    if (aggregateState.reached.has(target) && aggregateState.wired) {
      via.push({
        kind: 'aggregate',
        name: aggregateState.wiredVia[0] ?? aggregateState.script,
        files: aggregateState.wiredVia.flatMap(
          (name) => invokedNames.get(name) ?? [],
        ),
      });
    }

    // One record per target: reached both directly and through the aggregate
    // is still one wired target, never two findings that disagree.
    if (via.length > 0) {
      wired.push({ [key]: target, npmScripts, via });
      // Opted out *and* wired is the list disagreeing with the repository, so
      // it fails here rather than printing a note the aggregate would swallow
      // on a green run. Declared non-gates are exempt from this: `not a gate`
      // is a claim about what the script is, not about whether anything runs
      // it, and the monthly model audit is both.
      const entry = optedOutMap.get(target);
      if (entry) {
        errors.push(
          `${optOutPath}: \`${entry.check}\` is opted out ("${entry.reason}") ` +
            `but ${target} is wired via ${via.map((v) => v.name).join(', ')}. ` +
            'Drop the entry or drop the wiring — the list must not disagree ' +
            'with the pipelines.',
        );
      }
      continue;
    }

    const entry = optedOutMap.get(target);
    if (entry) {
      optedOut.push({ [key]: target, ...entry });
      continue;
    }

    unwired.push({ [key]: target, npmScripts });
  }

  return { wired, unwired, optedOut };
}

/**
 * Decides, for every checker and every Contract Suite, whether some pipeline
 * reaches it.
 *
 * Returns `{ exitCode, errors, unwired, wired, optedOut, unwiredSuites,
 * wiredSuites, optedOutSuites, declaredNonGates }`. Exit 0 = every checker
 * and suite is wired or deliberately opted out. Exit 1 = at least one checker
 * or suite runs nowhere, and every one of them is named. Exit 2 = the check
 * could not run: a missing, malformed, or self-contradicting opt-out list, or
 * a nested aggregate.
 */
export function assertGateCoverage({
  checkers = [],
  suites = [],
  pkgScripts = {},
  pipelines = [],
  optOut = null,
  optOutPath = OPT_OUT_PATH,
  aggregate = { script: AGGREGATE_SCRIPT, manifest: [] },
  readSource = () => null,
}) {
  const invokedNames = new Map();
  const invokedPaths = new Map();
  const invokedTestPaths = new Map();
  for (const { path, text } of pipelines) {
    const { names, nodeScripts, nodeTestScripts } = pipelineInvocations(text);
    for (const name of names) {
      if (!invokedNames.has(name)) invokedNames.set(name, []);
      invokedNames.get(name).push(path);
    }
    for (const script of nodeScripts) {
      if (!invokedPaths.has(script)) invokedPaths.set(script, []);
      invokedPaths.get(script).push(path);
    }
    for (const script of nodeTestScripts) {
      if (!invokedTestPaths.has(script)) invokedTestPaths.set(script, []);
      invokedTestPaths.get(script).push(path);
    }
  }

  // An npm script "runs" a checker only when it executes the file itself.
  // `node --test check-x.test.mjs` runs the contracts, never the checker —
  // and, symmetrically, a suite is run only by the `--test` invocations.
  const runsByNpmScript = new Map(
    Object.entries(pkgScripts).map(([name, command]) => [
      name,
      nodeRuns(String(command))
        .filter((run) => !run.isTestRunner)
        .map((run) => run.script),
    ]),
  );
  const testRunsByNpmScript = new Map(
    Object.entries(pkgScripts).map(([name, command]) => [
      name,
      nodeRuns(String(command))
        .filter((run) => run.isTestRunner)
        .map((run) => run.script),
    ]),
  );
  const npmScriptsRunningChecker = (path) =>
    [...runsByNpmScript]
      .filter(([, scripts]) => scripts.includes(path))
      .map(([name]) => name);
  const npmScriptsRunningSuite = (path) =>
    [...testRunsByNpmScript]
      .filter(([, scripts]) => scripts.includes(path))
      .map(([name]) => name);

  const aggregateState = resolveAggregate({
    aggregate,
    npmScriptsRunning: npmScriptsRunningChecker,
    invokedNames,
    invokedPaths,
    readSource,
  });

  const { entries: optOutEntries, errors: optOutErrors } = parseOptOut(
    optOut,
    optOutPath,
  );

  const errors = [...aggregateState.errors, ...optOutErrors];

  // An opt-out entry names a checker or a suite (by filename or path), or the
  // npm script that runs one. `format:check` has no checker file at all,
  // which is why a script name is a legal key: the list records deliberate
  // non-gates, and an entry naming nothing at all is stale config, not an
  // exemption.
  const optedOutCheckers = new Map();
  const optedOutSuites = new Map();
  const declaredNonGates = [];
  for (const entry of optOutEntries) {
    const asPath = normalize(
      entry.check.includes('/') ? entry.check : `${SCRIPTS_DIR}/${entry.check}`,
    );
    if (checkers.includes(asPath)) {
      optedOutCheckers.set(asPath, entry);
      continue;
    }
    if (suites.includes(asPath)) {
      optedOutSuites.set(asPath, entry);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(pkgScripts, entry.check)) {
      const reachedCheckers = (runsByNpmScript.get(entry.check) ?? []).filter(
        (script) => checkers.includes(script),
      );
      const reachedSuites = (testRunsByNpmScript.get(entry.check) ?? []).filter(
        (script) => suites.includes(script),
      );
      if (reachedCheckers.length === 0 && reachedSuites.length === 0) {
        declaredNonGates.push(entry);
      }
      for (const script of reachedCheckers) optedOutCheckers.set(script, entry);
      for (const script of reachedSuites) optedOutSuites.set(script, entry);
      continue;
    }
    errors.push(
      `${optOutPath}: \`${entry.check}\` is neither a checker nor a suite in ` +
        `${SCRIPTS_DIR}/ nor a script in package.json. An opt-out for ` +
        'something that no longer exists hides nothing and rots the list.',
    );
  }

  const checkerResult = classifyTargets({
    targets: checkers,
    key: 'checker',
    npmScriptsRunning: npmScriptsRunningChecker,
    invokedNames,
    invokedPaths,
    aggregateState,
    optedOutMap: optedOutCheckers,
    optOutPath,
    errors,
  });

  const suiteResult = classifyTargets({
    targets: suites,
    key: 'suite',
    npmScriptsRunning: npmScriptsRunningSuite,
    invokedNames,
    invokedPaths: invokedTestPaths,
    aggregateState,
    optedOutMap: optedOutSuites,
    optOutPath,
    errors,
  });

  const exitCode =
    errors.length > 0
      ? 2
      : checkerResult.unwired.length > 0 || suiteResult.unwired.length > 0
        ? 1
        : 0;
  return {
    ok: exitCode === 0,
    exitCode,
    errors,
    unwired: checkerResult.unwired,
    wired: checkerResult.wired,
    optedOut: checkerResult.optedOut,
    unwiredSuites: suiteResult.unwired,
    wiredSuites: suiteResult.wired,
    optedOutSuites: suiteResult.optedOut,
    declaredNonGates,
    aggregate: {
      script: aggregateState.script,
      wired: aggregateState.wired,
      npmScripts: aggregateState.npmScripts,
      reached: [...aggregateState.reached].sort(),
    },
  };
}
