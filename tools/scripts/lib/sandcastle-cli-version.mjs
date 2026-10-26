/**
 * The Claude Code version a sandcastle slice runs, pinned and reported.
 *
 * `.sandcastle/Dockerfile` installs Claude Code at the version its
 * `ARG CLAUDE_CODE_VERSION` names, with the auto-updater off, so every slice in
 * an image runs the same CLI. The orchestrator only builds the image when it is
 * missing, so a bumped pin would otherwise never reach an image that already
 * exists: before dispatch it reads the version the image actually carries,
 * rebuilds when that differs from the pin, and writes the version into each
 * slice's log — the way the CI reviewer's log names the CLI
 * `anthropics/claude-code-action` ran.
 *
 * Run the tests with: yarn sandcastle:cli-version:test
 */

const PIN_PATTERN = /^ARG CLAUDE_CODE_VERSION=(\S+)\s*$/m;
const SEMVER = /^\d+\.\d+\.\d+(?:-\S+)?$/;
const VERSION_OUTPUT = /^(\d+\.\d+\.\d+(?:-\S+)?) \(Claude Code\)\s*$/;

/**
 * Pure: the Claude Code version a Dockerfile pins.
 *
 * Throws rather than returning a fallback: an image built without a pin is
 * the unpinned state this module exists to end.
 *
 * @param {string} dockerfile
 * @returns {string}
 */
export const pinnedClaudeCodeVersion = (dockerfile) => {
  const match = PIN_PATTERN.exec(dockerfile);
  if (!match) {
    throw new Error(
      'the sandbox Dockerfile has no `ARG CLAUDE_CODE_VERSION=<version>` line',
    );
  }
  const version = match[1];
  if (!SEMVER.test(version)) {
    throw new Error(
      `CLAUDE_CODE_VERSION must be an exact version, got "${version}"`,
    );
  }
  return version;
};

/**
 * Pure: the version in `claude --version` output, or null when the output is
 * not that shape (no CLI on PATH, an error page, a renamed product).
 *
 * @param {string} stdout
 * @returns {string | null}
 */
export const parseClaudeCodeVersion = (stdout) =>
  VERSION_OUTPUT.exec(stdout.trim())?.[1] ?? null;

/**
 * Pure: the line a slice log carries for the CLI it ran.
 *
 * @param {{ issueNumber: number, version: string, image: string }} input
 * @returns {string}
 */
export const claudeCodeLogLine = ({ issueNumber, version, image }) =>
  `  [#${issueNumber}] Claude Code ${version} (pinned in ${image})`;
