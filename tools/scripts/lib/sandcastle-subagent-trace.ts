/**
 * Pure parsing/formatting for `--trace-subagents`.
 *
 * Sandcastle 0.12.0's Claude Code provider captures every sub-agent transcript to the
 * host automatically, unconditionally, as part of ordinary session capture — see
 * `captureToHost` in `@ai-hero/sandcastle`, which enumerates
 * `<sessionId>/subagents/agent-*.jsonl` inside the sandbox and copies each file to
 * `<hostProjectsDir>/<encodedCwd>/<sessionId>/subagents/` on the host. The copy is not
 * byte-for-byte: it goes through `copyClaudeSessionFile` → `transferClaudeSession` →
 * `rewriteSessionCwd`, which rewrites `cwd` (and `session_meta.payload.cwd`) from the
 * sandbox path to the host path on every record. Nothing else in the record changes, and
 * a failed copy is logged to stderr and skipped rather than failing the run — so a missing
 * transcript is possible and is not an error anyone is shown twice.
 * Nothing here reads a stream or infers a boundary the way ADR 0036 rejected: each
 * captured file already IS one sub-agent's isolated transcript, and every assistant
 * turn in it carries `attributionAgent` / `attributionSkill`, set by the harness
 * itself — confirmed by inspecting a real captured transcript (issue #411).
 *
 * Kept pure — no fs, no docker — so it is testable with `node --test` on string
 * fixtures. `.sandcastle/main.mts` owns locating and copying the files this module
 * reads.
 *
 * Run the tests with: node --test tools/scripts/lib/sandcastle-subagent-trace.test.ts
 *
 * See docs/adr/0036-sub-agent-work-is-auditable-and-gate-commands-are-derived.md.
 */

export interface SubagentToolCallSummary {
  name: string;
  count: number;
}

export interface SubagentUsageTotals {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
}

export interface SubagentSummary {
  agentId: string;
  /**
   * From `attributionAgent`. Every real transcript observed carries this on
   * each assistant turn; undefined only for a transcript with no assistant
   * turns at all (e.g. truncated mid-write).
   */
  agentType: string | undefined;
  /** From `attributionSkill`. */
  skill: string | undefined;
  /**
   * From `message.model` on an assistant turn. Sub-agents are routed
   * per-agent, so this is not necessarily the orchestrator's model.
   */
  model: string | undefined;
  /**
   * MCP server names derived from `mcp__<server>__<tool>` tool calls, sorted.
   * Empty means no MCP tool was invoked — which may mean the server never
   * started.
   */
  mcpServers: string[];
  /** Assistant turns in the transcript. */
  turnCount: number;
  /** Sorted by count, then name. */
  toolCalls: SubagentToolCallSummary[];
  /**
   * Summed across every assistant turn — NOT a true peak; each turn's
   * `usage` is itself a snapshot of that turn only.
   */
  usage: SubagentUsageTotals;
  /**
   * The largest single-turn (input + cache-write + cache-read) total
   * observed — a proxy for how close the sub-agent got to a context limit.
   */
  peakContextTokens: number;
}

/**
 * Render a token count compactly: 1000 -> `1k`, 1_500_000 -> `1.5m`.
 *
 * Token counts here run from tens to millions in the same table — a sub-agent's
 * cache-read was 1702754 on one line and its input 3466 on the next. Raw digits at
 * that spread are unreadable and, worse, hard to compare at a glance, which is the
 * one thing this index exists for.
 *
 * A fraction is shown only below 10 units, so `1.7m` keeps its meaning while `205k`
 * is not padded to a false `204.8k` precision nobody acts on.
 */
export function formatTokens(value: number | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';

  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);

  const units = [
    { limit: 1_000_000_000, suffix: 'b' },
    { limit: 1_000_000, suffix: 'm' },
    { limit: 1_000, suffix: 'k' },
  ];

  for (const { limit, suffix } of units) {
    if (abs >= limit) {
      const scaled = abs / limit;
      // One decimal below 10 (1.7m stays meaningful); whole units above it.
      const text =
        scaled < 10
          ? scaled.toFixed(1).replace(/\.0$/, '')
          : String(Math.round(scaled));
      return `${sign}${text}${suffix}`;
    }
  }

  return `${sign}${abs}`;
}

const EMPTY_USAGE: SubagentUsageTotals = Object.freeze({
  inputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  outputTokens: 0,
});

interface TranscriptContentBlock {
  type?: string;
  name?: string;
}

interface TranscriptUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

interface TranscriptMessage {
  model?: string;
  content?: TranscriptContentBlock[];
  usage?: TranscriptUsage;
}

interface TranscriptRecord {
  agentId?: string;
  type?: string;
  attributionAgent?: string;
  attributionSkill?: string;
  message?: TranscriptMessage;
}

/**
 * Parse one captured sub-agent session JSONL into a summary. Malformed or empty lines
 * are skipped rather than thrown on — a transcript captured mid-write (the sandbox was
 * killed before the agent finished) should still yield whatever it can, not crash the
 * trace step over a truncated last line.
 *
 * @param jsonl Raw contents of a captured `agent-<id>.jsonl` file.
 */
export function parseSubagentTranscript(jsonl: string): SubagentSummary {
  let agentId: string | undefined;
  let agentType: string | undefined;
  let skill: string | undefined;
  let model: string | undefined;
  let turnCount = 0;
  let peakContextTokens = 0;
  const toolCallCounts = new Map<string, number>();
  const usage: SubagentUsageTotals = { ...EMPTY_USAGE };

  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    let record: TranscriptRecord;
    try {
      record = JSON.parse(trimmed) as TranscriptRecord;
    } catch {
      continue;
    }

    if (typeof record.agentId === 'string') agentId ??= record.agentId;
    if (record.type !== 'assistant') continue;

    turnCount += 1;
    if (typeof record.attributionAgent === 'string') {
      agentType ??= record.attributionAgent;
    }
    if (typeof record.attributionSkill === 'string') {
      skill ??= record.attributionSkill;
    }
    if (typeof record.message?.model === 'string') {
      model ??= record.message.model;
    }

    const content = record.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'tool_use' && typeof block.name === 'string') {
          toolCallCounts.set(
            block.name,
            (toolCallCounts.get(block.name) ?? 0) + 1,
          );
        }
      }
    }

    const turnUsage = record.message?.usage;
    if (turnUsage) {
      const input = turnUsage.input_tokens ?? 0;
      const cacheWrite = turnUsage.cache_creation_input_tokens ?? 0;
      const cacheRead = turnUsage.cache_read_input_tokens ?? 0;
      usage.inputTokens += input;
      usage.cacheCreationInputTokens += cacheWrite;
      usage.cacheReadInputTokens += cacheRead;
      usage.outputTokens += turnUsage.output_tokens ?? 0;
      peakContextTokens = Math.max(
        peakContextTokens,
        input + cacheWrite + cacheRead,
      );
    }
  }

  const toolCalls: SubagentToolCallSummary[] = [...toolCallCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // Claude Code names MCP tools `mcp__<server>__<tool>`, so the server set is derivable
  // from the calls themselves — no separate manifest to read, and no way for the list to
  // claim a server that was configured but never actually reached.
  const mcpServers = [
    ...new Set(
      toolCalls
        .map(({ name }) => /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(name)?.[1])
        .filter((server): server is string => typeof server === 'string'),
    ),
  ].sort();

  return {
    agentId: agentId ?? 'unknown',
    agentType,
    skill,
    model,
    mcpServers,
    turnCount,
    toolCalls,
    usage,
    peakContextTokens,
  };
}

export interface FormatSubagentIndexContext {
  issueNumber: number;
  sliceBranch: string;
}

/**
 * Render a per-slice index of every captured sub-agent, in the order given. Markdown
 * so it opens readably next to the raw transcripts without any special tooling.
 */
export function formatSubagentIndex(
  summaries: ReadonlyArray<SubagentSummary & { fileName: string }>,
  { issueNumber, sliceBranch }: FormatSubagentIndexContext,
): string {
  const lines = [
    `# Sub-agent trace — #${issueNumber} (${sliceBranch})`,
    '',
    summaries.length === 0
      ? '_No sub-agent invocations were captured for this slice._'
      : `${summaries.length} sub-agent invocation(s) captured.`,
    '',
  ];

  for (const summary of summaries) {
    const label = summary.agentType ?? `agent ${summary.agentId}`;
    lines.push(`## ${label}${summary.skill ? ` — ${summary.skill}` : ''}`);
    lines.push('');
    lines.push(`- Transcript: \`${summary.fileName}\``);
    lines.push(`- Model: ${summary.model ?? 'unknown'}`);
    lines.push(`- Turns: ${summary.turnCount}`);
    lines.push(
      `- Peak context: ${formatTokens(summary.peakContextTokens)} tokens`,
    );
    lines.push(
      `- Token usage (summed per-turn snapshots, not a single total): ` +
        `input ${formatTokens(summary.usage.inputTokens)}, ` +
        `cache-write ${formatTokens(summary.usage.cacheCreationInputTokens)}, ` +
        `cache-read ${formatTokens(summary.usage.cacheReadInputTokens)}, ` +
        `output ${formatTokens(summary.usage.outputTokens)}`,
    );
    lines.push(
      summary.toolCalls.length === 0
        ? '- Tool calls: none'
        : `- Tool calls: ${summary.toolCalls.map((t) => `${t.name} (${t.count})`).join(', ')}`,
    );
    // Stated even when empty. A silent absence reads as "no MCP was needed"; the more
    // common cause is that a configured server never started in the sandbox, and that
    // is only visible if the line is always there.
    lines.push(
      summary.mcpServers.length === 0
        ? '- MCP servers: none invoked'
        : `- MCP servers: ${summary.mcpServers.join(', ')}`,
    );
    lines.push('');
  }

  return lines.join('\n');
}
