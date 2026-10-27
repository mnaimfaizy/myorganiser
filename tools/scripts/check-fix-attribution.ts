#!/usr/bin/env node
// Asserts that a fix Pull Request's commits name the change that introduced
// the defect it repairs, or declare that nobody could (ADR 0100).
//
//   node tools/scripts/check-fix-attribution.ts \
//     --base <sha> --head <sha> --branch <head ref> [--title <pr title>]
//
// The escaped-defect rate (ADR 0077) is a fraction whose numerator is built
// from fixes that name their root cause. Its first measurement read 57 fixes
// and found that none did, so the rate could never leave `not measurable`.
// Nothing asked a fix to write the fact down; ADR 0077's consequences named
// the line — `Introduced in #415` — and a sentence is not an assertion
// (ADR 0085).
//
// This check **asks the measurement** rather than restating it: whether the
// Pull Request is a fix is `pullRequestType` from measure-escaped-defects.mjs,
// and whether its commits attribute the defect is `attributeFix` from
// escaped-defects.mjs, over the same `%s%n%b` text the measurement reads. A
// copy of either would agree on the examples in a test and drift on
// everything else (ADR 0076 item 4) — and a gate that passed a line the
// measurement cannot read would be satisfied while the rate stayed empty.
//
// ASSERTS: when the Pull Request is a fix — a `fix/` branch, or a `fix`
// Conventional Commit title on a branch whose prefix names no type — at least
// one commit in `base..head` carries a line the measurement reads as
// attribution: any `ROOT_CAUSE_MARKERS` phrasing, of which `Introduced in #N`
// is the one documented, or the declaration `Introduced in unknown: <why>`.
//
// DOES NOT ASSERT that the reference is right, that it resolves to a merged
// Pull Request, or that it is earlier than the fix. Those are facts about
// history the measurement already classifies (`unresolved`, `not-earlier`),
// where a wrong reference is counted and visible; failing a Pull Request over
// them would make the author argue with the archaeology in CI.
//
// DOES NOT READ the Pull Request body or the closing issue. The measurement
// reads both, but only with a token, and its first run had none: commits are
// the one source every measurement reads, so they are the one source this
// gate accepts. A fix whose only attribution is in its body fails here and
// would have measured nothing on a git-only run.
//
// Exit 0 = not a fix, or the fix names its origin. Exit 1 = a fix that does
// not. Exit 2 = could not run.
import { execFileSync } from 'node:child_process';

import { attributeFix } from './review/escaped-defects.ts';
import { pullRequestType } from './review/measure-escaped-defects.ts';

const fail: (msg: string) => never = (msg) => {
  console.error(`fix-attribution: ${msg}`);
  process.exit(2);
};

export const parseArgs = (argv: string[]): Record<string, string> => {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const next = argv[i + 1];
    flags[arg.slice(2)] = next && !next.startsWith('--') ? argv[++i] : '';
  }
  return flags;
};

/** What `attributeFix` found, once it found something. */
export type FixAttribution = NonNullable<ReturnType<typeof attributeFix>>;

/**
 * The verdict for one Pull Request. `type` is the Pull Request type the branch
 * or title declares, which is `null` when neither declares one.
 */
export type FixVerdict =
  | { status: 'not-a-fix'; type: string | null }
  | { status: 'unattributed'; type: string | null }
  | {
      status: 'attributed';
      type: string | null;
      attribution: FixAttribution;
    };

export interface JudgeInput {
  branch?: string;
  title?: string;
  commits: string;
}

/** The verdict for one Pull Request, given the text of its commits. */
export const judge = ({ branch, title, commits }: JudgeInput): FixVerdict => {
  const type = pullRequestType({ branch: branch || null, title: title || '' });
  if (type !== 'fix') return { status: 'not-a-fix', type };
  const attribution = attributeFix({ commits });
  if (!attribution) return { status: 'unattributed', type };
  return { status: 'attributed', type, attribution };
};

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (!flags.base || !flags.head)
    fail('--base <sha> and --head <sha> are required');

  let commits: string;
  try {
    commits = execFileSync(
      'git',
      ['log', `${flags.base}..${flags.head}`, '--format=%s%n%b%n'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (err) {
    fail(
      `could not read ${flags.base}..${flags.head}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const verdict = judge({ branch: flags.branch, title: flags.title, commits });
  if (verdict.status === 'not-a-fix') {
    console.log(
      `fix-attribution: not a fix (type ${verdict.type ?? 'unknown'}), nothing to assert`,
    );
    process.exit(0);
  }
  if (verdict.status === 'attributed') {
    const { marker, quote } = verdict.attribution;
    console.log(`fix-attribution: ${marker} — "${quote}"`);
    process.exit(0);
  }
  console.error(
    'fix-attribution: this is a fix, and no commit names the change that ' +
      'introduced the defect (ADR 0100).\n\n' +
      'Add one line to a commit body on this branch:\n\n' +
      '  Introduced in #<pull request>\n\n' +
      'or, when you looked and nothing can be named:\n\n' +
      '  Introduced in unknown: <why>\n\n' +
      'The escaped-defect rate (ADR 0077) is built from this line; a fix ' +
      'without it measures nothing.',
  );
  process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('check-fix-attribution.ts'))
  main();
