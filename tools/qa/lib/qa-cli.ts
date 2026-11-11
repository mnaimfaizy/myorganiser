/**
 * Small helpers the QA tooling's command-line executors share: reading
 * `--flag` arguments and reporting an error by its first line. Pure.
 */

/** Reads `--flag value` pairs and bare `--flag`s; anything else is an error. */
export function readFlags(
  argv: readonly string[],
  valued: readonly string[],
  bare: readonly string[],
): Map<string, string | true> | string {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (flags.has(arg)) return `${arg} given twice`;
    if (valued.includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        return `${arg} needs a value`;
      }
      flags.set(arg, value);
      i++;
    } else if (bare.includes(arg)) {
      flags.set(arg, true);
    } else {
      return `unknown argument "${arg}"`;
    }
  }
  return flags;
}

/** The first line of an error's message, for a one-line report. */
export function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.trim().split('\n')[0] ?? '';
}
