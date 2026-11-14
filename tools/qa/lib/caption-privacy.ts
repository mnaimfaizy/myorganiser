/**
 * Caption privacy for a Storyboard (PRD #1544, #1548). A pure check over the
 * strings a scenario's author wrote that reach the Storyboard page or a video
 * overlay: the title, the expected results, each side's observed text and
 * failure message, and every step's caption and device/tab label, plus any
 * further field the caller names for the same check (a `video` scenario's
 * MP4 tab label on each side, which a step need not carry).
 *
 * It is a DENY-list, not an allow-list. A string is refused when it contains,
 * as an exact substring, a known secret (the QA Account's password or vault
 * passphrase, or a value passed to `secret()`), or when the Request Transcript
 * redactor's own Bearer/JWT detection matches it (imported, not copied).
 * Encoded, split or case-changed variants are out of scope on purpose: the
 * values are known exactly and captions are written by the scenario's author.
 *
 * It returns FIELD NAMES only (`S1 after step 3 caption`) and never a value,
 * so a refusal can be printed anywhere.
 */
import {
  decodeBounded,
  holdsKnownSecret,
  looksLikeCredentialValue,
} from './redact-transcript.ts';
import { SIDES } from './qa-switch.ts';
import type { StoryboardInput } from './storyboard.ts';

/** Whether one string leaks: it holds a secret verbatim, or a Bearer/JWT. */
export function leaks(text: string, secrets: readonly string[]): boolean {
  if (holdsKnownSecret(text, secrets)) return true;
  return looksLikeCredentialValue(decodeBounded(text).value);
}

/** A string a check reads, with the name a refusal gives it. */
export interface CheckedField {
  field: string;
  text: string;
}

/** Every string of a Storyboard's input that could reach a reader, named. */
export function captionFields(input: StoryboardInput): CheckedField[] {
  const { id } = input;
  const fields: CheckedField[] = [
    { field: `${id} title`, text: input.title },
    { field: `${id} expected after`, text: input.expected.after },
  ];
  if (input.expected.before !== undefined) {
    fields.push({
      field: `${id} expected before`,
      text: input.expected.before,
    });
  }
  for (const side of SIDES) {
    const run = input.sides[side];
    if (!run) continue;
    if (run.observed !== undefined) {
      fields.push({ field: `${id} ${side} observed`, text: run.observed });
    }
    if (run.message !== undefined) {
      fields.push({ field: `${id} ${side} message`, text: run.message });
    }
    for (const step of run.steps) {
      const at = `${id} ${side} step ${step.index}`;
      fields.push(
        { field: `${at} caption`, text: step.caption },
        { field: `${at} label`, text: step.label },
        { field: `${at} device`, text: step.device },
        { field: `${at} tab`, text: step.tab },
      );
    }
  }
  return fields;
}

/**
 * The names of the fields that leak, in reading order; empty when none does.
 * `more` are further strings that reach a combined file, checked the same way
 * after the Storyboard's own.
 */
export function findCaptionLeaks(
  input: StoryboardInput,
  secrets: readonly string[],
  more: readonly CheckedField[] = [],
): string[] {
  return [...captionFields(input), ...more]
    .filter(({ text }) => leaks(text, secrets))
    .map(({ field }) => field);
}

/** The text a withheld field is replaced by in the step-records file. */
export const WITHHELD_FIELD = '[withheld]';

/**
 * The input with every leaking field replaced, for the step-records file: the
 * secrets are never saved, so a later re-render cannot redo the exact check
 * and the file must not hold the value.
 */
export function withholdLeaks(
  input: StoryboardInput,
  secrets: readonly string[],
): StoryboardInput {
  const hide = (text: string): string =>
    leaks(text, secrets) ? WITHHELD_FIELD : text;
  const sides: StoryboardInput['sides'] = {};
  for (const side of SIDES) {
    const run = input.sides[side];
    if (!run) continue;
    sides[side] = {
      ...run,
      ...(run.observed === undefined ? {} : { observed: hide(run.observed) }),
      ...(run.message === undefined ? {} : { message: hide(run.message) }),
      steps: run.steps.map((step) => ({
        ...step,
        caption: hide(step.caption),
        label: hide(step.label),
        device: hide(step.device),
        tab: hide(step.tab),
      })),
    };
  }
  return {
    ...input,
    title: hide(input.title),
    expected: {
      after: hide(input.expected.after),
      ...(input.expected.before === undefined
        ? {}
        : { before: hide(input.expected.before) }),
    },
    sides,
  };
}
