import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  emitAdditionalContext,
  extractCommand,
  getToolInput,
  getToolName,
  type HookPayload,
  readPayloadOrExit,
  SHELL_TOOL_NAMES,
} from './lib.ts';
import { getUpstreamBriefSuggestions } from './upstream-brief-suggestion.ts';

export { extractCommand, SHELL_TOOL_NAMES };

export const PACKAGE_MUTATION =
  /\b(?:yarn|npm|pnpm)\s+(?:add|remove|up|upgrade|install|uninstall|update)\b/i;

export const DEP_SYNC_MESSAGE =
  'package.json may have changed — run /dep-sync to update TECH_STACK.md.';

export function isPackageMutation(command: string): boolean {
  return PACKAGE_MUTATION.test(command);
}

/**
 * Whether this PostToolUse payload is a package-manager mutation on a shell
 * tool. Non-shell tools are ignored even if their input happens to mention
 * `yarn add`.
 */
export function shouldEmitReminder(payload: HookPayload): boolean {
  const toolName = getToolName(payload);
  if (toolName && !SHELL_TOOL_NAMES.has(toolName)) {
    return false;
  }
  return isPackageMutation(extractCommand(getToolInput(payload)));
}

/**
 * DepSync reminder, plus one `/upstream-brief` line per Ecosystem whose
 * Baseline has left the range its latest committed report recorded
 * (ADR 0084 item 14). Fail-open: a suggestion lookup that throws still
 * returns the DepSync line.
 */
export function buildDepSyncMessages(
  repoDir = process.cwd(),
  getSuggestions: (repoDir: string) => string[] = getUpstreamBriefSuggestions,
): string[] {
  const messages = [DEP_SYNC_MESSAGE];
  try {
    for (const ecosystem of getSuggestions(repoDir)) {
      messages.push(
        `Run /upstream-brief ${ecosystem} — its Baseline has moved.`,
      );
    }
  } catch {
    // Fail open: if checking fails, just emit the dep-sync message
  }
  return messages;
}

async function main() {
  const payload = await readPayloadOrExit();

  if (!shouldEmitReminder(payload)) {
    process.exit(0);
  }

  emitAdditionalContext(buildDepSyncMessages().join('\n'));
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  main();
}
