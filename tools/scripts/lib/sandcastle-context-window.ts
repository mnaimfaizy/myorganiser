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
