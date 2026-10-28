#!/usr/bin/env node
// Re-validates every committed structured Upstream Brief report (ADR 0084 item 10).
//
//   node tools/scripts/check-upstream-briefs.ts [--print]
//
// WHY THIS FILE EXISTS AT ALL, GIVEN THE VALIDATOR IS ELSEWHERE
//   The validator ships inside `.agents/skills/upstream-brief/` because the
//   skill is portable and a validator in this repo's script tree would make a
//   brief checkable only here (ADR 0018, retained by ADR 0084). But
//   `gates:coverage:check` — the Meta-Gate — discovers checkers by a
//   NON-RECURSIVE scan of `tools/scripts/` for `check-*.ts`
//   (`tools/scripts/lib/gate-coverage.ts`). A gate living anywhere else is
//   invisible to it: it would look wired forever, and deleting the line that
//   runs it would fail nothing. So this file is a thin adapter, named and
//   placed to be seen, and the judgment stays in the skill.
//
// WHAT IT ASSERTS, AND IN WHICH DIRECTION
//   Two assertions about two artifacts, each one direction.
//
//   1. THE COMMITTED REPORTS, AT THE COMMIT THEY RECORD. For every structured
//   report committed in the brief directory, every entry that survived
//   validation still holds at the commit that report records. A local citation
//   is `file` + `line` + the literal text at that line, read back with
//   `git show <commit>:<file>`. Because the commit is fixed, a brief frozen at
//   its date stays valid however far the tree moves on — and a citation that
//   stops matching means the report and the history disagree, which is drift a
//   frozen document cannot self-report.
//
//   The other direction is deliberately NOT asserted: nothing here requires a
//   Markdown brief to have a structured report beside it. The three briefs
//   written before ADR 0084 are not migrated (ADR 0084, Consequences), so a
//   rule of that shape would fail on three documents nobody intends to change.
//   A brief directory holding no structured report passes, and says so.
//
//   2. THE ADAPTER'S DECLINED OPPORTUNITIES, AT THE CURRENT TREE (ADR 0084
//   item 12: "The validator fails an entry whose Ecosystem or path no longer
//   exists"). A declined entry is a standing instruction to stay quiet about
//   one technique at one place. When the Ecosystem is no longer declared or
//   the file is gone, the entry silences nothing and records a decision about
//   something that is not there. Unlike the reports above, this one is about
//   the tree in front of it: a decline is live configuration, not a frozen
//   document, and the question is whether it still points at anything today.
//
//   Its other direction is deliberately NOT asserted either: nothing here
//   requires a declined entry to name an Opportunity any run actually
//   produced. Suppression is decided at run time against the Baseline and the
//   upstream quote (`ledger.mjs`), and a gate that demanded a live match would
//   fail on exactly the entry doing its job — the one whose Opportunity is no
//   longer being proposed because it is suppressed.
//
//   Nor does it re-check the report's own `unverified` list. Those entries
//   were refused at write time and carry no surviving claim; re-checking them
//   would fail forever by construction and no brief could pass its own gate.
//
// WHICH FILES ARE REPORTS
//   Every `*.json` directly in the brief directory. Not a filename pattern:
//   a report that escaped the gate through a typo'd name is exactly the
//   failure mode the Meta-Gate exists to prevent, one level down. The scan is
//   non-recursive, matching `check-docs-notes.ts`, so a brief that needs an
//   assets folder is unaffected — and a JSON file in the brief directory that
//   is not a report belongs in a subdirectory of it.
//
// Exit 0 = every committed report still holds (or there are none), and every
//          declined Opportunity still points at something real.
// Exit 1 = a report is invalid, or its local evidence no longer matches the
//          commit it records, or a declined entry names an Ecosystem or a path
//          that is gone.
// Exit 2 = the check could not run: an unreadable report, or a recorded commit
//          this clone does not have. The second is separated deliberately —
//          `git show` fails identically for a missing path and an unresolvable
//          ref, so without resolving the commit first a shallow clone would
//          report every citation in the brief as a fabrication (ADR 0078).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { errorMessage } from './lib/error-message.ts';
import { validateDeclinedOpportunities } from '../../.agents/skills/upstream-brief/ledger.mjs';
import { recheckUpstreamReport } from '../../.agents/skills/upstream-brief/report.mjs';
// The adapter schema belongs to the skill (ADAPTER.md), so where briefs live,
// which Ecosystems are declared, and which Opportunities were declined are
// read with the skill's own readers rather than a second set here. Same rule
// as the git plumbing below: one vocabulary, one implementation.
import {
  DEFAULT_BRIEF_DIR,
  readBriefDir,
  readDeclaredLeads,
  readDeclinedOpportunities,
} from '../../.agents/skills/upstream-brief/resolve-ledger.mjs';
// The skill's own git plumbing, imported rather than copied. Both modules are
// already reached from here, and `validate-report.mjs` runs nothing on import:
// its CLI body sits behind an `import.meta.url` guard. A second copy of "read
// this file at this commit" is a second place for the two to disagree about
// what a missing path means, which is the one distinction this gate rests on.
import {
  gitHasCommit,
  gitSource,
} from '../../.agents/skills/upstream-brief/validate-report.mjs';

const LABEL = 'upstream-briefs';

/**
 * Where the briefs are, and what the adapter's default is. Both are the
 * skill's, re-exported under the name this gate's contract suite already uses:
 * a second matcher here would be a second answer to "which directory does this
 * repo keep briefs in", and the gate reading the wrong one passes forever
 * while checking nothing.
 */
export { DEFAULT_BRIEF_DIR };
export const resolveBriefDir = readBriefDir;

/**
 * The IO the check reads through, so its contract suite can drive it with a
 * file map instead of a tree.
 *
 * `exists` answers whether the current tree carries a path — asked only of a
 * declined entry's local site. It defaults to `read`, which is what a file map
 * in a test is; the real run passes `existsSync`, because a site path that is
 * a directory is still a path that exists and `readFileSync` would only throw
 * at it.
 */
export interface UpstreamBriefIo {
  /** A repo file, or null when it is not there. */
  read: (path: string) => string | null | undefined;
  /** Directory entries, or null when the directory is not there. */
  list: (dir: string) => string[] | null;
  hasCommit: (commit: string) => boolean;
  source: (commit: string) => (file: string) => string | null;
  exists?: (path: string) => boolean;
}

/** What the check concluded: the exit code, the lines to print, and one entry per report. */
export interface UpstreamBriefOutcome {
  exitCode: number;
  briefDir: string;
  reports: { path: string; commit: string; ok: boolean }[];
  lines: string[];
}

/**
 * Pure over its inputs so the contract suite drives fixtures rather than the
 * repository. Returns `{exitCode, lines, reports}`; the caller prints.
 */
export function checkUpstreamBriefs({
  read,
  list,
  hasCommit,
  source,
  exists = (path) => {
    const contents = read(path);
    return contents !== null && contents !== undefined;
  },
}: UpstreamBriefIo): UpstreamBriefOutcome {
  const briefDir = resolveBriefDir(read);
  const lines: string[] = [];
  const reports: UpstreamBriefOutcome['reports'] = [];
  let exitCode = 0;
  const worst = (code: number) => {
    exitCode = Math.max(exitCode, code);
  };

  /** The second assertion, appended to whatever the first one found. */
  const withDeclined = (result: UpstreamBriefOutcome): UpstreamBriefOutcome => {
    const declined = readDeclinedOpportunities(read);
    if (declined.length === 0) {
      // Said out loud, like the empty brief directory above: a gate that
      // checked no declined entry must not read like one that checked them all.
      result.lines.push(
        `${LABEL}: no declined Opportunity recorded in the adapter`,
      );
      return result;
    }
    const { problems } = validateDeclinedOpportunities(declined, {
      knownEcosystems: readDeclaredLeads(read),
      exists,
    });
    if (problems.length === 0) {
      result.lines.push(
        `${LABEL}: ${declined.length} declined Opportunity(s) still point at a ` +
          'declared Ecosystem and a file in the tree',
      );
      return result;
    }
    for (const problem of problems) {
      const entry = problem.entry as { ecosystem?: string; site?: string };
      result.lines.push(
        `${LABEL}: declined_opportunities[${problem.index}] ` +
          `(${entry.ecosystem || '(no ecosystem)'} → ` +
          `${entry.site || '(no site)'}) — ${problem.reason}: ${problem.detail}`,
      );
    }
    result.exitCode = Math.max(result.exitCode, 1);
    return result;
  };

  const entries = list(briefDir);
  if (entries === null)
    return withDeclined({
      exitCode: 0,
      briefDir,
      reports: [],
      lines: [
        `${LABEL}: ${briefDir} does not exist — no structured report to check`,
      ],
    });

  const paths = entries
    .filter((name: string) => name.endsWith('.json'))
    .sort()
    .map((name: string) => `${briefDir}/${name}`);

  if (paths.length === 0)
    return withDeclined({
      exitCode: 0,
      briefDir,
      reports: [],
      // Said out loud, not inferred from silence. A brief directory with no
      // structured report passes (ADR 0084, Consequences), and a green run
      // that checked nothing must not read like a green run that checked
      // everything.
      lines: [
        `${LABEL}: no structured report in ${briefDir} — nothing to re-validate`,
      ],
    });

  for (const path of paths) {
    const text = read(path);
    if (text === null || text === undefined) {
      lines.push(`${LABEL}: ${path} could not be read`);
      worst(2);
      continue;
    }
    let raw: { commit?: unknown };
    try {
      raw = JSON.parse(text);
    } catch (error) {
      lines.push(`${LABEL}: ${path} is not valid JSON: ${errorMessage(error)}`);
      worst(1);
      continue;
    }
    const commit = typeof raw?.commit === 'string' ? raw.commit : '';
    if (!commit) {
      lines.push(
        `${LABEL}: ${path} records no commit, so no local citation could be ` +
          'compared to anything',
      );
      worst(1);
      continue;
    }
    if (!hasCommit(commit)) {
      lines.push(
        `${LABEL}: ${path} records commit ${commit}, which is not in this ` +
          'clone. Deepen the checkout (fetch-depth: 0) and run again.',
      );
      worst(2);
      continue;
    }

    const verdict = recheckUpstreamReport(raw, { readSource: source(commit) });
    reports.push({ path, commit, ok: verdict.ok });
    if (verdict.ok) {
      lines.push(`${LABEL}: ${path} holds at ${commit}`);
      continue;
    }
    lines.push(`${LABEL}: ${path} no longer holds at ${commit}`);
    for (const problem of verdict.problems) lines.push(`  ${problem}`);
    worst(1);
  }

  return withDeclined({ exitCode, briefDir, reports, lines });
}

function run(argv: string[]) {
  const cwd = process.cwd();
  const read = (path: string) => {
    const absolute = join(cwd, path);
    return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
  };
  const list = (dir: string) => {
    const absolute = join(cwd, dir);
    if (!existsSync(absolute)) return null;
    return readdirSync(absolute, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  };

  const result = checkUpstreamBriefs({
    read,
    list,
    hasCommit: (commit: string) => gitHasCommit(commit, cwd),
    source: (commit: string) => gitSource(commit, cwd),
    exists: (path: string) => existsSync(join(cwd, path)),
  });

  if (argv.includes('--print'))
    console.log(`${LABEL}: brief directory is ${result.briefDir}`);
  const write = result.exitCode === 0 ? console.log : console.error;
  for (const line of result.lines) write(line);
  process.exit(result.exitCode);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`)
  run(process.argv.slice(2));
