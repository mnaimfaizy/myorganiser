#!/usr/bin/env node
// EXPERIMENT ONLY — DO NOT MERGE (issue #1493).
//
// Reads the Playwright blob reports and CPU samples of CI runs, and reports
// what `workers: 2` per E2E shard buys and costs against `workers: 1`:
//
//   node tools/scripts/ci/e2e-workers-experiment.ts \
//     --runs <id>,<id>,... [--dir tmp/1493/artifacts] \
//     [--out <report.md>] [--json <report.json>]
//
// For each run it downloads (once, into `--dir/<run id>/`) every artifact
// named `e2e-blob-report-*`, `control-e2e-blob-report-*`,
// `nightly-blob-report-*`, and `cpu-samples-*`. A blob report names its own
// worker count (`onConfigure.config.workers`), so a baseline run from `main`'s
// pull requests and a paired control shard read the same way.
//
// Per shard report:
//   * spec wall — first test start to last test end, so the `next start`
//     boot before the first test is left out;
//   * serial test time — every attempt's duration, summed;
//   * flaky — a test whose last attempt passed after an earlier one did not;
//   * failed — a test whose last attempt did not pass.
//
// The spec-time ratio pairs a 2-worker shard with the 1-worker shard of the
// same run and shard number when the run has both; otherwise it divides the
// per-shard medians.
//
// CPU: vmstat rows and top frames inside the shard's spec window. Busy is
// 100 − idle; the run queue `r` against `nproc` is the contention signal.
// Not a gate, never merged.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { cannotRun, isMain, parseArgs, writeFile } from '../review/cli.ts';

const bail = cannotRun('e2e-workers-experiment');

export const ARTIFACT_PATTERNS = [
  'e2e-blob-report-*',
  'control-e2e-blob-report-*',
  'nightly-blob-report-*',
  'cpu-samples-*',
] as const;

interface BlobEvent {
  method: string;
  params?: Record<string, unknown>;
}

export interface TestOutcome {
  title: string;
  attempts: string[];
}

export interface ShardReport {
  runId: string;
  /** The artifact's name, e.g. `e2e-blob-report-2`. */
  artifact: string;
  /** `e2e`, `control`, or `nightly`. */
  role: string;
  /** Shard number, or the browser for a nightly report. */
  shard: string;
  project: string;
  workers: number;
  status: string;
  /** First test start (epoch ms). */
  startMs: number;
  /** Last test end (epoch ms). */
  endMs: number;
  specWallMs: number;
  serialMs: number;
  tests: number;
  attempts: number;
  flaky: string[];
  failed: string[];
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = (sorted.length - 1) / 2;
  return (sorted[Math.floor(mid)] + sorted[Math.ceil(mid)]) / 2;
};

const quantile = (values: readonly number[], q: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

interface SuiteEntry {
  title: string;
  testId?: string;
  entries?: SuiteEntry[];
}

const titlesOf = (
  entries: readonly SuiteEntry[],
  path: readonly string[],
  into: Map<string, string>,
): void => {
  for (const entry of entries) {
    const here = [...path, entry.title].filter(Boolean);
    if (entry.testId) into.set(entry.testId, here.join(' › '));
    if (entry.entries) titlesOf(entry.entries, here, into);
  }
};

/** The artifact name's role and shard: `control-e2e-blob-report-3` → control, 3. */
export const roleOf = (artifact: string): { role: string; shard: string } => {
  const control = /^control-e2e-blob-report-(.+)$/.exec(artifact);
  if (control) return { role: 'control', shard: control[1] };
  const nightly = /^nightly-blob-report-(.+)$/.exec(artifact);
  if (nightly) return { role: 'nightly', shard: nightly[1] };
  const lane = /^e2e-blob-report-(.+)$/.exec(artifact);
  if (lane) return { role: 'e2e', shard: lane[1] };
  return { role: 'unknown', shard: artifact };
};

/** One blob report's `report.jsonl`, summarised. Pure. */
export function summarizeBlob(
  jsonl: string,
  runId: string,
  artifact: string,
): ShardReport {
  const events: BlobEvent[] = jsonl
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as BlobEvent);

  const titles = new Map<string, string>();
  let workers = 0;
  let project = '';
  let status = 'unknown';
  const attemptStart = new Map<string, { testId: string; start: number }>();
  const outcomes = new Map<string, TestOutcome>();
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = 0;
  let serialMs = 0;
  let attempts = 0;

  for (const event of events) {
    const params = event.params ?? {};
    if (event.method === 'onConfigure') {
      const config = params['config'] as { workers?: number } | undefined;
      workers = config?.workers ?? 0;
    } else if (event.method === 'onProject') {
      const p = params['project'] as { name: string; suites: SuiteEntry[] };
      project = p.name;
      titlesOf(p.suites, [], titles);
    } else if (event.method === 'onTestBegin') {
      const result = params['result'] as { id: string; startTime: number };
      attemptStart.set(result.id, {
        testId: params['testId'] as string,
        start: result.startTime,
      });
    } else if (event.method === 'onTestEnd') {
      const test = params['test'] as { testId: string; expectedStatus: string };
      const result = params['result'] as {
        id: string;
        duration: number;
        status: string;
      };
      const begun = attemptStart.get(result.id);
      if (begun) {
        startMs = Math.min(startMs, begun.start);
        endMs = Math.max(endMs, begun.start + result.duration);
      }
      serialMs += result.duration;
      attempts += 1;
      const outcome = outcomes.get(test.testId) ?? {
        title: titles.get(test.testId) ?? test.testId,
        attempts: [],
      };
      outcome.attempts.push(
        result.status === test.expectedStatus ? 'expected' : result.status,
      );
      outcomes.set(test.testId, outcome);
    } else if (event.method === 'onEnd') {
      status = (params['result'] as { status: string }).status;
    }
  }

  const flaky: string[] = [];
  const failed: string[] = [];
  for (const outcome of outcomes.values()) {
    const last = outcome.attempts[outcome.attempts.length - 1];
    if (last === 'expected') {
      if (outcome.attempts.some((a) => a !== 'expected')) {
        flaky.push(outcome.title);
      }
    } else if (last !== 'skipped') {
      failed.push(outcome.title);
    }
  }

  const { role, shard } = roleOf(artifact);
  const hasTests = Number.isFinite(startMs);
  return {
    runId,
    artifact,
    role,
    shard,
    project,
    workers,
    status,
    startMs: hasTests ? startMs : 0,
    endMs: hasTests ? endMs : 0,
    specWallMs: hasTests ? endMs - startMs : 0,
    serialMs,
    tests: outcomes.size,
    attempts,
    flaky,
    failed,
  };
}

export interface VmstatRow {
  atMs: number;
  r: number;
  busy: number;
  steal: number;
}

/**
 * `vmstat -n -t 2` output. Columns are found by name from the header, so the
 * `gu` column procps 4 adds does not shift anything. The timestamp is the
 * last two fields, in the runner's zone (UTC). The first row is the
 * since-boot average, and is dropped. Pure.
 */
export function parseVmstat(text: string): VmstatRow[] {
  const lines = text.split('\n');
  const headerIndex = lines.findIndex((line) => /^\s*r\s+b\s/.test(line));
  if (headerIndex < 0) return [];
  const header = lines[headerIndex].trim().split(/\s+/);
  const col = (name: string) => header.indexOf(name);
  const rows: VmstatRow[] = [];
  for (const line of lines.slice(headerIndex + 2)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < header.length || !/^\d/.test(fields[0])) continue;
    const date = fields[fields.length - 2];
    const time = fields[fields.length - 1];
    const atMs = Date.parse(`${date}T${time}Z`);
    if (Number.isNaN(atMs)) continue;
    rows.push({
      atMs,
      r: Number(fields[col('r')]),
      busy: 100 - Number(fields[col('id')]),
      steal: col('st') >= 0 ? Number(fields[col('st')]) : 0,
    });
  }
  return rows;
}

export interface TopFrame {
  atMs: number;
  /** %CPU per command name, summed over that command's processes. */
  byCommand: Map<string, number>;
}

/** Groups a process into the families this experiment cares about. */
export const commandFamily = (command: string): string => {
  const c = command.toLowerCase();
  if (c.includes('next-server') || c.includes('next start'))
    return 'next-server';
  if (/chrom|headless_shell|firefox|webkit|minibrowser/.test(c))
    return 'browser';
  if (c.startsWith('node') || c.includes('playwright')) return 'node';
  if (c.startsWith('vmstat') || c.startsWith('top')) return 'sampler';
  return basename(c.split(/\s+/)[0] ?? c) || 'other';
};

/** The sampler's `@@ <epoch>` + one `top -b` frame blocks. Pure. */
export function parseTop(text: string): TopFrame[] {
  const frames: TopFrame[] = [];
  let current: TopFrame | null = null;
  let cpuCol = -1;
  let cmdCol = -1;
  for (const line of text.split('\n')) {
    const stamp = /^@@ (\d+)/.exec(line);
    if (stamp) {
      current = { atMs: Number(stamp[1]) * 1000, byCommand: new Map() };
      frames.push(current);
      cpuCol = -1;
      continue;
    }
    if (!current) continue;
    const trimmed = line.trim();
    if (/^PID\s/.test(trimmed)) {
      const header = trimmed.split(/\s+/);
      cpuCol = header.indexOf('%CPU');
      cmdCol = header.indexOf('COMMAND');
      continue;
    }
    if (cpuCol < 0 || !/^\d/.test(trimmed)) continue;
    const fields = trimmed.split(/\s+/);
    const cpu = Number(fields[cpuCol]);
    if (Number.isNaN(cpu)) continue;
    const family = commandFamily(fields.slice(cmdCol).join(' '));
    current.byCommand.set(family, (current.byCommand.get(family) ?? 0) + cpu);
  }
  return frames;
}

export interface CpuSummary {
  artifact: string;
  nproc: number | null;
  samples: number;
  busyP50: number | null;
  busyP90: number | null;
  runQueueP50: number | null;
  runQueueP90: number | null;
  runQueueMax: number | null;
  /** Share of samples whose run queue exceeds nproc. */
  saturatedShare: number | null;
  stealP90: number | null;
  /** Mean %CPU per process family per top frame (100 = one core). */
  families: Record<string, number>;
}

/** CPU samples inside `[startMs, endMs]`. Pure. */
export function summarizeCpu(
  artifact: string,
  nproc: number | null,
  vmstat: readonly VmstatRow[],
  top: readonly TopFrame[],
  startMs: number,
  endMs: number,
): CpuSummary {
  const rows = vmstat.filter((row) => row.atMs >= startMs && row.atMs <= endMs);
  const frames = top.filter((f) => f.atMs >= startMs && f.atMs <= endMs);
  const families: Record<string, number> = {};
  for (const frame of frames) {
    for (const [family, cpu] of frame.byCommand) {
      families[family] = (families[family] ?? 0) + cpu / frames.length;
    }
  }
  const queue = rows.map((row) => row.r);
  return {
    artifact,
    nproc,
    samples: rows.length,
    busyP50: median(rows.map((row) => row.busy)),
    busyP90: quantile(
      rows.map((row) => row.busy),
      0.9,
    ),
    runQueueP50: median(queue),
    runQueueP90: quantile(queue, 0.9),
    runQueueMax: queue.length ? Math.max(...queue) : null,
    saturatedShare:
      nproc && rows.length
        ? rows.filter((row) => row.r > nproc).length / rows.length
        : null,
    stealP90: quantile(
      rows.map((row) => row.steal),
      0.9,
    ),
    families,
  };
}

/** The CPU artifact that sampled the same job as a blob artifact. */
export const cpuArtifactFor = (report: ShardReport): string =>
  report.role === 'nightly'
    ? `cpu-samples-nightly-${report.shard}`
    : `cpu-samples-${report.role}-${report.shard}`;

export interface ExperimentSummary {
  reports: ShardReport[];
  cpu: Record<string, CpuSummary>;
  /** workers → shard → median spec wall seconds. */
  specWall: Record<string, Record<string, number | null>>;
  /** Paired 2-worker / 1-worker spec wall ratios, same run and shard. */
  pairedRatios: { runId: string; shard: string; ratio: number }[];
  ratioMedian: number | null;
  /** Ratio of the slowest shard's median spec wall, 2 workers over 1. */
  slowestShardRatio: number | null;
  flaky: { title: string; workers: number; count: number }[];
  failed: { title: string; workers: number; count: number }[];
}

/** Everything the report says, from the parsed inputs. Pure. */
export function summarizeExperiment(
  reports: readonly ShardReport[],
  cpu: Record<string, CpuSummary>,
): ExperimentSummary {
  const lane = reports.filter((r) => r.role !== 'nightly');
  const specWall: Record<string, Record<string, number | null>> = {};
  const byWorkers = new Map<number, Map<string, number[]>>();
  for (const r of lane) {
    const shards = byWorkers.get(r.workers) ?? new Map<string, number[]>();
    shards.set(r.shard, [...(shards.get(r.shard) ?? []), r.specWallMs / 1000]);
    byWorkers.set(r.workers, shards);
  }
  for (const [workers, shards] of byWorkers) {
    specWall[String(workers)] = Object.fromEntries(
      [...shards].sort().map(([shard, walls]) => [shard, median(walls)]),
    );
  }

  const pairedRatios: ExperimentSummary['pairedRatios'] = [];
  for (const two of lane.filter((r) => r.workers === 2 && r.specWallMs > 0)) {
    const one = lane.find(
      (r) =>
        r.workers === 1 &&
        r.runId === two.runId &&
        r.shard === two.shard &&
        r.specWallMs > 0,
    );
    if (one) {
      pairedRatios.push({
        runId: two.runId,
        shard: two.shard,
        ratio: two.specWallMs / one.specWallMs,
      });
    }
  }

  const slowest = (workers: string): number | null => {
    const walls = Object.values(specWall[workers] ?? {}).filter(
      (w): w is number => w !== null,
    );
    return walls.length ? Math.max(...walls) : null;
  };
  const slow1 = slowest('1');
  const slow2 = slowest('2');

  const tally = (pick: (r: ShardReport) => string[]) => {
    const counts = new Map<
      string,
      { title: string; workers: number; count: number }
    >();
    for (const r of reports) {
      for (const title of pick(r)) {
        const key = `${r.workers}\u0000${r.project}\u0000${title}`;
        const label = r.role === 'nightly' ? `[${r.project}] ${title}` : title;
        const entry = counts.get(key) ?? {
          title: label,
          workers: r.workers,
          count: 0,
        };
        entry.count += 1;
        counts.set(key, entry);
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  };

  return {
    reports: [...reports],
    cpu,
    specWall,
    pairedRatios,
    ratioMedian: median(pairedRatios.map((p) => p.ratio)),
    slowestShardRatio: slow1 && slow2 ? slow2 / slow1 : null,
    flaky: tally((r) => r.flaky),
    failed: tally((r) => r.failed),
  };
}

const fmt = (value: number | null, digits = 0): string =>
  value === null ? '–' : value.toFixed(digits);

/** The report, as Markdown. Pure. */
export function renderExperiment(summary: ExperimentSummary): string {
  const lines: string[] = ['# E2E workers experiment (issue #1493)', ''];
  const runs = new Set(summary.reports.map((r) => r.runId));
  lines.push(
    `${summary.reports.length} blob report(s) from ${runs.size} run(s).`,
    '',
    '## Spec wall per shard (median seconds, first test start → last test end)',
    '',
  );
  const shards = [
    ...new Set(Object.values(summary.specWall).flatMap((s) => Object.keys(s))),
  ].sort();
  lines.push(
    `| Workers | ${shards.map((s) => `Shard ${s}`).join(' | ')} | Reports |`,
    `| --- |${shards.map(() => ' --- |').join('')} --- |`,
  );
  for (const workers of Object.keys(summary.specWall).sort()) {
    const n = summary.reports.filter(
      (r) => r.role !== 'nightly' && String(r.workers) === workers,
    ).length;
    lines.push(
      `| ${workers} | ${shards.map((s) => fmt(summary.specWall[workers][s] ?? null)).join(' | ')} | ${n} |`,
    );
  }
  lines.push(
    '',
    `- Paired ratio (2 workers ÷ 1, same run and shard): median **${fmt(summary.ratioMedian, 2)}** over ${summary.pairedRatios.length} pair(s); range ${fmt(
      summary.pairedRatios.length
        ? Math.min(...summary.pairedRatios.map((p) => p.ratio))
        : null,
      2,
    )}–${fmt(
      summary.pairedRatios.length
        ? Math.max(...summary.pairedRatios.map((p) => p.ratio))
        : null,
      2,
    )}.`,
    `- Slowest shard's median, 2 workers ÷ 1: **${fmt(summary.slowestShardRatio, 2)}**.`,
    '',
    '## Flaky (passed on retry) and failed tests',
    '',
  );
  if (summary.flaky.length === 0 && summary.failed.length === 0) {
    lines.push('None.');
  }
  for (const f of summary.flaky) {
    lines.push(`- flaky ×${f.count} at ${f.workers} worker(s): ${f.title}`);
  }
  for (const f of summary.failed) {
    lines.push(`- failed ×${f.count} at ${f.workers} worker(s): ${f.title}`);
  }

  lines.push(
    '',
    '## CPU inside each spec window',
    '',
    '| Report | Workers | Busy p50/p90 % | Run queue p50/p90/max (nproc) | r > nproc | Steal p90 | Mean %CPU: next-server / browser / node |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const r of summary.reports) {
    const c = summary.cpu[`${r.runId}/${cpuArtifactFor(r)}`];
    if (!c) continue;
    const fam = (name: string) => fmt(c.families[name] ?? null);
    lines.push(
      `| ${r.runId} ${r.artifact} | ${r.workers} | ${fmt(c.busyP50)}/${fmt(c.busyP90)} | ${fmt(c.runQueueP50, 1)}/${fmt(c.runQueueP90, 1)}/${fmt(c.runQueueMax)} (${fmt(c.nproc)}) | ${c.saturatedShare === null ? '–' : `${Math.round(c.saturatedShare * 100)}%`} | ${fmt(c.stealP90)} | ${fam('next-server')} / ${fam('browser')} / ${fam('node')} |`,
    );
  }
  lines.push(
    '',
    '## Per report',
    '',
    '| Run | Artifact | Project | Workers | Status | Tests | Attempts | Spec wall s | Serial s | Parallelism |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const r of summary.reports) {
    lines.push(
      `| ${r.runId} | ${r.artifact} | ${r.project} | ${r.workers} | ${r.status} | ${r.tests} | ${r.attempts} | ${fmt(r.specWallMs / 1000)} | ${fmt(r.serialMs / 1000)} | ${r.specWallMs ? (r.serialMs / r.specWallMs).toFixed(2) : '–'} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Downloads a run's artifacts once, and returns the run's directory. */
function download(runId: string, dir: string): string {
  const runDir = join(dir, runId);
  if (existsSync(runDir) && readdirSync(runDir).length > 0) return runDir;
  const args = ['run', 'download', runId, '-D', runDir];
  for (const pattern of ARTIFACT_PATTERNS) args.push('-p', pattern);
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(
      `e2e-workers-experiment: run ${runId}: ${result.stderr.trim() || 'download failed'} (expired artifacts are skipped)`,
    );
  }
  return runDir;
}

/** The `report.jsonl` text of every zip in a blob artifact directory. */
function blobTexts(artifactDir: string): string[] {
  return readdirSync(artifactDir)
    .filter((name) => name.endsWith('.zip'))
    .map((zip) => {
      const result = spawnSync(
        'unzip',
        ['-p', join(artifactDir, zip), 'report.jsonl'],
        {
          encoding: 'utf8',
          maxBuffer: 256 * 1024 * 1024,
        },
      );
      if (result.status !== 0) bail(`cannot unzip ${join(artifactDir, zip)}`);
      return result.stdout;
    });
}

const readOr = (path: string): string =>
  existsSync(path) ? readFileSync(path, 'utf8') : '';

function main(): void {
  const { flags } = parseArgs(process.argv.slice(2));
  const runIds = (flags['runs'] ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (runIds.length === 0) bail('pass --runs <id>,<id>,...');
  const dir = flags['dir'] ?? 'tmp/1493/artifacts';

  const reports: ShardReport[] = [];
  const cpu: Record<string, CpuSummary> = {};
  for (const runId of runIds) {
    const runDir = download(runId, dir);
    if (!existsSync(runDir)) continue;
    const artifacts = readdirSync(runDir).filter((name) =>
      statSync(join(runDir, name)).isDirectory(),
    );
    for (const artifact of artifacts.filter((a) => a.includes('blob-report'))) {
      for (const text of blobTexts(join(runDir, artifact))) {
        reports.push(summarizeBlob(text, runId, artifact));
      }
    }
    for (const report of reports.filter((r) => r.runId === runId)) {
      const name = cpuArtifactFor(report);
      const cpuDir = join(runDir, name);
      if (!existsSync(cpuDir)) continue;
      const nproc = Number(readOr(join(cpuDir, 'nproc')).trim()) || null;
      cpu[`${runId}/${name}`] = summarizeCpu(
        name,
        nproc,
        parseVmstat(readOr(join(cpuDir, 'vmstat.log'))),
        parseTop(readOr(join(cpuDir, 'top.log'))),
        report.startMs,
        report.endMs,
      );
    }
  }

  const summary = summarizeExperiment(reports, cpu);
  const markdown = renderExperiment(summary);
  process.stdout.write(markdown);
  if (flags['out']) writeFile(flags['out'], markdown);
  if (flags['json']) {
    writeFile(flags['json'], `${JSON.stringify(summary, null, 2)}\n`);
  }
}

if (isMain(import.meta.url)) main();
