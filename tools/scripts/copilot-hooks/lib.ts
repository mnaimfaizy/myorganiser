import process from 'node:process';

/**
 * Shared helpers for multi-harness agent hooks (Copilot CLI/cloud, VS Code Copilot,
 * Cursor IDE/CLI, Claude Code).
 *
 * Scripts emit dual-format JSON so one implementation works across hosts.
 */

/**
 * A hook's stdin payload. Each harness names the same fields differently, so
 * every one is optional and read through `getToolName` / `getToolInput`.
 */
export interface HookPayload {
  toolName?: unknown;
  tool_name?: unknown;
  tool?: unknown;
  name?: unknown;
  toolArgs?: unknown;
  tool_args?: unknown;
  toolInput?: unknown;
  tool_input?: unknown;
  input?: unknown;
  args?: unknown;
  arguments?: unknown;
  cwd?: unknown;
}

/** An open heredoc waiting for its terminator line. */
interface HeredocTerminator {
  delimiter: string;
  stripIndent: boolean;
}

export const MUTATING_TOOL_NAMES = new Set<string>([
  // Copilot CLI / cloud
  'apply_patch',
  'applypatch',
  'bash',
  'command',
  'create',
  'delete',
  'edit',
  'execute',
  'move',
  'multiedit',
  'multi_edit',
  'patch',
  'powershell',
  'rename',
  'replace',
  'run',
  'shell',
  'write',
  // Cursor tool types (preToolUse matcher values, lowercased)
  'delete',
  'shell',
  'write',
  // VS Code Copilot Chat tool names
  'create_file',
  'createfile',
  'deletefile',
  'editfiles',
  'replace_string_in_file',
  'runterminalcommand',
  // Claude Code tool names (payloads may use these)
  'bash',
  'edit',
  'write',
]);

export function normalizeText(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

/** Tool names whose input carries a shell command rather than file arguments. */
export const SHELL_TOOL_NAMES = new Set<string>([
  'bash',
  'command',
  'execute',
  'powershell',
  'run',
  'runterminalcommand',
  'shell',
]);

/** Input keys that hold a shell command. */
export const COMMAND_KEYS = new Set<string>([
  'cmd',
  'command',
  'script',
  'shell',
]);

/**
 * Input keys that name a file a tool is about to write.
 *
 * Deliberately excludes `pattern` (a search expression, not a destination) and
 * every content-bearing key — `content`, `new_string`, `old_string`. Matching
 * content is how a hook ends up firing because a document *mentions* a path.
 */
export const WRITE_PATH_KEYS = new Set<string>([
  'dest',
  'destination',
  'dir',
  'directory',
  'file',
  'file_path',
  'filename',
  'filenames',
  'filepath',
  'filePath',
  'files',
  'folder',
  'new_path',
  'notebook_path',
  'old_path',
  'path',
  'paths',
  'target',
  'targets',
]);

// A redirect that writes somewhere real. `2>/dev/null` discards output and is not a write, and
// the lookarounds keep `>=`, `=>`, and `->` from reading as redirects at all. Getting this wrong
// is not cosmetic: a bare `/>/` test made every command carrying `2>/dev/null` look like a write.
const FILE_REDIRECT = /(?<![-=>])>{1,2}(?![=>])\s*([^\s|;&<>]+)/g;
const NULL_SINKS = new Set<string>(['/dev/null', 'nul', '$null']);

export function hasFileRedirect(normalized: string): boolean {
  for (const match of normalized.matchAll(FILE_REDIRECT)) {
    if (!NULL_SINKS.has(match[1])) {
      return true;
    }
  }

  return false;
}

/**
 * Whether a shell command plausibly modifies the filesystem.
 *
 * Conservative by design — a read misclassified as a write blocks or nags on
 * `ls`, `cat`, and `grep`, which is the failure this guard exists to avoid.
 */
export function isLikelyWriteCommand(command: string): boolean {
  const normalized = normalizeText(command);

  return (
    hasFileRedirect(normalized) ||
    /\btee\b/.test(normalized) ||
    /\b(?:cp|mv|rm|touch|truncate)\b/.test(normalized) ||
    /\bgit\s+(?:restore|checkout|reset)\b/.test(normalized) ||
    /\bsed\b[^\n]*\s-i\b/.test(normalized) ||
    /\bperl\b[^\n]*\s-i\b/.test(normalized) ||
    /\b(?:out-file|set-content|add-content|new-item|remove-item)\b/.test(
      normalized,
    )
  );
}

/**
 * Remove heredoc bodies from a shell command, keeping the header line.
 *
 * The path guards match protected paths against shell command text. A heredoc
 * body is *content* being written, not a destination being written to, so
 * scanning it repeats the mistake `WRITE_PATH_KEYS` exists to avoid: a commit
 * message, PR body, or doc that merely mentions a generated directory gets
 * blocked as though it edited that directory. That fired on a real session —
 * writing a commit message that cited a generated spec path.
 *
 * The header line survives, so a genuine write to a protected path is still
 * caught: the redirect target sits on the header, never in the body.
 *
 * Handles `<<EOF`, `<<-EOF`, and quoted `<<'EOF'` / `<<"EOF"`. Herestrings
 * (`<<<`) carry no body and are left alone.
 */
export function stripHeredocBodies(command: string): string {
  const lines = command.split(/\r?\n/);
  const output: string[] = [];
  const pending: HeredocTerminator[] = [];
  let active: HeredocTerminator | null = null;

  for (const line of lines) {
    if (active) {
      // `<<-` allows an indented terminator; plain `<<` requires column zero.
      const candidate = active.stripIndent ? line.trimStart() : line;
      if (candidate === active.delimiter) {
        active = pending.shift() ?? null;
      }

      continue;
    }

    output.push(line);

    // One line may open several heredocs (`cmd <<A <<B`); they close in order.
    for (const match of line.matchAll(
      /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g,
    )) {
      pending.push({ delimiter: match[3], stripIndent: match[1] === '-' });
    }

    active = pending.shift() ?? null;
  }

  return output.join('\n');
}

/**
 * Reduce a path to one canonical spelling so two spellings of the same place
 * compare equal: separators unified to `/`, case folded, `.` and `..` collapsed.
 *
 * Done by hand rather than with `node:path` because a hook payload may carry a
 * Windows path (`D:\repo\tmp`) on a POSIX host or the reverse, and `path.resolve`
 * reads only the host's own spelling — it would treat `d:/repo` as relative.
 * A relative `value` is joined to `baseDir` first; with no `baseDir` it stays
 * relative and so can never equal an absolute directory.
 */
export function normalizePathForCompare(value: string, baseDir = ''): string {
  const unified = normalizeText(value);
  const base = normalizeText(baseDir);
  const isAbsolute = (text: string) =>
    text.startsWith('/') || /^[a-z]:\//.test(text);
  const joined = isAbsolute(unified) || !base ? unified : `${base}/${unified}`;

  const root =
    /^[a-z]:\//.exec(joined)?.[0] ?? (joined.startsWith('/') ? '/' : '');
  const segments: string[] = [];
  for (const segment of joined.slice(root.length).split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }

    if (segment === '..') {
      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return root + segments.join('/');
}

/** Whether `path` names something strictly inside `directory` — not the directory itself. */
export function isPathInsideDirectory(
  path: string,
  directory: string,
  baseDir = '',
): boolean {
  const target = normalizePathForCompare(path, baseDir);
  const container = normalizePathForCompare(directory);

  return (
    target.startsWith(`${container}/`) && target.length > container.length + 1
  );
}

export function extractCommand(toolInput: unknown): string {
  if (typeof toolInput === 'string') {
    return toolInput;
  }

  if (!toolInput || typeof toolInput !== 'object') {
    return '';
  }

  const record = toolInput as Record<string, unknown>;
  for (const key of COMMAND_KEYS) {
    const value = record[key];
    if (typeof value === 'string') {
      return value;
    }
  }

  return '';
}

/**
 * Collect only the strings that name a write destination: shell commands that
 * look like writes, and values under `WRITE_PATH_KEYS`. Unlike `collectStrings`
 * this never returns file content.
 */
export function collectWriteTargets(
  node: unknown,
  key = '',
  output: string[] = [],
): string[] {
  if (node === null || node === undefined) {
    return output;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectWriteTargets(item, key, output);
    }

    return output;
  }

  if (typeof node === 'object') {
    for (const [childKey, childValue] of Object.entries(node)) {
      collectWriteTargets(childValue, childKey, output);
    }

    return output;
  }

  if (typeof node !== 'string') {
    return output;
  }

  if (COMMAND_KEYS.has(key)) {
    if (isLikelyWriteCommand(node)) {
      output.push(node);
    }

    return output;
  }

  if (WRITE_PATH_KEYS.has(key)) {
    output.push(node);
  }

  return output;
}

export function getToolName(payload: HookPayload | undefined): string {
  const value =
    payload?.toolName ??
    payload?.tool_name ??
    payload?.tool ??
    payload?.name ??
    '';

  return typeof value === 'string' ? value.toLowerCase() : '';
}

export function getToolInput(payload: HookPayload | undefined): unknown {
  const raw =
    payload?.toolArgs ??
    payload?.tool_args ??
    payload?.toolInput ??
    payload?.tool_input ??
    payload?.input ??
    payload?.args ??
    payload?.arguments ??
    null;

  if (typeof raw !== 'string') {
    return raw;
  }

  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return raw;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return raw;
  }
}

export function collectStrings(node: unknown, output: string[] = []): string[] {
  if (node === null || node === undefined) {
    return output;
  }

  if (typeof node === 'string') {
    output.push(node);
    return output;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectStrings(item, output);
    }

    return output;
  }

  if (typeof node === 'object') {
    for (const value of Object.values(node)) {
      collectStrings(value, output);
    }
  }

  return output;
}

export function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let rawInput = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      rawInput += chunk;
    });
    process.stdin.on('end', () => {
      resolve(rawInput);
    });
  });
}

/**
 * Parse hook stdin. On empty/invalid input, allow and exit (fail-open).
 * Never exit non-zero on parse errors — that fail-closes Copilot preToolUse
 * and can trip Cursor failClosed when stdout is empty.
 */
export async function readPayloadOrExit(): Promise<HookPayload> {
  const rawInput = await readStdin();

  if (!rawInput.trim()) {
    allowTool();
  }

  try {
    return JSON.parse(rawInput) as HookPayload;
  } catch (error) {
    console.error('[agent-hooks] Unable to parse hook payload.');
    console.error(error instanceof Error ? error.message : String(error));
    allowTool();
  }
}

export function isMutatingTool(toolName: string): boolean {
  return Boolean(toolName) && MUTATING_TOOL_NAMES.has(toolName);
}

/**
 * Set by the `--defer` flag the Claude Code launcher in `.claude/settings.json`
 * passes. Claude Code reads a PreToolUse `allow` as "skip the prompt", which
 * turned these guard scripts into a blanket approval: every shell command that
 * touched no protected path ran without the permission rules' allow list or
 * auto mode's classifier ever seeing it. A guard only has something to deny;
 * under `--defer` it stays silent instead, and Claude Code's own permission
 * flow decides. Copilot and Cursor launch without the flag and keep the
 * explicit allow their fail-closed modes need.
 */
const DEFER_ALLOW = process.argv.includes('--defer');

/**
 * Explicit allow for preToolUse. Required if Cursor `failClosed: true` is set —
 * empty stdout is treated as hook failure and blocks the tool. Under `--defer`
 * it exits 0 with no output: no decision, so the normal permission flow applies.
 */
export function allowTool(): never {
  if (DEFER_ALLOW) {
    process.exit(0);
  }

  process.stdout.write(
    JSON.stringify({
      permissionDecision: 'allow',
      permission: 'allow',
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    }),
  );
  process.exit(0);
}

/**
 * Deny a tool call in a format accepted by Copilot, VS Code, Cursor, and Claude.
 * Exit 2 is the portable "block" signal across Cursor and Claude; Copilot
 * preToolUse also treats exit 2 as deny.
 */
export function denyTool(reason: string): never {
  process.stdout.write(
    JSON.stringify({
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
      permission: 'deny',
      user_message: reason,
      agent_message: reason,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(2);
}

/**
 * Inject follow-up context after a tool completes.
 */
export function emitAdditionalContext(message: string): never {
  process.stdout.write(
    JSON.stringify({
      additionalContext: message,
      additional_context: message,
      systemMessage: message,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: message,
      },
    }),
  );
  process.exit(0);
}
