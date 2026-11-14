// Contracts for the QA stack's executor (ADR 0147 decisions 2 and 9), run
// through `runQaStack` and `runQaSwitch` with a stubbed QaDeps. Every git,
// docker, process, port and file fact is an in-memory fake here, so no real
// command, container, process or port runs. The pure rules are tested in
// qa-stack.test.ts and qa-switch.test.ts.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test, { describe } from 'node:test';

import {
  type QaDeps,
  type RunResult,
  runQaStack,
  runQaSwitch,
} from './qa-stack-executor.ts';
import {
  QA_STACK,
  type QaStackState,
  SERVICE_COMMAND,
  SERVICE_PORT,
} from './qa-stack.ts';

const REPO = '/repo';
const WT = '/wt';
const STATE_PATH = join(REPO, QA_STACK.stateDir, 'state.json');
const ENV_SH_PATH = join(REPO, QA_STACK.stateDir, 'env.sh');
const ENV_EXAMPLE_PATH = join(WT, '.env.example');
const FIRST_PGID = 5000;
const LOCAL_DB = 'postgresql://u:p@127.0.0.1:5453/db';

function fullSha(short: string): string {
  return short.padEnd(40, '0');
}

const MERGE_BASE = fullSha('aaaaaaa');
const HEAD = fullSha('bbbbbbb');

interface FakeOptions {
  gitDir?: string;
  gitCommonDir?: string;
  statusPorcelain?: string;
  head?: string;
  isAncestorStatus?: number;
  lockStatus?: number;
  dockerStatus?: number | null;
  /**
   * Whether `<worktree>/node_modules` exists. `exists` follows links, so a
   * dangling symlink is `nodeModules: false` together with `nodeModulesSymlink`.
   */
  nodeModules?: boolean;
  /** `<worktree>/node_modules` is a symbolic link, valid or dangling. */
  nodeModulesSymlink?: boolean;
  /** The shell's NODE_ENV; undefined when unset. */
  nodeEnv?: string;
  files?: Record<string, string>;
  /** Paths removed from the default files after `files` is applied. */
  omit?: string[];
  listeners?: Record<number, number>;
  alive?: number[];
  processGroupOf?: (pid: number) => number | null;
  /** Ports a spawned service never listens on. */
  silentPorts?: number[];
  /** Process groups that ignore both SIGTERM and SIGKILL. */
  unkillable?: number[];
  /** Any command whose joined argv contains this substring exits 1. */
  failCommand?: string;
  /** Git's `rev-parse --verify` fails, so no ref resolves to a commit. */
  unresolvable?: boolean;
}

interface Spawn {
  argv: readonly string[];
  cwd: string;
  env: Record<string, string>;
  pgid: number;
}

interface Run {
  argv: readonly string[];
  options: { cwd: string; env?: Record<string, string> };
}

const ok = (stdout = ''): RunResult => ({ status: 0, stdout, stderr: '' });
const code = (status: number | null): RunResult => ({
  status,
  stdout: '',
  stderr: '',
});

/**
 * A machine with nothing running. Spawned services get pgids from
 * FIRST_PGID upward, listen on their port, and are alive until killed.
 * Git answers by argv pattern; HEAD follows `checkout --detach`.
 */
function fakeMachine(options: FakeOptions = {}) {
  const calls: string[] = [];
  const runs: Run[] = [];
  const spawns: Spawn[] = [];
  const kills: { pgid: number; signal: string }[] = [];
  const writes: string[] = [];
  const removes: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const files = new Map<string, string>(
    Object.entries({
      [ENV_EXAMPLE_PATH]:
        'APP_FRONTEND_URL=http://localhost:4200\nACCESS_JWT_SECRET=\nYOUTUBE_CRON_SECRET=keep\nGOOGLE_REDIRECT_URI=http://localhost:4200/dashboard/youtube/callback\n',
      [join(WT, 'docker-compose.yml')]:
        'services:\n  myorganiser_db:\n    image: bitnami/postgresql@sha256:abc\n',
      ...options.files,
    }),
  );
  for (const path of options.omit ?? []) files.delete(path);
  const listeners = new Map<number, number>(
    Object.entries(options.listeners ?? {}).map(([port, pid]) => [
      Number(port),
      pid,
    ]),
  );
  const alive = new Set<number>(options.alive ?? []);
  const unkillable = new Set<number>(options.unkillable ?? []);
  const silentPorts = new Set<number>(options.silentPorts ?? []);
  const gitDir = options.gitDir ?? '/repo/.git/worktrees/wt';
  const gitCommonDir = options.gitCommonDir ?? '/repo/.git';
  const statusPorcelain = options.statusPorcelain ?? '';
  const isAncestorStatus = options.isAncestorStatus ?? 0;
  const lockStatus = options.lockStatus ?? 0;
  const dockerStatus =
    options.dockerStatus === undefined ? 0 : options.dockerStatus;
  let head = options.head ?? HEAD;
  let nextPgid = FIRST_PGID;
  let secrets = 0;

  const gitCall = (args: string[]): RunResult => {
    const [verb] = args;
    if (verb === 'rev-parse') {
      if (args.includes('--git-dir')) return ok(`${gitDir}\n${gitCommonDir}\n`);
      if (args[1] === '--verify') {
        if (options.unresolvable) return code(128);
        return ok(`${fullSha(args[2].replace('^{commit}', ''))}\n`);
      }
      if (args[1] === 'HEAD') return ok(`${head}\n`);
    }
    if (verb === 'status') return ok(statusPorcelain);
    if (verb === 'checkout' && args[1] === '--detach') {
      head = args[2];
      return ok();
    }
    if (verb === 'merge-base') return code(isAncestorStatus);
    if (verb === 'diff') return code(lockStatus);
    return ok();
  };

  const deps: QaDeps = {
    repoRoot: REPO,
    nodeEnv: options.nodeEnv,
    run(argv, runOptions) {
      calls.push(argv.join(' '));
      runs.push({ argv: [...argv], options: runOptions });
      if (options.failCommand && argv.join(' ').includes(options.failCommand)) {
        return { status: 1, stdout: '', stderr: 'boom' };
      }
      if (argv[0] === 'docker' && argv[1] === 'version') {
        return code(dockerStatus);
      }
      if (argv[0] === 'git') return gitCall(argv.slice(3));
      return ok();
    },
    spawnDetached(argv, spawnOptions) {
      const pgid = nextPgid++;
      spawns.push({
        argv: [...argv],
        cwd: spawnOptions.cwd,
        env: spawnOptions.env,
        pgid,
      });
      alive.add(pgid);
      const port =
        argv.join(' ') === SERVICE_COMMAND.backend.join(' ')
          ? SERVICE_PORT.backend
          : SERVICE_PORT.web;
      if (!silentPorts.has(port)) listeners.set(port, pgid);
      return pgid;
    },
    isGroupAlive: (pgid) => alive.has(pgid),
    listenerPid: (port) => listeners.get(port) ?? null,
    processGroupOf: options.processGroupOf ?? ((pid) => pid),
    killGroup(pgid, signal) {
      kills.push({ pgid, signal });
      if (unkillable.has(pgid)) return;
      alive.delete(pgid);
      for (const [port, pid] of listeners) {
        if (pid === pgid) listeners.delete(port);
      }
    },
    readFile: (path) => files.get(path) ?? null,
    writeFile(path, text) {
      writes.push(path);
      files.set(path, text);
    },
    removeFile(path) {
      removes.push(path);
      files.delete(path);
    },
    exists: (path) =>
      path === join(WT, 'node_modules')
        ? (options.nodeModules ?? true)
        : files.has(path),
    isSymlink: (path) =>
      path === join(WT, 'node_modules') &&
      (options.nodeModulesSymlink ?? false),
    sleep: () => Promise.resolve(),
    generateSecret: () => `secret-${++secrets}`,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };

  return {
    deps,
    calls,
    runs,
    spawns,
    kills,
    writes,
    removes,
    out,
    err,
    files,
    listeners,
    alive,
  };
}

function startArgv(...extra: string[]): string[] {
  return [
    'start',
    '--worktree',
    WT,
    '--change-kind',
    'fix',
    '--merge-base',
    'aaaaaaa',
    '--head',
    'bbbbbbb',
    ...extra,
  ];
}

/** A stack running `current` of Before and After, with both services live. */
function runningState(current: 0 | 1): QaStackState {
  const served = current === 0 ? MERGE_BASE : HEAD;
  return {
    worktree: WT,
    container: 'myorganiser-qa-db',
    mergeBase: MERGE_BASE,
    head: HEAD,
    sides: ['before', 'after'],
    current,
    services: {
      backend: { pgid: 101, spawnCommit: served, port: SERVICE_PORT.backend },
      web: { pgid: 202, spawnCommit: served, port: SERVICE_PORT.web },
    },
    env: {},
  };
}

function runningFake(
  current: 0 | 1,
  extra: FakeOptions = {},
  stateOverride: Partial<QaStackState> = {},
) {
  const served = current === 0 ? MERGE_BASE : HEAD;
  return fakeMachine({
    head: served,
    listeners: {
      [SERVICE_PORT.backend]: 101,
      [SERVICE_PORT.web]: 202,
    },
    alive: [101, 202],
    ...extra,
    files: {
      [STATE_PATH]: JSON.stringify({
        ...runningState(current),
        ...stateOverride,
      }),
      [ENV_SH_PATH]: 'export X=1\n',
      ...extra.files,
    },
  });
}

function savedState(files: Map<string, string>): QaStackState {
  const text = files.get(STATE_PATH);
  assert.ok(text, 'expected state.json to be written');
  return JSON.parse(text) as QaStackState;
}

function indexOfCall(calls: readonly string[], needle: string): number {
  return calls.findIndex((call) => call.includes(needle));
}

describe('runQaStack start', () => {
  test('a fix with its own database runs the ordered sequence on the merge-base and records the stack', async () => {
    const f = fakeMachine();
    assert.equal(await runQaStack(startArgv(), f.deps), 0);

    const dockerRun = f.calls.find((call) => call.startsWith('docker run'));
    assert.ok(dockerRun, 'expected a docker run');
    assert.ok(dockerRun.includes('-p 127.0.0.1:5499:5432'));
    assert.ok(dockerRun.includes('--name myorganiser-qa-db'));

    const order = [
      'docker run',
      `checkout --detach ${MERGE_BASE}`,
      'prisma migrate deploy',
      'prisma generate',
      'qa-accounts.ts seed --restore',
    ].map((needle) => indexOfCall(f.calls, needle));
    for (const index of order) assert.ok(index >= 0, `missing step ${index}`);
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
    );
    assert.equal(
      f.calls.filter((call) => call.includes('qa-accounts.ts seed')).length,
      1,
    );

    assert.equal(f.spawns.length, 2);
    assert.equal(f.spawns[0].argv.join(' '), SERVICE_COMMAND.backend.join(' '));
    assert.equal(f.spawns[1].argv.join(' '), SERVICE_COMMAND.web.join(' '));
    assert.ok(f.spawns.every((spawn) => spawn.cwd === WT));

    const state = savedState(f.files);
    assert.deepEqual(state.sides, ['before', 'after']);
    assert.equal(state.current, 0);
    assert.equal(state.container, 'myorganiser-qa-db');
    assert.equal(state.mergeBase, MERGE_BASE);
    assert.equal(state.services.backend?.pgid, FIRST_PGID);
    assert.equal(state.services.web?.pgid, FIRST_PGID + 1);
    assert.ok(f.files.has(ENV_SH_PATH), 'expected env.sh to be written');

    assert.ok(f.out.some((line) => line.includes('serving')));
    assert.ok(f.out.some((line) => line.startsWith('qa:stack: up')));
  });

  test('the database password reaches docker by name only, through the run environment, never in argv', async () => {
    const f = fakeMachine();
    assert.equal(await runQaStack(startArgv(), f.deps), 0);

    const dockerRun = f.runs.find(
      (run) => run.argv[0] === 'docker' && run.argv[1] === 'run',
    );
    assert.ok(dockerRun, 'expected a docker run');
    assert.ok(dockerRun.argv.includes('POSTGRESQL_PASSWORD'));
    assert.ok(
      dockerRun.argv.every((arg) => !arg.startsWith('POSTGRESQL_PASSWORD=')),
      'the password must not be an argv element',
    );
    // The first generated secret is the database password.
    assert.equal(dockerRun.options.env?.POSTGRESQL_PASSWORD, 'secret-1');
    assert.ok(
      f.runs
        .filter((run) => run.argv[0] === 'docker')
        .every((run) => !run.argv.join(' ').includes('secret-1')),
      'no docker argv carries the password',
    );
  });

  test('the readiness probe names the QA user, so pg_isready can attempt a connection and the stack becomes ready', async () => {
    // Without -U, libpq has no default user in the image's uid-without-a-
    // passwd-entry, and pg_isready exits 3 whatever the server's state.
    const f = fakeMachine();
    const base = f.deps.run;
    f.deps.run = (argv, runOptions) => {
      const result = base(argv, runOptions);
      if (
        argv[0] === 'docker' &&
        argv[1] === 'exec' &&
        argv.includes('pg_isready')
      ) {
        const user = argv[argv.indexOf('-U') + 1];
        return code(user === QA_STACK.databaseUser ? 0 : 3);
      }
      return result;
    };
    assert.equal(await runQaStack(startArgv(), f.deps), 0);

    const probes = f.runs.filter(
      (run) => run.argv[0] === 'docker' && run.argv[1] === 'exec',
    );
    assert.ok(probes.length > 0, 'expected a readiness probe');
    assert.deepEqual(probes[0].argv, [
      'docker',
      'exec',
      QA_STACK.containerName,
      'pg_isready',
      '-h',
      '127.0.0.1',
      '-p',
      '5432',
      '-U',
      QA_STACK.databaseUser,
    ]);
    assert.ok(f.out.some((line) => line.startsWith('qa:stack: up')));
  });

  const REFUSALS: readonly {
    name: string;
    machine: () => ReturnType<typeof fakeMachine>;
    args?: string[];
    err: RegExp;
  }[] = [
    {
      name: "the repository's primary checkout",
      machine: () =>
        fakeMachine({ gitDir: '/repo/.git', gitCommonDir: '/repo/.git' }),
      err: /primary checkout/,
    },
    {
      name: 'a worktree with uncommitted changes',
      machine: () => fakeMachine({ statusPorcelain: ' M src/a.ts\n' }),
      err: /uncommitted changes/,
    },
    {
      name: 'a non-local database URL',
      machine: () => fakeMachine(),
      args: ['--database-url', 'postgresql://u:p@db.example.com/x'],
      err: /refusing to start.*db\.example\.com/,
    },
    {
      name: 'a port already listening',
      machine: () => fakeMachine({ listeners: { 4300: 1234 } }),
      err: /port 4300 \(pid 1234\) is in use/,
    },
    {
      name: 'a state file already present',
      machine: () =>
        fakeMachine({ files: { [STATE_PATH]: '{"worktree":"/wt"}' } }),
      err: /already up/,
    },
    {
      name: 'a merge-base that is not an ancestor of the head',
      machine: () => fakeMachine({ isAncestorStatus: 1 }),
      err: /is not an ancestor/,
    },
    {
      name: 'a production NODE_ENV, even with a local database',
      machine: () => fakeMachine({ nodeEnv: 'production' }),
      args: ['--database-url', LOCAL_DB],
      err: /NODE_ENV is production/,
    },
  ];

  for (const { name, machine, args, err } of REFUSALS) {
    test(`refuses ${name} with exit 1, before any docker run, spawn or state write`, async () => {
      const f = machine();
      assert.equal(await runQaStack(startArgv(...(args ?? [])), f.deps), 1);
      assert.match(f.err.join('\n'), err);
      assert.equal(
        f.calls.filter((call) => call.startsWith('docker run')).length,
        0,
      );
      assert.equal(f.spawns.length, 0);
      assert.equal(f.writes.length, 0);
    });
  }

  test('a local --database-url runs no docker command and records no container', async () => {
    const f = fakeMachine();
    assert.equal(
      await runQaStack(startArgv('--database-url', LOCAL_DB), f.deps),
      0,
    );
    assert.deepEqual(
      f.calls.filter((call) => call.startsWith('docker')),
      [],
    );
    const state = savedState(f.files);
    assert.equal(state.container, null);
    assert.equal(state.env.DATABASE_URL, LOCAL_DB);
    assert.equal(f.spawns.length, 2);
  });

  test('exits 2 when docker is missing, before any step runs', async () => {
    const f = fakeMachine({ dockerStatus: null });
    assert.equal(await runQaStack(startArgv(), f.deps), 2);
    assert.match(f.err.join('\n'), /docker is missing/);
    assert.equal(f.spawns.length, 0);
    assert.equal(f.writes.length, 0);
  });

  test('exits 2 for bad arguments', async () => {
    const f = fakeMachine();
    assert.equal(await runQaStack(['start', '--worktree', WT], f.deps), 2);
    assert.match(f.err.join('\n'), /--change-kind must be fix or feature/);
    assert.equal(f.calls.length, 0);
  });

  test('a porcelain status keeps the leading space of its first line, so the dirty paths keep their leading dots', async () => {
    // Porcelain lines are "XY path"; the space in " M" is significant, and
    // a full trim would turn ".agents/x.md" into "agents/x.md".
    const f = fakeMachine({
      statusPorcelain: ' M .agents/x.md\n?? .hidden\n',
    });
    assert.equal(await runQaStack(startArgv(), f.deps), 1);
    assert.match(
      f.err.join('\n'),
      /uncommitted changes \(\.agents\/x\.md, \.hidden\)/,
    );
    assert.equal(
      f.calls.filter((call) => call.startsWith('docker run')).length,
      0,
    );
  });

  test('exits 2 when .env.example is missing from the worktree', async () => {
    const f = fakeMachine({ omit: [ENV_EXAMPLE_PATH] });
    assert.equal(await runQaStack(startArgv(), f.deps), 2);
    assert.match(f.err.join('\n'), /has no \.env\.example/);
  });

  test('exits 2 when a commit does not resolve', async () => {
    const f = fakeMachine({ unresolvable: true });
    assert.equal(await runQaStack(startArgv(), f.deps), 2);
    assert.match(f.err.join('\n'), /is not a commit/);
  });

  test('exits 2 when git cannot tell whether the merge-base is an ancestor', async () => {
    const f = fakeMachine({ isAncestorStatus: 128 });
    assert.equal(await runQaStack(startArgv(), f.deps), 2);
    assert.match(f.err.join('\n'), /cannot tell whether/);
    assert.equal(f.spawns.length, 0);
  });

  test('a failing step exits 1, names the step, prints no "up" line, and keeps state.json', async () => {
    const f = fakeMachine({ failCommand: 'qa-accounts.ts seed' });
    assert.equal(await runQaStack(startArgv(), f.deps), 1);
    assert.match(f.err.join('\n'), /seeding the QA Accounts failed/);
    assert.ok(f.out.every((line) => !line.startsWith('qa:stack: up')));
    assert.ok(f.files.has(STATE_PATH), 'state.json is kept for a later stop');
    assert.equal(f.spawns.length, 0);
  });

  test('a service that never listens exits 1 and names the port', async () => {
    const f = fakeMachine({ silentPorts: [SERVICE_PORT.backend] });
    assert.equal(await runQaStack(startArgv(), f.deps), 1);
    assert.match(f.err.join('\n'), /backend did not listen on port 3300/);
    assert.ok(f.out.every((line) => !line.startsWith('qa:stack: up')));
  });

  test('a served-commit mismatch after start exits 1 and does not report the stack up', async () => {
    // The web listener is the second spawn, so its pgid is FIRST_PGID + 1.
    const f = fakeMachine({
      processGroupOf: (pid) => (pid === FIRST_PGID + 1 ? 999 : pid),
    });
    assert.equal(await runQaStack(startArgv(), f.deps), 1);
    assert.match(f.err.join('\n'), /not serving/);
    assert.ok(f.out.every((line) => !line.startsWith('qa:stack: up')));
  });

  const NODE_MODULES_LINKS: readonly {
    name: string;
    options: FakeOptions;
  }[] = [
    { name: 'a valid', options: { nodeModulesSymlink: true } },
    // existsSync follows the link, so a dangling one reads as missing.
    {
      name: 'a dangling',
      options: { nodeModulesSymlink: true, nodeModules: false },
    },
  ];

  for (const { name, options } of NODE_MODULES_LINKS) {
    test(`refuses ${name} symlinked node_modules with exit 2, naming the fix, before any docker, install, spawn or write`, async () => {
      const f = fakeMachine(options);
      assert.equal(await runQaStack(startArgv(), f.deps), 2);
      const message = f.err.join('\n');
      assert.match(message, /\/wt\/node_modules is a symbolic link/);
      assert.match(message, /corepack yarn install --immutable/);
      assert.match(message, /cp -c -R/);
      assert.deepEqual(
        f.runs.filter((run) => run.argv[0] !== 'git'),
        [],
        'no docker, install, prisma, seed or probe runs',
      );
      assert.equal(indexOfCall(f.calls, 'checkout'), -1);
      assert.equal(f.spawns.length, 0);
      assert.equal(f.writes.length, 0);
      assert.equal(f.files.has(STATE_PATH), false);
    });
  }

  test('a missing node_modules plans the install between checkout and migrate, and the stack starts', async () => {
    const f = fakeMachine({ nodeModules: false });
    assert.equal(await runQaStack(startArgv(), f.deps), 0);
    const checkout = indexOfCall(f.calls, `checkout --detach ${MERGE_BASE}`);
    const install = indexOfCall(f.calls, 'corepack yarn install --immutable');
    const migrate = indexOfCall(f.calls, 'prisma migrate deploy');
    assert.ok(checkout >= 0 && install >= 0 && migrate >= 0);
    assert.ok(checkout < install && install < migrate);
    const installRun = f.runs.find(
      (run) => run.argv.join(' ') === 'corepack yarn install --immutable',
    );
    assert.equal(installRun?.options.cwd, WT);
  });

  test('a real node_modules directory plans no install and the stack starts', async () => {
    const f = fakeMachine({ nodeModules: true });
    assert.equal(await runQaStack(startArgv(), f.deps), 0);
    assert.equal(indexOfCall(f.calls, 'yarn install'), -1);
    assert.ok(f.out.some((line) => line.startsWith('qa:stack: up')));
  });
});

describe('runQaSwitch', () => {
  test('to After from a running Before stops both recorded groups, checks out the head, migrates, restarts, and never re-seeds', async () => {
    const f = runningFake(0);
    assert.equal(
      await runQaSwitch(['--worktree', WT, '--to', 'after'], f.deps),
      0,
    );

    assert.deepEqual(f.kills, [
      { pgid: 101, signal: 'SIGTERM' },
      { pgid: 202, signal: 'SIGTERM' },
    ]);
    assert.ok(
      f.calls.some((call) => call.includes(`checkout --detach ${HEAD}`)),
    );
    assert.ok(f.calls.some((call) => call.includes('prisma migrate deploy')));
    assert.equal(f.spawns.length, 2);
    assert.equal(
      f.calls.filter((call) => call.includes('qa-accounts.ts seed')).length,
      0,
    );
    assert.equal(
      f.calls.filter((call) => call.startsWith('docker run')).length,
      0,
    );
    assert.equal(savedState(f.files).current, 1);
  });

  test('to Before from After is refused, naming the backward migration and --before-only, with nothing killed or checked out', async () => {
    const f = runningFake(1);
    assert.equal(
      await runQaSwitch(['--worktree', WT, '--to', 'before'], f.deps),
      1,
    );
    const message = f.err.join('\n');
    assert.match(message, /backward migration/);
    assert.match(message, /--before-only/);
    assert.equal(f.kills.length, 0);
    assert.equal(
      f.calls.filter((call) => call.includes('checkout --detach')).length,
      0,
    );
    assert.equal(f.spawns.length, 0);
  });

  test('to After installs dependencies between checkout and migrate when yarn.lock differs', async () => {
    const f = runningFake(0, { lockStatus: 1 });
    assert.equal(
      await runQaSwitch(['--worktree', WT, '--to', 'after'], f.deps),
      0,
    );
    const checkout = indexOfCall(f.calls, `checkout --detach ${HEAD}`);
    const install = indexOfCall(f.calls, 'yarn install --immutable');
    const migrate = indexOfCall(f.calls, 'prisma migrate deploy');
    assert.ok(checkout >= 0 && install >= 0 && migrate >= 0);
    assert.ok(checkout < install && install < migrate);
  });

  test('exits 2 when --worktree is missing', async () => {
    const f = fakeMachine();
    assert.equal(await runQaSwitch(['--to', 'after'], f.deps), 2);
    assert.match(f.err.join('\n'), /--worktree is required/);
  });

  const SWITCH_REFUSALS: readonly {
    name: string;
    machine: () => ReturnType<typeof fakeMachine>;
    args: string[];
    err: RegExp;
  }[] = [
    {
      name: 'no stack is up',
      machine: () => fakeMachine(),
      args: ['--worktree', WT, '--to', 'after'],
      err: /no QA stack is up/,
    },
    {
      name: 'a worktree other than the stack',
      machine: () => runningFake(0),
      args: ['--worktree', '/other', '--to', 'after'],
      err: /runs from \/wt, not \/other/,
    },
    {
      name: 'the primary checkout',
      machine: () =>
        runningFake(0, { gitDir: '/repo/.git', gitCommonDir: '/repo/.git' }),
      args: ['--worktree', WT, '--to', 'after'],
      err: /primary checkout/,
    },
    {
      name: 'a dirty worktree',
      machine: () => runningFake(0, { statusPorcelain: ' M src/a.ts\n' }),
      args: ['--worktree', WT, '--to', 'after'],
      err: /uncommitted changes/,
    },
  ];

  for (const { name, machine, args, err } of SWITCH_REFUSALS) {
    test(`refuses a switch with ${name}, exit 1, with nothing killed, checked out or spawned`, async () => {
      const f = machine();
      assert.equal(await runQaSwitch(args, f.deps), 1);
      assert.match(f.err.join('\n'), err);
      assert.equal(f.kills.length, 0);
      assert.equal(
        f.calls.filter((call) => call.includes('checkout --detach')).length,
        0,
      );
      assert.equal(f.spawns.length, 0);
    });
  }
});

describe('runQaStack stop and status', () => {
  test('stop kills only the recorded process groups and removes only the stack container, state and env file', async () => {
    const f = runningFake(0);
    assert.equal(await runQaStack(['stop'], f.deps), 0);

    assert.deepEqual(f.kills, [
      { pgid: 101, signal: 'SIGTERM' },
      { pgid: 202, signal: 'SIGTERM' },
    ]);
    assert.deepEqual(
      f.calls.filter((call) => call.startsWith('docker')),
      ['docker rm -f myorganiser-qa-db'],
    );
    assert.deepEqual(f.removes, [ENV_SH_PATH, STATE_PATH]);
    assert.equal(f.files.has(STATE_PATH), false);
    assert.equal(f.files.has(ENV_SH_PATH), false);
  });

  test('stop of a stack started with --database-url makes no docker call', async () => {
    const f = runningFake(0, {}, { container: null });
    assert.equal(await runQaStack(['stop'], f.deps), 0);
    assert.deepEqual(f.kills, [
      { pgid: 101, signal: 'SIGTERM' },
      { pgid: 202, signal: 'SIGTERM' },
    ]);
    assert.equal(f.calls.filter((call) => call.startsWith('docker')).length, 0);
    assert.equal(f.files.has(STATE_PATH), false);
  });

  test('stop exits 1 when a group survives SIGKILL, and keeps its record in state.json', async () => {
    const f = runningFake(0, { unkillable: [101] });
    assert.equal(await runQaStack(['stop'], f.deps), 1);
    assert.match(f.err.join('\n'), /survived SIGKILL/);
    assert.deepEqual(f.kills, [
      { pgid: 101, signal: 'SIGTERM' },
      { pgid: 101, signal: 'SIGKILL' },
    ]);
    assert.ok(f.files.has(STATE_PATH), 'state.json is kept');
    assert.equal(savedState(f.files).services.backend?.pgid, 101);
    assert.equal(f.calls.filter((call) => call.startsWith('docker')).length, 0);
  });

  test('stop with no stack up exits 0 and touches nothing', async () => {
    const f = fakeMachine();
    assert.equal(await runQaStack(['stop'], f.deps), 0);
    assert.equal(f.kills.length, 0);
    assert.equal(f.calls.length, 0);
    assert.match(f.out.join('\n'), /nothing to stop/);
  });

  test('status with no stack up exits 1', async () => {
    const f = fakeMachine();
    assert.equal(await runQaStack(['status'], f.deps), 1);
    assert.match(f.out.join('\n'), /no QA stack is up/);
  });

  test('status with a state file that is not JSON exits 2 and names the file', async () => {
    const f = fakeMachine({ files: { [STATE_PATH]: 'not json' } });
    assert.equal(await runQaStack(['status'], f.deps), 2);
    assert.match(f.err.join('\n'), /is not valid JSON/);
  });

  test('status with a healthy stack exits 0 and names the plan', async () => {
    const f = runningFake(0);
    assert.equal(await runQaStack(['status'], f.deps), 0);
    assert.match(f.out.join('\n'), /plan before then after/);
  });

  test('status exits 1 and names the problem when the web port is not listening', async () => {
    const f = runningFake(0, { listeners: { [SERVICE_PORT.backend]: 101 } });
    assert.equal(await runQaStack(['status'], f.deps), 1);
    assert.match(f.out.join('\n'), /nothing listens on web's port 4300/);
  });
});
