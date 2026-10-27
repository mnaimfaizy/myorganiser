#!/usr/bin/env node

import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

/** One usage record, from either the JSONL file or a parsed legacy log line. */
interface AgentUsageRecord {
  timestamp?: string | null;
  prdNumber?: number | null;
  issueNumber?: number | null;
  agentKind?: string;
  model?: string;
  available?: boolean;
  iterations?: number;
  telemetryIterations?: number;
  inputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  outputTokens?: number;
  source?: string;
}

interface UsageTotals {
  runs: number;
  unavailableRuns: number;
  iterations: number;
  telemetryIterations: number;
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
}

const repoRoot = process.cwd();
const usageFile = path.join(
  repoRoot,
  '.sandcastle',
  'usage',
  'agent-usage.jsonl',
);
const logsDir = path.join(repoRoot, '.sandcastle', 'logs');

function parseArgs(argv: string[]): {
  json: boolean;
  prdNumber: number | null;
  since: Date | null;
} {
  const args = argv.slice(2);
  const valueAfter = (flag: string): string | null => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : null;
  };
  const prd = valueAfter('--prd');
  const since = valueAfter('--since');
  return {
    json: args.includes('--json'),
    prdNumber: prd ? Number(prd) : null,
    since: since ? new Date(since) : null,
  };
}

function isEnoent(error: unknown): boolean {
  return (error as { code?: string })?.code === 'ENOENT';
}

async function readJsonlRecords(): Promise<AgentUsageRecord[]> {
  try {
    const content = await fs.readFile(usageFile, 'utf8');
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line) as AgentUsageRecord;
        } catch {
          throw new Error(`Invalid JSONL at ${usageFile}:${index + 1}`);
        }
      });
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }
}

async function readLegacyLogRecords(): Promise<AgentUsageRecord[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(logsDir, { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }

  const records: AgentUsageRecord[] = [];
  const pattern =
    /\[#(\d+)\]\s+([^:\s]+):([^\s]+)\s+tokens — input (\d+), cache-write (\d+), cache-read (\d+), output (\d+)\./g;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.log')) continue;
    const content = await fs.readFile(path.join(logsDir, entry.name), 'utf8');
    for (const match of content.matchAll(pattern)) {
      records.push({
        timestamp: null,
        prdNumber: null,
        issueNumber: Number(match[1]),
        agentKind: match[2],
        model: match[3],
        available: true,
        iterations: 0,
        telemetryIterations: 0,
        inputTokens: Number(match[4]),
        cacheCreationInputTokens: Number(match[5]),
        cacheReadInputTokens: Number(match[6]),
        outputTokens: Number(match[7]),
        source: `legacy:${entry.name}`,
      });
    }
  }
  return records;
}

function usageSignature(record: AgentUsageRecord): string {
  return [
    record.issueNumber,
    record.agentKind,
    record.model,
    record.inputTokens ?? 0,
    record.cacheCreationInputTokens ?? 0,
    record.cacheReadInputTokens ?? 0,
    record.outputTokens ?? 0,
  ].join('|');
}

function addUsage(target: UsageTotals, record: AgentUsageRecord): void {
  target.runs += 1;
  target.iterations += record.iterations ?? 0;
  target.telemetryIterations += record.telemetryIterations ?? 0;
  if (!record.available) {
    target.unavailableRuns += 1;
    return;
  }
  target.inputTokens += record.inputTokens ?? 0;
  target.cacheCreationInputTokens += record.cacheCreationInputTokens ?? 0;
  target.cacheReadInputTokens += record.cacheReadInputTokens ?? 0;
  target.outputTokens += record.outputTokens ?? 0;
}

function emptyTotals(): UsageTotals {
  return {
    runs: 0,
    unavailableRuns: 0,
    iterations: 0,
    telemetryIterations: 0,
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
  };
}

function aggregate(
  records: AgentUsageRecord[],
  keyFor: (record: AgentUsageRecord) => string,
): Record<string, UsageTotals> {
  const groups = new Map<string, UsageTotals>();
  for (const record of records) {
    const key = keyFor(record);
    if (!groups.has(key)) groups.set(key, emptyTotals());
    addUsage(groups.get(key) as UsageTotals, record);
  }
  return Object.fromEntries(
    [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
}

function markdownRows(groups: Record<string, UsageTotals>): string[] {
  return Object.entries(groups).map(
    ([key, totals]) =>
      `| ${key} | ${totals.runs} | ${totals.iterations} | ${totals.telemetryIterations} | ${totals.unavailableRuns} | ${totals.inputTokens} | ${totals.cacheCreationInputTokens} | ${totals.cacheReadInputTokens} | ${totals.outputTokens} |`,
  );
}

async function main() {
  const options = parseArgs(process.argv);
  const jsonlRecords = await readJsonlRecords();
  const legacyRecords = await readLegacyLogRecords();
  const structuredSignatures = new Map<string, number>();
  for (const record of jsonlRecords.filter((record) => record.available)) {
    const signature = usageSignature(record);
    structuredSignatures.set(
      signature,
      (structuredSignatures.get(signature) ?? 0) + 1,
    );
  }
  const uniqueLegacyRecords = legacyRecords.filter((record) => {
    const signature = usageSignature(record);
    const remaining = structuredSignatures.get(signature) ?? 0;
    if (remaining === 0) return true;
    structuredSignatures.set(signature, remaining - 1);
    return false;
  });
  const records = [...jsonlRecords, ...uniqueLegacyRecords];
  const filtered = records.filter((record) => {
    if (
      options.prdNumber !== null &&
      Number(record.prdNumber) !== options.prdNumber
    ) {
      return false;
    }
    if (options.since) {
      if (!record.timestamp) return false;
      if (new Date(record.timestamp) < options.since) return false;
    }
    return true;
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    source:
      jsonlRecords.length > 0
        ? `${path.relative(repoRoot, usageFile)} + legacy logs`
        : path.relative(repoRoot, logsDir),
    records: filtered.length,
    totals: filtered.reduce((totals, record) => {
      addUsage(totals, record);
      return totals;
    }, emptyTotals()),
    byWorkflow: aggregate(
      filtered,
      (record) => `PRD #${record.prdNumber ?? 'unknown'}`,
    ),
    byModel: aggregate(
      filtered,
      (record) => `${record.agentKind}:${record.model}`,
    ),
  };

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(
    [
      '# Agent loop usage report',
      '',
      `- Source: ${summary.source}`,
      `- Records: ${summary.records}`,
      `- Runs without token telemetry: ${summary.totals.unavailableRuns}`,
      '',
      '## By workflow',
      '',
      '| Workflow | Runs | Iterations | Iterations with telemetry | Runs unavailable | Input | Cache write | Cache read | Output |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...markdownRows(summary.byWorkflow),
      '',
      '## By harness and model',
      '',
      '| Harness:model | Runs | Iterations | Iterations with telemetry | Runs unavailable | Input | Cache write | Cache read | Output |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...markdownRows(summary.byModel),
      '',
      '## Cost note',
      '',
      'Token totals are the portable measurement. Actual session cost depends on the active provider plan, included usage, cache rates, request multipliers, and overage settings. Use the official billing links in `tools/config/agent-model-policy.json`; do not treat API list prices as the invoice for subscription-backed runs.',
    ].join('\n'),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
