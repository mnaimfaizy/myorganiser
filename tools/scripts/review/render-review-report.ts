#!/usr/bin/env node
// Renders a normalized `/code-review` report as the two-section Markdown a
// human reads, in the terminal or on the Pull Request (ADR 0071 item 8).
//
//   node tools/scripts/review/render-review-report.ts <normalized.json> [--previous <normalized.json>] [--out <report.md>] [--no-hunks]
//
// The reviewer never writes prose; this is the only source of it. The input
// must be the validator's output — a raw report is refused, so the only path
// to prose runs through normalizeReport. Two sections, Standards and Spec,
// each sorted by severity within itself and never across (ADR 0017). Nits
// are folded. A located finding shows the addressed lines, read from the
// checkout at the head SHA (`git show`), so the reader sees the hunk without
// any diff text having passed through a model. With --previous, a strip of
// new, persisting, and resolved findings is derived from ids — or, when that
// artifact was written at another report schema version, a line saying there
// is no comparable previous run (issue #718).
//
// Exit 0 = rendered. Exit 2 = the script could not run, or the input is not
// a normalized report.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { ZodError } from 'zod';

import { cannotRun, isMain, parseArgs, readJsonOr } from './cli.ts';
import { evidenceText } from './evidence.ts';
import { isExecutable } from './run-ladder.ts';
import type {
  FindingAxis,
  FindingLocation,
  NormalizedFinding,
  NormalizedReport,
  RunFactsSummary,
} from './schema.ts';
import {
  AXIS_TITLES,
  FINDING_AXES,
  NormalizedReportSchema,
  REPORT_SCHEMA_VERSION,
  bySeverity,
  formatIssues,
  isComparableReport,
  reportSchemaVersionOf,
  verdictHeading,
} from './schema.ts';

/**
 * A duration as a person reads one: `45 s`, `1 min 52 s`, `1 h 3 min`.
 *
 * The comment used to print raw milliseconds (`112403 ms`), which nobody
 * reads at a glance. Seconds are dropped once the run passes an hour, and
 * anything under a second is `under 1 s`, because the report measures a
 * review session and not a function call.
 *
 * @param ms a non-negative duration in milliseconds
 */
export const formatDuration = (ms: number): string => {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 1) return 'under 1 s';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0)
    return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  if (minutes > 0)
    return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
  return `${seconds} s`;
};

/**
 * A token count the way a person reads one: `650541` is `651k`.
 *
 * About three figures, because the count is there to say how big a run was.
 * The exact count stays in the normalized report.
 *
 * @param count a non-negative whole number of tokens
 */
export const formatTokens = (count: number): string => {
  if (count < 1000) return String(count);
  if (count < 9950) return `${(count / 1000).toFixed(1)}k`;
  if (count < 999500) return `${Math.round(count / 1000)}k`;
  return `${(count / 1e6).toFixed(2)}M`;
};

/**
 * A path as inline code. A path here is one a sub-agent chose to open, so a
 * backtick in it is dropped rather than allowed to end the span.
 */
const codePath = (path: string) => `\`${path.replaceAll('`', '')}\``;

const COVERAGE_ROWS = 25;

/**
 * Which changed files each axis opened, diffed, or neither (issue #1140), as
 * a table under the run facts, most lines added first. A Spec cell is bold
 * where the Spec brief asks for the whole file and the axis did not open it.
 * With no changed-file list there is no table, rather than an empty one.
 */
const renderCoverage = (
  coverage?: NonNullable<RunFactsSummary['coverage']> | null,
): string[] => {
  if (!coverage?.length) return [];
  const rows = coverage
    .slice(0, COVERAGE_ROWS)
    .map(
      (c) =>
        `| ${codePath(c.file)} | ${c.added} | ${c.standards} | ${
          isExecutable(c.file) && c.spec !== 'opened' ? `**${c.spec}**` : c.spec
        } |`,
    );
  const rest = coverage.length - rows.length;
  return [
    '- changed files, most lines added first (read from the transcript):',
    '',
    '| File | Added | Standards | Spec |',
    '| --- | --- | --- | --- |',
    ...rows,
    ...(rest > 0 ? ['', `_…and ${rest} more changed file(s)._`] : []),
    '',
  ];
};

/**
 * The lines that say what the report knows about its own run, and where it
 * knows it from (ADR 0123).
 *
 * Every outcome is stated and none is acted on here: what a fact costs is not
 * the renderer's to decide. `unknown` is printed as that word. It is never
 * printed as an empty list or as "none", which are claims.
 *
 * The note about root `AGENTS.md` and `CLAUDE.md` is fixed text. A list of
 * what was opened would otherwise read as the list of what the review was
 * held to, and the harness loads those two into the session without anyone
 * opening them.
 *
 * @param report a normalized report
 * @returns Markdown list lines
 */
export const renderRunFacts = (report: NormalizedReport): string[] => {
  if (report.runFactsFrom !== 'transcript' || !report.runFacts)
    return [
      '- run facts: self-reported by the reviewer, not read from a transcript',
      `- standards sources (as the reviewer listed them): ${
        report.standardsSources?.length
          ? report.standardsSources.map(codePath).join(', ')
          : 'none'
      }`,
    ];

  const facts: RunFactsSummary = report.runFacts;
  const cli = facts.cliVersion ?? 'unknown';
  if (facts.shape === 'unknown')
    return [
      `- run facts: **unknown** — the reviewer transcript could not be read (Claude Code CLI ${cli}): ${facts.shapeReason}`,
      '- standards sources opened: unknown',
      ...renderRunCost(report),
    ];

  const lines: string[] = [
    `- run facts: read from the reviewer transcript (Claude Code CLI ${cli})`,
  ];
  // `axes` is stated exactly when the shape is readable, and the branch above
  // returned for every other shape.
  const { standards, spec } = facts.axes!;
  lines.push(
    `- standards sources opened by the Standards sub-agent: ${
      report.standardsSources?.length
        ? report.standardsSources.map(codePath).join(', ')
        : '**none**'
    } (root \`AGENTS.md\` and \`CLAUDE.md\` are loaded by the harness and are not listed)`,
  );
  lines.push(
    `- sub-agent tool calls: Standards ${standards.toolCalls} · Spec ${
      report.spec.kind === 'none' && !spec.dispatched
        ? 'not run'
        : spec.toolCalls
    }`,
  );
  // An axis that was meant to run: Standards always, Spec when there is one.
  const expected: Record<FindingAxis, boolean> = {
    standards: true,
    spec: report.spec.kind !== 'none',
  };
  for (const axis of FINDING_AXES) {
    if (!expected[axis]) continue;
    const a = facts.axes![axis];
    if (!a.briefRead)
      lines.push(
        `- ${AXIS_TITLES[axis]} brief: **not read** — no sub-agent opened it${a.dispatched ? '' : ', and no dispatch named it'}`,
      );
    if (a.replyIsJson === false)
      lines.push(
        `- ${AXIS_TITLES[axis]} reply: **not a bare JSON object** — it cannot be compared with the findings reported`,
      );
    if (a.dispatched && a.onTemplate === false)
      lines.push(
        `- ${AXIS_TITLES[axis]} dispatch: **carried text beyond the skill's template**`,
      );
  }
  if (standards.briefRead && !facts.indexOpened)
    lines.push(
      '- standards index: **not opened** — the Standards sub-agent read its brief and never opened `CODING_STANDARDS.md`',
    );
  if ((facts.unattributedDispatches ?? 0) > 0)
    lines.push(
      `- extra dispatches: **${facts.unattributedDispatches}** — sub-agent dispatch(es) that read neither brief and named neither, which the skill has no template for`,
    );
  if (facts.repliesParsed === false)
    lines.push(
      '- sub-agent replies: **not all readable** — a reply held no findings list this pipeline could parse, so the findings reported cannot all be compared with the findings returned',
    );
  return [
    ...lines,
    ...renderCoverage(facts.coverage),
    ...renderRunCost(report),
  ];
};

/**
 * What the run facts cost: the failures that fail `Agent Review Ran`, and
 * whether the tier was tightened (ADR 0123 items 4 and 5).
 *
 * The facts themselves are printed above, one line each. These lines say
 * what they did, so a reader does not have to know the ladder to see why a
 * check is red or a tier moved.
 */
const renderRunCost = (report: NormalizedReport): string[] => {
  const { failures = [], tightenedBy = [] } = report.runFacts ?? {};
  const lines = failures.map(
    (failure) =>
      `- **\`Agent Review Ran\` fails** (\`${failure.reason}\`): ${failure.detail.replaceAll('`', '')}`,
  );
  if (failures.length > 0) return lines;
  if (tightenedBy.length > 0)
    lines.push(
      report.effectiveTier === null
        ? `- run facts that would tighten a tier: ${tightenedBy.map((t) => `\`${t}\``).join(', ')}`
        : `- tier tightened one step toward a human by: ${tightenedBy.map((t) => `\`${t}\``).join(', ')}`,
    );
  return lines;
};

/** Most lines of a hunk shown inline; a finding is a pointer, not a file. */
export const HUNK_MAX_LINES = 30;

const locationText = (f: NormalizedFinding) =>
  f.location
    ? `\`${f.location.file}:${f.location.startLine}${f.location.endLine ? `-${f.location.endLine}` : ''}\``
    : null;

/**
 * Read the addressed lines from the checkout at the finding's head SHA.
 * Returns null when git cannot serve them (not a repo, unknown SHA, file
 * absent at that commit); the renderer then says so instead of guessing.
 */
export const readHunk = (
  location: FindingLocation,
  cwd: string = process.cwd(),
): string | null => {
  const result = spawnSync(
    'git',
    ['show', `${location.headSha}:${location.file}`],
    { cwd, encoding: 'utf8' },
  );
  if (result.status !== 0) return null;
  const lines = result.stdout.split('\n');
  const start = location.startLine;
  const end = Math.min(
    location.endLine ?? location.startLine,
    start + HUNK_MAX_LINES - 1,
    lines.length,
  );
  if (start > lines.length) return null;
  const width = String(end).length;
  return lines
    .slice(start - 1, end)
    .map((l, i) => `${String(start + i).padStart(width)} | ${l}`)
    .join('\n');
};

const fence = (text: string) => [
  '  ```',
  ...text.split('\n').map((l) => `  ${l}`),
  '  ```',
];

const renderFinding = (f: NormalizedFinding, { hunks }: { hunks: boolean }) => {
  const head = [`**${f.severity}**`, f.summary, locationText(f)]
    .filter(Boolean)
    .join(' · ');
  const lines = [
    `- ${head}`,
    `  - rule: \`${f.ruleId}\` — ${f.rule} (source: \`${f.source}\`)`,
    `  - ${evidenceText(f)}`,
  ];
  if (f.evidence.kind === 'executed' && f.evidence.outputExcerpt) {
    lines.push(...fence(f.evidence.outputExcerpt));
  }
  if (f.location && hunks) {
    const hunk = readHunk(f.location);
    lines.push(
      hunk === null
        ? `  - hunk unavailable at \`${f.location.headSha.slice(0, 7)}\``
        : `  - at \`${f.location.headSha.slice(0, 7)}\`:`,
    );
    if (hunk !== null) lines.push(...fence(hunk));
  }
  if (f.wouldBlock) lines.push('  - would block with evidence');
  if (f.confidence) lines.push(`  - confidence: ${f.confidence}`);
  if (f.remedy) lines.push(`  - remedy: ${f.remedy}`);
  lines.push(`  - id: \`${f.id}\``);
  return lines.join('\n');
};

const renderAxis = (
  axis: FindingAxis,
  findings: NormalizedFinding[],
  opts: { hunks: boolean },
) => {
  const sorted = [...findings].sort(bySeverity);
  const main = sorted.filter((f) => f.severity !== 'nit');
  const nits = sorted.filter((f) => f.severity === 'nit');
  const out = [`## ${AXIS_TITLES[axis]}`, ''];
  if (sorted.length === 0) {
    out.push('No findings.', '');
    return out.join('\n');
  }
  if (main.length)
    out.push(main.map((f) => renderFinding(f, opts)).join('\n'), '');
  if (nits.length) {
    out.push(
      '<details>',
      `<summary>${nits.length} nit${nits.length === 1 ? '' : 's'}</summary>`,
      '',
      nits.map((f) => renderFinding(f, opts)).join('\n'),
      '',
      '</details>',
      '',
    );
  }
  return out.join('\n');
};

const renderDelta = (current: NormalizedReport, previous: NormalizedReport) => {
  const now = new Map(current.findings.map((f) => [f.id, f]));
  const before = new Map(previous.findings.map((f) => [f.id, f]));
  const fresh = [...now.keys()].filter((id) => !before.has(id));
  const persisting = [...now.keys()].filter((id) => before.has(id));
  const resolved = [...before.keys()].filter((id) => !now.has(id));
  const item = (label: string, ids: string[]) =>
    `- ${label}: ${ids.length}${ids.length ? ` (${ids.map((id) => `\`${id}\``).join(', ')})` : ''}`;
  return [
    `Since \`${previous.head.slice(0, 7)}\`:`,
    item('new', fresh),
    item('persisting', persisting),
    item('resolved', resolved),
    '',
  ].join('\n');
};

/**
 * What the strip says when the stored artifact predates a change to how ids
 * are derived. Reporting nothing at all would read as a first run; reporting a
 * diff would announce every finding new and every prior one resolved, which is
 * the mass auto-resolve the schema bump exists to prevent (issue #718).
 */
const renderIncomparable = (previous: unknown) => {
  const version = reportSchemaVersionOf(previous);
  return [
    `No comparable previous run: the stored report is report schema \`${version ?? 'unknown'}\`, this run is \`${REPORT_SCHEMA_VERSION}\`.`,
    '- finding identities are only comparable within a schema version, so nothing below is marked new, persisting, or resolved.',
    '',
  ].join('\n');
};

const worst = (findings: NormalizedFinding[]) =>
  [...findings].sort(bySeverity)[0]?.severity ?? 'none';

/**
 * Render a normalized report. Throws a ZodError when `report` is not the
 * validator's output; callers that read from disk turn that into exit 2.
 */
export const renderReport = (
  raw: unknown,
  previous: unknown = null,
  { hunks = true }: { hunks?: boolean } = {},
): string => {
  const report = NormalizedReportSchema.parse(raw);
  // A previous report of another vintage is read for its version and nothing
  // else; parsing it against today's schema would reject a file that is not
  // wrong, only old.
  const comparable = previous !== null && isComparableReport(previous);
  const prior = comparable ? NormalizedReportSchema.parse(previous) : null;
  const specText =
    report.spec.kind === 'none'
      ? 'none (tightened to review:human)'
      : `${report.spec.kind} ${report.spec.ref} (found by ${report.spec.foundBy})${
          report.spec.also
            ? `, also ${report.spec.also.join(', ')} (closed by commits)`
            : ''
        }`;
  const tierText = report.effectiveTier ?? 'interactive';
  // `null` is a transcript that carried no figures; absent is a report that
  // never had any. Only the first is something to say.
  const costText = report.cost
    ? ` · ${formatTokens(report.cost.inputTokens)} in / ${formatTokens(report.cost.outputTokens)} out tokens`
    : report.cost === null
      ? ' · tokens unknown'
      : '';
  const parts = [
    verdictHeading(report.verdict),
    '',
    `- range: \`${report.base.slice(0, 7)}...${report.head.slice(0, 7)}\``,
    `- tier: ${tierText}`,
    `- spec: ${specText}`,
    `- model: ${report.model} · ${report.durationMs === null ? 'duration unknown' : formatDuration(report.durationMs)}${costText}`,
    ...renderRunFacts(report),
    `- suppressed as redundant with deterministic checks: ${report.suppressed.redundant}`,
    '',
  ];
  if (prior) parts.push(renderDelta(report, prior));
  else if (previous !== null) parts.push(renderIncomparable(previous));
  const byAxis = Object.fromEntries(
    FINDING_AXES.map((axis) => [
      axis,
      report.findings.filter((f) => f.axis === axis),
    ]),
  );
  for (const axis of FINDING_AXES)
    parts.push(renderAxis(axis, byAxis[axis], { hunks }));
  parts.push(
    '---',
    FINDING_AXES.map(
      (axis) =>
        `${AXIS_TITLES[axis]}: ${byAxis[axis].length} finding(s), worst ${worst(byAxis[axis])}`,
    ).join(' · '),
    '',
  );
  return parts.join('\n');
};

const USAGE =
  'usage: render-review-report.ts <normalized.json> [--previous <path>] [--out <path>] [--no-hunks]';

export const main = (argv: string[]): void => {
  const bail = cannotRun('review-render');
  const { positional, flags } = parseArgs(argv);
  const [inputPath] = positional;
  if (!inputPath) bail(USAGE);
  const report = readJsonOr(inputPath, bail);
  const previous = flags.previous ? readJsonOr(flags.previous, bail) : null;
  let markdown: string;
  try {
    markdown = renderReport(report, previous, {
      hunks: !('no-hunks' in flags),
    });
  } catch (err) {
    if (!(err instanceof ZodError)) throw err;
    // `bail` exits; returning it says so, so the lines below are reached only
    // with `markdown` assigned.
    return bail(
      `${inputPath} is not a normalized report — run review:validate first\n  ${formatIssues(err).join('\n  ')}`,
    );
  }
  if (flags.out) writeFileSync(flags.out, markdown);
  else process.stdout.write(markdown);
};

if (isMain(import.meta.url)) main(process.argv.slice(2));
