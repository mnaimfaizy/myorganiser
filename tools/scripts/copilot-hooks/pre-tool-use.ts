import { isAbsolute, resolve } from 'node:path';

import {
  allowTool,
  ANTIGRAVITY_HOOK,
  CODEX_HOOK,
  collectStrings,
  COMMAND_KEYS,
  denyTool,
  extractCommand,
  extractFileRedirectTargets,
  getToolInput,
  getToolName,
  isLikelyWriteCommand,
  isMutatingTool,
  normalizeText,
  readPayloadOrExit,
  SHELL_TOOL_NAMES,
  stripHeredocBodies,
} from './lib.ts';
import {
  getSecretReadReason,
  inspectReadNode,
  mentionsEnvFile,
  type PathRule,
  ruleMatches,
} from './read-policy.ts';
import { getSignoffWriteReason } from './signoff-guard.ts';

/** Read-only tools across harnesses. Not mutating, but they can exfiltrate. */
const READ_TOOL_NAMES = new Set<string>([
  'glob',
  'grep',
  'read',
  'read_file',
  'readfile',
  'search_files',
  'searchfiles',
  'view',
]);

const PATH_KEYS = new Set<string>([
  // Antigravity file tools pass PascalCase `Path`; `Target`, `Replacement`, and
  // `Content` carry file content and are intentionally excluded.
  'Path',
  'dest',
  'destination',
  'dir',
  'directory',
  'file',
  'files',
  'filename',
  'filenames',
  'filepath',
  'filePath',
  // Claude Code Write/Edit/NotebookEdit send snake_case path keys.
  'file_path',
  'notebook_path',
  'new_path',
  'old_path',
  'folder',
  'glob',
  'path',
  'paths',
  'pattern',
  'source',
  'sources',
  'target',
  'targets',
]);

/**
 * Workflow guards: generated or tool-owned outputs that must be regenerated
 * rather than hand-edited. These are lifted inside the sandbox (see SANDBOX
 * below) — there they are pure friction, and blocking them also blocks the
 * recovery commands an agent needs to undo its own mistake.
 */
const WORKFLOW_PROTECTED_PATTERNS: PathRule[] = [
  {
    pattern: /(^|[^a-z0-9])libs\/app-api-client\/src(?:\/|$)/i,
    reason:
      'Direct edits to the generated API client are blocked. Regenerate it with `yarn api:generate` after syncing the API contract.',
  },
  {
    pattern: /(^|[^a-z0-9])libs\/api-specs\/src(?:\/|$)/i,
    reason:
      'Direct edits to the synced OpenAPI spec are blocked. Update backend controllers/DTOs and run `yarn openapi:sync`.',
  },
  {
    pattern: /(^|[^a-z0-9])apps\/backend\/src\/swagger(?:\/|$)/i,
    reason:
      'Direct edits to generated Swagger output are blocked. Update backend controllers/DTOs and regenerate API docs.',
  },
  {
    pattern: /(^|[^a-z0-9])libs\/design-tokens\/src\/generated(?:\/|$)/i,
    reason:
      'Direct edits to generated design token files are blocked. Edit `libs/design-tokens/src/tokens.json` and rebuild tokens.',
  },
  {
    pattern: /(^|[^a-z0-9])apps\/backend\/src\/prisma\/migrations(?:\/|$)/i,
    reason:
      'Direct edits to Prisma migrations are blocked. Update the schema and use the migration workflow instead.',
  },
];

/**
 * Secret guards: writes that would put credentials or key material into the
 * repository. These stay active everywhere, sandbox included — the sandbox
 * filesystem is disposable, but the transcript is not: it is written to
 * .sandcastle/logs on the host and fed back into model context.
 */
const SECRET_WRITE_PATTERNS: PathRule[] = [
  {
    matcher: mentionsEnvFile,
    reason:
      'Direct edits to environment files are blocked. Keep secrets in local env files or managed secret storage.',
  },
  {
    pattern:
      /(^|[^a-z0-9])(?:\.npmrc|\.yarnrc(?:\.yml)?|credentials|secrets)(?:\/|$)/i,
    reason:
      'Direct edits to secret or credentials files are blocked. Keep secrets out of the repository.',
  },
  {
    pattern: /\.(?:pem|key|p8|p12|pfx|der|crt|cer)$/i,
    reason:
      'Direct edits to key or certificate files are blocked. Keep secret material out of the repository.',
  },
];

/**
 * Sandcastle runs the agent in a disposable container against a throwaway
 * worktree, so the workflow guards buy nothing there: the agent cannot damage
 * anything a human keeps, and the guards demonstrably trap it. In run #408 the
 * block on generated paths rejected every `git restore` the agent attempted
 * after a botched regeneration, leaving it holding a deletion it could not undo
 * and committed instead. Allow/deny lists are a chat and local-development
 * affordance; the sandbox is the place the agent is meant to be free.
 *
 * Set by `ENV MYORGANISER_SANDBOX=1` in .sandcastle/Dockerfile. Secret guards
 * are deliberately NOT lifted — see SECRET_WRITE_PATTERNS above.
 */
const SANDBOX = process.env.MYORGANISER_SANDBOX === '1';

const PROTECTED_PATTERNS = SANDBOX
  ? SECRET_WRITE_PATTERNS
  : [...WORKFLOW_PROTECTED_PATTERNS, ...SECRET_WRITE_PATTERNS];

function looksLikePath(text: string): boolean {
  const normalized = normalizeText(text);

  return (
    normalized.includes('/') ||
    normalized.startsWith('.') ||
    /\.[a-z0-9]{1,5}(?:[?*].*)?$/i.test(normalized)
  );
}

function getProtectedPathReason(
  text: string,
  { isPath }: { isPath: boolean },
): string | null {
  const normalized = normalizeText(text);

  for (const rule of PROTECTED_PATTERNS) {
    if (ruleMatches(rule, normalized, isPath)) {
      return rule.reason;
    }
  }

  return null;
}

function inspectPatchText(text: string, cwd?: string): string | null {
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const match =
      line.match(/^\*\*\*\s+(?:add|update|delete)\s+file:\s+(.+)$/i) ??
      line.match(/^\*\*\*\s+move\s+to:\s+(.+)$/i);

    if (!match) {
      continue;
    }

    const target = match[1];
    const reason = getProtectedPathReason(cwd ? resolve(cwd, target) : target, {
      isPath: true,
    });
    if (reason) {
      return reason;
    }
  }

  return null;
}

function inspectCommand(rawCommand: string, cwd?: string): string | null {
  const command = stripHeredocBodies(rawCommand);

  if (!isLikelyWriteCommand(command)) {
    return null;
  }

  const directReason = getProtectedPathReason(command, { isPath: false });
  if (directReason) {
    return directReason;
  }

  if (cwd) {
    for (const target of extractFileRedirectTargets(command)) {
      const resolvedReason = getProtectedPathReason(resolve(cwd, target), {
        isPath: true,
      });
      if (resolvedReason) {
        return resolvedReason;
      }
    }
  }

  return null;
}

function inspectNode(node: unknown, key = '', cwd?: string): string | null {
  if (node === null || node === undefined) {
    return null;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const reason = inspectNode(item, key, cwd);
      if (reason) {
        return reason;
      }
    }

    return null;
  }

  if (typeof node === 'object') {
    for (const [childKey, childValue] of Object.entries(node)) {
      const reason = inspectNode(childValue, childKey, cwd);
      if (reason) {
        return reason;
      }
    }

    return null;
  }

  if (typeof node !== 'string') {
    return null;
  }

  if (COMMAND_KEYS.has(key)) {
    return inspectCommand(node, cwd);
  }

  if (PATH_KEYS.has(key)) {
    return getProtectedPathReason(cwd ? resolve(cwd, node) : node, {
      isPath: true,
    });
  }

  return null;
}

/**
 * Normalize read-tool arguments before delegating to `inspectReadNode`:
 * - Map Antigravity PascalCase `Path` to `path` so `read-policy.ts`'s
 *   `READ_PATH_KEYS` inspects it.
 * - Resolve relative path values against `cwd` when the harness reports one.
 * - Leave `pattern` (search expression) untouched.
 */
function normalizeReadNode(
  node: unknown,
  cwd?: string,
  resolvePath = false,
): unknown {
  if (typeof node === 'string') {
    return resolvePath && cwd ? resolve(cwd, node) : node;
  }

  if (Array.isArray(node)) {
    return node.map((item) => normalizeReadNode(item, cwd, resolvePath));
  }

  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      const normalizedKey = key === 'Path' ? 'path' : key;
      const isPathKey =
        normalizedKey !== 'pattern' && PATH_KEYS.has(normalizedKey);
      const mapped = normalizeReadNode(value, cwd, isPathKey);
      if (Object.prototype.hasOwnProperty.call(out, normalizedKey)) {
        out[normalizedKey] = [out[normalizedKey], mapped];
      } else {
        out[normalizedKey] = mapped;
      }
    }

    return out;
  }

  return node;
}

function inspectToolInput(
  toolName: string,
  toolInput: unknown,
  cwd?: string,
): string | null {
  if (!toolName) {
    return null;
  }

  if (
    toolName === 'apply_patch' ||
    toolName === 'applypatch' ||
    toolName === 'patch'
  ) {
    if (typeof toolInput === 'string') {
      return inspectPatchText(toolInput, cwd);
    }

    // The serialized scan reads the input as text, so path arguments and patch
    // headers are also judged as the paths they are.
    for (const text of collectStrings(toolInput)) {
      const reason = inspectPatchText(text, cwd);
      if (reason) {
        return reason;
      }
    }

    return (
      inspectNode(toolInput, '', cwd) ??
      getProtectedPathReason(JSON.stringify(toolInput ?? {}), { isPath: false })
    );
  }

  if (typeof toolInput === 'string') {
    if (
      toolName === 'bash' ||
      toolName === 'command' ||
      toolName === 'shell' ||
      toolName === 'powershell' ||
      toolName === 'run_command' ||
      toolName === 'runterminalcommand'
    ) {
      return inspectCommand(toolInput, cwd);
    }

    if (!looksLikePath(toolInput)) {
      return null;
    }

    // `execute` and `run` reach this branch with a command, not a path.
    const isPath = !SHELL_TOOL_NAMES.has(toolName);
    return getProtectedPathReason(
      isPath && cwd ? resolve(cwd, toolInput) : toolInput,
      { isPath },
    );
  }

  return inspectNode(toolInput, '', cwd);
}

async function main() {
  const payload = await readPayloadOrExit();
  const toolName = getToolName(payload);
  const toolInput = getToolInput(payload);
  // Resolve relative paths against the tool cwd reported by Codex or Antigravity
  // (Antigravity launches hook scripts with process cwd set to the hooks.json dir).
  const cwd =
    (CODEX_HOOK || ANTIGRAVITY_HOOK) &&
    typeof payload?.cwd === 'string' &&
    isAbsolute(payload.cwd)
      ? payload.cwd
      : undefined;

  if (READ_TOOL_NAMES.has(toolName)) {
    const readReason =
      typeof toolInput === 'string'
        ? getSecretReadReason(cwd ? resolve(cwd, toolInput) : toolInput, {
            pathOnly: true,
          })
        : inspectReadNode(normalizeReadNode(toolInput, cwd));

    if (readReason) {
      denyTool(readReason);
    }

    allowTool();
  }

  if (!isMutatingTool(toolName)) {
    allowTool();
  }

  if (SHELL_TOOL_NAMES.has(toolName)) {
    // Heredoc bodies are kept: a Sign-off body or a waiver piped into `gh`
    // through one is exactly what this guard must see.
    const signoffReason = getSignoffWriteReason(extractCommand(toolInput), cwd);
    if (signoffReason) {
      denyTool(signoffReason);
    }

    // Same reasoning as the write guard: a heredoc body that *names* an env
    // file is prose, not a read of it. Actual secret values in that body are
    // still caught by secret-scan.ts, which scans content on purpose.
    const readReason = getSecretReadReason(
      stripHeredocBodies(extractCommand(toolInput)),
    );
    if (readReason) {
      denyTool(readReason);
    }
  }

  const reason = inspectToolInput(toolName, toolInput, cwd);
  if (!reason) {
    allowTool();
  }

  denyTool(reason);
}

main();
