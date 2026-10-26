/**
 * The steps of `release:cut` that run after the release branch exists: the
 * OpenAPI sync, the staging, the leftover check, and the commit.
 *
 * Kept out of `tools/scripts/release.mjs` so they can run against a scratch
 * repository under test; that script runs top-level and exits the process.
 * These throw `AbandonedCutError` instead, and the script turns it into its
 * usual `die()`. The pure parts they build on live in `release-notes.ts`.
 */
import { execSync } from 'node:child_process';

import { abandonedCutSteps, unstagedPaths } from './release-notes.ts';

/** A cut that stopped after creating the release branch. */
export class AbandonedCutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AbandonedCutError';
  }
}

/**
 * Paths git reports as changed but not staged, untracked ones included.
 *
 * @param {{cwd?: string}} [options]
 * @returns {string[]}
 */
export function readUnstagedPaths({ cwd } = {}) {
  // Raw output: trimming would eat the first line's status column.
  return unstagedPaths(
    execSync('git status --porcelain', {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8'),
  );
}

/**
 * `openapi:sync` also regenerates backend routes and client code. On a clean
 * `main` those only move by the version stamp; anything else means main's
 * generated output had drifted from its contract, which belongs in its own
 * pull request rather than inside the release commit.
 *
 * @param {string} releaseBranch
 * @param {{cwd?: string}} [options]
 */
export function assertNothingLeftUnstaged(releaseBranch, { cwd } = {}) {
  const leftover = readUnstagedPaths({ cwd });
  if (leftover.length > 0) {
    throw new AbandonedCutError(
      'Refusing to commit the release: `yarn openapi:sync` changed files the release commit does not carry:\n' +
        leftover.map((file) => `  - ${file}`).join('\n') +
        '\nThe generated OpenAPI output on main has drifted from its contract. Fix that on main in a pull request first.\n' +
        abandonedCutSteps(releaseBranch),
    );
  }
}

/**
 * Runs one step of the cut. Past `git checkout -b`, a failure leaves the
 * release branch checked out with uncommitted changes, so the error names the
 * way back to a clean main.
 *
 * @param {string} command
 * @param {string} releaseBranch
 * @param {{cwd?: string, stdio?: import('node:child_process').StdioOptions}} [options]
 */
export function runOrAbandonCut(
  command,
  releaseBranch,
  { cwd, stdio = 'inherit' } = {},
) {
  try {
    execSync(command, { cwd, stdio });
  } catch {
    throw new AbandonedCutError(
      `\`${command}\` failed (output above).\n${abandonedCutSteps(releaseBranch)}`,
    );
  }
}
