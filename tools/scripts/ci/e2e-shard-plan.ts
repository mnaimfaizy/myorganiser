#!/usr/bin/env node

/**
 * Prints the spec files one E2E shard runs, balanced by duration (ADR 0050).
 *
 *   node tools/scripts/ci/e2e-shard-plan.ts --shard 2/4
 *   node tools/scripts/ci/e2e-shard-plan.ts --print 4
 *
 * `--shard k/n` prints one Playwright file filter per line, for the `Run E2E
 * shard` step to pass to `nx run web-e2e:e2e`. `--print n` shows the whole
 * plan with each shard's predicted seconds, for a person checking the
 * balance after refreshing `apps/web-e2e/shard-weights.json`.
 *
 * An empty shard is an error rather than an empty line: Playwright given no
 * file filter runs every test, so a shard with nothing to do would otherwise
 * run the whole suite.
 *
 * Exit 0 = plan printed. Exit 2 = bad arguments, unreadable weights, or an
 * empty shard.
 */

import { join, resolve } from 'node:path';
import process from 'node:process';

import { errorMessage } from '../lib/error-message.ts';
import {
  E2E_TEST_DIR,
  SHARD_WEIGHTS_FILE,
  fileFilter,
  listSpecFiles,
  parseShardArg,
  planShards,
  readShardWeights,
} from '../lib/e2e-shard-plan.ts';

const USAGE = 'usage: e2e-shard-plan.ts --shard <k/n> | --print <n>';

function main(argv: readonly string[]): number {
  const [flag, value] = argv;
  if ((flag !== '--shard' && flag !== '--print') || !value) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const root = resolve(import.meta.dirname, '../../..');
  const files = listSpecFiles(join(root, E2E_TEST_DIR));
  const weights = readShardWeights(join(root, SHARD_WEIGHTS_FILE));

  if (flag === '--print') {
    const total = parseShardArg(`1/${value}`).total;
    planShards(files, weights, total).forEach((shard, index) => {
      process.stdout.write(
        `shard ${index + 1}/${total}: ${shard.seconds.toFixed(1)}s, ${shard.files.length} file(s)\n`,
      );
      for (const file of shard.files) process.stdout.write(`  ${file}\n`);
    });
    return 0;
  }

  const { current, total } = parseShardArg(value);
  const shard = planShards(files, weights, total)[current - 1];
  if (shard.files.length === 0) {
    process.stderr.write(
      `shard ${current}/${total} has no spec files; Playwright would run the whole suite\n`,
    );
    return 2;
  }
  for (const file of shard.files) process.stdout.write(`${fileFilter(file)}\n`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`e2e-shard-plan: ${errorMessage(error)}\n`);
  process.exitCode = 2;
}
