#!/usr/bin/env node
// Selects the review obligations a diff triggers, outside the model (ADR 0074's
// sibling problem: what a reviewer is told is not what a reviewer does).
//
//   node tools/scripts/review/select-obligations.ts --base <sha> --head <sha> [--out <worklist.json>]
//
// The worklist is the whole point. An obligation in a brief competes for
// attention with every other instruction and fires at the model's discretion;
// an obligation in a worklist arrives already matched, with the file and line
// that matched it, and the reviewer's job is to answer rather than to notice.
// Selecting here also means a diff that triggers nothing costs nothing.
//
// Exit 0 = selection written (an empty worklist is a normal, correct result).
// Exit 2 = the script could not run (bad refs, unreadable catalogue).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { errorMessage } from '../lib/error-message.ts';
import { cannotRun, isMain, parseArgs } from './cli.ts';
import type { GuardedEnum } from '../lib/enum-fanout-guarded.ts';
import type { ObligationCatalogue } from './obligations.ts';
import {
  enumMemberValues,
  loadObligationCatalogue,
  parseAddedLines,
  selectObligations,
} from './obligations.ts';

const USAGE =
  'usage: select-obligations.ts --base <sha> --head <sha> [--out <path>] [--catalogue <path>]';

export const main = (
  argv: string[],
  {
    run = gitDiff,
    read = gitShow,
  }: {
    run?: (base: string, head: string) => string;
    read?: (head: string, path: string) => string | null;
  } = {},
): void => {
  const bail = cannotRun('review-obligations-select');
  const { flags } = parseArgs(argv);
  if (!flags.base || !flags.head) bail(USAGE);
  if ('out' in flags && !flags.out) bail('--out needs a path');

  // A guarded enum's member values are read at the reviewed head, never from
  // the tooling tree: a replay's head predates members the tooling knows.
  // The guard above exits unless both refs are present.
  const base = flags.base!;
  const head = flags.head!;
  const membersOf = (guard: GuardedEnum) =>
    enumMemberValues(read(head, guard.definedIn), guard.enum);

  let catalogue: ObligationCatalogue;
  try {
    catalogue = flags.catalogue
      ? loadObligationCatalogue(flags.catalogue, { membersOf })
      : loadObligationCatalogue(undefined, { membersOf });
  } catch (err) {
    return bail(errorMessage(err));
  }

  let diff: string;
  try {
    diff = run(base, head);
  } catch (err) {
    return bail(`git diff failed: ${errorMessage(err)}`);
  }

  const worklist = selectObligations({
    catalogue,
    addedLines: parseAddedLines(diff),
    head,
  });

  const text = `${JSON.stringify(worklist, null, 2)}\n`;
  if (flags.out) {
    writeFileSync(flags.out, text);
    const sites = worklist.selected.reduce((n, o) => n + o.sites.length, 0);
    console.log(
      `review-obligations-select: ${worklist.selected.length} obligation(s), ${sites} site(s), written to ${flags.out}`,
    );
  } else {
    process.stdout.write(text);
  }
};

// Three-dot, matching the skill's diff command, so the worklist covers what the
// branch changed rather than what the base moved on to.
const gitDiff = (base: string, head: string): string =>
  execFileSync('git', ['diff', '-U0', `${base}...${head}`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

// A file absent at head is not an error: the enum may postdate the range, and
// the trigger then falls back to the enum-qualified shapes.
const gitShow = (head: string, path: string): string | null => {
  try {
    return execFileSync('git', ['show', `${head}:${path}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
};

if (isMain(import.meta.url)) main(process.argv.slice(2));
