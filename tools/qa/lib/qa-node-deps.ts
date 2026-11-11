/**
 * The real machine behind `QaDeps`, for `tools/qa/qa-stack.ts` and
 * `tools/qa/qa-switch.ts`. Kept apart from `qa-stack-executor.ts` so a test of
 * the executor never loads it: no test starts a process, a container or a
 * listener.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { QaDeps } from './qa-stack-executor.ts';

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

export function nodeQaDeps(repoRoot: string): QaDeps {
  const run: QaDeps['run'] = (argv, { cwd, env }) => {
    const result = spawnSync(argv[0], argv.slice(1), {
      cwd,
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
    return {
      status: result.error ? null : result.status,
      stdout: result.stdout ?? '',
      stderr: result.error ? result.error.message : (result.stderr ?? ''),
    };
  };
  return {
    repoRoot,
    nodeEnv: process.env.NODE_ENV,
    run,
    spawnDetached(argv, { cwd, env, logFile }) {
      mkdirSync(dirname(logFile), { recursive: true });
      const log = openSync(logFile, 'a');
      try {
        const child = spawn(argv[0], argv.slice(1), {
          cwd,
          env: { ...process.env, ...env },
          detached: true,
          stdio: ['ignore', log, log],
        });
        if (child.pid === undefined) {
          throw new Error(`could not start ${argv.join(' ')}`);
        }
        child.unref();
        return child.pid;
      } finally {
        closeSync(log);
      }
    },
    isGroupAlive(pgid) {
      try {
        process.kill(-pgid, 0);
        return true;
      } catch (error) {
        return errorCode(error) === 'EPERM';
      }
    },
    listenerPid(port) {
      const result = run(
        ['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
        { cwd: repoRoot },
      );
      if (result.status === null) {
        throw new Error('lsof is missing; it is how the stack sees its ports');
      }
      const pid = Number.parseInt(result.stdout.trim().split('\n')[0], 10);
      return Number.isNaN(pid) ? null : pid;
    },
    processGroupOf(pid) {
      const result = run(['ps', '-o', 'pgid=', '-p', String(pid)], {
        cwd: repoRoot,
      });
      const pgid = Number.parseInt(result.stdout.trim(), 10);
      return Number.isNaN(pgid) ? null : pgid;
    },
    killGroup(pgid, signal) {
      try {
        process.kill(-pgid, signal);
      } catch (error) {
        if (errorCode(error) !== 'ESRCH') throw error;
      }
    },
    readFile(path) {
      try {
        return readFileSync(path, 'utf8');
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return null;
        throw error;
      }
    },
    writeFile(path, text) {
      mkdirSync(dirname(path), { recursive: true });
      // The state and env files hold generated local secrets.
      writeFileSync(path, text, { mode: 0o600 });
    },
    removeFile(path) {
      rmSync(path, { force: true });
    },
    exists: existsSync,
    sleep: (ms) => delay(ms),
    generateSecret: () => randomBytes(32).toString('hex'),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  };
}
