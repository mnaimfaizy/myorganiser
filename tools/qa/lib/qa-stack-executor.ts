/**
 * Runs the QA stack's plans: `yarn qa:stack:start|stop|status` and
 * `yarn qa:switch` (ADR 0147 decisions 2 and 9).
 *
 * Every rule lives in the pure modules beside this one: `qa-stack.ts`
 * (ports, environment, refusals, the served-commit check) and `qa-switch.ts`
 * (the step plans). This module only gathers facts, asks those modules, and
 * runs the steps they return, through `QaDeps`, so a test can stub the
 * machine: no test starts a stack, touches a database or binds a port.
 *
 * Every refusal is decided before a step runs. Exit 0 = done, 1 = a refusal
 * or a step that failed (including a served-commit mismatch), 2 = bad
 * invocation or a missing dependency (docker, a worktree file).
 */
import { join, resolve } from 'node:path';

import {
  NEXT_DEV_REWRITE,
  QA_SERVICES,
  QA_STACK,
  type QaService,
  type QaStackState,
  SERVICE_COMMAND,
  SERVICE_PORT,
  buildQaEnv,
  composeDatabaseImage,
  portRefusal,
  qaContainerDatabaseUrl,
  renderEnvFile,
  servedCommitProblems,
  stackDatabaseRefusal,
  worktreeRefusal,
} from './qa-stack.ts';
import {
  type Step,
  SwitchPlanError,
  commitFor,
  parseStackArgs,
  parseSwitchArgs,
  planSides,
  planStart,
  planStop,
  planSwitch,
  STACK_USAGE,
  SWITCH_USAGE,
} from './qa-switch.ts';

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** The machine, as the executor sees it. The real one is in `tools/qa/qa-stack.ts`. */
export interface QaDeps {
  /** The repository the tooling runs from; the stack's state lives under it. */
  repoRoot: string;
  /** NODE_ENV of the shell running the tooling: a production host is refused whatever the stack's own env says. */
  nodeEnv: string | undefined;
  /** Runs to completion. `env` is laid over the tooling's own environment. */
  run(
    argv: readonly string[],
    options: { cwd: string; env?: Record<string, string> },
  ): RunResult;
  /** Starts a process as the leader of a new process group; returns its pid (= pgid). */
  spawnDetached(
    argv: readonly string[],
    options: { cwd: string; env: Record<string, string>; logFile: string },
  ): number;
  isGroupAlive(pgid: number): boolean;
  /** Pid listening on a TCP port of this machine, or `null`. */
  listenerPid(port: number): number | null;
  processGroupOf(pid: number): number | null;
  killGroup(pgid: number, signal: 'SIGTERM' | 'SIGKILL'): void;
  readFile(path: string): string | null;
  writeFile(path: string, text: string): void;
  removeFile(path: string): void;
  exists(path: string): boolean;
  /** True for a symbolic link, valid or dangling; false for anything else, including a missing path. */
  isSymlink(path: string): boolean;
  sleep(ms: number): Promise<void>;
  generateSecret(): string;
  out(line: string): void;
  err(line: string): void;
}

export type ExitCode = 0 | 1 | 2;

/** A refusal or failed step: exit 1. */
class StackRefusal extends Error {}
/** Bad invocation or a missing dependency: exit 2. */
class StackUsageError extends Error {}

const DATABASE_WAIT_MS = 60_000;
const PORT_WAIT_MS = {
  backend: 180_000,
  web: 300_000,
} as const satisfies Record<QaService, number>;
const STOP_WAIT_MS = 15_000;
const POLL_MS = 1_000;

function statePath(deps: QaDeps): string {
  return join(deps.repoRoot, QA_STACK.stateDir, 'state.json');
}

function stackFile(deps: QaDeps, name: string): string {
  return join(deps.repoRoot, QA_STACK.stateDir, name);
}

function readState(deps: QaDeps): QaStackState | null {
  const text = deps.readFile(statePath(deps));
  if (text === null) return null;
  try {
    return JSON.parse(text) as QaStackState;
  } catch {
    throw new StackUsageError(
      `${statePath(deps)} is not valid JSON; inspect it, stop what it names by hand, and remove it`,
    );
  }
}

function saveState(deps: QaDeps, state: QaStackState): void {
  deps.writeFile(statePath(deps), `${JSON.stringify(state, null, 2)}\n`);
}

function git(deps: QaDeps, worktree: string, args: string[]): RunResult {
  return deps.run(['git', '-C', worktree, ...args], { cwd: worktree });
}

function gitOk(deps: QaDeps, worktree: string, args: string[]): string {
  const result = git(deps, worktree, args);
  if (result.status !== 0) {
    throw new StackUsageError(
      `git ${args.join(' ')} failed in ${worktree}: ${result.stderr.trim()}`,
    );
  }
  // Only the end: `status --porcelain` lines start with a significant
  // space (" M path"), which a full trim would take off the first one.
  return result.stdout.trimEnd();
}

/** Primary-checkout and uncommitted-change refusals, before anything checks out. */
function refuseUnsafeWorktree(deps: QaDeps, worktree: string): void {
  const [gitDir, gitCommonDir] = gitOk(deps, worktree, [
    'rev-parse',
    '--path-format=absolute',
    '--git-dir',
    '--git-common-dir',
  ]).split('\n');
  const statusPorcelain = gitOk(deps, worktree, ['status', '--porcelain']);
  const refusal = worktreeRefusal({ gitDir, gitCommonDir, statusPorcelain });
  if (refusal) {
    throw new StackRefusal(`refusing the worktree ${worktree}: ${refusal}`);
  }
}

function resolveCommit(deps: QaDeps, worktree: string, sha: string): string {
  const result = git(deps, worktree, [
    'rev-parse',
    '--verify',
    `${sha}^{commit}`,
  ]);
  if (result.status !== 0) {
    throw new StackUsageError(`${sha} is not a commit in ${worktree}`);
  }
  return result.stdout.trim();
}

/** `git diff --quiet` exits 1 when the files differ. */
function lockfileDiffers(
  deps: QaDeps,
  worktree: string,
  from: string,
  to: string,
): boolean {
  const result = git(deps, worktree, [
    'diff',
    '--quiet',
    from,
    to,
    '--',
    'yarn.lock',
  ]);
  if (result.status === 0) return false;
  if (result.status === 1) return true;
  throw new StackUsageError(
    `cannot compare yarn.lock between ${from} and ${to}`,
  );
}

async function waitFor(
  deps: QaDeps,
  timeoutMs: number,
  ready: () => boolean,
): Promise<boolean> {
  for (let waited = 0; ; waited += POLL_MS) {
    if (ready()) return true;
    if (waited >= timeoutMs) return false;
    await deps.sleep(POLL_MS);
  }
}

interface StepContext {
  deps: QaDeps;
  state: QaStackState;
  /** Only while starting the stack's own container. */
  databasePassword?: string;
}

function runOrRefuse(
  deps: QaDeps,
  label: string,
  argv: readonly string[],
  options: { cwd: string; env?: Record<string, string> },
): void {
  const result = deps.run(argv, options);
  if (result.status !== 0) {
    throw new StackRefusal(
      `${label} failed (${argv.join(' ')}):\n${result.stderr.trim()}`,
    );
  }
}

async function stopServices({ deps, state }: StepContext): Promise<void> {
  for (const service of QA_SERVICES) {
    const record = state.services[service];
    if (!record) continue;
    if (deps.isGroupAlive(record.pgid)) {
      deps.killGroup(record.pgid, 'SIGTERM');
      const stopped = await waitFor(
        deps,
        STOP_WAIT_MS,
        () => !deps.isGroupAlive(record.pgid),
      );
      if (!stopped) {
        deps.killGroup(record.pgid, 'SIGKILL');
        const killed = await waitFor(
          deps,
          STOP_WAIT_MS,
          () => !deps.isGroupAlive(record.pgid),
        );
        if (!killed) {
          // Keep the record, so a later stop can still find it.
          throw new StackRefusal(
            `${service} (process group ${record.pgid}) survived SIGKILL; stop it by hand`,
          );
        }
      }
    }
    delete state.services[service];
    saveState(deps, state);
  }
}

async function runStep(step: Step, ctx: StepContext): Promise<void> {
  const { deps, state } = ctx;
  const worktree = state.worktree;
  switch (step.kind) {
    case 'start-database': {
      const image = composeDatabaseImage(
        deps.readFile(join(worktree, 'docker-compose.yml')) ?? '',
      );
      if (!image) {
        throw new StackUsageError(
          'docker-compose.yml names no myorganiser_db image to run',
        );
      }
      runOrRefuse(
        deps,
        'starting the QA database',
        [
          'docker',
          'run',
          '-d',
          '--name',
          QA_STACK.containerName,
          '-p',
          `${QA_STACK.databaseHost}:${QA_STACK.databasePort}:5432`,
          '-e',
          `POSTGRESQL_USERNAME=${QA_STACK.databaseUser}`,
          '-e',
          // By name only: docker reads the value from its own environment,
          // so the password never appears in a process listing.
          'POSTGRESQL_PASSWORD',
          '-e',
          `POSTGRESQL_DATABASE=${QA_STACK.databaseName}`,
          image,
        ],
        {
          cwd: worktree,
          env: { POSTGRESQL_PASSWORD: ctx.databasePassword ?? '' },
        },
      );
      return;
    }
    case 'wait-database': {
      const ready = await waitFor(
        deps,
        DATABASE_WAIT_MS,
        () =>
          deps.run(
            [
              'docker',
              'exec',
              QA_STACK.containerName,
              'pg_isready',
              '-h',
              '127.0.0.1',
              '-p',
              '5432',
              // The image runs as a uid with no user name, so libpq has no
              // default user and pg_isready makes no attempt (exit 3) unless
              // one is given, however ready the server is.
              '-U',
              QA_STACK.databaseUser,
            ],
            { cwd: worktree },
          ).status === 0,
      );
      if (!ready)
        throw new StackRefusal('the QA database did not become ready');
      return;
    }
    case 'stop-services':
      await stopServices(ctx);
      return;
    case 'checkout': {
      // `next dev` rewrites this file on every start; put it back so the
      // checkout cannot be blocked by it. No person's edit lives there: the
      // worktree was refused if anything else was uncommitted.
      const status = gitOk(deps, worktree, [
        'status',
        '--porcelain',
        '--',
        NEXT_DEV_REWRITE,
      ]);
      if (status !== '')
        gitOk(deps, worktree, ['checkout', '--', NEXT_DEV_REWRITE]);
      gitOk(deps, worktree, ['checkout', '--detach', step.commit]);
      return;
    }
    case 'install':
      runOrRefuse(
        deps,
        'installing dependencies',
        ['corepack', 'yarn', 'install', '--immutable'],
        { cwd: worktree },
      );
      return;
    case 'migrate-forward':
      // `migrate deploy` only applies migrations that have not run; it never
      // rolls one back. The plans keep Before ahead of After so it never needs to.
      runOrRefuse(
        deps,
        'migrating forward',
        [
          'corepack',
          'yarn',
          'prisma',
          'migrate',
          'deploy',
          '--schema',
          'prisma/schema',
        ],
        { cwd: join(worktree, 'apps/backend/src'), env: state.env },
      );
      return;
    case 'generate':
      runOrRefuse(
        deps,
        'generating the Prisma client',
        ['corepack', 'yarn', 'prisma', 'generate', '--schema', 'prisma/schema'],
        { cwd: join(worktree, 'apps/backend/src'), env: state.env },
      );
      return;
    case 'seed':
      runOrRefuse(
        deps,
        'seeding the QA Accounts',
        ['node', 'tools/scripts/qa-accounts.ts', 'seed', '--restore'],
        { cwd: worktree, env: state.env },
      );
      return;
    case 'start-services':
      for (const service of QA_SERVICES) {
        const spawnCommit = gitOk(deps, worktree, ['rev-parse', 'HEAD']);
        const pgid = deps.spawnDetached(SERVICE_COMMAND[service], {
          cwd: worktree,
          env: state.env,
          logFile: stackFile(deps, `${service}.log`),
        });
        state.services[service] = {
          pgid,
          spawnCommit,
          port: SERVICE_PORT[service],
        };
        saveState(deps, state);
        const listening = await waitFor(
          deps,
          PORT_WAIT_MS[service],
          () => deps.listenerPid(SERVICE_PORT[service]) !== null,
        );
        if (!listening) {
          throw new StackRefusal(
            `${service} did not listen on port ${SERVICE_PORT[service]}; see ${stackFile(deps, `${service}.log`)}`,
          );
        }
      }
      return;
    case 'check-served-commit': {
      const problems = servedCommitProblems(
        gatherServedFacts(deps, state, step.commit),
      );
      if (problems.length > 0) {
        throw new StackRefusal(
          `the stack is not serving ${step.commit}; run no scenario:\n  - ${problems.join('\n  - ')}`,
        );
      }
      deps.out(`qa: serving ${step.commit}`);
      return;
    }
    case 'remove-database':
      if (state.container) {
        runOrRefuse(
          deps,
          'removing the QA database',
          ['docker', 'rm', '-f', state.container],
          { cwd: deps.repoRoot },
        );
      }
      return;
  }
}

function gatherServedFacts(
  deps: QaDeps,
  state: QaStackState,
  expected: string,
) {
  const worktree = state.worktree;
  const service = (name: QaService) => {
    const record = state.services[name];
    const listener = deps.listenerPid(SERVICE_PORT[name]);
    return {
      record,
      alive: record ? deps.isGroupAlive(record.pgid) : false,
      listenerPgid: listener === null ? null : deps.processGroupOf(listener),
    };
  };
  return {
    expected,
    worktreeHead: gitOk(deps, worktree, ['rev-parse', 'HEAD']),
    statusPorcelain: gitOk(deps, worktree, ['status', '--porcelain']),
    services: { backend: service('backend'), web: service('web') },
  };
}

async function runSteps(steps: Step[], ctx: StepContext): Promise<void> {
  for (const step of steps) await runStep(step, ctx);
}

async function guard(
  deps: QaDeps,
  prefix: string,
  body: () => Promise<ExitCode>,
): Promise<ExitCode> {
  try {
    return await body();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.err(`${prefix}: ${message}`);
    if (error instanceof StackUsageError) return 2;
    return 1;
  }
}

/**
 * The QA stack's Next.js cannot resolve its package through a symlinked
 * `node_modules`, valid or dangling, and the failure shows only in `web.log`.
 */
function refuseSymlinkedNodeModules(deps: QaDeps, worktree: string): void {
  const nodeModules = join(worktree, 'node_modules');
  if (deps.isSymlink(nodeModules)) {
    throw new StackUsageError(
      `${nodeModules} is a symbolic link; the QA stack cannot run from one. Replace it with a real install ("corepack yarn install --immutable") or a copy-on-write clone ("cp -c -R <source>/node_modules ${nodeModules}" on APFS)`,
    );
  }
}

function refusePlan<T>(plan: () => T): T {
  try {
    return plan();
  } catch (error) {
    if (error instanceof SwitchPlanError) throw new StackRefusal(error.message);
    throw error;
  }
}

/** `yarn qa:stack:start` and friends. */
export async function runQaStack(
  argv: readonly string[],
  deps: QaDeps,
): Promise<ExitCode> {
  return guard(deps, 'qa:stack', async () => {
    const args = parseStackArgs(argv);
    if ('error' in args) {
      throw new StackUsageError(
        args.error === STACK_USAGE
          ? STACK_USAGE
          : `${args.error}\n${STACK_USAGE}`,
      );
    }
    if (args.command === 'status') return stackStatus(deps);
    if (args.command === 'stop') return stopStack(deps);

    if (readState(deps)) {
      throw new StackRefusal(
        `a QA stack is already up (${statePath(deps)}); run "yarn qa:stack:stop" first`,
      );
    }
    const worktree = resolve(args.worktree);
    refuseUnsafeWorktree(deps, worktree);
    refuseSymlinkedNodeModules(deps, worktree);
    const mergeBase = resolveCommit(deps, worktree, args.mergeBase);
    const head = resolveCommit(deps, worktree, args.head);
    const ancestry = git(deps, worktree, [
      'merge-base',
      '--is-ancestor',
      mergeBase,
      head,
    ]);
    if (ancestry.status !== 0 && ancestry.status !== 1) {
      throw new StackUsageError(
        `cannot tell whether ${mergeBase} is an ancestor of ${head}`,
      );
    }
    const sides = refusePlan(() => planSides(args));

    const ownDatabase = args.databaseUrl === null;
    const databasePassword = ownDatabase ? deps.generateSecret() : undefined;
    const envExample = deps.readFile(join(worktree, '.env.example'));
    if (envExample === null) {
      throw new StackUsageError(
        `${worktree} has no .env.example to build the environment from`,
      );
    }
    const env = buildQaEnv({
      envExample,
      databaseUrl:
        args.databaseUrl ?? qaContainerDatabaseUrl(databasePassword ?? ''),
      generateSecret: deps.generateSecret,
    });
    // The stack's env always says development, so the shell's own NODE_ENV
    // is what tells a production host apart.
    const refusal = stackDatabaseRefusal({
      DATABASE_URL: env.DATABASE_URL,
      NODE_ENV: deps.nodeEnv === 'production' ? deps.nodeEnv : env.NODE_ENV,
    });
    if (refusal) {
      throw new StackRefusal(
        `refusing to start: ${refusal}. The QA stack runs against a local database only.`,
      );
    }
    const ports: number[] = [QA_STACK.webPort, QA_STACK.backendPort];
    if (ownDatabase) ports.push(QA_STACK.databasePort);
    const portProblem = portRefusal(
      Object.fromEntries(ports.map((port) => [port, deps.listenerPid(port)])),
    );
    if (portProblem)
      throw new StackRefusal(`refusing to start: ${portProblem}`);
    if (
      ownDatabase &&
      deps.run(['docker', 'version'], { cwd: worktree }).status !== 0
    ) {
      throw new StackUsageError(
        'docker is missing or not running; start it, or pass --database-url for a local database',
      );
    }

    const steps = refusePlan(() =>
      planStart({
        sides,
        mergeBase,
        head,
        mergeBaseIsAncestor: ancestry.status === 0,
        ownDatabase,
        installNeeded: !deps.exists(join(worktree, 'node_modules')),
      }),
    );

    const state: QaStackState = {
      worktree,
      container: ownDatabase ? QA_STACK.containerName : null,
      mergeBase,
      head,
      sides,
      current: 0,
      services: {},
      env,
    };
    // Written before the first step, so a start that fails part-way can
    // still be stopped by "yarn qa:stack:stop".
    saveState(deps, state);
    deps.writeFile(stackFile(deps, 'env.sh'), renderEnvFile(env));
    deps.out(
      `qa:stack: serving ${sides.join(' then ')}; starting on ${sides[0]} (${commitFor(sides[0], state)})`,
    );
    await runSteps(steps, { deps, state, databasePassword });
    deps.out(
      `qa:stack: up — web http://localhost:${QA_STACK.webPort}, backend http://localhost:${QA_STACK.backendPort}`,
    );
    return 0;
  });
}

async function stopStack(deps: QaDeps): Promise<ExitCode> {
  const state = readState(deps);
  if (!state) {
    deps.out('qa:stack: no QA stack is up; nothing to stop');
    return 0;
  }
  await runSteps(planStop(state), { deps, state });
  deps.removeFile(stackFile(deps, 'env.sh'));
  deps.removeFile(statePath(deps));
  deps.out('qa:stack: stopped');
  return 0;
}

function stackStatus(deps: QaDeps): ExitCode {
  const state = readState(deps);
  if (!state) {
    deps.out('qa:stack: no QA stack is up');
    return 1;
  }
  const side = state.sides[state.current];
  const expected = commitFor(side, state);
  const problems = servedCommitProblems(
    gatherServedFacts(deps, state, expected),
  );
  deps.out(
    `qa:stack: ${state.worktree}, ${side} (${expected}), plan ${state.sides.join(' then ')}`,
  );
  for (const problem of problems) deps.out(`  - ${problem}`);
  return problems.length === 0 ? 0 : 1;
}

/** `yarn qa:switch`. */
export async function runQaSwitch(
  argv: readonly string[],
  deps: QaDeps,
): Promise<ExitCode> {
  return guard(deps, 'qa:switch', async () => {
    const args = parseSwitchArgs(argv);
    if ('error' in args)
      throw new StackUsageError(`${args.error}\n${SWITCH_USAGE}`);
    const state = readState(deps);
    if (!state) {
      throw new StackRefusal(
        'no QA stack is up; run "yarn qa:stack:start" first',
      );
    }
    const worktree = resolve(args.worktree);
    if (worktree !== state.worktree) {
      throw new StackRefusal(
        `the QA stack runs from ${state.worktree}, not ${worktree}`,
      );
    }
    refuseUnsafeWorktree(deps, worktree);
    const served = commitFor(state.sides[state.current], state);
    const target = commitFor(args.to, state);
    const steps = refusePlan(() =>
      planSwitch({
        state,
        to: args.to,
        installNeeded:
          served !== target && lockfileDiffers(deps, worktree, served, target),
      }),
    );
    await runSteps(steps, { deps, state });
    state.current = state.sides.indexOf(args.to);
    saveState(deps, state);
    return 0;
  });
}
