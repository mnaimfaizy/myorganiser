/**
 * A provider adapter supplies this result from its own isolated-profile probe.
 * A status string or the mere presence of credentials is not a usability proof.
 */
export type CodexSubscriptionProbe = () => Promise<{
  authentication: 'subscription' | 'api' | 'access-token' | 'unknown';
  usable: boolean;
}>;

/** Refuse all ambiguous, non-subscription and failed probes before dispatch. */
export async function requireCodexSubscription(
  probe: CodexSubscriptionProbe,
): Promise<void> {
  let result: Awaited<ReturnType<CodexSubscriptionProbe>>;
  try {
    result = await probe();
  } catch {
    throw new Error('Codex subscription authentication could not be verified.');
  }
  if (result?.authentication !== 'subscription' || result.usable !== true) {
    throw new Error('A usable Codex subscription is required before dispatch.');
  }
}

export interface CodexCommand {
  executable: 'codex';
  args: string[];
  stdin: string;
}

/**
 * Arguments are passed directly to a process API, never interpolated in a shell.
 * This builder does not prove that the CLI honours the policy, that hooks run,
 * or that an isolated profile is mounted. Those remain launch prerequisites.
 */
export function buildCodexCommand(model: string, prompt: string): CodexCommand {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(model)) {
    throw new Error('Invalid Codex model.');
  }
  return {
    executable: 'codex',
    args: [
      '--ask-for-approval',
      'never',
      'exec',
      '--sandbox',
      'workspace-write',
      '--ignore-user-config',
      '--json',
      '--model',
      model,
      '-',
    ],
    stdin: prompt,
  };
}

/** Build a candidate only after the injected subscription check has passed. */
export async function prepareCodexCommand(
  probe: CodexSubscriptionProbe,
  model: string,
  prompt: string,
): Promise<CodexCommand> {
  await requireCodexSubscription(probe);
  return buildCodexCommand(model, prompt);
}
