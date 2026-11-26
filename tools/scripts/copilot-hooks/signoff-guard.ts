import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { SIGNOFF_ISSUE_MARKER } from '../lib/signoff-issue.ts';

/**
 * Where a `gh` command starts: a line start, or after `|`, `;`, `&`, `(`,
 * `{`, `!` or a backtick; then an optional `then`/`do`/`else`, variable
 * assignments and `env`, and an optional path to the binary; then `-R`/`--repo`
 * global flags. A command that only quotes a `gh` call, such as a test
 * fixture, does not match.
 */
const GH_COMMAND = String.raw`(?:^|[\n|;&(\x60{!])[ \t]*(?:(?:then|do|else)\s+)?(?:[A-Za-z_]\w*=\S*\s+)*(?:env\s+(?:[A-Za-z_]\w*=\S*\s+)*)?(?:[^\s'"]*\/)?gh(?:\s+(?:-R|--repo)(?:=|\s+)\S+)*\s+`;

/** A `gh api` call that sends fields or a body; a bare `gh api` GET passes. */
const GH_API_SEND = String.raw`api\b[^|;&\n]*\s(?:-[fF]|--field|--raw-field|--input)\b`;

/** A `gh` call that can write an issue body or a comment. */
const GH_ISSUE_WRITE = new RegExp(
  `${GH_COMMAND}(?:issue\\s+(?:edit|create|comment)\\b|${GH_API_SEND})`,
);

/** A `gh` call that can write an issue comment: where the gate reads waivers. */
const GH_COMMENT_WRITE = new RegExp(
  `${GH_COMMAND}(?:issue\\s+comment\\b|(?=${GH_API_SEND})api\\b[^|;&\\n]*/comments\\b)`,
);

/** A `gh` call that can rewrite an issue body: `gh issue edit` or a sending `gh api`. */
const GH_BODY_EDIT = new RegExp(
  `${GH_COMMAND}(?:issue\\s+edit\\b|${GH_API_SEND})`,
);

/**
 * A `gh` call that reads an issue: `gh issue view`, or a `gh api` call on
 * `…/issues/<n>` that sends nothing (no field, input or write method).
 */
const GH_ISSUE_READ = new RegExp(
  `${GH_COMMAND}(?:issue\\s+view\\b|api\\b(?![^|;&\\n)]*\\s(?:-[fF]|--field|--raw-field|--input|-X\\s*(?:PATCH|POST|PUT)|--method[=\\s]+(?:PATCH|POST|PUT))\\b)[^|;&\\n)]*/issues/\\d+(?![\\w/]))`,
);

/**
 * A body the command builds at run time, which this guard cannot see: a
 * command substitution, or stdin (`--body-file -`, `-F -`, `--input -`,
 * `key=@-`).
 */
const RUN_TIME_BODY =
  /\$\(|`|(?:--body-file|--input|\s-F)[=\s]+-(?=\s|$)|=@-(?=\s|$|["'])/;

/**
 * A line that starts `waive:`. Looser on purpose than the production gate's
 * `WAIVER_RE` in `tools/scripts/lib/signoff-gate.ts`, so a malformed waiver is
 * refused too. In a command the line can start after a newline (real or a
 * `\n` escape), a quote, or `=` (`-f body=waive:…`).
 */
const WAIVER_LINE = /(?:^|\n|\\n|["'=])[ \t]*waive[ \t]*:/i;

/**
 * GitHub caps an issue body at 65536 characters, which is at most 256 KiB of
 * UTF-8. A larger file is not a body, and reading it would spend the hook's
 * 5-second budget.
 */
const MAX_BODY_FILE_BYTES = 256 * 1024;

/**
 * Refuses an agent's shell command that writes a Sign-off Issue body, rewrites
 * an issue body from its own current text, or posts a `waive:` comment
 * (ADR 0151). The production gate trusts a tick or a waiver
 * by the owner's login, and an agent acting for the Maintainer writes as that
 * login too, so the gate cannot tell them apart; this guard stops the agent's
 * tool call instead.
 */
export function getSignoffWriteReason(
  command: string,
  cwd = process.cwd(),
): string | null {
  const writesIssue = GH_ISSUE_WRITE.test(command);
  const writesComment = GH_COMMENT_WRITE.test(command);
  if (!writesIssue && !writesComment) {
    return null;
  }

  for (const text of [command, ...readBodyFiles(command, cwd)]) {
    if (text.includes(SIGNOFF_ISSUE_MARKER)) {
      return 'Writing a Sign-off Issue body is blocked: only the Maintainer ticks a Person Check, and the Merge Train adds checks as a script (ADR 0151). Ask the Maintainer to tick it.';
    }

    if (writesComment && WAIVER_LINE.test(text)) {
      return 'Posting a `waive:` comment is blocked: only the Maintainer waives a Person Check (ADR 0151). Ask the Maintainer to waive it.';
    }
  }

  // A tick made by reading a body and writing it back edited never shows the
  // marker, so a run-time body rebuilt from an issue read is refused whole.
  if (
    GH_BODY_EDIT.test(command) &&
    RUN_TIME_BODY.test(command) &&
    GH_ISSUE_READ.test(command)
  ) {
    return 'Rewriting an issue body from its own current text is blocked: the hook cannot see whether it is a Sign-off Issue, where only the Maintainer ticks a Person Check (ADR 0151). Write the new body to a file and pass it with `--body-file`.';
  }

  return null;
}

/**
 * The files a `gh` command reads its body from: `--body-file X` or `-F X`
 * (`gh issue`), `--input X` and `-F|--field key=@X` (`gh api`). A relative
 * path resolves against the tool's reported working directory when available.
 * Stdin (`-`), a file the command itself is about to write, and a
 * missing or unreadable file cannot be read here and are skipped.
 */
function readBodyFiles(command: string, cwd: string): string[] {
  const paths = [
    ...Array.from(
      command.matchAll(
        /(?:--body-file|--input|\s-F)[=\s]+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s'"=]+))(?=\s|$)/g,
      ),
      (match) => match[1] ?? match[2] ?? match[3],
    ),
    ...Array.from(
      command.matchAll(
        /(?:\s-F|--field)[=\s]+[\w.[\]-]+=@(['"]?)([^\s'"]+)\1/g,
      ),
      (match) => match[2],
    ),
  ].filter((path) => path !== '-');

  return paths.flatMap((path) => {
    try {
      const resolved = resolve(cwd, path);
      const stat = statSync(resolved);
      if (!stat.isFile() || stat.size > MAX_BODY_FILE_BYTES) return [];
      return [readFileSync(resolved, 'utf8')];
    } catch {
      return [];
    }
  });
}
