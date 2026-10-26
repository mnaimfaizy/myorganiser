#!/usr/bin/env node
// Validates a structured Upstream Brief report and renders the Markdown brief.
//
//   node .agents/skills/upstream-brief/validate-report.mjs <report.json> \
//     [--out <normalized.json>] [--render <brief.md>] [--repo <dir>]
//
// The skill is portable (ADR 0018, retained by ADR 0084), so this file and the
// two modules beside it import only Node built-ins and each other. A consuming
// repo wires it through a thin checker of its own; in this one that is
// `tools/scripts/check-upstream-briefs.ts`, which exists so the Meta-Gate can
// see the gate (ADR 0084 item 10).
//
// WHAT COMES OUT
//   `--out` writes the normalized report. That artifact — not the worker's
//   input — is what gets committed beside the Markdown brief, because it is
//   the one carrying the write-time `unverified` list and the counts the gate
//   re-checks against. `--render` writes the brief.
//
// EXIT CODES
//   0  the report is a report. It may carry Unverified entries: a finding the
//      validator refused moves to that list with its reason and the rest of
//      the report stands (ADR 0084 item 3). That is the whole difference from
//      the code-review contract, which rejects a report whole because it
//      computes a verdict one bad finding would corrupt.
//   1  the report is invalid or unparseable — a bad envelope, a hand-written
//      derived field, JSON that is not JSON. Nothing downstream can use it.
//   2  the check could not run: no input path, an unreadable file, an
//      unwritable output, or a recorded commit this clone does not have.
//      The last one is separated deliberately. `git show <commit>:<file>`
//      fails identically for a missing path and for a ref that does not
//      resolve, so without resolving the commit first, a shallow clone would
//      report every citation in the brief as `file-not-found` — the loudest
//      possible accusation against a worker that did nothing wrong (the same
//      separation ADR 0078 forced on the review pipeline).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

import { UpstreamReportRejected, normalizeUpstreamReport } from './report.mjs';
import { renderUpstreamBrief } from './render.mjs';

const USAGE =
  'usage: validate-report.mjs <report.json> [--out <normalized.json>] ' +
  '[--render <brief.md>] [--repo <dir>]';

const LABEL = 'upstream-report';

const cannotRun = (message) => {
  console.error(`${LABEL}: ${message}`);
  process.exit(2);
};

/**
 * One file's contents at a commit. `git show` rather than the working tree:
 * the checkout has moved on, and a local citation is a claim about the commit
 * the brief recorded, not about whatever is on disk now. This is also what
 * lets a frozen brief stay checkable forever.
 */
export const gitSource = (commit, cwd) => (file) => {
  try {
    return execFileSync('git', ['show', `${commit}:${file}`], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
};

/** Whether the recorded commit is one this clone actually has. */
export const gitHasCommit = (commit, cwd) => {
  try {
    execFileSync(
      'git',
      ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`],
      {
        cwd,
        stdio: ['ignore', 'ignore', 'ignore'],
      },
    );
    return true;
  } catch {
    return false;
  }
};

/** Flags are `--name value`; the first bare token is the report path. */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[name] = next;
      i += 1;
    } else flags[name] = '';
  }
  return { positional, flags };
}

export function main(
  argv,
  { source = gitSource, hasCommit = gitHasCommit } = {},
) {
  const { positional, flags } = parseArgs(argv);
  const [reportPath] = positional;
  if (!reportPath) cannotRun(USAGE);
  for (const flag of ['out', 'render', 'repo'])
    if (flag in flags && !flags[flag]) cannotRun(`--${flag} needs a path`);
  const cwd = flags.repo || process.cwd();

  let text;
  try {
    text = readFileSync(reportPath, 'utf8');
  } catch (error) {
    cannotRun(`${reportPath}: ${error.message}`);
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    // Exit 1, not 2: the file was read fine. What it holds is not a report.
    console.error(
      `${LABEL}: ${reportPath} is not valid JSON: ${error.message}`,
    );
    process.exit(1);
  }

  // Read before validation so a missing commit is reported as the reason
  // nothing could be checked, rather than as 40 fabricated citations.
  const commit = typeof raw?.commit === 'string' ? raw.commit : '';
  if (!commit) {
    console.error(
      `${LABEL}: ${reportPath} records no commit, so no local citation could be ` +
        'compared to anything',
    );
    process.exit(1);
  }
  if (!hasCommit(commit, cwd))
    cannotRun(
      `${reportPath} records commit ${commit}, which is not in this clone. ` +
        'Deepen the checkout (`git fetch --deepen` or fetch-depth: 0) and run again.',
    );

  let report;
  try {
    report = normalizeUpstreamReport(raw, { readSource: source(commit, cwd) });
  } catch (error) {
    if (!(error instanceof UpstreamReportRejected)) throw error;
    console.error(`${LABEL}: ${reportPath} is not a valid report`);
    for (const problem of error.problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  try {
    if (flags.out)
      writeFileSync(flags.out, `${JSON.stringify(report, null, 2)}\n`);
    if (flags.render) writeFileSync(flags.render, renderUpstreamBrief(report));
  } catch (error) {
    cannotRun(`could not write output: ${error.message}`);
  }

  const { counts } = report;
  console.log(
    `${LABEL}: ${reportPath} — ${counts.findings} finding(s), ` +
      `${counts.checkedAndClear} checked and clear, ` +
      `${counts.opportunities} opportunit(ies), ` +
      `${counts.incidental} incidental, ` +
      // Always printed, including zero. A line that disappears when the count
      // is zero reads as a run that verified everything.
      `${counts.unverified} unverified`,
  );
  for (const u of report.unverified)
    console.log(`  unverified: ${u.where} (${u.reason}) — ${u.detail}`);
  return report;
}

// `import.meta.url` vs argv[1] rather than a helper: this file may not import
// anything outside the skill directory, and a two-line comparison is cheaper
// than a shared module the skill would have to carry to stay portable.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`)
  main(process.argv.slice(2));
