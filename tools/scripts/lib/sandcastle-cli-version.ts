/**
 * Which Claude Code a sandcastle slice runs, chosen from the environment and
 * reported in the slice log.
 *
 * Two variables, set wherever the other `SANDCASTLE_*` ones are (the 1Password
 * Environment, or `.sandcastle/.env`), so changing the CLI never needs a commit:
 *
 *   SANDCASTLE_CLAUDE_CODE_UPDATE   auto | manual. Unset means auto, or manual
 *                                   when a version is set.
 *   SANDCASTLE_CLAUDE_CODE_VERSION  The exact version manual mode installs.
 *
 * Auto follows the latest release: each dispatch asks the release channel the
 * installer uses which version is current, and rebuilds the image when it
 * carries another. Manual holds the image at the named version. Either way the
 * update happens at dispatch, never inside a running slice — the image is
 * built with the CLI's own auto-updater off, so the version the log names is
 * the version the agent ran.
 *
 * Run the tests with: node --test tools/scripts/lib/sandcastle-cli-version.test.ts
 */

export const UPDATE_VARIABLE = 'SANDCASTLE_CLAUDE_CODE_UPDATE';
export const VERSION_VARIABLE = 'SANDCASTLE_CLAUDE_CODE_VERSION';

/** The channel `https://claude.ai/install.sh` reads "latest" from. */
export const LATEST_RELEASE_URL =
  'https://downloads.claude.ai/claude-code-releases/latest';

export type ClaudeCodeMode = 'auto' | 'manual';

export type ClaudeCodePolicy =
  | { mode: 'auto' }
  | { mode: 'manual'; version: string };

const UPDATE_MODES: readonly string[] = ['auto', 'manual'];
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const VERSION_OUTPUT = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?) \(Claude Code\)$/;

/**
 * Pure: the update policy the environment asks for.
 *
 * Throws on a value it cannot honour rather than guessing, as
 * `SANDCASTLE_CLAUDE_AUTH` does: a typo in either variable would otherwise
 * run a CLI nobody chose.
 *
 */
export const claudeCodePolicy = (
  env: Record<string, string | undefined>,
): ClaudeCodePolicy => {
  const rawMode = (env[UPDATE_VARIABLE] ?? '').trim().toLowerCase();
  const version = (env[VERSION_VARIABLE] ?? '').trim();

  if (rawMode && !UPDATE_MODES.includes(rawMode)) {
    throw new Error(
      `${UPDATE_VARIABLE} must be "auto" or "manual" (got "${rawMode}").`,
    );
  }
  if (version && !SEMVER.test(version)) {
    throw new Error(
      `${VERSION_VARIABLE} must be an exact version such as 2.1.310 (got "${version}").`,
    );
  }

  const mode = rawMode || (version ? 'manual' : 'auto');
  if (mode === 'manual') {
    if (!version) {
      throw new Error(
        `${UPDATE_VARIABLE}=manual needs ${VERSION_VARIABLE} set to the version to install.`,
      );
    }
    return { mode: 'manual', version };
  }
  if (version) {
    throw new Error(
      `${UPDATE_VARIABLE}=auto follows the latest release, so ${VERSION_VARIABLE}=${version} ` +
        `would be ignored. Unset one of them.`,
    );
  }
  return { mode: 'auto' };
};

/**
 * Pure: the version a release-channel response names, or null when the body
 * is anything else (an error page, an empty reply).
 *
 */
export const parseReleaseVersion = (body: string): string | null => {
  const text = body.trim();
  return SEMVER.test(text) ? text : null;
};

/**
 * Pure: the version in `claude --version` output, or null when the output is
 * not that shape (no CLI on PATH, an error, a renamed product).
 *
 */
export const parseClaudeCodeVersion = (stdout: string): string | null =>
  VERSION_OUTPUT.exec(stdout.trim())?.[1] ?? null;

/**
 * Pure: how a log names where the version came from.
 *
 */
export const describeClaudeCodeMode = (mode: ClaudeCodeMode): string =>
  mode === 'auto' ? 'auto: latest release' : `manual: ${VERSION_VARIABLE}`;

/**
 * Pure: the line a slice log carries for the CLI it ran.
 *
 */
export const claudeCodeLogLine = ({
  issueNumber,
  version,
  mode,
  image,
}: {
  issueNumber: number;
  version: string;
  mode: ClaudeCodeMode;
  image: string;
}): string =>
  `  [#${issueNumber}] Claude Code ${version} (${describeClaudeCodeMode(mode)}, ${image})`;
