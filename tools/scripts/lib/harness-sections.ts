/**
 * Per-harness body sections for canonical sub-agent files.
 *
 * `.github/agents/*.agent.md` is the canonical body for every harness, and the
 * sync script overwrites each target's body from it wholesale. That is normally
 * what we want — one body, four harnesses — but some instructions only make
 * sense where a specific harness grants a specific tool. MCP tools are the
 * motivating case: the same graphify server is called `mcp__graphify__*` in
 * Claude Code, `mcp_graphify_*` in Gemini CLI, and `graphify/*` in Copilot.
 *
 * Writing those differences straight into a target file does not survive: the
 * next `yarn agents:sync` regenerates the body from canonical and the edit is
 * gone (this is exactly how the Graphify instrumentation was lost in 555fe1c).
 * So canonical carries them, wrapped in markers, and each target renders only
 * the blocks addressed to it:
 *
 *   <!-- harness:claude -->
 *   Claude-only text.
 *   <!-- /harness -->
 *
 *   <!-- harness:claude,cursor -->
 *   Text for both.
 *   <!-- /harness -->
 *
 * Unmarked content is universal. Markers must sit alone on their own line, and
 * blocks must not nest — both are enforced with a hard error rather than a
 * best-effort parse, because a marker that silently fails to apply reintroduces
 * the bug this mechanism exists to prevent.
 *
 * Note `.github/agents` is canonical, not a render target: Copilot reads the
 * file with the markers still in it and therefore sees every block. Keep block
 * contents short and self-labeling ("**Claude Code:** ...") so that reads as a
 * reference table rather than as contradictory instructions.
 *
 * Consumers: sync-subagents.mjs
 */

/** Harness names a marker may address. `copilot` is `.github/agents` itself. */
export const KNOWN_HARNESSES = Object.freeze([
  'claude',
  'copilot',
  'cursor',
  'gemini',
] as const);

export type KnownHarness = (typeof KNOWN_HARNESSES)[number];

const OPEN_LINE = /^[ \t]*<!--\s*harness:([^>]*?)\s*-->[ \t]*$/;
const CLOSE_LINE = /^[ \t]*<!--\s*\/harness\s*-->[ \t]*$/;
const ANY_MARKER = /<!--\s*\/?\s*harness\b/;

interface RenderHarnessSectionsOptions {
  /** Labels errors, e.g. a path. */
  source?: string;
}

interface OpenBlock {
  targets: string[];
  line: number;
}

/**
 * Renders a canonical body for one harness, keeping blocks addressed to it and
 * dropping the rest. Bodies with no markers are returned unchanged apart from
 * blank-run collapsing, so adding this mechanism cannot drift existing agents.
 *
 * @param body Canonical body text.
 * @param harness One of KNOWN_HARNESSES.
 * @param options `source` labels errors, e.g. a path.
 * @returns The body as that harness should see it.
 */
export function renderHarnessSections(
  body: string,
  harness: string,
  options: RenderHarnessSectionsOptions = {},
): string {
  const source = options.source ?? 'canonical body';

  if (!KNOWN_HARNESSES.includes(harness as KnownHarness)) {
    throw new Error(
      `Unknown harness "${harness}". Known harnesses: ${KNOWN_HARNESSES.join(', ')}.`,
    );
  }

  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  let open: OpenBlock | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNo = index + 1;

    const openMatch = line.match(OPEN_LINE);
    if (openMatch) {
      if (open) {
        throw new Error(
          `${source}:${lineNo}: nested <!-- harness: --> block; the block opened at line ${open.line} is still unclosed.`,
        );
      }
      open = {
        targets: parseTargets(openMatch[1], source, lineNo),
        line: lineNo,
      };
      continue;
    }

    if (CLOSE_LINE.test(line)) {
      if (!open) {
        throw new Error(
          `${source}:${lineNo}: <!-- /harness --> with no matching <!-- harness:... --> open marker.`,
        );
      }
      open = null;
      continue;
    }

    if (!open || open.targets.includes(harness)) {
      kept.push(line);
    }
  }

  if (open) {
    throw new Error(
      `${source}: <!-- harness:${open.targets.join(',')} --> opened at line ${open.line} is never closed.`,
    );
  }

  const rendered = collapseBlankRuns(kept.join('\n'));

  // A marker written inline rather than on its own line never matched above and
  // would leak into every harness. Refuse it instead of shipping it.
  if (ANY_MARKER.test(rendered)) {
    throw new Error(
      `${source}: stray harness marker left after rendering. Markers must sit alone on their own line, e.g.\n` +
        `  <!-- harness:claude -->\n  ...\n  <!-- /harness -->`,
    );
  }

  return rendered;
}

function parseTargets(
  rawList: string,
  source: string,
  lineNo: number,
): string[] {
  const targets = rawList
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (!targets.length) {
    throw new Error(
      `${source}:${lineNo}: <!-- harness: --> names no harness. Expected one or more of ${KNOWN_HARNESSES.join(', ')}.`,
    );
  }

  const unknown = targets.filter(
    (target) => !KNOWN_HARNESSES.includes(target as KnownHarness),
  );
  if (unknown.length) {
    throw new Error(
      `${source}:${lineNo}: unknown harness ${unknown.map((t) => `"${t}"`).join(', ')}. Known harnesses: ${KNOWN_HARNESSES.join(', ')}.`,
    );
  }

  return targets;
}

/** Removing a block leaves the blank lines that surrounded it back to back. */
function collapseBlankRuns(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n');
}
