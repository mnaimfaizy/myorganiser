#!/usr/bin/env node

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  classifyCommitFailure,
  findBlockedSecretPaths,
  formatCommitFailureTrailer,
  type CommitFailureTrailerFields,
} from './classify-commit-failure.ts';

const usage = `Usage:
  corepack yarn ai:commit --message-file path/to/message.txt
  corepack yarn ai:commit --message "type(scope): subject"

Agents should use --message-file. Stdin is accepted for non-interactive callers.

Options:
  --message-file <path>  Read the commit message from a file. Preferred.
  --message <text>       Commit message text to use.
  --help                 Show this help text.
`;

interface CommitOptions {
  help: boolean;
  message: string | null;
  messageFile: string | null;
}

function writeTrailer(fields: CommitFailureTrailerFields): void {
  process.stderr.write(formatCommitFailureTrailer(fields));
}

function fail(
  message: string,
  trailer?: CommitFailureTrailerFields,
  exitCode = 1,
): never {
  process.stderr.write(`${message}\n`);
  if (trailer) {
    writeTrailer(trailer);
  }
  process.exit(exitCode);
}

function parseArgs(argv: string[]): CommitOptions {
  const options: CommitOptions = {
    help: false,
    message: null,
    messageFile: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--message') {
      options.message = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--message-file') {
      options.messageFile = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`, {
      reason: 'unknown',
      hint: 'Use --message-file <path> or --message <text>.',
    });
  }

  return options;
}

function run(
  command: string,
  args: string[],
  { capture = false }: { capture?: boolean } = {},
): SpawnSyncReturns<string> {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    fail(`Failed to run ${command}: ${result.error.message}`, {
      reason: 'unknown',
      hint: `Retry after fixing the ${command} launch error.`,
    });
  }

  return result;
}

function readCommitMessage(options: CommitOptions): string {
  if (options.message && options.messageFile) {
    fail('Provide either --message or --message-file, not both.', {
      reason: 'unknown',
      hint: 'Prefer --message-file <path>.',
    });
  }

  if (options.messageFile) {
    return readFileSync(options.messageFile, 'utf8');
  }

  if (options.message) {
    return options.message;
  }

  if (!process.stdin.isTTY) {
    return readFileSync(0, 'utf8');
  }

  fail(
    'A commit message is required. Use --message-file (preferred) or --message.',
    {
      reason: 'unknown',
      hint: 'corepack yarn ai:commit --message-file <path>',
    },
  );
}

function listStagedPaths({
  diffFilter,
}: { diffFilter?: string } = {}): string[] {
  const args = ['diff', '--cached', '--name-only'];
  if (diffFilter) {
    args.push(`--diff-filter=${diffFilter}`);
  }

  const result = run('git', args, {
    capture: true,
  });

  if (result.status !== 0) {
    fail('Unable to inspect staged changes before committing.', {
      reason: 'unknown',
      hint: 'Confirm git status, stage the intended files, then retry.',
    });
  }

  return (result.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function ensureStagedChanges(stagedPaths: string[]): void {
  if (stagedPaths.length > 0) {
    return;
  }

  fail(
    'No staged changes found. Stage the intended files before running ai:commit.',
    {
      reason: 'empty-index',
      hint: 'Stage specific files (never git add .), then retry corepack yarn ai:commit --message-file <path>.',
    },
  );
}

function rejectStagedSecrets(stagedPaths: string[]): void {
  const blocked = findBlockedSecretPaths(stagedPaths);
  if (blocked.length === 0) {
    return;
  }

  fail(`Refusing to commit secret-looking paths: ${blocked.join(', ')}`, {
    reason: 'secret',
    paths: blocked,
    hint: 'Unstage those files (`git restore --staged <path>`) and keep secrets out of the commit.',
  });
}

function runCommit(messagePath: string): SpawnSyncReturns<string> {
  const result = spawnSync('git', ['commit', '--file', messagePath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  if (result.error) {
    fail(`Failed to run git: ${result.error.message}`, {
      reason: 'unknown',
      hint: 'Retry after fixing the git launch error.',
    });
  }

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  return result;
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  process.stdout.write(usage);
  process.exit(0);
}

const commitMessage = readCommitMessage(options).trimEnd();

if (!commitMessage.trim()) {
  fail('Commit message cannot be empty.', {
    reason: 'unknown',
    hint: 'Write a Conventional Commit message, then pass it with --message-file.',
  });
}

const stagedPaths = listStagedPaths();
ensureStagedChanges(stagedPaths);
rejectStagedSecrets(listStagedPaths({ diffFilter: 'ACMR' }));

const tempDir = mkdtempSync(join(tmpdir(), 'myorganiser-ai-commit-'));
const messagePath = join(tempDir, 'COMMIT_EDITMSG');

writeFileSync(messagePath, `${commitMessage}\n`, 'utf8');

const commitResult = runCommit(messagePath);

rmSync(tempDir, { force: true, recursive: true });

if (commitResult.status === 0) {
  process.exit(0);
}

const output = `${commitResult.stdout ?? ''}\n${commitResult.stderr ?? ''}`;
writeTrailer(classifyCommitFailure(output));
process.exit(typeof commitResult.status === 'number' ? commitResult.status : 1);
