#!/usr/bin/env node
// Classifies how one reviewer session ended, from the transcript
// anthropics/claude-code-action leaves behind (its `execution_file`), so a
// run that measured nothing is never read as a reviewer that found nothing.
//
//   node tools/scripts/review/classify-reviewer-run.ts <execution-file>
//
// Appends `total_cost_usd`, `turns`, `rate_limited`, `turn_exhausted`, and
// `prevented` to $GITHUB_OUTPUT when it is set, and prints a workflow
// annotation for every outcome that is not a clean finish. Always exits 0
// once it has a path: this script reports what the transcript says, and the
// callers of `.github/actions/code-reviewer` decide what fails.
//
// The judgments live here rather than in the action's shell because a
// transcript artifact expires after seven days and a live run costs a
// reviewer session: `classify-reviewer-run.test.ts` runs them against
// fixture transcripts instead.
import { appendFileSync, readFileSync } from 'node:fs';

import { cannotRun, isMain } from './cli.ts';

/**
 * The files the reviewer is told to write, as paths under the workspace. A
 * refused write to one of these is the harness contradicting the reviewer's
 * own instructions, on the one action a run cannot finish without.
 *
 * The report has two names because the action's "Validate the report" step
 * accepts two: `report.json`, which the CI prompt asks for, and the skill's
 * interactive `<head>.report.json`, which that step renames. A report name
 * the action would have accepted is one whose refusal prevented the run.
 */
export const REQUIRED_OUTPUTS = Object.freeze([
  'tmp/code-review/report.json',
  'tmp/code-review/<head>.report.json',
  'tmp/code-review/obligations.answers.json',
] as const);

/** One workflow annotation this script prints. */
export interface RunAnnotation {
  level: 'error' | 'warning';
  message: string;
}

/** What the action's outputs should say about one reviewer session. */
export interface ReviewerRunClassification {
  outputs: Record<string, string>;
  annotations: RunAnnotation[];
}

const REQUIRED_OUTPUT_PATTERN =
  /(?:^|\/)tmp\/code-review\/(?:(?:[^/]+\.)?report\.json|obligations\.answers\.json)$/;

const FILE_WRITERS = new Set(['Write', 'Edit']);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;
const finiteOrEmpty = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? String(v) : '';

/**
 * The required output a denied tool call was writing, or `null`. The path is
 * matched in both forms a reviewer uses: relative to the workspace, and
 * absolute, where only the tail is ours to recognize — the workspace root
 * differs per runner.
 */
export function refusedOutputPath(denial: unknown): string | null {
  if (!isObject(denial) || !FILE_WRITERS.has(String(denial.tool_name)))
    return null;
  const path = (denial.tool_input as { file_path?: unknown } | undefined)
    ?.file_path;
  if (typeof path !== 'string') return null;
  const normalized = path.replaceAll('\\', '/').replace(/^(\.\/)+/, '');
  return REQUIRED_OUTPUT_PATTERN.test(normalized) ? path : null;
}

/**
 * Reads a transcript and answers what the action's outputs should say.
 *
 * `rate_limited` has three answers, not two. A transcript that cannot be
 * read must not answer "no rate limit": that is the reading which lets a
 * lockout be scored as a miss. When it is `unknown`, `turn_exhausted` and
 * `prevented` are left unset rather than guessed.
 *
 * `prevented` is `true` on either of two grounds: the run hit the turn
 * ceiling with permission denials (run 45), or — whatever its `subtype` — it
 * was refused a write to one of `REQUIRED_OUTPUTS` (run 35716439899, which
 * ended `success` with six refused writes to its own report and answer sheet
 * and was read as "no valid report", issue #880).
 *
 * @param text the execution file's contents
 */
export function classifyReviewerRun(text: string): ReviewerRunClassification {
  const annotations: RunAnnotation[] = [];
  let events: unknown;
  try {
    events = JSON.parse(text);
  } catch {
    events = null;
  }
  if (!Array.isArray(events)) {
    annotations.push({
      level: 'warning',
      message:
        'could not read the reviewer transcript for rate-limit events; treating the result as unknown',
    });
    return {
      outputs: { total_cost_usd: '', turns: '', rate_limited: 'unknown' },
      annotations,
    };
  }

  // The last `result` event carries the run's own accounting regardless of
  // how it ended — cleanly, rate limited, or turn exhausted.
  const objects = (events as unknown[]).filter(isObject);
  const result = objects.findLast((e) => e.type === 'result') ?? {};
  const turns = finiteOrEmpty(result.num_turns);
  const outputs: Record<string, string> = {
    total_cost_usd: finiteOrEmpty(result.total_cost_usd),
    turns,
  };

  const limitInfos = objects
    .filter((e) => e.type === 'rate_limit_event')
    .map((e) => e.rate_limit_info)
    .filter(isObject);
  if (limitInfos.some((info) => info.status === 'rejected')) {
    const window = limitInfos.at(-1)!.rateLimitType ?? 'unknown';
    annotations.push({
      level: 'error',
      message: `the reviewer was cut off by the ${window} rate limit after ${turns || 0} turn(s); this run measured nothing and is not a miss`,
    });
    outputs.rate_limited = 'true';
  } else {
    outputs.rate_limited = 'false';
  }

  const denials = Array.isArray(result.permission_denials)
    ? result.permission_denials
    : [];
  // The turn-ceiling ground reads the transcript's own count and nothing
  // else, as it always has: no count is no denials.
  const denied =
    typeof result.permission_denials_count === 'number'
      ? result.permission_denials_count
      : 0;

  // 26 permission denials is not a hard case; it is the allowlist and the
  // instructions disagreeing about what the reviewer may do, and that
  // disagreement is what burned the turns, not the diff. Plain turn
  // exhaustion with no denial is a genuinely hard case (or, after the axes
  // dispatch first, usually a run that still wrote a report).
  let prevented = false;
  if (result.subtype === 'error_max_turns') {
    annotations.push({
      level: 'error',
      message: `the reviewer hit the turn ceiling after ${turns || 0} turn(s) with ${denied} permission denial(s); this run measured nothing and is not a miss`,
    });
    outputs.turn_exhausted = 'true';
    if (denied > 0) {
      annotations.push({
        level: 'error',
        message: `${denied} of those turns were spent on a permission the reviewer's own instructions told it to use and --allowedTools refused; this measurement was prevented by the apparatus, not by a hard case`,
      });
      prevented = true;
    }
  } else {
    outputs.turn_exhausted = 'false';
  }

  const refused = denials.map(refusedOutputPath).filter(Boolean);
  if (refused.length > 0) {
    annotations.push({
      level: 'error',
      message: `the reviewer was refused a write to its own required output ${[...new Set(refused)].join(', ')} (${refused.length} refusal(s)); this measurement was prevented by the apparatus, and a run that wrote no report because of it is not a miss`,
    });
    prevented = true;
  }
  outputs.prevented = String(prevented);

  return { outputs, annotations };
}

// A refused path is text the model chose, so it is escaped the way a
// workflow command's message is: an unescaped newline would let it start a
// second command on its own line.
const escapeMessage = (message: string) =>
  message
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');

export const main = (
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): void => {
  const bail = cannotRun('classify-reviewer-run');
  const [file] = argv;
  if (!file) bail('usage: classify-reviewer-run.ts <execution-file>');

  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    // An unreadable file is classified like an unparseable one: unknown.
  }
  const { outputs, annotations } = classifyReviewerRun(text);
  for (const { level, message } of annotations) {
    console.log(`::${level}::${escapeMessage(message)}`);
  }
  const lines = Object.entries(outputs).map(([k, v]) => `${k}=${v}`);
  console.log(lines.join('\n'));
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  }
};

if (isMain(import.meta.url)) main(process.argv.slice(2));
