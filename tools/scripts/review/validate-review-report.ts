#!/usr/bin/env node
// Validates a `/code-review` report and writes its normalized form (ADR 0071).
//
//   node tools/scripts/review/validate-review-report.ts <report.json>
//     [--out <normalized.json>] [--tier <review:label>] [--previous <normalized.json>]
//     [--facts <run-facts.json>] [--worklist <obligations.json>]
//
// A report is accepted whole or rejected whole. On rejection every schema
// issue is printed, one per line, and nothing is written — a partial verdict
// is the thing this script exists to refuse. The normalized file carries the
// derived finding ids, the computed verdict, and the effective tier; it is
// what the renderer and the poster read.
//
// --previous is the previous run's normalized report. A finding that report
// already held — same axis, rule id, and file, on overlapping lines — keeps
// its id; every other finding is minted one (ADR 0071 item 6, issue #940).
// It is how a finding is recognised across pushes, so a run that has a
// previous report and is not handed it reads every finding as new. A report
// of another schema version lends no ids and is not an error.
//
// --facts is the run facts file `read-transcript-facts.ts` wrote from the
// reviewer transcript. It overwrites the report's `standardsSources`,
// `executed`, `durationMs`, `model`, and `cost`, which are facts about the run
// and not the reviewer's to state (ADR 0123). Without it the report keeps what
// the reviewer wrote and is marked `runFactsFrom: reviewer`.
//
// With --facts the run is also judged (run-ladder.ts). A fact that fails
// `Agent Review Ran` — no sub-agent read an axis's brief, a reported
// finding is not one a sub-agent returned, or a finding's executed evidence
// is not in the transcript (ADR 0126) — is written to
// `runFacts.failures` and printed; a fact that tightens the tier is written
// to `runFacts.tightenedBy` and moves `effectiveTier`. Neither rejects the
// report: it met its contract, and the caller fails the check from the
// normalized file, so the findings are still published.
//
// --worklist is the obligation worklist the selector wrote. It is read for
// one thing: which findings the main agent was meant to write itself, which
// no sub-agent returned and which are not a failure. A path that does not
// exist is a run with no worklist, as it is everywhere else in the pipeline.
//
// Exit 0 = valid, normalized report written or printed.
// Exit 1 = invalid report (the reviewer's output does not meet the contract).
// Exit 2 = the script could not run (missing file, unreadable JSON, a
//          --previous of this schema version that is not a normalized report,
//          a --facts that is not a run facts file, or a --worklist that
//          exists and is not JSON).
import { existsSync, writeFileSync } from 'node:fs';
import { ZodError } from 'zod';

import { cannotRun, isMain, parseArgs, readJsonOr } from './cli.ts';
import {
  formatIssues,
  isComparableReport,
  NormalizedReportSchema,
  normalizeReport,
  RunFactsSchema,
} from './schema.ts';

const USAGE =
  'usage: validate-review-report.ts <report.json> [--out <path>] [--tier <review:label>] [--previous <normalized.json>] [--facts <run-facts.json>] [--worklist <obligations.json>]';

export const main = (argv) => {
  const bail = cannotRun('review-validate');
  const { positional, flags } = parseArgs(argv);
  const [inputPath] = positional;
  if (!inputPath) bail(USAGE);
  if ('out' in flags && !flags.out) bail('--out needs a path');

  const raw = readJsonOr(inputPath, bail);
  // In CI the tier is the classifier's job output, not whatever the reviewer
  // wrote into the envelope (ADR 0070 item 3). The schema still checks it.
  if ('tier' in flags) {
    if (!flags.tier) bail('--tier needs a review:* label');
    if (raw && typeof raw === 'object') raw.tier = flags.tier;
  }

  // Ids are carried out of this file, so it is held to the contract it was
  // written under: a comparable report that does not parse is somebody else's
  // file under the artifact's name, and lending ids from it would mint
  // identities nothing can trace.
  let previous = null;
  if ('previous' in flags) {
    if (!flags.previous) bail('--previous needs a path');
    previous = readJsonOr(flags.previous, bail);
    if (isComparableReport(previous)) {
      const parsed = NormalizedReportSchema.safeParse(previous);
      if (!parsed.success)
        bail(
          `${flags.previous} is not a normalized report\n  ${formatIssues(parsed.error).join('\n  ')}`,
        );
    }
  }

  // In CI the report's facts about its own run are the transcript's, not
  // the reviewer's (ADR 0123). A facts file that is missing or malformed
  // cannot run: falling back to what the reviewer wrote is the silent state
  // this flag exists to remove.
  let facts = null;
  if ('facts' in flags) {
    if (!flags.facts) bail('--facts needs a path');
    facts = readJsonOr(flags.facts, bail);
    const parsed = RunFactsSchema.safeParse(facts);
    if (!parsed.success)
      bail(
        `${flags.facts} is not a run facts file\n  ${formatIssues(parsed.error).join('\n  ')}`,
      );
  }

  let worklist = null;
  if ('worklist' in flags) {
    if (!flags.worklist) bail('--worklist needs a path');
    if (existsSync(flags.worklist)) worklist = readJsonOr(flags.worklist, bail);
  }

  let normalized;
  try {
    normalized = normalizeReport(raw, { previous, facts, worklist });
  } catch (err) {
    if (!(err instanceof ZodError)) throw err;
    console.error('review-validate: report rejected');
    for (const line of formatIssues(err)) console.error(`  ${line}`);
    process.exit(1);
  }

  // The reader annotates a transcript it could not read. This is the one
  // case it cannot see: the transcript read cleanly and only the report
  // shows it cannot be right.
  if (facts?.shape === 'readable' && normalized.runFacts?.shape === 'unknown') {
    const message = `the reviewer transcript does not account for this report (Claude Code CLI ${normalized.runFacts.cliVersion ?? 'unknown'}): ${normalized.runFacts.shapeReason}. Its run facts are recorded as unknown. If this appears on every review, the transcript format changed under tools/scripts/review/transcript-facts.ts.`;
    console.log(
      `::error::${message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`,
    );
  }

  // Printed, not annotated: the report is validated twice in CI, and the
  // step that fails the check writes the one annotation.
  for (const failure of normalized.runFacts?.failures ?? [])
    console.log(
      `review-validate: run failure (${failure.reason}): ${failure.detail}`,
    );

  const text = `${JSON.stringify(normalized, null, 2)}\n`;
  if (flags.out) {
    writeFileSync(flags.out, text);
    console.log(
      `review-validate: ${normalized.findings.length} finding(s), verdict ${normalized.verdict}, written to ${flags.out}`,
    );
  } else {
    process.stdout.write(text);
  }
};

if (isMain(import.meta.url)) main(process.argv.slice(2));
