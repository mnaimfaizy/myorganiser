/**
 * Pure decision logic for the Door line gate on `yarn ai:create-pr`.
 *
 * The Merge Train reads a Pull Request's Merge Danger Door with `readDoor`
 * (ADR 0148). A drafted body whose Door line the train cannot read holds the
 * Pull Request on every `--auto` pass, and nothing else compares the drafted
 * line to the reader: PrAuthor's template test reads the template, not a
 * draft. PR #1532's first draft wrote `**Door:** two-way. The branch adds …`
 * and was held for it. This gate runs the train's own reader on the body
 * before anything is pushed.
 *
 * Only a supplied body (`--body` / `--body-file`) is checked. The runner's
 * commit-derived fallback body carries no Merge danger section, by design.
 *
 * Run the tests with: node --test tools/scripts/lib/pr-door-line.test.ts
 */

import { DOOR_LINE_FORM, readDoor } from './merge-train.ts';

export interface DoorLineInput {
  /** The body text, or null when the runner builds its own fallback body. */
  suppliedBody: string | null;
}

export type DoorLineResult = { ok: true } | { ok: false; message: string };

/**
 * The body `ai:create-pr` will publish, as the gate must see it: the file's
 * text when `--body-file` is given, else `--body`, else null for the runner's
 * fallback. `readFile` is injected so the choice is testable. `parseArgs`
 * refuses both flags together, so the file winning over `--body` is only a
 * defined order, never a reachable choice.
 */
export function suppliedBodyFrom(
  { body, bodyFile }: { body: string | null; bodyFile: string | null },
  readFile: (path: string) => string,
): string | null {
  if (bodyFile) return readFile(bodyFile);
  return body;
}

export function checkDoorLine({ suppliedBody }: DoorLineInput): DoorLineResult {
  if (suppliedBody === null) return { ok: true };

  const door = readDoor(suppliedBody);
  if (door.status === 'one-way' || door.status === 'two-way') {
    return { ok: true };
  }
  if (door.status === 'unreadable') {
    return {
      ok: false,
      message: `The Merge Train cannot read this Door line: ${door.line}\nWrite it as ${DOOR_LINE_FORM}. Re-run PrAuthor or fix the line in the body file.`,
    };
  }
  return {
    ok: false,
    message: `The body has no Door line. Every PrAuthor body carries a \`## Merge danger\` section with a Door line written as ${DOOR_LINE_FORM}. Re-run PrAuthor or add the section to the body file.`,
  };
}
