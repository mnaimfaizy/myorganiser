import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allowTool,
  collectStrings,
  collectWriteTargets,
  denyTool,
  extractCommand,
  getToolInput,
  getToolName,
  type HookPayload,
  isMutatingTool,
  isPathInsideDirectory,
  readPayloadOrExit,
} from './lib.ts';

/**
 * The code-review reviewer records ADR 0078 citations — verbatim tracked source
 * lines — in files under this directory. It is derived from this script's own
 * location, not from the session's working directory: the reviewer's shell can
 * `cd` away (ADR 0118), and a moved cwd must not move the exemption with it.
 */
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const REVIEWER_OUTPUT_DIR = `${REPO_ROOT}/tmp/code-review`;

/** Claude Code's file-writing tools. A shell command is never a reviewer write. */
const REVIEWER_WRITE_TOOLS = new Set<string>([
  'write',
  'edit',
  'multiedit',
  'multi_edit',
]);

const SECRET_PATTERNS: {
  pattern: RegExp;
  reason: string;
  exemptInReviewerOutput?: boolean;
}[] = [
  {
    pattern: /-----BEGIN [A-Z0-9 ]+PRIVATE KEY-----/i,
    reason:
      'Private key material was detected in the tool input. Keep private keys out of the repository and use a secret manager instead.',
  },
  {
    pattern: /\b(?:ghp|github_pat|gho|ghu|ghs)_[A-Za-z0-9_]{20,}\b/i,
    reason:
      'A GitHub token-like secret was detected in the tool input. Remove it and store it outside the repository.',
  },
  {
    pattern:
      /\b(?:sk-[A-Za-z0-9]{20,}|sk_(?:live|test)_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[0-9A-Za-z\-_]{35}|ya29\.[A-Za-z0-9\-_]+|xox[baprs]-[A-Za-z0-9-]{10,})\b/i,
    reason:
      'A secret-looking credential was detected in the tool input. Remove it and keep it in a secret manager or local env file instead.',
  },
  {
    pattern:
      /\b[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}\b/,
    reason:
      'A JWT-like token was detected in the tool input. Remove it and avoid pasting credentials into the repository.',
  },
  {
    pattern:
      /(?:client[_-]?secret|refresh[_-]?token|access[_-]?token|api[_-]?key|password|passphrase)\s*[:=]\s*['"`][^'"`\n]{16,}['"`]/i,
    reason:
      'A literal credential-like value was detected in the tool input. Remove it and keep secrets out of source files and prompts.',
    // The one pattern that matches a quoted word list. A test fixture such as a
    // multi-word passphrase has this shape, and a faithful citation of it must
    // be writable. Every other pattern still applies in the reviewer's directory.
    exemptInReviewerOutput: true,
  },
];

/**
 * Whether this call writes only into the reviewer's output directory. Every
 * destination must be inside it, and a call carrying a shell command never
 * qualifies. No destination at all is not a match: an unnamed target is not
 * known to be the reviewer's.
 */
function isReviewerOutputWrite(
  payload: HookPayload,
  toolName: string,
  toolInput: unknown,
): boolean {
  if (!REVIEWER_WRITE_TOOLS.has(toolName) || extractCommand(toolInput) !== '') {
    return false;
  }

  const targets = collectWriteTargets(toolInput);
  const baseDir =
    typeof payload?.cwd === 'string' ? payload.cwd : process.cwd();

  return (
    targets.length > 0 &&
    targets.every((target) =>
      isPathInsideDirectory(target, REVIEWER_OUTPUT_DIR, baseDir),
    )
  );
}

function getSecretReason(
  strings: string[],
  { reviewerOutput = false }: { reviewerOutput?: boolean } = {},
): string | null {
  for (const text of strings) {
    for (const secretPattern of SECRET_PATTERNS) {
      if (reviewerOutput && secretPattern.exemptInReviewerOutput) {
        continue;
      }

      if (secretPattern.pattern.test(text)) {
        return secretPattern.reason;
      }
    }
  }

  return null;
}

async function main() {
  const payload = await readPayloadOrExit();
  const toolName = getToolName(payload);

  if (!isMutatingTool(toolName)) {
    allowTool();
  }

  const toolInput = getToolInput(payload);
  const secretReason = getSecretReason(collectStrings(toolInput), {
    reviewerOutput: isReviewerOutputWrite(payload, toolName, toolInput),
  });
  if (!secretReason) {
    allowTool();
  }

  denyTool(secretReason);
}

main();
