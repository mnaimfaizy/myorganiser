/**
 * Whether a finding's executed evidence is something the reviewer transcript
 * shows was run (issue #1039, ADR 0126).
 *
 * A finding with `evidence.kind: "executed"` names a command and an exit
 * code, and that evidence can earn Blocking (ADR 0071). Both are written by
 * the model that claims to have run it. The transcript holds every Bash call
 * that was actually made, so the two are compared here.
 *
 * This module compares and reports. What a mismatch costs is decided in
 * `run-ladder.ts`.
 *
 * ## The matching rule
 *
 * A model quoting a command it ran rarely quotes it byte for byte, and a
 * check that fails a pull request on a stray space would be re-run, not
 * read. So the comparison is on what ran, not on how it was typed. The
 * evidence matches a call when, after the four allowances below, every
 * simple command the evidence quotes is one the call ran, adjacent and in
 * the call's order.
 *
 *   1. **Whitespace.** A command is compared as its words. Any run of
 *      unquoted whitespace separates two words and is otherwise nothing, and
 *      a backslash at the end of a line continues the command.
 *   2. **Quoting.** Quotes and backslash escapes are taken off and what they
 *      held stays one word: `"old name"`, `'old name'`, and `old\ name` are
 *      the same word, and `--x="a b"` is the same word as `--x='a b'`.
 *      Quoting that changes the words is a different command: `old name`
 *      unquoted is two words.
 *   3. **One part of a chained call.** A call is split at `&&`, `||`, `;`,
 *      `|`, and a newline into its simple commands. Evidence may quote the
 *      whole call, one of its simple commands, or several adjacent ones:
 *      `yarn nx test backend` matches `cd apps/backend && yarn nx test
 *      backend | tail -n 40`. Parts taken from two different calls, parts
 *      out of order, and parts with one skipped between them do not match.
 *      Which separator joined them is not compared. A call that holds a
 *      here-document is the exception: its body is text that reads as
 *      commands, so it matches whole or not at all.
 *   4. **Where it ran and where its output went.** An unquoted redirection
 *      (`2>&1`, `> file`, `2>/dev/null`, `< file`, `<<< text`) is dropped
 *      with its target from both sides, and so is a trailing `&`.
 *
 * Nothing else is allowed. `yarn nx test x` is not `corepack yarn nx test
 * x`, an added or dropped flag is a different command, and a prefix of a
 * command is not the command. Evidence that comes to no words at all matches
 * nothing: an empty sequence would otherwise be found in every call.
 *
 * The words are compared as typed. Nothing is expanded: a variable, a glob,
 * a `$(…)` substitution, and a subshell's parentheses are the characters
 * they are, on both sides. A command inside a substitution is therefore not
 * a part evidence can quote on its own.
 *
 * ## The exit code
 *
 * The transcript carries one exit code per call, not per simple command, so
 * it is compared only when the evidence quotes the whole call and the
 * transcript carries a code for that call. Evidence that is one part of a
 * chained call has no code of its own in the transcript, and a call with no
 * readable result has none either. Both are "cannot tell", and "cannot tell"
 * matches. A command run more than once matches if any run agrees.
 */

import { simpleCommands } from '../lib/shell-command.ts';

/** What a finding gives as executed evidence, of the fields compared here. */
export interface ExecutedEvidenceClaim {
  command: string;
  exitCode: number;
}

/** One Bash call the transcript shows, with the code its result carries. */
export interface TranscriptExecution {
  command: string;
  exitCode: number | null;
}

/**
 * The comparison's answer. `exitCodes` are the codes the transcript carries
 * for the calls the evidence quotes whole.
 */
export type EvidenceMatch =
  | { status: 'ran' }
  | { status: 'not-run' }
  | { status: 'exit-code-differs'; exitCodes: number[] };

/**
 * A simple command's words, with the quotes and backslashes taken off. A
 * word remembers whether it opened quoted or escaped: `">"` is an argument,
 * and `>"my file"` is a redirection with a quoted target.
 */
interface Word {
  text: string;
  literal: boolean;
}

const wordsOf = (simple: string): Word[] => {
  const words: Word[] = [];
  let text = '';
  let literal = false;
  let open = false;
  let quote: string | null = null;
  const close = () => {
    if (open) words.push({ text, literal });
    text = '';
    literal = false;
    open = false;
  };
  const take = (ch: string, asLiteral: boolean): void => {
    if (!open) literal = asLiteral;
    open = true;
    text += ch;
  };
  for (let i = 0; i < simple.length; i += 1) {
    const ch = simple[i];
    if (ch === '\\' && quote !== "'" && i + 1 < simple.length) {
      const next = simple[i + 1];
      // Inside double quotes a backslash escapes only a quote or itself.
      if (!quote || next === '"' || next === '\\') {
        take(next, true);
        i += 1;
        continue;
      }
    }
    if (quote) {
      if (ch === quote) quote = null;
      else text += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      take('', true);
      continue;
    }
    if (/\s/.test(ch)) {
      close();
      continue;
    }
    take(ch, false);
  }
  close();
  return words;
};

/** A redirection, and whether its target is in the same word. */
const REDIRECTION = /^(?:\d*|&)(?:>>?|<<<|<)(.*)$/;
const HERE_DOCUMENT = /^\d*<<(?!<)/;

/**
 * What a simple command ran, as one comparable string, or `null` when
 * nothing is left of it once redirections and a trailing `&` are dropped.
 */
const whatRan = (words: readonly Word[]): string | null => {
  const kept: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const { text, literal } = words[i];
    if (!literal && text === '&' && i === words.length - 1) continue;
    const redirection = literal ? null : REDIRECTION.exec(text);
    if (!redirection) {
      kept.push(text);
      continue;
    }
    // `> file` puts the target in the next word; `>file` and `2>&1` do not.
    if (redirection[1] === '') i += 1;
  }
  return kept.length ? JSON.stringify(kept) : null;
};

/**
 * A call as the sequence of what its simple commands ran, and whether it
 * holds a here-document.
 */
const read = (
  command: string,
): { sequence: string[]; hereDocument: boolean } => {
  const commands = simpleCommands(command).map(wordsOf);
  return {
    sequence: commands
      .map(whatRan)
      .filter((ran): ran is string => ran !== null),
    hereDocument: commands.some((words) =>
      words.some((w) => !w.literal && HERE_DOCUMENT.test(w.text)),
    ),
  };
};

/** Whether `part` is found in `whole`, adjacent and in order. */
const isRunOf = (part: readonly string[], whole: readonly string[]): boolean => {
  for (let start = 0; start + part.length <= whole.length; start += 1)
    if (part.every((ran, i) => whole[start + i] === ran)) return true;
  return false;
};

/**
 * Compare one finding's executed evidence with the calls a transcript shows.
 *
 * @param evidence the command and exit code a finding gives as evidence
 * @param executions the Bash calls the evidence may have come from;
 *   `exitCode` is `null` where the transcript does not carry one
 */
export const matchExecutedEvidence = (
  evidence: ExecutedEvidenceClaim,
  executions: readonly TranscriptExecution[],
): EvidenceMatch => {
  const claimed = read(evidence.command).sequence;
  if (claimed.length === 0) return { status: 'not-run' };

  const differing = new Set<number>();
  let found = false;
  for (const execution of executions) {
    const call = read(execution.command);
    const whole = claimed.length === call.sequence.length;
    if (!isRunOf(claimed, call.sequence)) continue;
    // A here-document's body lines read as commands and are text.
    if (call.hereDocument && !whole) continue;
    found = true;
    const { exitCode } = execution;
    const comparable = whole && exitCode !== null;
    if (!comparable || exitCode === evidence.exitCode)
      return { status: 'ran' };
    differing.add(exitCode);
  }
  return found
    ? {
        status: 'exit-code-differs',
        exitCodes: [...differing].sort((a, b) => a - b),
      }
    : { status: 'not-run' };
};
