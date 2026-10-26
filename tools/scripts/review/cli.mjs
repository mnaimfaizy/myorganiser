/**
 * Shared CLI plumbing for the review scripts: flag parsing, the exit-2
 * "could not run" helper, the is-main guard, the first line of a thrown
 * `gh` error, and the small gather layer the two measurement scripts share —
 * git, `gh`, dates, and writing a file. Kept here so the validator, the
 * renderer, the publisher, and the Review Tier label applier do not each
 * carry a differently shaped copy, and so a fix to the `gh` probe or the git
 * buffer is made once.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gh as runGh, ghJson as runGhJson } from '../lib/gh.ts';

/**
 * Split argv into `{ positional, flags }`. A flag is `--name value`; a flag
 * given twice keeps the last value; a flag with no value is `null`.
 */
export const parseArgs = (argv) => {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[arg.slice(2)] = null;
    } else {
      flags[arg.slice(2)] = next;
      i += 1;
    }
  }
  return { positional, flags };
};

/** Exit 2: the script could not run. Distinct from exit 1, a rejected report. */
export const cannotRun = (prefix) => (msg) => {
  console.error(`${prefix}: ${msg}`);
  process.exit(2);
};

/** The first non-empty line of a thrown `gh` error, for logs and cannotRun. */
export const firstLine = (err) =>
  String(err?.stderr || err?.message || err)
    .split('\n')
    .find(Boolean) ?? 'unknown error';

export const readJsonOr = (path, onError) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return onError(`cannot read ${path}: ${err.message}`);
  }
};

/**
 * The one way the review scripts call `gh`. The spec resolver, the
 * publisher, and the Review Tier label applier use it, and only from steps
 * that hold the job token; the reviewer itself never does (ADR 0071 item 8).
 */
export const gh = (args, input) => runGh(args, { input });
export const ghJson = (args, input) => runGhJson(args, { input });
export const ghGraphql = (query, variables) =>
  ghJson(
    ['api', 'graphql', '--input', '-'],
    JSON.stringify({ query, variables }),
  );

/**
 * `gh` reachable and logged in. Checked once per run by a measurement; never
 * assumed, because an unauthenticated `gh` is a lookup that fails rather than
 * an answer, and both measurements report what they could not read.
 */
export const githubAvailable = () => {
  try {
    gh(['auth', 'status']);
    return true;
  } catch {
    return false;
  }
};

/**
 * `ghJson`, except that a failure is an answer. Every `gh` call in a
 * measurement is a lookup whose absence is reportable — an unread verdict is
 * `unknown`, an unread artifact makes a push `unreadable` — so the throwing
 * helper the publisher wants is wrong for those callers.
 */
export const ghJsonOrNull = (args, input) => {
  try {
    return ghJson(args, input);
  } catch {
    return null;
  }
};

/**
 * The measurements' git. The buffer is generous because one call reads every
 * commit message on `main`, and the measurement that needed 256 MiB sets the
 * size for both rather than each guessing its own.
 */
export const git = (args, { cwd } = {}) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...(cwd ? { cwd } : {}),
  });

/** The date part of an ISO timestamp, which is the granularity a window has. */
export const dateOnly = (iso) => (iso ? String(iso).slice(0, 10) : iso);

/** `days` before `iso`, as `YYYY-MM-DD`. */
export const shiftDays = (iso, days) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

/** Write `text` to `path`, creating the directory a measurement writes into. */
export const writeFile = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

/** True when `moduleUrl` is the script node was asked to run. */
export const isMain = (moduleUrl) =>
  Boolean(process.argv[1]) &&
  fileURLToPath(moduleUrl) ===
    fileURLToPath(
      new URL(
        `file://${process.argv[1].replace(/\\/g, '/').replace(/^([A-Za-z]:)/, '/$1')}`,
      ),
    );
