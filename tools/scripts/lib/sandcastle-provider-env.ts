/**
 * Which host credentials reach a Sandcastle sandbox container (#1593, ADR 0010).
 *
 * The container has outbound network access and reads issue text, and only the
 * host pushes (ADR 0010). So a GitHub token never belongs inside it, and each
 * agent kind receives only its own provider credential.
 *
 * Two layers, deliberately different in kind:
 *
 *   1. SELECTION (the primary defence) is an allow-list by agent kind. A variable
 *      reaches the container only if the table below names it for that kind.
 *   2. The GUARD is a deny-list of exactly `GH_TOKEN` and `GITHUB_TOKEN`, run on
 *      the fully assembled `docker({ env })` record. It is a backstop for a later
 *      edit that spreads in another env source. A deny-list is safe here because
 *      it compares exact variable names in our own record, not untrusted text
 *      with encodings; an allow-list guard would also have to know every Nx,
 *      Yarn and provider entry and would break with each new one.
 *
 * `COPILOT_GITHUB_TOKEN` alone authenticates the Copilot CLI: GitHub's CLI
 * reference checks `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN` in that
 * order, and takes a fine-grained token with the "Copilot Requests" permission.
 *
 * Pure: it takes the env as an argument, so it is tested without Docker.
 */

export const AGENT_KINDS = ['claude', 'cursor', 'copilot', 'codex'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

/** `null` = not a claude run. `'none'` = a credential was needed and absent. */
export type ClaudeAuthResolution = 'subscription' | 'api' | 'none' | null;

/** Variables that must never be inside a sandbox, whatever the agent kind. */
export const FORBIDDEN_SANDBOX_VARIABLES = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
] as const;

/** Variables an agent kind needs whatever Claude auth resolved: its own key, or none. */
const STATIC_PROVIDER_VARIABLES = {
  claude: [],
  cursor: ['CURSOR_API_KEY'],
  copilot: ['COPILOT_GITHUB_TOKEN'],
  codex: [],
} as const satisfies Record<AgentKind, readonly string[]>;

/** The one Claude credential `resolveClaudeAuth` chose, as a variable name. */
function claudeVariables(
  agentKind: AgentKind,
  claudeAuth: ClaudeAuthResolution,
): readonly string[] {
  if (agentKind !== 'claude') return [];
  if (claudeAuth === 'subscription') return ['CLAUDE_CODE_OAUTH_TOKEN'];
  if (claudeAuth === 'api') return ['ANTHROPIC_API_KEY'];
  return [];
}

/** The provider part of the sandbox env for one agent kind. Unset or empty host variables are omitted. */
export function providerEnvironment({
  agentKind,
  claudeAuth,
  env,
}: {
  agentKind: AgentKind;
  claudeAuth: ClaudeAuthResolution;
  env: Readonly<Record<string, string | undefined>>;
}): Record<string, string> {
  const names = [
    ...claudeVariables(agentKind, claudeAuth),
    ...STATIC_PROVIDER_VARIABLES[agentKind],
  ];
  return Object.fromEntries(
    names.flatMap((name) => {
      const value = env[name];
      return value ? [[name, value]] : [];
    }),
  );
}

/**
 * Throws, naming the variable but never its value, when the assembled sandbox
 * env carries a GitHub token. Call it before launching a container.
 */
export function assertNoGitHubTokens(
  sandboxEnv: Readonly<Record<string, string | undefined>>,
): void {
  for (const name of FORBIDDEN_SANDBOX_VARIABLES) {
    if (Object.hasOwn(sandboxEnv, name)) {
      throw new Error(
        `Refusing to start a sandbox: its environment contains ${name}. ` +
          'Only the host pushes (ADR 0010); a GitHub token must never be forwarded into the container.',
      );
    }
  }
}
