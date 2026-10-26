/**
 * Run with: yarn sandcastle:subagent-trace:test  (node --test, matching the other libs here)
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseSubagentTranscript,
  formatSubagentIndex,
  formatTokens,
} from './sandcastle-subagent-trace.ts';

function line(record: unknown): string {
  return JSON.stringify(record);
}

interface ToolCallBlock {
  type: string;
  name: string;
  input: Record<string, never>;
}

interface AssistantTurnUsage {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
}

interface AssistantTurnInput {
  agentId?: string;
  attributionAgent?: string;
  attributionSkill?: string;
  content?: ToolCallBlock[];
  usage?: AssistantTurnUsage;
  model?: string;
}

function assistantTurn({
  agentId = 'abc123',
  attributionAgent,
  attributionSkill,
  content = [],
  usage,
  model,
}: AssistantTurnInput): string {
  return line({
    parentUuid: 'x',
    isSidechain: true,
    agentId,
    type: 'assistant',
    ...(attributionAgent ? { attributionAgent } : {}),
    ...(attributionSkill ? { attributionSkill } : {}),
    message: {
      role: 'assistant',
      content,
      ...(model ? { model } : {}),
      ...(usage ? { usage } : {}),
    },
  });
}

test('parses agent type, skill, tool calls, and usage from a real-shaped transcript', () => {
  const jsonl = [
    line({
      parentUuid: null,
      isSidechain: true,
      agentId: 'abc123',
      type: 'user',
      message: { role: 'user', content: 'do the thing' },
    }),
    assistantTurn({
      attributionAgent: 'TestReviewer',
      attributionSkill: 'unit-test-delegation-workflow',
      content: [
        { type: 'tool_use', name: 'Read', input: {} },
        { type: 'tool_use', name: 'Bash', input: {} },
      ],
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 200,
        output_tokens: 50,
      },
    }),
    assistantTurn({
      content: [{ type: 'tool_use', name: 'Bash', input: {} }],
      usage: {
        input_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 400,
        output_tokens: 20,
      },
    }),
  ].join('\n');

  const summary = parseSubagentTranscript(jsonl);

  assert.equal(summary.agentId, 'abc123');
  assert.equal(summary.agentType, 'TestReviewer');
  assert.equal(summary.skill, 'unit-test-delegation-workflow');
  assert.equal(summary.turnCount, 2);
  assert.deepEqual(summary.toolCalls, [
    { name: 'Bash', count: 2 },
    { name: 'Read', count: 1 },
  ]);
  assert.deepEqual(summary.usage, {
    inputTokens: 15,
    cacheCreationInputTokens: 100,
    cacheReadInputTokens: 600,
    outputTokens: 70,
  });
  // Peak is the largest SINGLE turn's context, not the sum: turn 1 is 10+100+200=310,
  // turn 2 is 5+0+400=405 — the peak is 405, not 715.
  assert.equal(summary.peakContextTokens, 405);
});

test('ignores blank and malformed lines rather than throwing', () => {
  const jsonl = [
    '',
    '   ',
    'not json at all {{{',
    assistantTurn({ attributionAgent: 'ComponentBuilder' }),
  ].join('\n');

  const summary = parseSubagentTranscript(jsonl);

  assert.equal(summary.agentType, 'ComponentBuilder');
  assert.equal(summary.turnCount, 1);
});

test('a transcript truncated before any assistant turn yields an unknown-but-safe summary', () => {
  const jsonl = line({
    parentUuid: null,
    isSidechain: true,
    agentId: 'zzz',
    type: 'user',
    message: { role: 'user', content: 'do the thing' },
  });

  const summary = parseSubagentTranscript(jsonl);

  assert.equal(summary.agentId, 'zzz');
  assert.equal(summary.agentType, undefined);
  assert.equal(summary.turnCount, 0);
  assert.deepEqual(summary.toolCalls, []);
  assert.deepEqual(summary.usage, {
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
  });
  assert.equal(summary.peakContextTokens, 0);
});

test('an empty file yields the unknown placeholder, not a throw', () => {
  const summary = parseSubagentTranscript('');
  assert.equal(summary.agentId, 'unknown');
  assert.equal(summary.turnCount, 0);
});

test('a turn with tool calls but no usage block does not crash totals', () => {
  const jsonl = assistantTurn({
    attributionAgent: 'Docs',
    content: [{ type: 'tool_use', name: 'Write', input: {} }],
  });

  const summary = parseSubagentTranscript(jsonl);

  assert.equal(summary.turnCount, 1);
  assert.deepEqual(summary.toolCalls, [{ name: 'Write', count: 1 }]);
  assert.deepEqual(summary.usage, {
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
  });
});

test('formatSubagentIndex reports no invocations without listing anything', () => {
  const rendered = formatSubagentIndex([], {
    issueNumber: 411,
    sliceBranch: 'slice/411-trace-subagents',
  });

  assert.match(
    rendered,
    /# Sub-agent trace — #411 \(slice\/411-trace-subagents\)/,
  );
  assert.match(rendered, /No sub-agent invocations were captured/);
});

test('formatSubagentIndex labels an agent by type when known, and by id when not', () => {
  const summaries = [
    {
      ...parseSubagentTranscript(
        assistantTurn({ attributionAgent: 'TestReviewer' }),
      ),
      fileName: 'agent-aaa.jsonl',
    },
    {
      ...parseSubagentTranscript(''),
      agentId: 'bbb999',
      fileName: 'agent-bbb999.jsonl',
    },
  ];

  const rendered = formatSubagentIndex(summaries, {
    issueNumber: 411,
    sliceBranch: 'slice/411-trace-subagents',
  });

  assert.match(rendered, /## TestReviewer/);
  assert.match(rendered, /## agent bbb999/);
  assert.match(rendered, /`agent-aaa\.jsonl`/);
  assert.match(rendered, /`agent-bbb999\.jsonl`/);
});

// ─── Token formatting ─────────────────────────────────────────────────────────

test('token counts render as k / m / b', () => {
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(1000), '1k');
  assert.equal(formatTokens(1500), '1.5k');
  assert.equal(formatTokens(1_000_000), '1m');
  assert.equal(formatTokens(2_400_000_000), '2.4b');
});

test('a fraction is shown only below ten units', () => {
  // 205k, not 204.8k: a decimal at that magnitude is precision nobody acts on, while
  // 1.7m without one would round to 2m and lose the comparison the index exists for.
  assert.equal(formatTokens(204751), '205k');
  assert.equal(formatTokens(1702754), '1.7m');
  assert.equal(formatTokens(63716), '64k');
});

test('token formatting survives malformed input', () => {
  assert.equal(formatTokens(Number.NaN), '0');
  assert.equal(formatTokens(undefined), '0');
  assert.equal(formatTokens(-1500), '-1.5k');
});

// ─── Model and MCP attribution ────────────────────────────────────────────────

test('the model is taken from the assistant turn', () => {
  // Sub-agents are routed per-agent, so this is not necessarily the orchestrator's
  // model — a run reported claude-opus-5 while all three sub-agents ran haiku-4.5.
  const jsonl = assistantTurn({
    attributionAgent: 'CodeExplorer',
    model: 'claude-haiku-4-5-20251001',
    content: [],
  });

  assert.equal(
    parseSubagentTranscript(jsonl).model,
    'claude-haiku-4-5-20251001',
  );
});

test('a transcript with no model reports undefined rather than guessing', () => {
  assert.equal(
    parseSubagentTranscript(assistantTurn({ content: [] })).model,
    undefined,
  );
});

test('MCP servers are derived from mcp__server__tool call names', () => {
  const jsonl = [
    assistantTurn({
      content: [
        { type: 'tool_use', name: 'mcp__graphify__query_graph', input: {} },
        { type: 'tool_use', name: 'mcp__graphify__get_neighbors', input: {} },
        { type: 'tool_use', name: 'mcp__other_server__do_thing', input: {} },
        { type: 'tool_use', name: 'Read', input: {} },
      ],
    }),
  ].join('\n');

  assert.deepEqual(parseSubagentTranscript(jsonl).mcpServers, [
    'graphify',
    'other_server',
  ]);
});

test('no MCP calls yields an empty server list, not a missing one', () => {
  const summary = parseSubagentTranscript(
    assistantTurn({ content: [{ type: 'tool_use', name: 'Grep', input: {} }] }),
  );
  assert.deepEqual(summary.mcpServers, []);
});

test('the index always states MCP servers, including when none ran', () => {
  // Regression: CodeExplorer ran 51 turns and 1.7m cache-read tokens on #398 without
  // ever reaching graphify, because the server was not installed in the sandbox. A
  // silent absence reads as "no MCP was needed"; the line has to be there to be missed.
  const rendered = formatSubagentIndex(
    [
      {
        ...parseSubagentTranscript(
          assistantTurn({
            attributionAgent: 'CodeExplorer',
            model: 'claude-haiku-4-5-20251001',
            content: [{ type: 'tool_use', name: 'Grep', input: {} }],
            usage: {
              input_tokens: 3466,
              cache_creation_input_tokens: 204751,
              cache_read_input_tokens: 1702754,
              output_tokens: 8590,
            },
          }),
        ),
        fileName: 'agent-x.jsonl',
      },
    ],
    { issueNumber: 398, sliceBranch: 'slice/398-x' },
  );

  assert.match(rendered, /- MCP servers: none invoked/);
  assert.match(rendered, /- Model: claude-haiku-4-5-20251001/);
  assert.match(rendered, /cache-read 1\.7m/);
  assert.match(rendered, /Peak context: 1\.9m tokens/);
});
