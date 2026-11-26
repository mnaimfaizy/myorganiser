import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

import type { CodexSubscriptionProbe } from './sandcastle-codex-preflight.ts';

type StatusResult = { status: number | null; stdout: string; stderr: string };
export type StatusRunner = (
  executable: string,
  args: string[],
  options: { cwd: string; env: Record<string, string> },
) => StatusResult;

function overlaps(a: string, b: string): boolean {
  const path = relative(a, b);
  return (
    path === '' ||
    (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
  );
}

/** Validate paths without opening any profile contents. */
export function validateDedicatedProfile(
  profile: string,
  excluded: string[],
): string {
  if (
    !isAbsolute(profile) ||
    excluded.length === 0 ||
    excluded.some((path) => !isAbsolute(path))
  ) {
    throw new Error(
      'A dedicated absolute profile and excluded roots are required.',
    );
  }
  if (
    lstatSync(profile).isSymbolicLink() ||
    !lstatSync(profile).isDirectory()
  ) {
    throw new Error(
      'The dedicated profile must be a directory, not a symlink.',
    );
  }
  const canonical = realpathSync(profile);
  for (const path of excluded) {
    const other = realpathSync(path);
    if (overlaps(canonical, other) || overlaps(other, canonical)) {
      throw new Error('The dedicated profile overlaps an excluded root.');
    }
  }
  return canonical;
}

const runStatus: StatusRunner = (executable, args, options) => {
  const result = spawnSync(executable, args, {
    ...options,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 16_384,
    windowsHide: true,
    shell: false,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};

/**
 * Inspect only the CLI's status message using an isolated home and no inherited
 * environment. File storage prevents falling back to a shared system keyring.
 * The status text does not distinguish all ChatGPT credential modes or prove
 * request usability, so this adapter always returns an unverified probe.
 */
type StatusOptions = {
  executable: string;
  profile: string;
  excludedRoots: string[];
  runner?: StatusRunner;
};

export function readCodexStatus(options: StatusOptions): 'chatgpt' | 'unknown' {
  if (!isAbsolute(options.executable))
    throw new Error('Codex executable must be absolute.');
  const profile = validateDedicatedProfile(
    options.profile,
    options.excludedRoots,
  );
  const result = (options.runner ?? runStatus)(
    options.executable,
    ['-c', 'cli_auth_credentials_store="file"', 'login', 'status'],
    { cwd: profile, env: { CODEX_HOME: profile, HOME: profile } },
  );
  // Never return or log status output: API-key status can contain key fragments.
  return result.status === 0 &&
    result.stdout.trim() === '' &&
    result.stderr.trim() === 'Logged in using ChatGPT'
    ? 'chatgpt'
    : 'unknown';
}

export function makeCodexStatusProbe(
  options: StatusOptions,
): CodexSubscriptionProbe {
  return async () => {
    readCodexStatus(options);
    // ChatGPT and externally supplied ChatGPT tokens share this status line.
    return { authentication: 'unknown', usable: false };
  };
}
