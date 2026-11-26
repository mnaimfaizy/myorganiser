/**
 * The read-side secret policy, shared by the pre-tool-use hook and by the Codex
 * source snapshot, which asks it about every path in a worktree in-process.
 * One copy of the rules: a path the hook refuses to read is never captured.
 */
import { normalizeText } from './lib.ts';

/**
 * Path-bearing keys for read tools. Deliberately excludes `pattern` — that key
 * carries a search expression, not a path, and matching it would block a plain
 * `grep "secrets"`.
 */
const READ_PATH_KEYS = new Set<string>([
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
  'glob',
  'notebook_path',
  'path',
  'paths',
  'source',
  'sources',
  'target',
  'targets',
]);

/**
 * A path rule, matched against normalized text. A rule supplies either a
 * `pattern` or a `matcher` for logic a single regex cannot express.
 */
export interface PathRule {
  pattern?: RegExp;
  matcher?: (normalized: string) => boolean;
  reason: string;
  /** Checked against structured path arguments only, never raw command text. */
  pathOnly?: boolean;
}

export function ruleMatches(rule: PathRule, normalized: string): boolean {
  if (rule.matcher) {
    return rule.matcher(normalized);
  }

  return rule.pattern?.test(normalized) ?? false;
}

/** Characters that end a shell word or a code expression around a path. */
const TOKEN_SEPARATORS = /[\s"'`=;|&<>(){}[\],!$]+/;

/**
 * Code accessors for the process environment. They name a runtime object, not a
 * file, so such an accessor in a command is not a read of an environment file.
 * Only these roots are exempt, as a word of their own or inside a path-like word
 * (never as its last segment, which is a file name). Anything else containing
 * `.env` stays refused (`prod.env.bak`, `foo.env`, `config/<root>.env`).
 * Accepted false positive: `ctx.env.X` and other non-listed accessors.
 */
const ENV_ACCESSOR = /^(?:process|import\.meta|deno|bun)\.env(?:\.|$)/;

/** An env file name: `.env`, `.env.local`, `foo.env`. `.env.example` is allowed. */
const ENV_SEGMENT = /\.env(?:$|[^a-z0-9])/;
const ENV_EXAMPLE_SEGMENT = /\.env\.example(?:$|[^a-z0-9])/;

/**
 * True when normalized text names an environment file. Judged per word, so a
 * `.env.example` next to a real `.env` does not excuse it, and the env accessor
 * in code does not count. Shared by the read and write guards.
 */
export function mentionsEnvFile(normalized: string): boolean {
  for (const token of normalized.split(TOKEN_SEPARATORS)) {
    if (!token.includes('.env')) {
      continue;
    }

    const segments = token.split('/');
    const last = segments.length - 1;

    for (const [index, segment] of segments.entries()) {
      // An accessor may sit inside a sed expression (`s/a/<accessor>/`), but
      // the final segment of a slashed token is a file name: not exempt.
      const isAccessor =
        ENV_ACCESSOR.test(segment) && (last === 0 || index < last);

      if (
        !isAccessor &&
        ENV_SEGMENT.test(segment) &&
        !ENV_EXAMPLE_SEGMENT.test(segment)
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Read-side guard. `PROTECTED_PATTERNS` stops *writes* to generated and secret
 * files; these stop *reads* of secret material only. Generated code stays
 * readable — the point is to keep credentials out of the transcript.
 *
 * `pathOnly` rules are checked against structured path arguments but not against
 * raw shell command text, where the token is too ambiguous to match safely
 * (`.key` would fire on `obj.key`).
 */
const SECRET_READ_PATTERNS: PathRule[] = [
  {
    matcher: mentionsEnvFile,
    reason:
      'Reading environment files is blocked. They hold live credentials — read `.env.example` for the shape, or ask the user for the specific value.',
  },
  {
    pattern: /(^|[/\\])\.(?:ssh|aws|gnupg)(?:\/|$)/i,
    reason:
      'Reading SSH, AWS, or GnuPG configuration is blocked. That directory holds private key material.',
  },
  {
    pattern: /(^|[^a-z0-9])id_(?:rsa|dsa|ecdsa|ed25519)(?:$|[^a-z0-9])/i,
    reason:
      'Reading private SSH key files is blocked. Keep private keys out of tool output.',
  },
  {
    pattern:
      /(^|[^a-z0-9])(?:\.npmrc|\.yarnrc(?:\.yml)?|credentials|secrets)(?:\/|$)/i,
    reason:
      'Reading registry or credentials files is blocked. They commonly contain auth tokens.',
  },
  {
    pattern: /\.(?:pem|p8|p12|pfx)(?:$|[^a-z0-9])/i,
    reason:
      'Reading key or certificate bundles is blocked. Keep secret material out of tool output.',
  },
  {
    pathOnly: true,
    pattern: /\.(?:key|der|crt|cer)(?:$|[^a-z0-9])/i,
    reason:
      'Reading key or certificate files is blocked. Keep secret material out of tool output.',
  },
];

export function getSecretReadReason(
  text: string,
  { pathOnly = false }: { pathOnly?: boolean } = {},
): string | null {
  const normalized = normalizeText(text);

  for (const rule of SECRET_READ_PATTERNS) {
    if (rule.pathOnly && !pathOnly) {
      continue;
    }

    if (ruleMatches(rule, normalized)) {
      return rule.reason;
    }
  }

  return null;
}

export function inspectReadNode(node: unknown, key = ''): string | null {
  if (node === null || node === undefined) {
    return null;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const reason = inspectReadNode(item, key);
      if (reason) {
        return reason;
      }
    }

    return null;
  }

  if (typeof node === 'object') {
    for (const [childKey, childValue] of Object.entries(node)) {
      const reason = inspectReadNode(childValue, childKey);
      if (reason) {
        return reason;
      }
    }

    return null;
  }

  if (typeof node !== 'string' || !READ_PATH_KEYS.has(key)) {
    return null;
  }

  return getSecretReadReason(node, { pathOnly: true });
}
