#!/usr/bin/env node
// Reports how much of an obligation worklist the reviewer actually answered.
//
//   node tools/scripts/check-review-obligation-answers.ts <worklist.json> <answers.json> [--out <report.json>]
//
// Thoroughness never fails a review. An unanswered obligation is a fact about
// the review's thoroughness — neither a fact about the pipeline nor a judgment
// about the diff (ADR 0073), and the finding contract is untouched by it
// (ADR 0071: a report is accepted or rejected whole, so a malformed answer
// sheet must not be able to take the findings down with it).
//
// What it buys is a split that did not exist before. A missed defect used to
// look the same whatever caused it; now it reads as one of three:
//
//   not selected      -> the trigger is wrong. Fix the pattern; it is cheap.
//   selected, unanswered -> the forcing function is too weak.
//   answered, no finding -> a capability limit, and now known to be one.
//
// It sits in tools/scripts/ rather than beside obligations.mjs because
// gates:coverage:check discovers checkers with a NON-RECURSIVE scan of that
// directory (tools/scripts/lib/gate-coverage.ts). A check-*.mjs in a
// subdirectory is invisible to the Meta-Gate: it would look wired forever,
// and if the workflow line invoking it were deleted nothing would notice.
// That is precisely the shape ADR 0074 names — a checker nothing runs — so
// this file is named and placed to be seen.
//
// Thoroughness never fails a review. Two other things do, and they are a
// different kind of fact — about the reviewer, not about the diff (ADR 0078,
// on the ground ADR 0073 already holds):
//
//   A SELF-CONTRADICTION. An answer that meets its obligation's own declared
//   defect condition while raising no finding is not a judgment the reviewer is
//   entitled to make, because the catalogue already decided that answer is a
//   finding. Run 45 is the case: `import-confirm` wrote
//   `namesEverything: false`, whose defect rule says in as many words that
//   false is a finding, and raised nothing; the completeness report called that
//   sheet complete.
//
//   A CITATION THAT DOES NOT MATCH ITS SOURCE. Every answer field that makes a
//   claim about source carries the file, the line, and the literal text at that
//   line, and this script reads that line out of the tree at the reviewed head
//   and compares it. Run 45 again: `signup` wrote `slotChild: "Input"` for the
//   two sites whose direct child is a positioning `div`, and nothing compared
//   the writing to anything. Presence was never the weak point — a wrong
//   element name is a perfectly non-blank string.
//
// Both are Assertion Gates in the ADR 0043 sense - two artifacts compared, a
// factual mismatch named - not an opinion about the diff. Neither produces a
// finding: a finding is about the code under review, and this is not.
//
// Exit 0 = answered or thin, but sound.
// Exit 1 = an answer contradicts its own defect rule, or a quotation does not
//          match the tree at head.
// Exit 2 = the script could not run (missing file, unreadable JSON, bad shape,
//          a head this clone does not have). Since `continue-on-error` came
//          off the workflow step this gates too, and deliberately: a sheet
//          nobody can parse is a fact about the reviewer in the same family as
//          one whose quotations do not hold. The two exit codes stay distinct
//          because the log should say which happened, not because one of them
//          is free.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { ZodError } from 'zod';

import { errorMessage } from './lib/error-message.ts';
import { cannotRun, isMain, parseArgs, readJsonOr } from './review/cli.mjs';
import {
  AnswerSheetSchema,
  checkAnswers,
  obligationRuleId,
} from './review/obligations.mjs';
import { formatIssues } from './review/schema.mjs';

const USAGE =
  'usage: check-review-obligation-answers.ts <worklist.json> <answers.json> [--report <report.json>] [--out <path>]';

/**
 * The tree at the reviewed head, one file at a time. `git show` rather than the
 * working tree: the checkout can have moved on, and a quotation is a claim
 * about the commit that was reviewed. A file that is not there at that commit
 * reads as absent, which is one of the mismatches worth reporting.
 */
const gitSource = (head: string) => (file: string) => {
  try {
    return execFileSync('git', ['show', `${head}:${file}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
};

/**
 * Whether the reviewed head is a commit this clone actually has.
 *
 * `git show <head>:<file>` fails the same way for a missing path and for a ref
 * that does not resolve, so without this the wrong head reports every
 * quotation as citing a file that is not in the tree — the script's loudest
 * accusation about the reviewer, made when the reviewer did nothing wrong.
 * Resolving once tells the two apart: a head nobody can read is exit 2, could
 * not run, not exit 1.
 */
const gitHasCommit = (head: string) => {
  try {
    execFileSync(
      'git',
      ['rev-parse', '--verify', '--quiet', `${head}^{commit}`],
      {
        stdio: ['ignore', 'ignore', 'ignore'],
      },
    );
    return true;
  } catch {
    return false;
  }
};

/** One failed quotation, as `checkAnswers` reports it. */
export interface CitationFailure {
  key: string;
  field: string;
  reason: string;
  cited: { file: string; line: number; text?: string };
  lineCount?: number;
  actual?: string;
}

/** One line per failed quotation, naming what was claimed and what is there. */
export const citationLine = (f: CitationFailure) => {
  const at = `${f.key} field ${f.field}`;
  switch (f.reason) {
    case 'uncited':
      return `review-obligations-check: ${at} claims something about source and quotes no line`;
    case 'quotes-nothing':
      return `review-obligations-check: ${at} cites ${f.cited.file}:${f.cited.line} and quotes nothing but whitespace`;
    case 'file-not-found':
      return `review-obligations-check: ${at} cites ${f.cited.file}, which is not in the tree at head`;
    case 'line-out-of-range':
      return `review-obligations-check: ${at} cites ${f.cited.file}:${f.cited.line}, and that file has ${f.lineCount} line(s) at head`;
    default:
      return (
        `review-obligations-check: ${at} quotes ${JSON.stringify(f.cited.text)} ` +
        `at ${f.cited.file}:${f.cited.line}, where head has ${JSON.stringify(f.actual)}`
      );
  }
};

export const main = (
  argv: string[],
  {
    source = gitSource,
    hasHead = gitHasCommit,
  }: {
    source?: (head: string) => (file: string) => string | null;
    hasHead?: (head: string) => boolean;
  } = {},
) => {
  // `cannotRun` exits the process; cli.mjs is still JavaScript, so its arrow
  // infers `void` and nothing downstream would narrow without saying so here.
  const bail: (msg: string) => never = cannotRun(
    'review-obligations-check',
  ) as (msg: string) => never;
  const { positional, flags } = parseArgs(argv) as {
    positional: string[];
    flags: Record<string, string | null>;
  };
  const [worklistPath, answersPath] = positional;
  if (!worklistPath || !answersPath) bail(USAGE);
  if ('out' in flags && !flags.out) bail('--out needs a path');

  if ('report' in flags && !flags.report) bail('--report needs a path');

  const worklist = readJsonOr(worklistPath, bail);
  if (!Array.isArray(worklist?.selected))
    bail(`${worklistPath}: not an obligation worklist`);

  // The report the reviewer wrote, when it wrote one. Supplying it is what
  // turns "did you raise the finding your own answer says is there" from a
  // question the reviewer answers about itself into one this script answers by
  // looking. Optional, because this script also runs where no report exists
  // yet; without it the sheet's own declaration is all there is, and the
  // contradiction records which of the two it was read from.
  let findings: object[] | undefined;
  if (flags.report) {
    const envelope = readJsonOr(flags.report, bail);
    if (!Array.isArray(envelope?.findings))
      bail(`${flags.report}: not a review report`);
    findings = envelope.findings;
  }

  let sheet: ReturnType<typeof AnswerSheetSchema.parse>;
  try {
    sheet = AnswerSheetSchema.parse(readJsonOr(answersPath, bail));
  } catch (err) {
    if (!(err instanceof ZodError)) throw err;
    // Exit 2, not 1: a malformed sheet is not the reviewer answering wrongly,
    // it is this script unable to measure. The two are worth telling apart in
    // the log even though the step gates on both — since `continue-on-error`
    // came off, exit 2 fails the check as surely as exit 1 does, and a sheet
    // nobody can parse is as much a fact about the reviewer as one whose
    // quotations do not hold (ADR 0078). What it is NOT is a finding, and the
    // findings still publish either way.
    console.error('review-obligations-check: answer sheet unreadable');
    for (const line of formatIssues(err)) console.error(`  ${line}`);
    process.exit(2);
  }

  // Only when something is going to be read: a worklist that cites nothing
  // never resolves the head, so it is not refused for one.
  const cites = worklist.selected.some(
    (o: { citedFields?: unknown[] }) => o.citedFields?.length,
  );
  if (cites && !hasHead(worklist.head))
    bail(
      `${worklistPath}: head ${worklist.head} is not a commit in this clone, so no quotation could be compared to anything`,
    );

  let report: ReturnType<typeof checkAnswers>;
  try {
    report = checkAnswers(worklist, sheet, {
      readSource: source(worklist.head),
      findings,
    });
  } catch (err) {
    bail(errorMessage(err));
  }
  const summary =
    report.expected === 0
      ? 'no obligation fired on this diff'
      : `${report.answered} of ${report.expected} site(s) answered` +
        // Always, including `0 of 0`. A run that verified nothing is the one
        // this check exists to make impossible to mistake for a clean one, and
        // a line that disappears when the count is zero reads as a clean run.
        `, ${report.citations.verified} of ${report.citations.required} citation(s) verified` +
        (report.incomplete.length
          ? `, ${report.incomplete.length} missing field(s)`
          : '') +
        (report.unexpected.length
          ? `, ${report.unexpected.length} unexpected`
          : '');
  console.log(`review-obligations-check: ${summary}`);
  for (const u of report.unanswered)
    console.log(`  unanswered: ${u.id} at ${u.site.file}:${u.site.line}`);
  for (const i of report.incomplete)
    console.log(`  incomplete: ${i.key} missing ${i.missing.join(', ')}`);

  if (flags.out)
    writeFileSync(flags.out, `${JSON.stringify(report, null, 2)}\n`);

  for (const c of report.contradictions)
    console.error(
      `review-obligations-check: ${c.key} answers its own defect condition ` +
        `and raises no finding: ${JSON.stringify(c.answer)}` +
        (c.readFrom === 'report'
          ? ` (no finding with ruleId ${obligationRuleId(c.id)} in the report)`
          : ' (the sheet declared none; no report was supplied to check against)'),
    );
  // obligations.mjs is still JavaScript, so its failures arrive untyped at
  // this boundary; `citationLine` is what gives each reason its shape.
  for (const f of report.citationFailures)
    console.error(citationLine(f as CitationFailure));
  if (report.contradictions.length || report.citationFailures.length)
    process.exit(1);
};

if (isMain(import.meta.url)) main(process.argv.slice(2));
