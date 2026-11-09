#!/usr/bin/env node
// Re-validates every committed structured Upstream Brief report (ADR 0084 item 10).
//
//   node tools/scripts/check-upstream-briefs.ts [--print]
//
// WHY THIS FILE EXISTS AT ALL, GIVEN THE GATE IS ELSEWHERE
//   The gate ships inside the portable skill, as
//   `.agents/skills/upstream-brief/check-reports.mjs`, so every repository that
//   adopts the skill checks the same thing (the skill's DESIGN.md §10). But
//   `gates:coverage:check` — the Meta-Gate — discovers checkers by a
//   NON-RECURSIVE scan of `tools/scripts/` for `check-*.ts`
//   (`tools/scripts/lib/gate-coverage.ts`). A gate living anywhere else is
//   invisible to it: it would look wired forever, and deleting the line that
//   runs it would fail nothing. So this file is a thin adapter, named and
//   placed to be seen, and every judgment stays in the skill.
//
// WHAT IT ASSERTS, AND IN WHICH DIRECTION
//   Exactly what `check-reports.mjs` asserts, and its header is the
//   specification: (1) the skill's adapter, `upstream-brief.config.yml`, reads
//   cleanly; (2) every committed report still holds at the commit it records;
//   (3) every declined Opportunity still names a declared Ecosystem and a file
//   in the tree. The directions it omits — a Markdown brief with no report
//   beside it, a declined entry no run produced, a report's own `unverified`
//   list — are omitted there, for the reasons given there.
//
//   The contract suite is `check-upstream-briefs.test.ts`, which drives this
//   wrapper's export so the wiring and the logic are proven together.
//
// Exit codes are `check-reports.mjs`'s: 0 holds, 1 fails, 2 could not run.
import {
  DEFAULT_LABEL,
  checkReports,
  checkReportsIn,
  printAndExit,
} from '../../.agents/skills/upstream-brief/check-reports.mjs';
import { isEntryPoint } from '../../.agents/skills/upstream-brief/entry-point.mjs';
import {
  DEFAULT_BRIEF_DIR,
  readBriefDir,
} from '../../.agents/skills/upstream-brief/resolve-ledger.mjs';

/**
 * Where the briefs are, and the adapter's default. Both are the skill's,
 * re-exported under the names this gate's contract suite already uses.
 */
export { DEFAULT_BRIEF_DIR };
export const resolveBriefDir: (
  read: (path: string) => string | null | undefined,
) => string = readBriefDir;

/** The IO the check reads through, so its contract suite can drive a file map. */
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

/** The skill's gate over the given IO. */
export const checkUpstreamBriefs = (
  io: UpstreamBriefIo,
): UpstreamBriefOutcome =>
  checkReports({ ...io, label: DEFAULT_LABEL }) as UpstreamBriefOutcome;

if (isEntryPoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  printAndExit(checkReportsIn({ repo: process.cwd() }), {
    print: argv.includes('--print'),
  });
}
