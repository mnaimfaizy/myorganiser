// Covers what a reviewer transcript is read for (issue #1031, ADR 0123).
//
// The three fixtures under fixtures/transcripts are cut down from real CI
// runs, with the Claude Code CLI version in the filename, because the shape
// being read belongs to that CLI and a hand-written transcript would only
// prove the reader agrees with its author:
//
//   cli-2.1.292-paraphrased-dispatch        run 37576528356 — the old skill.
//     The main agent paraphrased both briefs, and the Standards sub-agent
//     listed four standards sources having opened none.
//   cli-2.1.293-template-sequential-fenced  run 37707518833 — the brief files,
//     first run. On template; `CODING_STANDARDS.md` opened.
//   cli-2.1.293-template                    run 37711917002 — the same, with a
//     Read of a harness spill file outside the workspace.
//   cli-2.1.301-handback                    run 38809002623 — the sub-agents ended
//     by calling SubagentHandback with their report. Each dispatch's own
//     tool_result is only a pointer to that call; the Spec sub-agent returned
//     one should-fix finding.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { BRIEFS, RETRY_LINE, axisNamedBy, isOnTemplate } from './briefs.ts';
import type { FindingAxis } from './schema.ts';
import type { TranscriptFacts } from './transcript-facts.ts';
import {
  filesOpenedBy,
  findingsReturnedBy,
  readTranscriptFacts,
  replyIsBareJson,
  standardsDocumentTest,
} from './transcript-facts.ts';

/**
 * The transcript shapes these fixtures carry. A transcript is JSON the Claude
 * Code CLI writes, so it is described here rather than imported: nothing in
 * the tooling owns its schema, and these tests reach only these fields — plus
 * an index signature, because several of them bend an event into a shape a
 * future CLI release might have.
 */
interface ToolInput {
  prompt?: string;
  file_path?: string;
  command?: string;
  message?: string;
  run_in_background?: boolean;
  [field: string]: unknown;
}
interface ContentBlock {
  type?: string;
  name?: string;
  id?: string;
  tool_use_id?: string;
  input?: ToolInput;
  content?: unknown;
  is_error?: boolean;
  text?: string;
}
interface TranscriptEvent {
  type?: string;
  subtype?: string;
  parent_tool_use_id?: string | null;
  message?: { id?: string; role?: string; content?: ContentBlock[] };
  modelUsage?: Record<string, unknown>;
  permission_denials?: { tool_use_id?: string }[];
  [field: string]: unknown;
}

const fixture = (name: string) =>
  readFileSync(
    new URL(`./fixtures/transcripts/${name}.json`, import.meta.url),
    'utf8',
  );

const INDEX = `
| Source | Covers |
| --- | --- |
| [\`AGENTS.md\`](AGENTS.md) | policy |
| [\`docs/adr/\`](docs/adr/) | decisions |
| [\`docs/ui/GUIDELINES.md\`](docs/ui/GUIDELINES.md) | UI |
| [\`docs/review/REVIEW_CHECKLIST.md\`](docs/review/REVIEW_CHECKLIST.md) | obligations |
| [upstream](https://example.com/standards.md) | not ours |
`;

const facts = (name: string) =>
  readTranscriptFacts(fixture(name), { index: INDEX });

// --- the template ----------------------------------------------------------

const HEAD = 'a'.repeat(40);
const standardsPrompt = [
  `Read ${BRIEFS.standards} first and follow it. It is your whole brief.`,
  '- diff: git diff main...HEAD',
  `- head: ${HEAD}`,
].join('\n');
const specPrompt = [
  `Read ${BRIEFS.spec} first and follow it. It is your whole brief.`,
  '- diff: git diff 3c5b6eff...HEAD',
  `- head: ${HEAD}`,
  '- spec: #1031, text in tmp/code-review/spec.json',
].join('\n');

test('a dispatch that is the template and nothing else is on template', () => {
  assert.ok(isOnTemplate('standards', standardsPrompt));
  assert.ok(isOnTemplate('spec', specPrompt));
  assert.ok(isOnTemplate('standards', `${standardsPrompt}\n`));
});

test('the retry line is the one addition the template takes', () => {
  const retry = RETRY_LINE.replace('<axis>', 'standards');
  assert.ok(isOnTemplate('standards', `${standardsPrompt}\n${retry}`));
  // The other axis's file is not this axis's retry.
  assert.ok(
    !isOnTemplate(
      'standards',
      `${standardsPrompt}\n${RETRY_LINE.replace('<axis>', 'spec')}`,
    ),
  );
});

test('anything added to the template is off template', () => {
  assert.ok(
    !isOnTemplate(
      'standards',
      `${standardsPrompt}\nOnly report real defects; empty findings is fine.`,
    ),
  );
  // Steering smuggled into a placeholder: a fixed point holds no spaces.
  assert.ok(
    !isOnTemplate(
      'standards',
      standardsPrompt.replace('main...HEAD', 'main...HEAD and skip smells'),
    ),
  );
  // The Spec template on the Standards axis is not the Standards template.
  assert.ok(!isOnTemplate('standards', specPrompt));
  assert.ok(!isOnTemplate('spec', standardsPrompt));
});

test('a dispatch names its axis by the brief path it carries', () => {
  assert.equal(axisNamedBy(standardsPrompt), 'standards');
  assert.equal(axisNamedBy(specPrompt), 'spec');
  assert.equal(axisNamedBy('You are the Standards reviewer.'), null);
});

// --- what counts as opened --------------------------------------------------

const CWD = '/home/runner/work/repo/repo';
const opened = (name: string, input: ToolInput) =>
  filesOpenedBy({ name, input }, CWD);

test('Read opens a file at any range, and the path is made repo-relative', () => {
  assert.deepEqual(opened('Read', { file_path: `${CWD}/AGENTS.md` }), [
    'AGENTS.md',
  ]);
  assert.deepEqual(
    opened('Read', { file_path: 'docs/adr/0001-x.md', offset: 10, limit: 5 }),
    ['docs/adr/0001-x.md'],
  );
  assert.deepEqual(opened('Read', { file_path: './CONTEXT.md' }), [
    'CONTEXT.md',
  ]);
});

test('a Read outside the workspace opened nothing in it', () => {
  // Run 37711917002: the harness spilled an oversized command output under
  // the runner's home, and the sub-agent read it back.
  assert.deepEqual(
    opened('Read', {
      file_path: '/home/runner/.claude/projects/x/tool-results/b2k.txt',
    }),
    [],
  );
  assert.deepEqual(opened('Read', { file_path: '../elsewhere/AGENTS.md' }), []);
});

test('cat and git show open files; every part of a chained call is read', () => {
  assert.deepEqual(
    opened('Bash', {
      command: `cat libs/a/AGENTS.md; git diff main...HEAD | grep '^-'; grep -rn x libs`,
    }),
    ['libs/a/AGENTS.md'],
  );
  assert.deepEqual(
    opened('Bash', { command: 'cat -n CODING_STANDARDS.md AGENTS.md' }),
    ['CODING_STANDARDS.md', 'AGENTS.md'],
  );
  assert.deepEqual(
    opened('Bash', {
      command: `git show ${HEAD}:docs/ui/GUIDELINES.md && git show HEAD:"AGENTS.md"`,
    }),
    ['docs/ui/GUIDELINES.md', 'AGENTS.md'],
  );
});

test('searching, listing and counting open nothing', () => {
  // Run 37576528356 listed two nested AGENTS.md files as sources on the
  // strength of this `ls`.
  for (const command of [
    'ls apps/mobile/AGENTS.md libs/mobile/AGENTS.md',
    'grep -n rule AGENTS.md',
    'git grep -n rule HEAD -- AGENTS.md',
    'head -40 AGENTS.md',
    'tail -5 AGENTS.md',
    'wc -l AGENTS.md',
    'git diff main...HEAD -- AGENTS.md',
    // A commit shown whole is not a file opened.
    'git show HEAD',
    'git show --stat HEAD',
  ])
    assert.deepEqual(opened('Bash', { command }), [], command);
  assert.deepEqual(opened('Grep', { pattern: 'x', path: 'AGENTS.md' }), []);
  assert.deepEqual(opened('Glob', { pattern: '**/AGENTS.md' }), []);
});

// --- what counts as a standards document ------------------------------------

test('a standards document is the index, what it links, or an Agent Guide', () => {
  const isStandard = standardsDocumentTest(INDEX);
  assert.ok(isStandard('CODING_STANDARDS.md'));
  assert.ok(isStandard('AGENTS.md'));
  assert.ok(isStandard('docs/ui/GUIDELINES.md'));
  // A directory link covers everything under it.
  assert.ok(isStandard('docs/adr/0123-anything.md'));
  // An Agent Guide at any depth, whether or not the index names it.
  assert.ok(isStandard('libs/mobile/ui/AGENTS.md'));
  // The code under review is not a standard.
  assert.ok(!isStandard('libs/mobile/ui/src/staticElement.ts'));
  assert.ok(!isStandard('.agents/skills/code-review/SKILL.md'));
  // A remote link is not a path.
  assert.ok(!isStandard('https://example.com/standards.md'));
});

test('the Review Checklist is excluded by name, though the index links it', () => {
  assert.ok(!standardsDocumentTest(INDEX)('docs/review/REVIEW_CHECKLIST.md'));
});

test('with no index, only the index itself and Agent Guides qualify', () => {
  const isStandard = standardsDocumentTest(null);
  assert.ok(isStandard('CODING_STANDARDS.md'));
  assert.ok(isStandard('apps/backend/AGENTS.md'));
  assert.ok(!isStandard('docs/ui/GUIDELINES.md'));
});

// --- the real transcripts ---------------------------------------------------

test('the paraphrased run: nothing on template, no brief, no standards source', () => {
  const f = facts('cli-2.1.292-paraphrased-dispatch');
  assert.equal(f.shape, 'readable');
  assert.equal(f.cliVersion, '2.1.292');
  assert.deepEqual(f.models, ['claude-sonnet-5-5']);
  assert.equal(f.durationMs, 39859);
  // Neither dispatch carried a brief path, so neither axis can be told apart
  // from the transcript: this is what the old skill looked like.
  assert.equal(f.dispatches, 2);
  assert.equal(f.axes!.standards.dispatched, false);
  assert.equal(f.axes!.standards.briefRead, false);
  assert.equal(f.axes!.spec.dispatched, false);
  // The report claimed AGENTS.md, CLAUDE.md and two nested Agent Guides.
  assert.deepEqual(f.standardsSources, []);
  assert.equal(f.indexOpened, false);
});

test('the first brief-file run: on template, briefs read, index opened', () => {
  const f = facts('cli-2.1.293-template-sequential-fenced');
  assert.equal(f.shape, 'readable');
  assert.equal(f.cliVersion, '2.1.293');
  for (const axis of ['standards', 'spec']) {
    assert.equal(f.axes![axis].dispatched, true, axis);
    assert.equal(f.axes![axis].briefRead, true, axis);
    assert.equal(f.axes![axis].onTemplate, true, axis);
  }
  assert.equal(f.axes!.standards.toolCalls, 14);
  assert.equal(f.axes!.spec.toolCalls, 10);
  // The report claimed AGENTS.md and CLAUDE.md as well; neither was opened.
  assert.deepEqual(f.standardsSources, ['CODING_STANDARDS.md']);
  assert.equal(f.indexOpened, true);
});

test('the second brief-file run: a spill file outside the workspace is ignored', () => {
  const f = facts('cli-2.1.293-template');
  assert.equal(f.durationMs, 112403);
  assert.deepEqual(f.standardsSources, ['CODING_STANDARDS.md']);
  assert.equal(f.axes!.standards.toolCalls, 14);
  assert.equal(f.axes!.spec.toolCalls, 8);
});

test('executed is the sub-agents commands, verbatim, and none of the main agents', () => {
  const f = facts('cli-2.1.293-template');
  assert.ok(f.executed!.includes('node tools/scripts/check-review-rules.mjs'));
  assert.ok(
    f.executed!.includes(
      'git diff 3c5b6eff9032e43d79d260ae5ce2fd3640826df0...HEAD --stat',
    ),
  );
  // The main agent ran the validator; that is not evidence a reviewer gathered.
  assert.ok(!f.executed!.some((c) => c.includes('review:validate')));
  // Both sub-agents ran the --stat diff; it is listed once.
  assert.equal(new Set(f.executed).size, f.executed!.length);
});

// --- what a sub-agent returned ---------------------------------------------

const FRAME =
  '[Subagent hand-back] The text below is the final report of a subagent.\n';
const TRAILER = '\nagentId: abc (use SendMessage)\n<usage>tool_uses: 3</usage>';

test('a reply is a bare JSON object once the harness framing is taken off', () => {
  assert.ok(replyIsBareJson('{"findings":[]}'));
  assert.ok(replyIsBareJson(`${FRAME}  {"findings":[]}${TRAILER}`));
  assert.ok(replyIsBareJson(`${FRAME}  {\n    "findings": []\n  }${TRAILER}`));
  assert.ok(replyIsBareJson([{ type: 'text', text: '{"findings":[]}' }]));
});

test('a fence, a sentence, or anything that is not an object is not a bare reply', () => {
  assert.ok(!replyIsBareJson('```json\n{"findings":[]}\n```'));
  assert.ok(!replyIsBareJson('{"findings":[]}\n\nI found nothing.'));
  assert.ok(!replyIsBareJson('Here it is: {"findings":[]}'));
  assert.ok(!replyIsBareJson('[]'));
  assert.ok(!replyIsBareJson(''));
  assert.ok(!replyIsBareJson(undefined));
});

test('the first brief-file run fenced its replies; the second did not', () => {
  const fenced = facts('cli-2.1.293-template-sequential-fenced');
  assert.equal(fenced.axes!.standards.replyIsJson, false);
  assert.equal(fenced.axes!.spec.replyIsJson, false);
  const bare = facts('cli-2.1.293-template');
  assert.equal(bare.axes!.standards.replyIsJson, true);
  assert.equal(bare.axes!.spec.replyIsJson, true);
});

// --- cannot tell is its own answer ------------------------------------------

const unknown = (text: string, reason: RegExp) => {
  const f = readTranscriptFacts(text, { index: INDEX });
  assert.equal(f.shape, 'unknown');
  assert.match(f.shapeReason!, reason);
  // Unknown is never an empty list and never zero.
  assert.equal(f.standardsSources, null);
  assert.equal(f.executed, null);
  assert.equal(f.indexOpened, null);
  assert.equal(f.axes, null);
  return f;
};

test('a transcript that is missing or not JSON is unknown', () => {
  unknown('', /not a JSON array/);
  unknown('{"type":"result"}', /not a JSON array/);
  unknown('not json at all', /not a JSON array/);
});

test('a transcript with no init or no result event is unknown', () => {
  const events: TranscriptEvent[] = JSON.parse(fixture('cli-2.1.293-template'));
  unknown(
    JSON.stringify(events.filter((e) => e.subtype !== 'init')),
    /no init event/,
  );
  unknown(
    JSON.stringify(events.filter((e) => e.type !== 'result')),
    /no result event/,
  );
});

test('dispatches whose sub-agent events cannot be attributed are unknown', () => {
  // What a CLI release that renamed `parent_tool_use_id` would look like:
  // the dispatches are there and nothing hangs off them. Read naively that is
  // "no sub-agent read its brief" on every pull request.
  const read: TranscriptEvent[] = JSON.parse(fixture('cli-2.1.293-template'));
  const events = read.map((e) => {
    if (!e.parent_tool_use_id) return e;
    const { parent_tool_use_id: _gone, ...rest } = e;
    return { ...rest, parentToolUseId: _gone };
  });
  const f = unknown(JSON.stringify(events), /no sub-agent event is attributed/);
  // What the init and result events say is still known.
  assert.equal(f.cliVersion, '2.1.293');
  assert.equal(f.durationMs, 112403);
});

test('a run that dispatched nothing is readable, and says so', () => {
  const whole: TranscriptEvent[] = JSON.parse(fixture('cli-2.1.293-template'));
  const events = whole.filter(
    (e) =>
      e.type !== 'assistant' ||
      (!e.parent_tool_use_id &&
        !e.message!.content!.some((b) => b.name === 'Agent')),
  );
  const f = readTranscriptFacts(JSON.stringify(events), { index: INDEX });
  assert.equal(f.shape, 'readable');
  assert.equal(f.dispatches, 0);
  assert.equal(f.axes!.standards.dispatched, false);
  assert.deepEqual(f.standardsSources, []);
});

// --- what a reply returned ---------------------------------------------------

const handBack = (body: string) =>
  [
    '[Subagent hand-back] The report follows:',
    ...body.split('\n').map((line) => `  ${line}`),
    'agentId: abc123',
    '<usage>subagent_tokens: 1</usage>',
  ].join('\n');

test('the findings a reply returned are read through the harness wrapping', () => {
  const finding = { axis: 'spec', ruleId: 'spec-requirement-missing' };
  assert.deepEqual(
    findingsReturnedBy(handBack(JSON.stringify({ findings: [finding] }))),
    [finding],
  );
  assert.deepEqual(findingsReturnedBy(handBack('{"findings":[]}')), []);
});

test('a fenced reply, or one with a sentence after it, still says what it returned', () => {
  const body = '```json\n{\n  "findings": []\n}\n```\n\nI found nothing.';
  assert.equal(replyIsBareJson(handBack(body)), false);
  assert.deepEqual(findingsReturnedBy(handBack(body)), []);
});

test('a reply with no findings list returned nothing this reader can compare', () => {
  for (const body of [
    'I reviewed the diff and found one problem.',
    '{"executed":[]}',
    '{"findings":"none"}',
    '{"findings":["a string"]}',
    '{"findings":[',
  ])
    assert.equal(findingsReturnedBy(handBack(body)), null, body);
});

test('every reply in a transcript is read, whichever dispatch it answers', () => {
  const paraphrased = facts('cli-2.1.292-paraphrased-dispatch');
  // Neither dispatch named a brief, so neither is an axis's; both replied.
  assert.equal(paraphrased.axes!.spec.dispatched, false);
  assert.equal(paraphrased.repliesParsed, true);
  assert.equal(paraphrased.returned!.length, 1);

  const real = facts('cli-2.1.293-template-two-findings');
  assert.equal(real.repliesParsed, true);
  assert.deepEqual(
    real.returned!.map((f) => f.axis),
    ['standards', 'spec'],
  );
});

test('an unreadable transcript returns no findings list at all', () => {
  const unknown = readTranscriptFacts('not json');
  assert.equal(unknown.returned, null);
  assert.equal(unknown.repliesParsed, null);
});

// --- what a SubagentHandback call returned (CLI 2.1.301) ----------------------

const SPEC_FINDING_SUMMARY =
  'Allowlist excuses the old spelling in QA Account files and recorded fixtures, beyond the frozen set the spec names';

test('a report handed back by SubagentHandback is read from the call, not the pointer', () => {
  const f = facts('cli-2.1.301-handback');
  assert.equal(f.shape, 'readable');
  assert.equal(f.cliVersion, '2.1.301');
  assert.equal(f.repliesParsed, true);
  assert.equal(f.returned!.length, 1);
  assert.equal(f.returned![0].axis, 'spec');
  assert.equal(f.returned![0].severity, 'should-fix');
  assert.equal(f.returned![0].summary, SPEC_FINDING_SUMMARY);
  assert.equal(f.axes!.standards.replyIsJson, true);
  assert.equal(f.axes!.spec.replyIsJson, true);
});

test('a dispatch whose only tool_result is the pointer, with no hand-back call, is unparseable', () => {
  // Drop every SubagentHandback call and the tool_result that answers it: what
  // is left is each dispatch's pointer, and nothing else in the transcript
  // says what the sub-agent reported.
  const events: TranscriptEvent[] = JSON.parse(fixture('cli-2.1.301-handback'));
  const handbackIds = new Set(
    events.flatMap((e) =>
      (e.message?.content ?? [])
        .filter((b) => b.name === 'SubagentHandback')
        .map((b) => b.id),
    ),
  );
  const pointerOnly = events.filter(
    (e) =>
      !(e.message?.content ?? []).some(
        (b) => handbackIds.has(b.id) || handbackIds.has(b.tool_use_id),
      ),
  );
  const f = readTranscriptFacts(JSON.stringify(pointerOnly), { index: INDEX });
  assert.equal(f.shape, 'readable');
  assert.equal(f.repliesParsed, false);
  assert.deepEqual(f.returned, []);
  assert.equal(f.axes!.standards.replyIsJson, false);
  assert.equal(f.axes!.spec.replyIsJson, false);
});

test('when a dispatch hands back twice, the last report is the one read', () => {
  const events: TranscriptEvent[] = JSON.parse(fixture('cli-2.1.301-handback'));
  const at = events.findIndex((e) =>
    (e.message?.content ?? []).some(
      (b) =>
        b.name === 'SubagentHandback' &&
        b.input!.message!.includes('"axis":"spec"'),
    ),
  );
  const parent = events[at].parent_tool_use_id;
  // A retry after the Spec sub-agent's report: an empty findings list.
  const retryId = 'toolu_retry_handback';
  events.splice(
    at + 2,
    0,
    {
      type: 'assistant',
      parent_tool_use_id: parent,
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: retryId,
            name: 'SubagentHandback',
            input: { message: '{"findings":[],"executed":[]}' },
          },
        ],
      },
    },
    {
      type: 'user',
      parent_tool_use_id: parent,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: retryId,
            content: 'Report delivered to your caller.',
          },
        ],
      },
    },
  );
  const f = readTranscriptFacts(JSON.stringify(events), { index: INDEX });
  assert.equal(f.repliesParsed, true);
  // The first report had a finding; the last, which is read, has none.
  assert.deepEqual(f.returned, []);
});

// --- token figures (issue #1057) --------------------------------------------

test('the token figures are summed from the result events model usage', () => {
  // Run 37717857861: 44 fresh, 1,102,181 cache-read and 187,728 cache-written
  // input tokens, and 8,088 output tokens.
  assert.deepEqual(facts('cli-2.1.293-template-two-findings').cost, {
    inputTokens: 44 + 1102181 + 187728,
    outputTokens: 8088,
  });
});

const withModelUsage = (modelUsage: Record<string, unknown>) => {
  const events: TranscriptEvent[] = JSON.parse(fixture('cli-2.1.293-template'));
  events.findLast((e) => e.type === 'result')!.modelUsage = modelUsage;
  return readTranscriptFacts(JSON.stringify(events), { index: INDEX });
};

const usage = (overrides = {}) => ({
  inputTokens: 10,
  outputTokens: 200,
  cacheReadInputTokens: 3000,
  cacheCreationInputTokens: 40000,
  ...overrides,
});

test('every model that ran is counted, sub-agents on another model included', () => {
  const read = withModelUsage({
    'claude-haiku-5-5': usage({ inputTokens: 1460, outputTokens: 30 }),
    'claude-sonnet-5-5': usage(),
  });
  assert.deepEqual(read.cost, {
    inputTokens: 1460 + 3000 + 40000 + 10 + 3000 + 40000,
    outputTokens: 230,
  });
});

test('a result event without the figures is unknown, never zero', () => {
  // The fixture cut before the figures were kept carries none.
  const bare = facts('cli-2.1.292-paraphrased-dispatch');
  assert.equal(bare.cost, null);
  assert.equal(bare.shape, 'readable');
  // One model's entry missing a figure: a partial sum would read as less.
  assert.equal(
    withModelUsage({
      'claude-haiku-5-5': usage({ outputTokens: undefined }),
      'claude-sonnet-5-5': usage(),
    }).cost,
    null,
  );
  assert.equal(
    withModelUsage({ 'claude-sonnet-5-5': usage({ inputTokens: -1 }) }).cost,
    null,
  );
});

test('an unreadable transcript keeps the figures its result event did carry', () => {
  const whole: TranscriptEvent[] = JSON.parse(fixture('cli-2.1.293-template'));
  const events = whole.filter(
    (e) => !(e.type === 'system' && e.subtype === 'init'),
  );
  const read = readTranscriptFacts(JSON.stringify(events), { index: INDEX });
  assert.equal(read.shape, 'unknown');
  assert.deepEqual(read.cost, {
    inputTokens: 40 + 916816 + 178513,
    outputTokens: 5372,
  });
  assert.equal(readTranscriptFacts('not json').cost, null);
});

// --- every Bash call, with the exit code the transcript carries (#1039) ----

const TWO_FINDINGS = 'cli-2.1.293-template-two-findings';
const RULES_CHECK = 'node tools/scripts/check-review-rules.mjs';

/**
 * A real transcript with a result added for one Bash call.
 *
 * The fixtures were cut down to the events #1031 read, which left out what a
 * sub-agent's tool calls returned. The event added here is the shape the
 * Claude Code CLI gives one: a `user` event under the same dispatch, holding
 * a `tool_result` for the call's id.
 */
const withResultFor = (command: string, result: Record<string, unknown>) => {
  const events: TranscriptEvent[] = JSON.parse(fixture(TWO_FINDINGS));
  const at = events.findIndex((e) =>
    e.message?.content?.some?.(
      (b) => b.type === 'tool_use' && b.input?.command === command,
    ),
  );
  const call = events[at].message!.content!.find(
    (b) => b.input?.command === command,
  )!;
  events.splice(at + 1, 0, {
    type: 'user',
    parent_tool_use_id: events[at].parent_tool_use_id,
    message: {
      content: [{ type: 'tool_result', tool_use_id: call.id, ...result }],
    },
  });
  return readTranscriptFacts(JSON.stringify(events), { index: INDEX });
};

const executionOf = (f: TranscriptFacts, command: string) =>
  f.executions!.filter((e) => e.command === command);

test('executions holds every Bash call, the main agents marked as its own', () => {
  const f = facts(TWO_FINDINGS);
  assert.deepEqual(executionOf(f, RULES_CHECK), [
    { command: RULES_CHECK, exitCode: null, by: 'sub-agent' },
  ]);
  // Both sub-agents ran the same `git diff --stat`: two calls, both kept.
  assert.equal(
    f.executions!.filter((e) => e.command.endsWith('...HEAD --stat')).length,
    2,
  );
  const main = f.executions!.filter((e) => e.by === 'main');
  assert.equal(main.length, 1);
  assert.match(main[0].command, /review:validate/);
});

test('a call with no result in the transcript has no exit code, not zero', () => {
  for (const e of facts(TWO_FINDINGS).executions!)
    assert.equal(e.exitCode, null);
});

test('a result that is not an error is exit 0', () => {
  for (const result of [
    { content: 'ok 12 rules', is_error: false },
    { content: [{ type: 'text', text: 'ok 12 rules' }] },
  ])
    assert.equal(
      executionOf(withResultFor(RULES_CHECK, result), RULES_CHECK)[0].exitCode,
      0,
    );
});

test('an error result is the exit code it opens with', () => {
  assert.equal(
    executionOf(
      withResultFor(RULES_CHECK, {
        content: 'Exit code 2\nrule smell-x has no brief entry',
        is_error: true,
      }),
      RULES_CHECK,
    )[0].exitCode,
    2,
  );
  assert.equal(
    executionOf(
      withResultFor(RULES_CHECK, {
        content: [{ type: 'text', text: 'Exit code 127\nnode: not found' }],
        is_error: true,
      }),
      RULES_CHECK,
    )[0].exitCode,
    127,
  );
});

test('an error result that names no exit code is cannot-tell', () => {
  // A denied permission and a timeout are errors the command never exited.
  for (const content of [
    'This command requires approval',
    'Command timed out after 2m 0s',
    'the test printed Exit code 1 somewhere in its output',
  ])
    assert.equal(
      executionOf(
        withResultFor(RULES_CHECK, { content, is_error: true }),
        RULES_CHECK,
      )[0].exitCode,
      null,
      content,
    );
});

test('an unreadable transcript states no executions', () => {
  assert.equal(readTranscriptFacts('not json').executions, null);
});

test('a call the harness refused did not run, and is not an execution', () => {
  // Run 37576528356: one sub-agent Bash call is in the result event's
  // permission denials.
  const events: TranscriptEvent[] = JSON.parse(
    fixture('cli-2.1.292-paraphrased-dispatch'),
  );
  const [denial] = events.findLast(
    (e) => e.type === 'result',
  )!.permission_denials!;
  const denied = events
    .flatMap((e) => e.message?.content ?? [])
    .find((b) => b.id === denial.tool_use_id);
  assert.equal(denied!.name, 'Bash');
  const f = facts('cli-2.1.292-paraphrased-dispatch');
  assert.deepEqual(executionOf(f, denied!.input!.command!), []);
  assert.ok(f.executions!.length > 0);
});

test('a backgrounded call has no exit code to read', () => {
  const events: TranscriptEvent[] = JSON.parse(fixture(TWO_FINDINGS));
  const call = events
    .flatMap((e) => e.message?.content ?? [])
    .find((b) => b.input?.command === RULES_CHECK);
  call!.input!.run_in_background = true;
  const at = events.findIndex((e) => e.message?.content?.includes?.(call!));
  events.splice(at + 1, 0, {
    type: 'user',
    parent_tool_use_id: events[at].parent_tool_use_id,
    message: {
      content: [
        { type: 'tool_result', tool_use_id: call!.id, content: 'started' },
      ],
    },
  });
  const f = readTranscriptFacts(JSON.stringify(events), { index: INDEX });
  assert.equal(executionOf(f, RULES_CHECK)[0].exitCode, null);
});

test('a call that ends in & has no exit code to read either', () => {
  const events: TranscriptEvent[] = JSON.parse(fixture(TWO_FINDINGS));
  const at = events.findIndex((e) =>
    e.message?.content?.some?.((b) => b.input?.command === RULES_CHECK),
  );
  const call = events[at].message!.content!.find(
    (b) => b.input?.command === RULES_CHECK,
  )!;
  call.input!.command = `${RULES_CHECK} &`;
  events.splice(at + 1, 0, {
    type: 'user',
    parent_tool_use_id: events[at].parent_tool_use_id,
    message: {
      content: [{ type: 'tool_result', tool_use_id: call.id, content: '' }],
    },
  });
  const f = readTranscriptFacts(JSON.stringify(events), { index: INDEX });
  assert.equal(executionOf(f, `${RULES_CHECK} &`)[0].exitCode, null);
});

// --- which changed files each axis opened or diffed (issue #1140) -----------

/** A real transcript with tool calls added to one axis's sub-agent. */
const withCallsOn = (axis: FindingAxis, inputs: [string, ToolInput][]) => {
  const events: TranscriptEvent[] = JSON.parse(fixture(TWO_FINDINGS));
  const dispatch = events
    .flatMap((e) => (e.parent_tool_use_id ? [] : (e.message?.content ?? [])))
    .find(
      (b) =>
        b.type === 'tool_use' &&
        typeof b.input?.prompt === 'string' &&
        b.input!.prompt!.includes(BRIEFS[axis]),
    )!;
  inputs.forEach(([name, input]: [string, ToolInput], i: number) =>
    events.push({
      type: 'assistant',
      parent_tool_use_id: dispatch.id,
      message: {
        content: [{ type: 'tool_use', id: `added-${axis}-${i}`, name, input }],
      },
    }),
  );
  return readTranscriptFacts(JSON.stringify(events), { index: INDEX });
};

test('each axis records the files it opened and the files it diffed by path', () => {
  const f = withCallsOn('spec', [
    [
      'Read',
      {
        file_path: `/home/runner/work/myorganiser/myorganiser/.github/workflows/deploy.yml`,
      },
    ],
    [
      'Bash',
      {
        command: 'git diff main...HEAD -- tools/scripts/deploy.mjs tools/a.sh',
      },
    ],
    // A stat names no file's content; it is neither an open nor a diff.
    ['Bash', { command: 'git diff main...HEAD --stat' }],
  ]);
  assert.ok(f.axes!.spec.opened.includes('.github/workflows/deploy.yml'));
  for (const path of ['tools/scripts/deploy.mjs', 'tools/a.sh'])
    assert.ok(f.axes!.spec.diffed.includes(path), path);
  assert.ok(!f.axes!.spec.diffed.includes('main...HEAD'));
  // The other axis is credited with nothing the Spec sub-agent did.
  assert.ok(!f.axes!.standards.opened.includes('.github/workflows/deploy.yml'));
  assert.ok(!f.axes!.standards.diffed.includes('tools/a.sh'));
});
