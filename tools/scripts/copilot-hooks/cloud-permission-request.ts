import { extractCommand, getToolInput, readPayloadOrExit } from './lib.ts';

/**
 * Claude Code `PermissionRequest` hook: answers a narrow set of permission
 * prompts on the user's behalf, in cloud sessions only.
 *
 * `.claude/settings.json` keeps `git push` and `yarn ai:create-pr` behind an
 * `ask` rule, which prompts in every mode including auto. At a terminal that is
 * a keystroke; in a cloud session (claude.ai/code) it is a round trip to a
 * browser tab for a push the session exists to make, from a VM that holds no
 * credentials of its own. So inside the cloud VM, and nowhere else, this
 * approves:
 *
 *   - `git push [-u|--set-upstream] origin <branch>` where `<branch>` is not
 *     `main`, `master`, `release/*`, `HEAD`, or a tag, with no force of any kind;
 *   - `yarn ai:create-pr …` (or via `corepack`), whose runner recomputes the
 *     merge base, pins its own lease, and refuses a base-branch head itself.
 *
 * Anything else — a compound command, a bare `git push` whose target depends
 * on upstream config, any unlisted flag — gets no decision and the user is
 * asked as before. Deny rules are evaluated regardless of what this returns.
 *
 * Decision record: docs/adr/0105-a-cloud-session-answers-its-own-feature-branch-push-prompt.md.
 *
 * Claude Code sets `CLAUDE_CODE_REMOTE=true` in cloud sessions only; a local
 * terminal, the desktop app's local sessions, and the CI reviewer never see it.
 *
 * Launch with `--defer`: this script never reads argv, but `readPayloadOrExit`
 * in lib.ts does — on an empty or unparsable payload it calls `allowTool()`,
 * which without the flag prints a PreToolUse-shaped allow into a
 * PermissionRequest response.
 */
const IS_CLOUD_SESSION = process.env.CLAUDE_CODE_REMOTE === 'true';

/** A single plain command: no chaining, piping, substitution, redirects, or quoting. */
const NOT_A_SIMPLE_COMMAND = /[;&|`\n\r<>'"]|\$\(/;

const PUSH_FLAGS = new Set(['-u', '--set-upstream']);

const PROTECTED_REF =
  /^(?:refs\/heads\/)?(?:main|master|head|release\/.*)$|^refs\/tags\//i;

function isSafePush(args: string[]): boolean {
  const positional: string[] = [];

  for (const arg of args) {
    if (arg.startsWith('-')) {
      if (!PUSH_FLAGS.has(arg)) {
        return false;
      }
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 2 || positional[0] !== 'origin') {
    return false;
  }

  const refspec = positional[1];
  if (refspec.startsWith('+')) {
    return false;
  }

  const [source, destination = source] = refspec.split(':');
  if (!source || !destination || refspec.split(':').length > 2) {
    return false;
  }

  return !PROTECTED_REF.test(source) && !PROTECTED_REF.test(destination);
}

function isCloudApprovable(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed || NOT_A_SIMPLE_COMMAND.test(trimmed)) {
    return false;
  }

  const tokens = trimmed.split(/\s+/);
  if (tokens[0] === 'corepack') {
    tokens.shift();
  }

  if (tokens[0] === 'yarn' && tokens[1] === 'ai:create-pr') {
    return true;
  }

  return (
    tokens[0] === 'git' && tokens[1] === 'push' && isSafePush(tokens.slice(2))
  );
}

async function main() {
  if (!IS_CLOUD_SESSION) {
    process.exit(0);
  }

  const payload = await readPayloadOrExit();
  const toolName = String(payload?.tool_name ?? '');

  if (toolName !== 'Bash' && toolName !== 'PowerShell') {
    process.exit(0);
  }

  if (!isCloudApprovable(extractCommand(getToolInput(payload)))) {
    process.exit(0);
  }

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow' },
      },
    }),
  );
  process.exit(0);
}

main();
