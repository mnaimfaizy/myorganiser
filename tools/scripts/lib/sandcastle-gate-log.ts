/**
 * The saved log of a Sandcastle gate run, and the handoff line that points at it.
 *
 * The gate (`runGate` in `.sandcastle/main.mts`) streams install + `nx` output to
 * the operator's terminal and, before this module, kept nothing: the only durable
 * record was a slice-log line saying the gate failed, not why. Each run now writes
 * its output to `.sandcastle/logs/gate/<label>--<timestamp>.log` (gitignored through
 * `.sandcastle/logs/`; NOT `.sandcastle/gate/`, the gate's temporary worktree root,
 * which is wiped on every run).
 *
 * The pieces here are pure or self-contained so they are tested without Docker:
 * the file name, the bounded tail, the handoff text, and the tee runner that copies
 * a child's output to the terminal and the log. Logging never changes a verdict.
 *
 * A resumed agent reads the slice log but cannot reach host files from inside its
 * sandbox (ADR 0044), so a FAIL handoff carries the tail itself. `extractHandoff`
 * reads one line per marker, hence the tail is folded into a single line.
 *
 * Run the tests with: node --test tools/scripts/lib/sandcastle-gate-log.test.ts
 */

/** Directory, relative to the repo root, that holds the gate logs. */
export const GATE_LOG_DIR = '.sandcastle/logs/gate';

/** How many trailing non-empty output lines a FAIL handoff carries. */
export const GATE_TAIL_LINES = 15;

/** One tail line is cut to this many characters. */
export const GATE_TAIL_LINE_CHARS = 200;

/** The folded tail is cut to this many characters in all. */
export const GATE_TAIL_TOTAL_CHARS = 1500;

/** At most this many error-marker lines are pinned ahead of the tail. */
export const GATE_PINNED_LINES = 3;

/** A pinned line is cut only past this width; the tail's lines use the narrower cap. */
export const GATE_PINNED_LINE_CHARS = 240;

const TAIL_JOINER = ' ⏎ ';

// What a failing tool prints where it says why: an ESLint/TypeScript `error`, the
// `✖` summary, a Jest `FAIL`. `errors` (as in "0 errors") is not a marker.
const ERROR_MARKER = /\berror\b|✖|\bFAIL\b/i;

// CSI sequences (colour, cursor movement) as tools print them into a pipe.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * A gate label made safe as part of a file name: `#1474` -> `1474`,
 * `feat/prd-slug` -> `feat-prd-slug`.
 */
export function sanitizeGateLabel(label: string): string {
  const safe = String(label ?? '')
    .replace(/^#+/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(0, 80);
  return safe === '' ? 'gate' : safe;
}

/** `<label>--<YYYYMMDDTHHMMSSZ>.log`, the file a gate run writes. */
export function gateLogFileName(label: string, now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d+Z$/, 'Z')
    .replace(/[-:]/g, '');
  return `${sanitizeGateLabel(label)}--${stamp}.log`;
}

/** `line` cut to `max` characters, ending in an ellipsis when it was cut. */
function clip(line: string, max: number): string {
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function cleanLines(output: string): string[] {
  return String(output ?? '')
    .replace(ANSI, '')
    .split(/\r?\n|\r/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');
}

export interface GateLogDigest {
  /** Up to three error-marker lines from before the tail, in output order. */
  pinned: string[];
  /** The bounded tail. */
  tail: string[];
}

/**
 * What a FAIL handoff carries: the tail of the output, plus up to three
 * error-marker lines from BEFORE the tail. A failing run often ends in a wall of
 * warnings or a summary, with the line that says why far above it.
 *
 * Pinned lines are kept whole where they fit under GATE_PINNED_LINE_CHARS, and
 * they spend the total bound first; the tail takes what is left (at least its
 * last line), so the whole stays within GATE_TAIL_TOTAL_CHARS.
 */
export function gateLogDigest(output: string): GateLogDigest {
  const lines = cleanLines(output);
  const inTail = new Set(lines.slice(-GATE_TAIL_LINES));
  const pinned: string[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(0, -GATE_TAIL_LINES)) {
    if (pinned.length >= GATE_PINNED_LINES) break;
    if (!ERROR_MARKER.test(line) || inTail.has(line) || seen.has(line))
      continue;
    seen.add(line);
    pinned.push(clip(line, GATE_PINNED_LINE_CHARS));
  }
  const spent = pinned.reduce((n, l) => n + l.length + TAIL_JOINER.length, 0);
  return { pinned, tail: gateLogTail(output, GATE_TAIL_TOTAL_CHARS - spent) };
}

/**
 * The last lines of a gate's output, bounded in lines, per-line width and total
 * width. Empty output gives an empty tail.
 */
export function gateLogTail(
  output: string,
  budget: number = GATE_TAIL_TOTAL_CHARS,
): string[] {
  const lines = cleanLines(output)
    .slice(-GATE_TAIL_LINES)
    .map((line) => clip(line, GATE_TAIL_LINE_CHARS));

  // Keep the END of the output when the total is over: that is where the cause is.
  const kept: string[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    total += lines[i].length + TAIL_JOINER.length;
    if (total > budget && kept.length > 0) break;
    kept.unshift(lines[i]);
  }
  return kept;
}

export interface GateHandoffInput {
  ok: boolean;
  /** The target list as the operator configured it, e.g. `lint test build`. */
  targets: string;
  /** Path of the saved gate log, when one was written. */
  logPath?: string;
  /** Output of the gate; only read on FAIL. */
  output?: string;
}

/**
 * The slice-log entry for a gate verdict (after the `HANDOFF:` marker). One line.
 * PASS names the log; FAIL also carries the bounded tail.
 */
export function formatGateHandoff({
  ok,
  targets,
  logPath,
  output,
}: GateHandoffInput): string {
  const where = logPath ? `; gate log: ${logPath}` : '';
  if (ok) return `gate PASS (${targets})${where}`;

  const head =
    `gate FAILED (${targets}) — the agent's work was committed; ` +
    `the HOST GATE rejected it${where}`;
  const { pinned, tail } = gateLogDigest(output ?? '');
  const errors =
    pinned.length > 0 ? `; error lines: ${pinned.join(TAIL_JOINER)}` : '';
  if (tail.length === 0) return head + errors;
  return `${head}${errors}; last ${tail.length} lines: ${tail.join(TAIL_JOINER)}`;
}

/** The one-line content of a log for a verdict reached before any container ran. */
export function formatGateSkipNote(reason: string): string {
  return `gate did not run a container: ${reason}\n`;
}

/**
 * Runs a command, copying its stdout and stderr to this process's own streams as
 * they arrive AND appending the same bytes to a log file. Exits with the
 * command's exit code (1 when it died on a signal, 127 when it could not start).
 *
 * If the log cannot be opened or written, it says so once on stderr and carries on:
 * a log is a convenience, never a dependency. SIGTERM/SIGINT are forwarded, so a
 * `spawnSync` timeout around this runner still stops the command.
 *
 * Arguments (after `--`): <log path or ''> <command> [args...]
 */
export const TEE_RUNNER_SOURCE = `
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const [logPath, command, ...args] = process.argv.slice(1);
let fd = -1;
const warn = (why) =>
  process.stderr.write('  gate: not saving the gate log (' + why + ') — continuing.\\n');
if (logPath) {
  try { fd = fs.openSync(logPath, 'a'); } catch (e) { warn(e.code || e.message); }
}
const copy = (chunk, out) => {
  out.write(chunk);
  if (fd < 0) return;
  try { fs.writeSync(fd, chunk); } catch (e) { fd = -1; warn(e.code || e.message); }
};
let child;
try {
  child = spawn(command, args, { stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true });
} catch (e) {
  process.stderr.write(String(e.message) + '\\n');
  process.exit(127);
}
child.stdout.on('data', (c) => copy(c, process.stdout));
child.stderr.on('data', (c) => copy(c, process.stderr));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
child.on('error', (e) => { process.stderr.write(String(e.message) + '\\n'); process.exit(127); });
child.on('close', (code) => process.exit(code === null ? 1 : code));
`;

/** Arguments for `spawnSync(process.execPath, …)` that run `command` through the tee runner. */
export function teeRunnerArgs(
  logPath: string | undefined,
  command: string,
  args: string[],
): string[] {
  return ['-e', TEE_RUNNER_SOURCE, '--', logPath ?? '', command, ...args];
}
