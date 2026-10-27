#!/usr/bin/env node
// Reads a reviewer transcript and writes the run facts file the validator
// takes with `--facts` (issue #1031, ADR 0123).
//
//   node tools/scripts/review/read-transcript-facts.ts <execution-file>
//     --out <run-facts.json> [--index <CODING_STANDARDS.md>]
//
// <execution-file> is what `anthropics/claude-code-action` leaves behind. It
// may be missing or empty: a reviewer that crashed before its first turn
// leaves none, and that is written down as an unknown shape rather than
// skipped, so the report never falls back to the reviewer's own claims.
//
// --index is the standards index at the reviewed head. It decides which of
// the files a sub-agent opened are standards documents. Without it only the
// index itself and `AGENTS.md` files qualify.
//
// Always exits 0 once it has its arguments: this script reports what the
// transcript says, and its callers decide what that costs. A transcript whose
// shape it cannot read prints a workflow error annotation naming the Claude
// Code CLI version, because the shape belongs to that CLI and the first
// unreadable run should point at the cause.
//
// Exit 2 = the script could not run (bad arguments, or --out not writable).
import { readFileSync, writeFileSync } from 'node:fs';

import { cannotRun, isMain, parseArgs } from './cli.ts';
import { readTranscriptFacts } from './transcript-facts.ts';

const USAGE =
  'usage: read-transcript-facts.ts <execution-file> --out <run-facts.json> [--index <CODING_STANDARDS.md>]';

const readOr = (path, fallback) => {
  if (!path) return fallback;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return fallback;
  }
};

// A reason is text derived from a file the reviewer's session wrote, so it is
// escaped the way a workflow command's message is.
const escapeMessage = (message) =>
  message
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');

export const main = (argv) => {
  const bail = cannotRun('review-facts');
  const { positional, flags } = parseArgs(argv);
  if (!flags.out) bail(USAGE);
  const [file] = positional;

  // An unreadable transcript is classified like an unparseable one.
  const text = readOr(file, '');
  const index = 'index' in flags ? readOr(flags.index, null) : null;
  const facts = readTranscriptFacts(text, { index });

  if (facts.shape === 'unknown') {
    const cli = facts.cliVersion ?? 'unknown';
    console.log(
      `::error::${escapeMessage(`the reviewer transcript could not be read for run facts (Claude Code CLI ${cli}): ${facts.shapeReason}. The report's standards sources and executed commands are recorded as unknown, not as the reviewer's own claim. If this appears on every review, the transcript format changed under tools/scripts/review/transcript-facts.ts.`)}`,
    );
  } else {
    const { standards, spec } = facts.axes;
    console.log(
      `review-facts: Claude Code CLI ${facts.cliVersion}, ${facts.models.join(', ')}, ${facts.durationMs} ms; ` +
        `Standards ${standards.toolCalls} tool call(s), Spec ${spec.toolCalls}; ` +
        `standards sources opened: ${facts.standardsSources.join(', ') || 'none'}`,
    );
  }

  try {
    writeFileSync(flags.out, `${JSON.stringify(facts, null, 2)}\n`);
  } catch (err) {
    bail(`could not write ${flags.out}: ${err.message}`);
  }
};

if (isMain(import.meta.url)) main(process.argv.slice(2));
