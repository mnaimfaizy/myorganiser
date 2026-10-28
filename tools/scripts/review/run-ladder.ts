/**
 * What a run fact costs (issue #1031, ADR 0123 items 4 and 5; issue #1039,
 * ADR 0126).
 *
 * `transcript-facts.ts` reads a reviewer transcript and decides nothing.
 * This module decides, from those facts and the report, in two kinds:
 *
 *   - a **failure** fails `Agent Review Ran`. It is a fact about the
 *     pipeline (ADR 0073): an axis did not run as built, the main agent
 *     authored a finding, or a finding gives as executed evidence a command
 *     or an exit code the transcript does not bear out.
 *   - a **tightening fact** is published and moves the effective tier one
 *     step toward a human. It says the review was thin or cannot be vouched
 *     for, which is not a broken gate (ADR 0078): run 37576528356 skipped
 *     the standards index and still found a real gap.
 *
 * "Cannot tell" is never a failure. A transcript this reader cannot account
 * for, or a reply it cannot parse, tightens the tier and fails nothing, so a
 * Claude Code CLI release that moves the transcript's shape reads as a
 * visible "unknown" and not as a red check on every pull request.
 *
 * Pure: no file is read here. `normalizeReport` in schema.ts is the caller.
 */
import { matchExecutedEvidence } from './executed-evidence.ts';
import type { WorklistSite } from './obligations.ts';
import { obligationRuleId } from './obligations.ts';
import type {
  AxesFacts,
  AxisFacts,
  FindingAxis,
  FileCoverageState,
  RunFacts,
  SpecKind,
} from './schema.ts';
import type { RunFailureReason, TighteningFact } from './run-ladder-terms.ts';
import { RUN_FAILURES, TIGHTENING_FACTS } from './run-ladder-terms.ts';

export { RUN_FAILURES, TIGHTENING_FACTS };

/** What this module reads of a reported finding, before it has an id. */
export interface JudgedFinding {
  axis: FindingAxis;
  ruleId: string;
  evidence?: { kind: string; command?: string; exitCode?: number };
  location?: { file: string; startLine: number } | undefined;
}

/** One Bash call the run facts carry, with whose call it was. */
type FactExecution = NonNullable<RunFacts['executions']>[number];

/**
 * The facts a readable transcript states. `RunFactsSchema` refines that a
 * readable file states every one of them, so this is what `readable` already
 * means; it is restated here because the type checker reads the nullable
 * field declarations rather than that refinement.
 */
type ReadableFacts = RunFacts & {
  axes: NonNullable<RunFacts['axes']>;
  returned: NonNullable<RunFacts['returned']>;
  unattributedDispatches: number;
  indexOpened: boolean;
};

const statesEveryFact = (facts: RunFacts): facts is ReadableFacts =>
  facts.axes !== null &&
  facts.returned !== null &&
  facts.unattributedDispatches !== null &&
  facts.indexOpened !== null;

/** One failure of `Agent Review Ran`, as the ladder reports it. */
export interface RunFailure {
  reason: RunFailureReason;
  axis: FindingAxis | null;
  detail: string;
}

/** What one axis did with one changed file (issue #1140). */
export interface FileCoverageRow {
  file: string;
  added: number;
  standards: FileCoverageState;
  spec: FileCoverageState;
}

/** What the ladder concludes about one run. */
export interface RunJudgment {
  failures: RunFailure[];
  tightenedBy: TighteningFact[];
}

const AXIS_NAMES: Record<FindingAxis, string> = {
  standards: 'Standards',
  spec: 'Spec',
};

// `Object.keys` loses the key type, and `AXIS_NAMES` is the pinned table over
// the axes, so its keys are exactly them (ADR 0053).
const AXES = Object.keys(AXIS_NAMES) as FindingAxis[];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

/** A value with every object's keys in one order, for comparison. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
};

const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const field = (of: object, key: string): unknown =>
  (of as Record<string, unknown>)[key];

/** The fields two findings disagree on, by top-level name. */
const fieldsThatDiffer = (reported: object, returned: object): string[] =>
  [...new Set([...Object.keys(reported), ...Object.keys(returned)])]
    .filter((key) => !sameValue(field(reported, key), field(returned, key)))
    .sort();

const where = (finding: JudgedFinding): string =>
  finding.location?.file
    ? `${finding.location.file}:${finding.location.startLine}`
    : 'no location';

/**
 * Whether a finding is one the main agent is meant to write itself: an
 * answer in the obligation worklist met its entry's `defectWhen`, and the
 * finding carries that obligation's mirrored rule id at a site the worklist
 * names (the skill's step 4).
 *
 * Matched as `raisedForSite` in obligations.ts matches: by rule id and the
 * site's file, and a finding with no location counts. The obligation check
 * and this one read the same two files, and a finding the first counts as
 * raised must not be failed by the second as authored. A worklist entry that
 * was truncated names only some of its sites, so any file passes for it.
 *
 * @param finding a reported finding
 * @param worklist the selector's output, or null when there is none
 */
export const isObligationFinding = (
  finding: JudgedFinding,
  worklist: unknown,
): boolean => {
  const list = (worklist ?? {}) as { selected?: unknown };
  const selected: unknown[] = Array.isArray(list.selected) ? list.selected : [];
  const file = finding.location?.file;
  return selected.some(
    (entry) =>
      isObject(entry) &&
      obligationRuleId(String(entry.id)) === finding.ruleId &&
      (file === undefined ||
        Number(entry.truncated) > 0 ||
        (Array.isArray(entry.sites) &&
          (entry.sites as WorklistSite[]).some((site) => site?.file === file))),
  );
};

/** A model-written command as one bounded line of a failure's detail. */
const oneLine = (command: string): string => {
  const line = command.replace(/\s+/g, ' ').trim();
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
};

/**
 * The failure a finding's executed evidence earns, or `null` (ADR 0126).
 *
 * The matching rule, and what it allows as a near-miss, is written down in
 * `executed-evidence.ts`. A sub-agent's finding is held to the commands
 * sub-agents ran. An obligation finding is the main agent's own, so the
 * command behind it may be the main agent's too.
 *
 * The finding is not touched. Evidence nobody executed is a fact about the
 * reviewer, like a citation that does not match its source (ADR 0078): the
 * report is published whole and the check fails beside it.
 */
const evidenceFailure = (
  finding: JudgedFinding,
  executions: readonly FactExecution[],
  isObligation: boolean,
): RunFailure | null => {
  const evidence = finding.evidence;
  if (evidence?.kind !== 'executed') return null;
  const claim = evidence as { command: string; exitCode: number };
  const match = matchExecutedEvidence(
    claim,
    isObligation ? executions : executions.filter((e) => e.by === 'sub-agent'),
  );
  if (match.status === 'ran') return null;
  const which = `the ${finding.ruleId} finding at ${where(finding)}`;
  const command = oneLine(claim.command);
  return {
    reason: 'evidence-not-executed',
    axis: finding.axis,
    detail:
      match.status === 'not-run'
        ? `${isObligation ? 'neither the main agent nor a sub-agent' : 'no sub-agent'} ran the command ${which} gives as executed evidence: ${command}`
        : `${which} gives exit code ${claim.exitCode} for a command the transcript shows it exiting ${match.exitCodes.join(' and ')}: ${command}`,
  };
};

/**
 * Code that runs, for the Spec brief's trace (issue #1140, decision 4): anything
 * under `.github/workflows/`, `.github/actions/` or `tools/`, and any `*.sh` or
 * `*.mjs` file. The Spec brief names the same scope. Its defects sit in how a
 * changed line meets an unchanged one, so a hunk is not enough and the bar is
 * the whole file, opened.
 */
const EXECUTABLE = [
  /^\.github\/(?:workflows|actions)\//,
  /^tools\//,
  /\.(?:sh|mjs)$/,
];
export const isExecutable = (file: string): boolean =>
  EXECUTABLE.some((re) => re.test(file));

const coverageOf = (
  axis: AxisFacts | undefined,
  file: string,
): FileCoverageState => {
  if (axis?.opened?.includes(file)) return 'opened';
  const diffedHere = (path: string): boolean =>
    file === path || file.startsWith(`${path}/`);
  if (axis?.diffed?.some(diffedHere)) return 'diffed';
  return 'neither';
};

/**
 * Each changed file, on each axis: opened (its content came back), diffed (a
 * diff named it or a directory above it), or neither. The changed-file list is
 * the selector's, never the reviewer's; with none, there is nothing to say.
 *
 * @param facts the run facts
 * @param worklist the obligation worklist, when one was selected
 */
export const fileCoverage = (
  facts: { axes: AxesFacts },
  worklist: unknown,
): FileCoverageRow[] | null => {
  const list = (worklist ?? {}) as { changedFiles?: unknown };
  // No axes is an unreadable transcript, which says nothing about a file.
  if (!facts.axes || !Array.isArray(list.changedFiles)) return null;
  const axes = facts.axes;
  return (list.changedFiles as { file: string; added: number }[]).map(
    ({ file, added }) => ({
      file,
      added,
      standards: coverageOf(axes.standards, file),
      spec: coverageOf(axes.spec, file),
    }),
  );
};

/**
 * Judge one run.
 *
 * @param run.facts the run facts, as `RunFactsSchema` parses them
 * @param run.readable whether the facts account for the report;
 *   `normalizeReport` may read a clean transcript as unknown
 * @param run.findings the report's findings, as the reviewer wrote them and
 *   before an id is added
 * @param run.specKind the report's `spec.kind`
 * @param run.worklist the obligation worklist, when one was selected
 */
export const judgeRun = ({
  facts,
  readable,
  findings,
  specKind,
  worklist = null,
}: {
  facts: RunFacts;
  readable: boolean;
  findings: readonly JudgedFinding[];
  specKind: SpecKind;
  worklist?: unknown;
}): RunJudgment => {
  if (!readable || !statesEveryFact(facts))
    return { failures: [], tightenedBy: ['transcript-unreadable'] };

  const failures: RunFailure[] = [];
  const tightenedBy = new Set<TighteningFact>();

  // An axis that was meant to run: Standards always, Spec when there is one.
  const expected: Record<FindingAxis, boolean> = {
    standards: true,
    spec: specKind !== 'none',
  };
  for (const axis of AXES) {
    const a = facts.axes[axis];
    if (expected[axis] && !a.briefRead)
      failures.push({
        reason: 'brief-not-read',
        axis,
        detail: `no sub-agent read the ${AXIS_NAMES[axis]} brief${a.dispatched ? '' : ', and no dispatch named it'}`,
      });
    if (a.dispatched && a.onTemplate === false)
      tightenedBy.add('dispatch-off-template');
  }
  // A dispatch that is neither axis's is one the skill has no template for.
  // Its findings still count as returned, so without this a main agent could
  // hand its own finding to a third sub-agent and report it on a run that
  // reads as fully on template.
  if (facts.unattributedDispatches > 0)
    tightenedBy.add('dispatch-off-template');
  if (facts.axes.standards.briefRead && !facts.indexOpened)
    tightenedBy.add('index-not-opened');
  if (facts.repliesParsed === false) tightenedBy.add('reply-unparseable');
  // Thin, not broken: a Spec pass that never opened a changed workflow or
  // script can still be right, and says so in the published coverage table.
  if (
    expected.spec &&
    fileCoverage(facts, worklist)?.some(
      (c) => isExecutable(c.file) && c.spec !== 'opened',
    )
  )
    tightenedBy.add('spec-axis-left-executable-file-unopened');

  // Facts read before the calls were kept say nothing about them, and
  // "cannot tell" is never a failure.
  if (Array.isArray(facts.executions))
    for (const finding of findings) {
      const failure = evidenceFailure(
        finding,
        facts.executions,
        isObligationFinding(finding, worklist),
      );
      if (failure) failures.push(failure);
    }

  for (const finding of findings) {
    if (isObligationFinding(finding, worklist)) continue;
    if (facts.returned.some((r) => sameValue(r, finding))) continue;
    // A reply that could not be parsed may have returned this finding.
    if (facts.repliesParsed === false) continue;
    const near = facts.returned.find((r) => {
      const location = r.location as { file?: string } | undefined;
      return (
        r.axis === finding.axis &&
        r.ruleId === finding.ruleId &&
        location?.file === finding.location?.file
      );
    });
    failures.push({
      reason: 'finding-not-returned',
      axis: finding.axis,
      detail: near
        ? `the ${finding.ruleId} finding at ${where(finding)} differs from the one a sub-agent returned in: ${fieldsThatDiffer(finding, near).join(', ')}`
        : `no sub-agent returned the ${finding.ruleId} finding at ${where(finding)}, and it is not an obligation finding for a worklist site`,
    });
  }

  return {
    failures,
    tightenedBy: TIGHTENING_FACTS.filter((fact) => tightenedBy.has(fact)),
  };
};
