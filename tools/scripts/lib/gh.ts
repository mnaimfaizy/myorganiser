/**
 * The one way tooling scripts call the GitHub CLI and read its output.
 *
 * `gh` returns stdout and lets a failed command throw exactly as
 * `execFileSync` threw it, so callers that report `err.stderr` or branch on
 * `err.status` keep working. `ghJson` adds one more failure a caller may want
 * to tell apart — output that is not JSON, such as an HTML error page — as a
 * `GhJsonError`. What a failure *means* stays with each caller: the release
 * script refuses a Cut, the review measurements record an unreadable lookup.
 *
 * Scripts that branch on the exit status without throwing (`spawnSync`, as
 * in `ai/create-pr.mjs`) are a different contract and do not use this.
 */
import { execFileSync } from 'node:child_process';

// `gh pr list --json files` over a few hundred Pull Requests runs to tens of
// megabytes; Node's 1 MiB default truncates it into a thrown error.
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

export class GhJsonError extends Error {
  args: readonly string[];
  stdout: string;

  constructor(args: readonly string[], stdout: string, cause: unknown) {
    super(`gh ${args.join(' ')} did not return JSON`, { cause });
    this.name = 'GhJsonError';
    this.args = args;
    this.stdout = stdout;
  }
}

/** The options `execFileSync` is called with — always text, never a Buffer. */
export interface GhExecOptions {
  encoding: 'utf8';
  stdio: ['pipe', 'pipe', 'pipe'];
  maxBuffer: number;
  windowsHide: boolean;
  input?: string;
}

/** The injectable stand-in for `execFileSync`, narrowed to what `gh` calls. */
export type GhExec = (
  file: string,
  args: readonly string[],
  options: GhExecOptions,
) => string;

export interface GhOptions {
  input?: string;
  maxBuffer?: number;
  exec?: GhExec;
}

export function gh(
  args: readonly string[],
  {
    input,
    maxBuffer = DEFAULT_MAX_BUFFER,
    exec = execFileSync,
  }: GhOptions = {},
): string {
  const options: GhExecOptions = {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer,
    windowsHide: true,
  };
  if (input !== undefined) options.input = input;
  return exec('gh', args, options);
}

/** `gh`, parsed. Empty output is `null`. */
export function ghJson(args: readonly string[], options?: GhOptions): unknown {
  const stdout = gh(args, options);
  try {
    return JSON.parse(stdout || 'null');
  } catch (error) {
    throw new GhJsonError(args, stdout, error);
  }
}
