// Covers what a run fact costs (issue #1031, ADR 0123 items 4 and 5): one
// test group per row of the consequence ladder, each against a transcript.
//
// Where a real CI run shows the row, its fixture is used as cut:
//
//   cli-2.1.292-paraphrased-dispatch    run 37576528356 — neither brief read,
//     and a returned finding the main agent rewrote one field of.
//   cli-2.1.293-template-two-findings   run 37717857861 — on template, both
//     briefs read, the index opened, and each sub-agent returned one finding
//     that the report carries unchanged. The report is the one the main agent
//     wrote in that run, read out of its own Write call.
//
// No real run shows the other rows, so they are derived here: a real
// transcript with one thing changed, and the change named in the test. That
// keeps the shape the CLI's and makes the one difference the thing under
// test, which a hand-written transcript would not.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BRIEFS } from './briefs.ts';
import { renderRunFacts } from './render-review-report.ts';
import {
  RUN_FAILURES,
  TIGHTENING_FACTS,
  fileCoverage,
  isExecutable,
  isObligationFinding,
  judgeRun,
} from './run-ladder.ts';
import type {
  Evidence,
  FindingAxis,
  FindingInput,
  NormalizeOptions,
  NormalizedReport,
  ReportInput,
  RunFacts,
  SpecKind,
} from './schema.ts';
import {
  NormalizedReportSchema,
  REVIEW_TIER_LABELS,
  normalizeReport,
} from './schema.ts';
import type { TranscriptFacts } from './transcript-facts.ts';
import { STANDARDS_INDEX, readTranscriptFacts } from './transcript-facts.ts';

const TWO_FINDINGS = 'cli-2.1.293-template-two-findings';
const PARAPHRASED = 'cli-2.1.292-paraphrased-dispatch';

/**
 * The transcript shapes these fixtures carry. A transcript is JSON the Claude
 * Code CLI writes, so it is described here rather than imported: nothing in
 * the tooling owns its schema, and this suite reaches only these fields.
 */
interface ContentBlock {
  type?: string;
  name?: string;
  id?: string;
  tool_use_id?: string;
  input?: {
    prompt?: string;
    file_path?: string;
    command?: string;
    content?: string;
  };
  content?: unknown;
  is_error?: boolean;
}

/** A sub-agent dispatch: the one block shape this suite reaches into. */
interface DispatchBlock extends ContentBlock {
  id: string;
  input: { prompt: string };
}

interface TranscriptEvent {
  type?: string;
  parent_tool_use_id?: string | null;
  message: { id?: string; content: ContentBlock[] };
}

/**
 * The facts of a readable run. `RunFactsSchema` lets `axes` and `returned`
 * be null, but only for a transcript that could not be read; every fixture
 * here is a real run, and the two tests that deliberately break one hand
 * their facts straight to the validator rather than reading them.
 */
type ReadFacts = Omit<TranscriptFacts, 'axes' | 'returned'> & {
  axes: NonNullable<RunFacts['axes']>;
  returned: NonNullable<RunFacts['returned']>;
};

/**
 * A normalized report that was judged. `runFacts`, `failures`, and
 * `tightenedBy` are optional in the schema only so a report normalized
 * before the ladder existed still parses; every report normalized here is
 * handed facts, so it carries all three.
 */
type RunFactsOf = NonNullable<NormalizedReport['runFacts']>;
type JudgedReport = Omit<NormalizedReport, 'runFacts'> & {
  runFacts: Omit<RunFactsOf, 'failures' | 'tightenedBy'> & {
    failures: NonNullable<RunFactsOf['failures']>;
    tightenedBy: NonNullable<RunFactsOf['tightenedBy']>;
  };
};

const events = (name: string): TranscriptEvent[] =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/transcripts/${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as TranscriptEvent[];

const factsOf = (transcript: unknown): ReadFacts =>
  readTranscriptFacts(JSON.stringify(transcript), {
    index: null,
  }) as ReadFacts;

/** The report the main agent wrote in a run, from its own Write call. */
const reportWrittenIn = (transcript: TranscriptEvent[]): ReportInput => {
  const write = transcript
    .filter((e) => e.type === 'assistant' && e.parent_tool_use_id === null)
    .flatMap((e) => e.message.content)
    .find(
      (block) =>
        block.name === 'Write' &&
        block.input?.file_path?.endsWith('tmp/code-review/report.json'),
    );
  return JSON.parse(write!.input!.content!) as ReportInput;
};

const isDispatch = (block: ContentBlock) =>
  block.name === 'Agent' || block.name === 'Task';

/** The dispatch whose prompt names a brief, and the id its events hang off. */
const dispatchOf = (
  transcript: TranscriptEvent[],
  axis: FindingAxis,
): DispatchBlock =>
  transcript
    .filter((e) => e.type === 'assistant' && e.parent_tool_use_id === null)
    .flatMap((e) => e.message.content)
    .find(
      (block) =>
        isDispatch(block) && block.input?.prompt?.includes(BRIEFS[axis]),
    ) as DispatchBlock;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A real transcript with the Standards sub-agent's Read of the index removed. */
const withoutIndexRead = (name: string) => {
  const transcript = events(name);
  const { id } = dispatchOf(transcript, 'standards');
  return transcript.filter(
    (e) =>
      !(
        e.parent_tool_use_id === id &&
        e.message.content.some(
          (block) =>
            block.name === 'Read' &&
            block.input?.file_path?.endsWith(`/${STANDARDS_INDEX}`),
        )
      ),
  );
};

/** A real transcript with one sentence added to the Standards dispatch. */
const withSteeredDispatch = (name: string) => {
  const transcript = events(name);
  dispatchOf(transcript, 'standards').input.prompt +=
    '\nOnly report real defects; empty findings is fine.';
  return transcript;
};

/** A real transcript with one sub-agent's reply replaced by prose. */
const withProseReply = (name: string, axis: FindingAxis) => {
  const transcript = events(name);
  const { id } = dispatchOf(transcript, axis);
  for (const e of transcript) {
    if (e.type !== 'user') continue;
    for (const block of e.message.content)
      if (block.tool_use_id === id)
        block.content = [
          { type: 'text', text: 'I reviewed the diff and found one problem.' },
        ];
  }
  return transcript;
};

const real = () => {
  const transcript = events(TWO_FINDINGS);
  return { report: reportWrittenIn(transcript), facts: factsOf(transcript) };
};

const normalized = (
  report: unknown,
  facts: unknown,
  options: NormalizeOptions = {},
): JudgedReport =>
  normalizeReport(clone(report), { facts, ...options }) as JudgedReport;

const reasons = (report: JudgedReport) =>
  report.runFacts.failures.map((f) => f.reason);

const HUMAN = REVIEW_TIER_LABELS.at(-1);

// --- the run that did everything as built ----------------------------------

test('a real run on template, with every finding returned, fails and tightens nothing', () => {
  const { report, facts } = real();
  assert.equal(report.findings.length, 2);
  assert.equal(facts.returned.length, 2);
  const out = normalized({ ...report, tier: 'review:agent' }, facts);
  assert.deepEqual(out.runFacts.failures, []);
  assert.deepEqual(out.runFacts.tightenedBy, []);
  assert.equal(out.effectiveTier, 'review:agent');
  assert.ok(NormalizedReportSchema.safeParse(out).success);
});

// --- row 1 and 2: a brief nobody read --------------------------------------

test('no sub-agent read the Standards brief: Agent Review Ran fails', () => {
  const facts = factsOf(events(PARAPHRASED));
  const out = normalized(
    {
      ...real().report,
      tier: 'review:auto',
      spec: { kind: 'none', foundBy: 'none' },
      findings: [],
    },
    facts,
  );
  assert.deepEqual(out.runFacts.failures, [
    {
      reason: 'brief-not-read',
      axis: 'standards',
      detail: 'no sub-agent read the Standards brief, and no dispatch named it',
    },
  ]);
  // A review that did not run as built vouches for nothing.
  assert.equal(out.effectiveTier, HUMAN);
});

test('the spec is not none and no sub-agent read the Spec brief: it fails for that axis too', () => {
  const facts = factsOf(events(PARAPHRASED));
  const out = normalized({ ...real().report, findings: [] }, facts);
  assert.deepEqual(
    out.runFacts.failures.map((f) => [f.reason, f.axis]),
    [
      ['brief-not-read', 'standards'],
      ['brief-not-read', 'spec'],
    ],
  );
});

// --- row 3: a finding the main agent changed or wrote ----------------------

test('run 37576528356: the main agent rewrote a returned confidence of 0.6 to "medium"', () => {
  const facts = factsOf(events(PARAPHRASED));
  // The dispatch named no brief, so no axis is attributed to it. Its
  // sub-agent returned a finding all the same, and it is compared like any
  // other: the reply is read whether or not the dispatch was on template.
  assert.equal(facts.returned.length, 1);
  assert.equal(facts.returned[0].confidence, 0.6);
  // What the report carried: the same finding with the one field rewritten
  // so it would pass the contract.
  const rewritten = { ...facts.returned[0], confidence: 'medium' };
  const out = normalized({ ...real().report, findings: [rewritten] }, facts);
  const changed = out.runFacts.failures.filter(
    (f) => f.reason === 'finding-not-returned',
  );
  assert.equal(changed.length, 1);
  assert.match(changed[0].detail, /differs .* in: confidence$/);
});

test('a reported finding that differs from the returned one fails, and names the field', () => {
  const { report, facts } = real();
  const changed = clone(report);
  changed.findings[0].severity = 'should-fix';
  const out = normalized(changed, facts);
  assert.deepEqual(reasons(out), ['finding-not-returned']);
  assert.match(out.runFacts.failures[0].detail, /differs .* in: severity$/);
  assert.equal(out.runFacts.failures[0].axis, changed.findings[0].axis);
  assert.equal(out.effectiveTier, HUMAN);
  // The report is not rejected: its findings are still published.
  assert.equal(out.findings.length, 2);
  assert.equal(out.verdict, 'comment');
});

test('a reported finding no sub-agent returned fails', () => {
  const { report, facts } = real();
  const authored = clone(report);
  authored.findings.push({
    ...clone(report.findings[0]),
    ruleId: 'smell-feature-envy',
    summary: 'Something the main agent noticed on its own',
  });
  const out = normalized(authored, facts);
  assert.deepEqual(reasons(out), ['finding-not-returned']);
  assert.match(out.runFacts.failures[0].detail, /^no sub-agent returned/);
});

test('key order is not a difference, and neither is the id the validator adds', () => {
  const { report, facts } = real();
  const reordered = clone(report);
  reordered.findings = reordered.findings.map((f) =>
    Object.fromEntries(Object.entries(f).reverse()),
  ) as FindingInput[];
  assert.deepEqual(normalized(reordered, facts).runFacts.failures, []);
});

test('dropping a returned finding is not a change', () => {
  // The one-axis-per-defect rule drops a Standards finding at assembly.
  const { report, facts } = real();
  const out = normalized({ ...report, findings: [report.findings[1]] }, facts);
  assert.deepEqual(out.runFacts.failures, []);
});

test('an obligation finding at a worklist site has no sub-agent origin and is not a failure', () => {
  const { report, facts } = real();
  const site = 'libs/web/ui/src/dialog.tsx';
  const obligation: FindingInput = {
    ...clone(report.findings[0]),
    ruleId: 'obligation-destructive-confirmation-names-what-it-mutates',
    location: { ...report.findings[0].location!, file: site },
  };
  const withIt = { ...report, findings: [...report.findings, obligation] };
  const entry = {
    id: 'destructive-confirmation-names-what-it-mutates',
    sites: [{ file: site, line: 4 }],
    truncated: 0,
  };

  const worklist = { head: report.head, selected: [entry] };
  assert.deepEqual(
    normalized(withIt, facts, { worklist }).runFacts.failures,
    [],
  );

  // No worklist, an entry for another obligation, or a site in another
  // file: nothing names this finding as the main agent's to write.
  for (const other of [
    null,
    { selected: [] },
    { selected: [{ ...entry, id: 'env-assignment-runtime-value' }] },
    { selected: [{ ...entry, sites: [{ file: 'libs/other.ts', line: 1 }] }] },
  ])
    assert.deepEqual(
      reasons(normalized(withIt, facts, { worklist: other })),
      ['finding-not-returned'],
      JSON.stringify(other),
    );

  // A truncated entry names only some of its sites, so any file passes.
  assert.ok(
    isObligationFinding(obligation, {
      selected: [{ ...entry, sites: [], truncated: 3 }],
    }),
  );
});

// --- row 4: the index never opened -----------------------------------------

test('Standards brief read and CODING_STANDARDS.md never opened: the tier tightens and the check does not fail', () => {
  const { report } = real();
  // Derived: run 37717857861 with the Standards sub-agent's Read of the
  // index taken out.
  const facts = factsOf(withoutIndexRead(TWO_FINDINGS));
  assert.equal(facts.axes.standards.briefRead, true);
  assert.equal(facts.indexOpened, false);
  const out = normalized({ ...report, tier: 'review:auto' }, facts);
  assert.deepEqual(out.runFacts.failures, []);
  assert.deepEqual(out.runFacts.tightenedBy, ['index-not-opened']);
  assert.equal(out.effectiveTier, 'review:agent');
});

// --- row 5: a dispatch off the template ------------------------------------

test('a dispatch carrying text beyond the template tightens the tier', () => {
  const { report } = real();
  // Derived: the same run with one of the two sentences run 37576528356
  // added to its dispatches appended to the Standards one.
  const facts = factsOf(withSteeredDispatch(TWO_FINDINGS));
  assert.equal(facts.axes.standards.onTemplate, false);
  const out = normalized({ ...report, tier: 'review:agent' }, facts);
  assert.deepEqual(out.runFacts.failures, []);
  assert.deepEqual(out.runFacts.tightenedBy, ['dispatch-off-template']);
  assert.equal(out.effectiveTier, HUMAN);
});

test('a dispatch that names no brief is off the template, and what it returned is still returned', () => {
  const { report } = real();
  // Derived: the same run with a third, free-form dispatch added beside the
  // two template ones, replying with a finding the report then carries.
  const transcript = events(TWO_FINDINGS);
  const extra = {
    ...clone(report.findings[0]),
    ruleId: 'smell-feature-envy',
    summary: 'A finding from a free-form third dispatch',
  };
  transcript.splice(
    transcript.findIndex((e) => e.type === 'result'),
    0,
    {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        id: 'msg_extra',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_extra',
            name: 'Agent',
            input: {
              prompt: 'Look at the diff again and report anything else.',
            },
          },
        ],
      },
    },
    {
      type: 'assistant',
      parent_tool_use_id: 'toolu_extra',
      message: {
        id: 'msg_extra_child',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_extra_child',
            name: 'Bash',
            input: { command: 'git diff --stat' },
          },
        ],
      },
    },
    {
      type: 'user',
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_extra',
            content: [
              { type: 'text', text: JSON.stringify({ findings: [extra] }) },
            ],
          },
        ],
      },
    },
  );
  const facts = factsOf(transcript);
  assert.equal(facts.unattributedDispatches, 1);
  assert.equal(facts.axes.standards.onTemplate, true);
  const out = normalized(
    { ...report, tier: 'review:auto', findings: [...report.findings, extra] },
    facts,
  );
  // A sub-agent did return it, so it is not a finding the main agent wrote.
  assert.deepEqual(out.runFacts.failures, []);
  // The run is not on the template all the same, and says so.
  assert.deepEqual(out.runFacts.tightenedBy, ['dispatch-off-template']);
  assert.equal(out.effectiveTier, 'review:agent');
  assert.match(renderRunFacts(out).join('\n'), /extra dispatches: \*\*1\*\*/);
});

// --- row 6: cannot tell -----------------------------------------------------

test('a transcript that cannot be read tightens the tier and fails nothing', () => {
  const { report } = real();
  // Derived: the same run with its result event cut off.
  const facts = factsOf(
    events(TWO_FINDINGS).filter((e) => e.type !== 'result'),
  );
  assert.equal(facts.shape, 'unknown');
  const out = normalized({ ...report, tier: 'review:auto' }, facts);
  assert.deepEqual(out.runFacts.failures, []);
  assert.deepEqual(out.runFacts.tightenedBy, ['transcript-unreadable']);
  assert.equal(out.effectiveTier, 'review:agent');
});

test('a transcript that shows no dispatch under a report with findings is unknown, not a failure', () => {
  const { report } = real();
  // Derived: the same run with both dispatches renamed, as a CLI release
  // that renamed the tool would leave it.
  const transcript = events(TWO_FINDINGS);
  for (const e of transcript)
    if (e.type === 'assistant')
      for (const block of e.message.content)
        if (isDispatch(block)) block.name = 'Delegate';
  const out = normalized(
    { ...report, tier: 'review:auto' },
    factsOf(transcript),
  );
  assert.equal(out.runFacts.shape, 'unknown');
  assert.deepEqual(out.runFacts.failures, []);
  assert.deepEqual(out.runFacts.tightenedBy, ['transcript-unreadable']);
});

test('a reply that cannot be parsed tightens the tier, and its findings are not failed', () => {
  const { report } = real();
  // Derived: the same run with the Standards sub-agent's reply replaced by
  // a sentence.
  const facts = factsOf(withProseReply(TWO_FINDINGS, 'standards'));
  assert.equal(facts.repliesParsed, false);
  assert.equal(facts.returned.length, 1);
  const out = normalized({ ...report, tier: 'review:auto' }, facts);
  // The Standards finding is not among the returned ones, and the reply
  // that may have held it could not be read: that is "cannot tell".
  assert.deepEqual(out.runFacts.failures, []);
  assert.deepEqual(out.runFacts.tightenedBy, ['reply-unparseable']);
  assert.equal(out.effectiveTier, 'review:agent');
});

test('a fenced reply broke the brief and is still read for what it returned', () => {
  const facts = factsOf(events('cli-2.1.293-template-sequential-fenced'));
  assert.equal(facts.axes.standards.replyIsJson, false);
  assert.equal(facts.repliesParsed, true);
  assert.deepEqual(facts.returned, []);
});

// --- how the steps combine ---------------------------------------------------

test('tightening facts cost one step together, on top of the step a missing spec costs', () => {
  const { report } = real();
  const transcript = withSteeredDispatch(TWO_FINDINGS);
  const { id } = dispatchOf(transcript, 'standards');
  const facts = factsOf(
    transcript.filter(
      (e) =>
        !(
          e.parent_tool_use_id === id &&
          e.message.content.some((b) =>
            b.input?.file_path?.endsWith(`/${STANDARDS_INDEX}`),
          )
        ),
    ),
  );
  const thin = (overrides: Partial<ReportInput>) =>
    normalized({ ...report, findings: [], ...overrides }, facts);

  assert.deepEqual(thin({}).runFacts.tightenedBy, [
    'index-not-opened',
    'dispatch-off-template',
  ]);
  assert.equal(thin({ tier: 'review:auto' }).effectiveTier, 'review:agent');
  assert.equal(thin({ tier: 'review:human' }).effectiveTier, 'review:human');
  // An interactive run has no label to tighten; the facts are still recorded.
  assert.equal(thin({ tier: null }).effectiveTier, null);
});

test('with no spec, a tightening fact is the second step', () => {
  // Derived: the same run with the index Read removed. The Spec sub-agent
  // ran in it, which a report with no spec does not need and is not failed for.
  const facts = factsOf(withoutIndexRead(TWO_FINDINGS));
  const out = normalized(
    {
      ...real().report,
      tier: 'review:auto',
      spec: { kind: 'none', foundBy: 'none' },
      findings: [],
    },
    facts,
  );
  assert.deepEqual(out.runFacts.failures, []);
  assert.equal(out.effectiveTier, HUMAN);
});

test('without a facts file nothing is judged', () => {
  const out = normalizeReport(clone(real().report));
  assert.equal(out.runFacts, null);
  assert.equal(out.effectiveTier, 'review:human');
});

// --- what the comment says ---------------------------------------------------

test('a failure is published as the reason the check fails', () => {
  const { report, facts } = real();
  const changed = clone(report);
  changed.findings[0].severity = 'should-fix';
  const text = renderRunFacts(normalized(changed, facts)).join('\n');
  assert.match(
    text,
    /\*\*`Agent Review Ran` fails\*\* \(`finding-not-returned`\)/,
  );
  assert.doesNotMatch(text, /tier tightened/);
});

test('a tightened tier is published with what tightened it', () => {
  const { report } = real();
  const facts = factsOf(withoutIndexRead(TWO_FINDINGS));
  const text = renderRunFacts(
    normalized({ ...report, tier: 'review:auto' }, facts),
  ).join('\n');
  assert.match(text, /standards index: \*\*not opened\*\*/);
  assert.match(
    text,
    /tier tightened one step toward a human by: `index-not-opened`/,
  );
  const interactive = renderRunFacts(
    normalized({ ...report, tier: null }, facts),
  ).join('\n');
  assert.match(interactive, /would tighten a tier: `index-not-opened`/);
});

test('an unparseable reply and an unreadable transcript each get a line', () => {
  const { report } = real();
  assert.match(
    renderRunFacts(
      normalized(report, factsOf(withProseReply(TWO_FINDINGS, 'spec'))),
    ).join('\n'),
    /sub-agent replies: \*\*not all readable\*\*/,
  );
  assert.match(
    renderRunFacts(
      normalized(
        { ...report, tier: 'review:auto' },
        factsOf(events(TWO_FINDINGS).filter((e) => e.type !== 'result')),
      ),
    ).join('\n'),
    /tier tightened one step toward a human by: `transcript-unreadable`/,
  );
});

// --- executed evidence nobody executed (issue #1039, ADR 0126) -------------
//
// No real run shows a finding with executed evidence, so each of these is
// the two-findings run with the Standards finding's evidence replaced, in
// the sub-agent's reply and in the report alike: the finding is still one a
// sub-agent returned, and its evidence is the one thing under test. The
// fixture was cut without what a sub-agent's tool calls returned, so a test
// that needs an exit code adds that one result, in the CLI's shape.

const RULES_CHECK = 'node tools/scripts/check-review-rules.mjs';

const executedEvidence = (command: string, exitCode = 1): Evidence => ({
  kind: 'executed',
  command,
  exitCode,
  outputExcerpt: 'rule smell-x has no brief entry',
  cwd: '.',
});

/** One tool result this suite adds to a fixture, in the CLI's own shape. */
interface AddedResult {
  of: string;
  content: string;
  isError: boolean;
}

/** The two-findings run with the Standards finding resting on `evidence`. */
const withStandardsEvidence = (
  evidence: Evidence,
  { result = null }: { result?: AddedResult | null } = {},
) => {
  const transcript = events(TWO_FINDINGS);
  const report = reportWrittenIn(transcript);
  const change = (finding: FindingInput) =>
    Object.assign(finding, { evidence });
  change(report.findings.find((f) => f.axis === 'standards')!);

  const { id } = dispatchOf(transcript, 'standards');
  for (const e of transcript) {
    if (e.type !== 'user') continue;
    for (const block of e.message.content) {
      if (block.tool_use_id !== id) continue;
      // A sub-agent's reply is one text part; the suite rewrites its JSON.
      const [part] = block.content as { text: string }[];
      part.text = part.text
        .split('\n')
        .map((line) => {
          if (!line.startsWith('  {')) return line;
          const reply = JSON.parse(line) as { findings: FindingInput[] };
          change(reply.findings[0]);
          return `  ${JSON.stringify(reply)}`;
        })
        .join('\n');
    }
  }

  if (result) {
    const at = transcript.findIndex(
      (e) =>
        e.parent_tool_use_id === id &&
        e.message.content.some((b) => b.input?.command === result.of),
    );
    const call = transcript[at].message.content.find(
      (b) => b.input?.command === result.of,
    );
    transcript.splice(at + 1, 0, {
      type: 'user',
      parent_tool_use_id: id,
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: call!.id,
            content: result.content,
            is_error: result.isError,
          },
        ],
      },
    });
  }
  return { report, facts: factsOf(transcript) };
};

test('executed evidence quoting a command a sub-agent ran fails nothing', () => {
  const { report, facts } = withStandardsEvidence(
    executedEvidence(RULES_CHECK),
  );
  const out = normalized({ ...report, tier: 'review:agent' }, facts);
  assert.deepEqual(out.runFacts.failures, []);
  assert.equal(out.effectiveTier, 'review:agent');
});

test('executed evidence quoting a command no sub-agent ran: Agent Review Ran fails', () => {
  const { report, facts } = withStandardsEvidence(
    executedEvidence('yarn nx test web-vault'),
  );
  const out = normalized({ ...report, tier: 'review:auto' }, facts);
  assert.deepEqual(reasons(out), ['evidence-not-executed']);
  const [failure] = out.runFacts.failures;
  assert.equal(failure.axis, 'standards');
  assert.match(failure.detail, /no sub-agent ran/);
  assert.match(failure.detail, /yarn nx test web-vault/);
  assert.match(failure.detail, /smell-duplicated-code/);
  assert.equal(out.effectiveTier, HUMAN);
  assert.ok(NormalizedReportSchema.safeParse(out).success);
});

test('the check edits no finding: a failed run still carries the finding as written', () => {
  const { report, facts } = withStandardsEvidence(
    executedEvidence('yarn nx test web-vault'),
  );
  const out = normalized(report, facts);
  assert.deepEqual(
    out.findings.map((finding) => ({ ...finding, id: undefined })),
    report.findings.map((finding) => ({ ...finding, id: undefined })),
  );
  assert.equal(out.verdict, normalizeReport(clone(report)).verdict);
});

test('a near-miss the matching rule allows fails nothing', () => {
  // Re-quoted and re-spaced, against the call as the sub-agent typed it.
  const typed = events(TWO_FINDINGS)
    .flatMap((e) => e.message?.content ?? [])
    .map((b) => b.input?.command)
    .find((c) => c?.startsWith('git grep -n "SCHEMA_VERSION'));
  const { report, facts } = withStandardsEvidence(
    executedEvidence(
      typed!.replaceAll('"', "'").replaceAll(' -- ', '   --   '),
      0,
    ),
  );
  assert.notEqual(
    (report.findings[0].evidence as { command?: string }).command,
    typed,
  );
  assert.deepEqual(normalized(report, facts).runFacts.failures, []);
});

test('a command only the main agent ran is not one a sub-agent ran', () => {
  const { facts: bare } = real();
  const mainOnly = bare.executions!.find((e) => e.by === 'main')!.command;
  const { report, facts } = withStandardsEvidence(
    executedEvidence(mainOnly, 0),
  );
  assert.deepEqual(reasons(normalized(report, facts)), [
    'evidence-not-executed',
  ]);
});

test('an obligation finding is the main agents own, and so is the command behind it', () => {
  const { report, facts } = real();
  const site = 'libs/web/ui/src/dialog.tsx';
  const id = 'destructive-confirmation-names-what-it-mutates';
  const worklist = {
    selected: [{ id, truncated: 0, sites: [{ file: site }] }],
  };
  const obligation = (command: string): FindingInput => ({
    ...clone(report.findings[0]),
    ruleId: `obligation-${id}`,
    location: { ...report.findings[0].location!, file: site },
    evidence: executedEvidence(command, 0),
  });
  const mainOnly = facts.executions!.find((e) => e.by === 'main')!.command;

  const ranIt = clone(report);
  ranIt.findings.push(obligation(mainOnly));
  assert.deepEqual(
    normalized(ranIt, facts, { worklist }).runFacts.failures,
    [],
  );

  const didNot = clone(report);
  didNot.findings.push(obligation('yarn nx test web-ui'));
  const out = normalized(didNot, facts, { worklist });
  assert.deepEqual(reasons(out), ['evidence-not-executed']);
  assert.match(out.runFacts.failures[0].detail, /neither the main agent nor/);
});

test('an exit code the transcript contradicts: Agent Review Ran fails', () => {
  const { report, facts } = withStandardsEvidence(
    executedEvidence(RULES_CHECK, 1),
    { result: { of: RULES_CHECK, content: 'ok 37 rules', isError: false } },
  );
  const out = normalized(report, facts);
  assert.deepEqual(reasons(out), ['evidence-not-executed']);
  assert.match(out.runFacts.failures[0].detail, /exit code 1/);
  assert.match(out.runFacts.failures[0].detail, /shows it exiting 0/);
});

test('an exit code the transcript agrees with, or does not carry, fails nothing', () => {
  const agrees = withStandardsEvidence(executedEvidence(RULES_CHECK, 2), {
    result: {
      of: RULES_CHECK,
      content: 'Exit code 2\nrule smell-x has no brief entry',
      isError: true,
    },
  });
  assert.deepEqual(
    normalized(agrees.report, agrees.facts).runFacts.failures,
    [],
  );
  // The fixture as cut carries no result for the call at all.
  const silent = withStandardsEvidence(executedEvidence(RULES_CHECK, 2));
  assert.deepEqual(
    normalized(silent.report, silent.facts).runFacts.failures,
    [],
  );
});

test('cannot-tell fails nothing: an unreadable transcript, or facts read before executions were', () => {
  const { report, facts } = withStandardsEvidence(
    executedEvidence('yarn nx test web-vault'),
  );
  const unreadable = normalized(report, {
    ...facts,
    shape: 'unknown',
    shapeReason: 'the transcript has no result event',
    dispatches: null,
    axes: null,
    standardsSources: null,
    indexOpened: null,
    executed: null,
    executions: null,
    unattributedDispatches: null,
    repliesParsed: null,
    returned: null,
  });
  assert.deepEqual(unreadable.runFacts.failures, []);
  assert.deepEqual(unreadable.runFacts.tightenedBy, ['transcript-unreadable']);

  const older = clone(facts);
  delete older.executions;
  assert.deepEqual(normalized(report, older).runFacts.failures, []);
});

test('the comment says the evidence was not executed, and still shows the finding', () => {
  const { report, facts } = withStandardsEvidence(
    executedEvidence('yarn nx test web-vault'),
  );
  assert.match(
    renderRunFacts(normalized(report, facts)).join('\n'),
    /\*\*`Agent Review Ran` fails\*\* \(`evidence-not-executed`\)/,
  );
});

// --- the vocabularies and the CLI -------------------------------------------

test('the ladder names three failures and five tightening facts', () => {
  assert.deepEqual(RUN_FAILURES, [
    'brief-not-read',
    'finding-not-returned',
    'evidence-not-executed',
  ]);
  assert.deepEqual(TIGHTENING_FACTS, [
    'index-not-opened',
    'dispatch-off-template',
    'transcript-unreadable',
    'reply-unparseable',
    'spec-axis-left-executable-file-unopened',
  ]);
});

const VALIDATOR = new URL('./validate-review-report.ts', import.meta.url)
  .pathname;

const validate = (report: unknown, facts: unknown, extra: string[] = []) => {
  const dir = mkdtempSync(join(tmpdir(), 'run-ladder-'));
  const paths = {
    report: join(dir, 'report.json'),
    facts: join(dir, 'facts.json'),
    out: join(dir, 'normalized.json'),
  };
  writeFileSync(paths.report, JSON.stringify(report));
  writeFileSync(paths.facts, JSON.stringify(facts));
  const run = spawnSync(
    process.execPath,
    [
      VALIDATOR,
      paths.report,
      '--facts',
      paths.facts,
      '--out',
      paths.out,
      ...extra,
    ],
    { encoding: 'utf8' },
  );
  return { run, dir, out: paths.out };
};

test('the validator writes a failed run and exits 0, so the findings are still published', () => {
  const { report, facts } = real();
  const changed = clone(report);
  changed.findings[0].severity = 'should-fix';
  const { run, out } = validate(changed, facts);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /run failure \(finding-not-returned\)/);
  const written = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(reasons(written), ['finding-not-returned']);
  assert.equal(written.findings.length, 2);
});

test('a transcript read and a report validated, end to end: fabricated executed evidence is a printed run failure', () => {
  const { report, facts } = withStandardsEvidence(
    executedEvidence('yarn nx test web-vault'),
  );
  const { run, out } = validate(report, facts);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /run failure \(evidence-not-executed\)/);
  const written = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(reasons(written), ['evidence-not-executed']);
  assert.equal(written.findings.length, 2);
});

test('--worklist names the obligation findings, and a path that does not exist is no worklist', () => {
  const { report, facts } = real();
  const site = 'libs/web/ui/src/dialog.tsx';
  const withIt = clone(report);
  withIt.findings.push({
    ...clone(report.findings[0]),
    ruleId: 'obligation-destructive-confirmation-names-what-it-mutates',
    location: { ...report.findings[0].location!, file: site },
  });

  const missing = validate(withIt, facts, [
    '--worklist',
    '/nonexistent/w.json',
  ]);
  assert.equal(missing.run.status, 0, missing.run.stderr);
  assert.deepEqual(reasons(JSON.parse(readFileSync(missing.out, 'utf8'))), [
    'finding-not-returned',
  ]);

  const dir = mkdtempSync(join(tmpdir(), 'run-ladder-w-'));
  const worklist = join(dir, 'obligations.json');
  writeFileSync(
    worklist,
    JSON.stringify({
      head: report.head,
      selected: [
        {
          id: 'destructive-confirmation-names-what-it-mutates',
          sites: [{ file: site, line: 4 }],
          truncated: 0,
        },
      ],
    }),
  );
  const named = validate(withIt, facts, ['--worklist', worklist]);
  assert.equal(named.run.status, 0, named.run.stderr);
  assert.deepEqual(reasons(JSON.parse(readFileSync(named.out, 'utf8'))), []);

  writeFileSync(worklist, 'not json');
  assert.equal(validate(withIt, facts, ['--worklist', worklist]).run.status, 2);
});

// --- which changed files each axis opened (issue #1140) ----------------------

/**
 * Facts carrying only what coverage is read from. `RunFacts` is the whole
 * facts file; a full fixture here would be noise around the thing under test.
 */
type CoverageFacts = Pick<
  RunFacts,
  | 'axes'
  | 'indexOpened'
  | 'unattributedDispatches'
  | 'repliesParsed'
  | 'executions'
  | 'returned'
>;

const coverageFacts = ({
  specOpened = [],
  specDiffed = [],
  standardsDiffed = [],
}: {
  specOpened?: string[];
  specDiffed?: string[];
  standardsDiffed?: string[];
} = {}): CoverageFacts => ({
  axes: {
    standards: {
      dispatched: true,
      briefRead: true,
      onTemplate: true,
      toolCalls: 3,
      opened: [],
      diffed: standardsDiffed,
    },
    spec: {
      dispatched: true,
      briefRead: true,
      onTemplate: true,
      toolCalls: 3,
      opened: specOpened,
      diffed: specDiffed,
    },
  },
  indexOpened: true,
  unattributedDispatches: 0,
  repliesParsed: true,
  executions: [],
  returned: [],
});
const changed = {
  selected: [],
  changedFiles: [
    { file: '.github/workflows/deploy.yml', added: 580 },
    { file: 'tools/scripts/deploy/lib.mjs', added: 300 },
    { file: 'docs/deploy.md', added: 40 },
  ],
};

test('each changed file is opened, diffed, or neither on each axis, most lines first', () => {
  const coverage = fileCoverage(
    coverageFacts({
      specOpened: ['tools/scripts/deploy/lib.mjs'],
      standardsDiffed: ['.github'],
    }),
    changed,
  );
  assert.deepEqual(coverage, [
    {
      file: '.github/workflows/deploy.yml',
      added: 580,
      standards: 'diffed',
      spec: 'neither',
    },
    {
      file: 'tools/scripts/deploy/lib.mjs',
      added: 300,
      standards: 'neither',
      spec: 'opened',
    },
    {
      file: 'docs/deploy.md',
      added: 40,
      standards: 'neither',
      spec: 'neither',
    },
  ]);
  // No worklist, or one written before it named changed files: nothing to say.
  assert.equal(fileCoverage(coverageFacts(), null), null);
  assert.equal(fileCoverage(coverageFacts(), { selected: [] }), null);
});

test('a Spec axis that left a changed workflow or script unopened tightens the tier', () => {
  const judge = (facts: CoverageFacts, specKind: SpecKind = 'issue') =>
    judgeRun({
      // Only the coverage fields are read on this path; see CoverageFacts.
      facts: facts as RunFacts,
      readable: true,
      findings: [],
      specKind,
      worklist: changed,
    }).tightenedBy;
  // The #1139 shape: the 580-line workflow neither opened nor read whole.
  assert.deepEqual(
    judge(coverageFacts({ specOpened: ['tools/scripts/deploy/lib.mjs'] })),
    ['spec-axis-left-executable-file-unopened'],
  );
  // A diff by path is not enough: the defect sat in unchanged lines around a hunk.
  assert.deepEqual(
    judge(
      coverageFacts({
        specOpened: ['tools/scripts/deploy/lib.mjs'],
        specDiffed: ['.github/workflows/deploy.yml'],
      }),
    ),
    ['spec-axis-left-executable-file-unopened'],
  );
  // Every executable file opened; an unopened doc does not count.
  assert.deepEqual(
    judge(
      coverageFacts({
        specOpened: [
          '.github/workflows/deploy.yml',
          'tools/scripts/deploy/lib.mjs',
        ],
      }),
    ),
    [],
  );
  // No Spec axis, no Spec coverage to judge.
  assert.deepEqual(judge(coverageFacts(), 'none'), []);
});

test('the comment lists each changed file and what each axis did with it', () => {
  const { report, facts } = real();
  const worklist = {
    selected: [],
    changedFiles: [
      { file: '.github/workflows/deploy.yml', added: 580 },
      { file: 'docs/deploy.md', added: 40 },
    ],
  };
  const out = normalized({ ...report, tier: 'review:human' }, facts, {
    worklist,
  });
  assert.deepEqual(out.runFacts.coverage, fileCoverage(facts, worklist));
  // In the recorded run both sub-agents diffed `.github` and `docs` by path.
  // A diff is not an open, so the workflow's Spec cell is still flagged.
  const text = renderRunFacts(out).join('\n');
  assert.match(
    text,
    /changed files, most lines added first \(read from the transcript\):/,
  );
  assert.match(
    text,
    /\| `\.github\/workflows\/deploy\.yml` \| 580 \| diffed \| \*\*diffed\*\* \|/,
  );
  assert.match(text, /\| `docs\/deploy\.md` \| 40 \| diffed \| neither \|/);
  assert.match(text, /`spec-axis-left-executable-file-unopened`/);
  // Without a changed-file list there is no table, rather than an empty one.
  assert.doesNotMatch(
    renderRunFacts(normalized(report, facts)).join('\n'),
    /changed files, most lines added first/,
  );
});

test('the render CLI prints the coverage table for a transcript-read report', () => {
  // Run as a process, not imported: the CLI renders while the module is
  // still evaluating, so a renderer declared below its entry point throws
  // there and nowhere else.
  const { report, facts } = real();
  const worklist = {
    selected: [],
    changedFiles: [{ file: '.github/workflows/deploy.yml', added: 580 }],
  };
  const dir = mkdtempSync(join(tmpdir(), 'render-cli-'));
  const path = join(dir, 'normalized.json');
  writeFileSync(path, JSON.stringify(normalized(report, facts, { worklist })));
  const run = spawnSync(
    process.execPath,
    [
      new URL('./render-review-report.ts', import.meta.url).pathname,
      path,
      '--no-hunks',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /changed files, most lines added first/);
});

test('code that runs is exactly the scope the Spec brief names', () => {
  // Issue #1140, decision 4: `.github/workflows/**`, `.github/actions/**`,
  // `tools/**`, `*.sh`, `*.mjs`.
  for (const file of [
    '.github/workflows/deploy-staging.yml',
    '.github/actions/code-reviewer/action.yml',
    'tools/config/review-rules.json',
    'tools/scripts/lib/staging-web-deploy.mjs',
    'apps/backend/scripts/start.sh',
    'libs/x/build.mjs',
  ])
    assert.ok(isExecutable(file), file);
  for (const file of [
    'docs/deploy.md',
    '.github/CODEOWNERS',
    'apps/backend/src/x.cjs',
    'libs/x/src/index.ts',
  ])
    assert.ok(!isExecutable(file), file);
});
