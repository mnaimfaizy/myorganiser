/**
 * Splitting a documented shell command into tokens.
 *
 * Two checkers need the same split and needed it differently at first:
 * `check-doc-commands.ts` asks which tokens name a file, and
 * `check-review-tool-allowlist.ts` asks whether a command's leading tokens
 * are the ones an allowlist entry permits. Both answers are wrong the moment
 * the split is wrong, and both are wrong in the same way — a quoted argument
 * cut on its spaces becomes several tokens nobody wrote. `"Vault Trust
 * Boundary.dc.html"` is one filename; `sed -n '1,20p'` is three tokens, not
 * four.
 *
 * So the split lives here rather than as a copy in each file, for the reason
 * `tools/scripts/review/cli.mjs` gives for its own contents: two copies of one
 * rule drift, and the drift is silent.
 */

/**
 * Split one command line into tokens, keeping a quoted argument whole.
 *
 * The quotes are dropped from the token, which is what both callers want: a
 * path is compared against the filesystem and an argument against an allowlist
 * entry, and neither comparison is about how the argument was quoted.
 */
export function tokenize(command: string): string[] {
  const tokens: string[] = [];
  for (const match of command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    const token = match[1] ?? match[2] ?? match[3];
    if (token !== undefined) tokens.push(token);
  }
  return tokens;
}

/**
 * Split a shell call into its simple commands, at `&&`, `||`, `;`, `|`, and a
 * newline. Quoted text is kept whole, so a `;` inside a quoted pattern does
 * not start a command; so is a character a backslash escapes, and a
 * backslash at the end of a line continues the command onto the next.
 *
 * The quotes and backslashes are left in each command, for a caller that
 * goes on to split it into words. A here-document's body is not recognised:
 * its lines come back as commands, and a caller that cares must look for the
 * `<<` itself.
 *
 */
export function simpleCommands(command: string): string[] {
  const commands: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    // Inside single quotes a backslash is a backslash.
    if (ch === '\\' && quote !== "'" && i + 1 < command.length) {
      i += 1;
      current += command[i] === '\n' && !quote ? ' ' : ch + command[i];
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      commands.push(current);
      current = '';
      i += 1;
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '\n') {
      commands.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  commands.push(current);
  return commands.map((c) => c.trim()).filter(Boolean);
}
