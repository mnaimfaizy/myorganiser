/**
 * The `gh` calls the Merge Train, `runs:ready` and the Sign-off Issue's IO
 * share: run `gh` without throwing, name the repository it points at, and name
 * the login it runs as. A lib, so `ci/` scripts and other libs import it alike.
 */
import { spawnSync } from 'node:child_process';

/** `gh`, with its exit status and output, never thrown. */
export const runGh = (
  args: readonly string[],
): { status: number; stdout: string; stderr: string } => {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};

/** The `<owner>/<name>` of the repository `gh` is pointed at; null when unreadable. */
export const currentRepository = (): string | null => {
  const result = runGh([
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '-q',
    '.nameWithOwner',
  ]);
  return result.status === 0 && result.stdout.trim()
    ? result.stdout.trim()
    : null;
};

/** The `gh` login the caller runs as, so it edits only its own comments. */
let cachedViewerLogin: string | null | undefined;
export const viewerLogin = (): string | null => {
  if (cachedViewerLogin !== undefined) return cachedViewerLogin;
  const result = runGh(['api', 'user', '-q', '.login']);
  cachedViewerLogin =
    result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
  return cachedViewerLogin;
};
