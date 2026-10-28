import {
  collectWriteTargets,
  emitAdditionalContext,
  extractCommand,
  getToolInput,
  getToolName,
  isLikelyWriteCommand,
  isMutatingTool,
  normalizeText,
  readPayloadOrExit,
  SHELL_TOOL_NAMES,
} from './lib.ts';

const CONTRACT_TARGETS: { pattern: RegExp; additionalContext: string }[] = [
  {
    pattern: /(^|[^a-z0-9])apps\/backend\/src\/controllers(?:\/|$)/i,
    additionalContext:
      'You changed backend contract sources.\n- Run `yarn openapi:sync`\n- Run `yarn api:generate`\n- Run the relevant backend tests',
  },
  {
    pattern: /(^|[^a-z0-9])apps\/backend\/src\/prisma\/schema(?:\/|$)/i,
    additionalContext:
      'You changed Prisma schema files.\n- Run `yarn nx run backend:generate-types`\n- Run `yarn nx run backend:migrate`\n- Run the relevant backend tests',
  },
];

/**
 * Strings that could name a file this tool call wrote.
 *
 * Only write destinations count. Reading a controller, grepping the schema
 * directory, or writing a document that merely *mentions* those paths is not a
 * contract change, and telling the agent to regenerate the API in those cases
 * trains it to ignore the reminder entirely.
 */
function getWriteTargets(toolName: string, toolInput: unknown): string[] {
  if (SHELL_TOOL_NAMES.has(toolName)) {
    const command = extractCommand(toolInput);
    return isLikelyWriteCommand(command) ? [command] : [];
  }

  if (typeof toolInput === 'string') {
    return [toolInput];
  }

  return collectWriteTargets(toolInput);
}

function getAdditionalContext(strings: string[]): string | null {
  const matches = new Set<string>();

  for (const text of strings) {
    const normalized = normalizeText(text);

    for (const target of CONTRACT_TARGETS) {
      if (target.pattern.test(normalized)) {
        matches.add(target.additionalContext);
      }
    }
  }

  if (matches.size === 0) {
    return null;
  }

  return Array.from(matches).join('\n\n');
}

async function main() {
  const payload = await readPayloadOrExit();
  const toolName = getToolName(payload);

  if (!isMutatingTool(toolName)) {
    process.exit(0);
  }

  const additionalContext = getAdditionalContext(
    getWriteTargets(toolName, getToolInput(payload)),
  );

  if (!additionalContext) {
    process.exit(0);
  }

  emitAdditionalContext(additionalContext);
}

main();
