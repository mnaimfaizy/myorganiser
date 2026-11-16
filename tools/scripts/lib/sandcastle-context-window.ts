/**
 * The context-window figures of one agent run, taken from Sandcastle 0.14's
 * `IterationResult.contextWindow`: the input tokens of an iteration's last model
 * call (cache included) and, when the agent reports it, the model's limit.
 */
export interface ContextWindowReading {
  readonly tokens: number;
  readonly limit?: number;
}

export interface RunContextWindow {
  /** The largest `tokens` over the run's iterations. */
  readonly peakTokens: number;
  /** The model's limit, from the iteration that reported one last. */
  readonly limit: number | null;
}

/** Summarise a run's iterations; null when no iteration reported a figure. */
export function summariseContextWindow(
  iterations: ReadonlyArray<{ contextWindow?: ContextWindowReading }>,
): RunContextWindow | null {
  let peakTokens = -1;
  let limit: number | null = null;
  for (const { contextWindow } of iterations) {
    if (!contextWindow) continue;
    peakTokens = Math.max(peakTokens, contextWindow.tokens);
    if (contextWindow.limit !== undefined) limit = contextWindow.limit;
  }
  return peakTokens < 0 ? null : { peakTokens, limit };
}

/** "peak context 84k of 200k (42%)", or "peak context 84k" without a limit. */
export function describeContextWindow(
  window: RunContextWindow,
  formatTokens: (tokens: number) => string,
): string {
  const peak = formatTokens(window.peakTokens);
  if (window.limit === null || window.limit <= 0) {
    return `peak context ${peak}`;
  }
  const percent = Math.round((window.peakTokens / window.limit) * 100);
  return `peak context ${peak} of ${formatTokens(window.limit)} (${percent}%)`;
}

/** The context-window part of a usage record, as `agent-usage.jsonl` stores it. */
export interface PeakContextRecord {
  peakContextTokens?: number;
  contextWindowLimit?: number | null;
}

/** Running peak across the runs of a report group; 0 tokens means none reported. */
export interface PeakContextTotals {
  peakContextTokens: number;
  contextWindowLimit: number | null;
}

/** Keep the largest peak, with the limit reported alongside that peak. */
export function addPeakContext(
  target: PeakContextTotals,
  record: PeakContextRecord,
): void {
  const peak = record.peakContextTokens ?? 0;
  if (peak > target.peakContextTokens) {
    target.peakContextTokens = peak;
    target.contextWindowLimit = record.contextWindowLimit ?? null;
  }
}

/** The report cell: "84 of 200", "84" without a limit, "n/a" with no reading. */
export function peakContextCell(totals: PeakContextTotals): string {
  if (totals.peakContextTokens === 0) return 'n/a';
  return totals.contextWindowLimit
    ? `${totals.peakContextTokens} of ${totals.contextWindowLimit}`
    : String(totals.peakContextTokens);
}
