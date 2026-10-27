#!/usr/bin/env node
// Appends one line to the golden replay results record (issue #932): one
// line per case run, including voids, which are recorded as voids and never
// as misses or catches (ADR 0101).
//
//   node tools/scripts/review/record-golden-result.ts --out <file> \
//     --date <YYYY-MM-DD> --run-id <id> --commit <sha> --case <id> \
//     --outcome caught|missed|clean-pass|clean-fail|void [--void-reason <reason>] \
//     [--recall <0..1>] --model <id> [--total-cost-usd <n>] [--turns <n>]
//     [--normalized <normalized.json>]
//
// --normalized is the validated report, when the case wrote one. The Claude
// Code CLI version and the three run facts that tighten a tier in production
// (index opened, dispatch on template, shape readable) are read from it onto
// the line (ADR 0123 item 7). A path that does not exist is a case that
// wrote no report, and the four fields are recorded as null.
//
// --recall is required for caught/missed, refused for clean-pass/clean-fail
// and void (issue #933, ADR 0101): a clean case is scored on whether a
// Blocking finding appeared, not on a recall fraction, and a void was never
// scored at all.
//
// Exit 0 = appended. Exit 2 = the record would be invalid.
import { existsSync } from 'node:fs';

import { errorMessage } from '../lib/error-message.ts';
import type { Bail } from './cli.ts';
import { cannotRun, isMain, parseArgs, readJsonOr } from './cli.ts';
import { appendResultLine, runFactFields } from './golden-results.ts';

const toNumberOrNull = (v: string | null | undefined) =>
  v === undefined || v === null ? null : Number(v);

export const main = (argv: string[]): void => {
  const bail: Bail = cannotRun('record-golden-result');
  const { flags } = parseArgs(argv);
  if (!flags.out) bail('--out <file> is required');

  const normalized =
    flags.normalized && existsSync(flags.normalized)
      ? (readJsonOr(flags.normalized, bail) as Parameters<
          typeof runFactFields
        >[0])
      : null;

  try {
    const record = appendResultLine(flags.out, {
      ...runFactFields(normalized),
      date: flags.date,
      runId: flags['run-id'],
      commit: flags.commit,
      caseId: flags.case,
      outcome: flags.outcome,
      voidReason: flags['void-reason'] ?? null,
      recall: toNumberOrNull(flags.recall),
      totalCostUsd: toNumberOrNull(flags['total-cost-usd']),
      turns: toNumberOrNull(flags.turns),
      model: flags.model,
    });
    console.log(
      `record-golden-result: appended ${JSON.stringify(record)} to ${flags.out}`,
    );
  } catch (err) {
    bail(errorMessage(err));
  }
};

if (isMain(import.meta.url)) main(process.argv.slice(2));
