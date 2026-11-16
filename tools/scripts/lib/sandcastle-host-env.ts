/**
 * Where the dispatcher's host credentials come from (#1593, ADR 0010).
 *
 * `@ai-hero/sandcastle`'s own `run()` reads `.sandcastle/.env` and forwards every
 * key listed there into the sandbox, whichever agent runs. So that file must not
 * hold a key: the dispatch refuses to start when it does, and host credentials
 * come from, highest first:
 *
 *   1. a 1Password Environment, when `OP_ENVIRONMENT_ID` is set, read in memory
 *      on the host (nothing is written to disk, no value is printed);
 *   2. the shell;
 *   3. a gitignored `.sandcastle/secrets.env` that only host code reads.
 *
 * `OP_ENVIRONMENT_ID` is not a secret and may live in `secrets.env` alone; the
 * shell's value wins. Which of these credentials reaches a container is decided
 * elsewhere, per agent kind (sandcastle-provider-env.ts).
 *
 * Reading is injected (`readText`, `readEnvironment`) so every rule here is
 * tested without a filesystem, a 1Password app, or Docker.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';

type Env = Readonly<Record<string, string | undefined>>;

export type RunOp = (bin: string, args: string[]) => string;

export const SECRETS_FILE = 'secrets.env';

/** `KEY=value` lines; blanks and `#` comments skipped; one layer of quotes removed. */
export function parseDotenv(text: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, '');
    if (!key) continue;
    parsed[key] = line
      .slice(eq + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
  }
  return parsed;
}

/**
 * Throws when the file Sandcastle forwards wholesale holds any key. `null`
 * means the file does not exist. An empty value still counts: Sandcastle then
 * takes the key's value from the shell. The message names keys, never values.
 */
export function assertNoForwardedEnvFile(text: string | null): void {
  if (text === null) return;
  const keys = Object.keys(parseDotenv(text));
  if (keys.length === 0) return;
  throw new Error(
    `.sandcastle/.env sets ${keys.join(', ')}. Sandcastle forwards every key in that file into ` +
      'the sandbox, whichever agent runs. Delete the file and put credentials in a 1Password ' +
      'Environment (OP_ENVIRONMENT_ID), your shell, or the gitignored .sandcastle/secrets.env.',
  );
}

/** The Environment id: the shell's value, else the secrets file's; blank means none. */
export function resolveOpEnvironmentId(
  shell: Env,
  secretsFile: Env,
): string | undefined {
  const id = (
    shell.OP_ENVIRONMENT_ID ||
    secretsFile.OP_ENVIRONMENT_ID ||
    ''
  ).trim();
  return id || undefined;
}

/**
 * Which 1Password CLI to call. Under WSL the Linux `op` cannot use the Windows
 * desktop app, so the Windows `op.exe` is used; with a service-account token the
 * Linux `op` works. `OP_CLI` overrides both.
 */
export function opBinary(
  env: Env,
  wsl: boolean = /microsoft/i.test(release()),
): string {
  if (env.OP_CLI) return env.OP_CLI;
  return wsl && !env.OP_SERVICE_ACCOUNT_TOKEN ? 'op.exe' : 'op';
}

/** An id is passed to `op` as an argument; anything that could read as a flag is refused. */
const ENVIRONMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const runOp: RunOp = (bin, args) =>
  execFileSync(bin, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });

function failureDetail(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  return String(stderr ? stderr : ((error as Error).message ?? error)).trim();
}

/**
 * Every variable of a 1Password Environment, in memory. `op environment read`
 * is the current CLI's command; a CLI that lacks it is asked with the other
 * `op environment secret list` form. The output is never logged. A failure names
 * the id, the likely cause and the first line of `op`'s own error text.
 */
export function readOpEnvironment(
  id: string,
  env: Env,
  run: RunOp = runOp,
): Record<string, string> {
  if (!ENVIRONMENT_ID_PATTERN.test(id)) {
    throw new Error(
      'OP_ENVIRONMENT_ID must be the Environment id copied from 1Password (letters, digits, "-" and "_" only).',
    );
  }
  const bin = opBinary(env);
  const attempts: string[][] = [
    ['environment', 'read', id],
    ['environment', 'secret', 'list', id, '--reveal', '--format=dotenv'],
  ];
  let detail = '';
  let missingBinary = false;
  for (const args of attempts) {
    try {
      return parseDotenv(run(bin, args));
    } catch (error) {
      detail = failureDetail(error);
      if (
        (error as { code?: unknown }).code === 'ENOENT' ||
        /ENOENT/.test(detail)
      ) {
        missingBinary = true;
        break;
      }
      if (!/unknown command|unknown flag/i.test(detail)) break;
    }
  }
  const hint = missingBinary
    ? ` \`${bin}\` was not found. Install the 1Password CLI, or set OP_CLI to its path.`
    : /couldn't be found|not found|no environment/i.test(detail)
      ? ' Check OP_ENVIRONMENT_ID (1Password: Developer > View Environments > Manage environment).'
      : /unknown command|unknown flag/i.test(detail)
        ? ' This 1Password CLI has no Environments support; update it (the beta channel, or 2.42.0+).'
        : ' Is the 1Password desktop app unlocked, with Settings > Developer > Integrate with 1Password CLI on?';
  throw new Error(
    `Could not read 1Password Environment ${id} with ${bin}.${hint}\n${detail.split('\n')[0]}`,
  );
}

/** Where credentials were read from, for the run header. Never includes a value. */
export function credentialSources({
  environmentId,
  opBin,
  secretsFile,
}: {
  environmentId: string | undefined;
  opBin: string;
  secretsFile: boolean;
}): string {
  return [
    ...(environmentId
      ? [`1Password Environment ${environmentId} via ${opBin}`]
      : []),
    'shell',
    ...(secretsFile ? ['.sandcastle/secrets.env'] : []),
  ].join(' > ');
}

function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return null;
    throw error;
  }
}

const withoutBlankValues = (record: Env): Record<string, string> =>
  Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  );

/**
 * The host's credentials and settings. Refuses first when `.sandcastle/.env`
 * holds a key, so no Environment is read for a run that cannot start.
 */
export function loadHostEnv({
  sandcastleDir,
  shell,
  readText = readTextFile,
  readEnvironment = readOpEnvironment,
}: {
  sandcastleDir: string;
  shell: Env;
  readText?: (path: string) => string | null;
  readEnvironment?: (id: string, env: Env) => Record<string, string>;
}): { env: Record<string, string>; sources: string } {
  assertNoForwardedEnvFile(readText(join(sandcastleDir, '.env')));

  const secretsText = readText(join(sandcastleDir, SECRETS_FILE));
  const fromFile = secretsText === null ? {} : parseDotenv(secretsText);
  const merged = {
    ...withoutBlankValues(fromFile),
    ...withoutBlankValues(shell),
  };

  const environmentId = resolveOpEnvironmentId(shell, fromFile);
  const fromEnvironment = environmentId
    ? withoutBlankValues(readEnvironment(environmentId, merged))
    : {};

  return {
    env: { ...merged, ...fromEnvironment },
    sources: credentialSources({
      environmentId,
      opBin: opBinary(merged),
      secretsFile: secretsText !== null,
    }),
  };
}
