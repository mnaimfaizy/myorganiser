#!/usr/bin/env node
// Asserts that docs/review/REVIEW_CHECKLIST.md and
// tools/config/review-obligations.json describe the same obligations.
//
//   node tools/scripts/check-review-checklist.ts [--print]
//
// The checklist is the human form of the catalogue: same questions, same
// answers, different delivery. Prose that must track a source of truth
// elsewhere is the shape this repo already gates everywhere else
// (vault:pages:check, auth:pages:check, review:pages:check,
// deploy:pages:check). Without this checker an obligation's id or its
// answerFields can move in the JSON while the entry a human reads still
// describes the old one, and the file's own claim — one artifact, two
// readers — quietly stops being true.
//
// What is asserted is what is mechanical: the set and order of ids, each
// entry's answer fields, and which of those fields must quote a line of
// source. The rationale, the trigger prose, and the incident history are
// deliberately not asserted; they are writing, and a gate over writing is a
// gate nobody can satisfy.
//
// Exit 0 = sound. Exit 1 = findings. Exit 2 = could not run.
import { readFileSync } from 'node:fs';

import { errorMessage } from './lib/error-message.ts';
import { isMain } from './review/cli.ts';
import { loadGoldenSet } from './review/golden.ts';
import {
  loadObligationCatalogue,
  normalizeCitedFields,
} from './review/obligations.ts';

const CHECKLIST = 'docs/review/REVIEW_CHECKLIST.md';

const die: (msg: string) => never = (msg) => {
  console.error(`review-checklist: ${msg}`);
  process.exit(2);
};

/** One cited field: the answer must quote a line of source, except for `uncitedWhen`. */
interface CitedField {
  field: string;
  uncitedWhen?: string;
}

/** One numbered checklist entry, as the checklist's Markdown spells it. */
interface ChecklistEntry {
  id: string;
  title: string;
  answerFields: string[];
  citedFields: CitedField[];
}

/**
 * Parse the checklist's numbered entries.
 *
 * An entry is a `## <n>. <title>` section carrying an `**id** \`<id>\`` line.
 * Sections without one (the preamble, Deferred candidates, Maintaining this
 * file) are prose about the list rather than entries in it, and are skipped.
 */
export function parseChecklist(md: string): ChecklistEntry[] {
  const entries: ChecklistEntry[] = [];
  const sections = md.split(/^## /m).slice(1);
  for (const section of sections) {
    const title = section.split('\n', 1)[0].trim();
    const idMatch = section.match(/^\*\*id\*\*\s+`([^`]+)`/m);
    if (!idMatch) continue;
    // The answer table's first column names the fields, one per row, each
    // backticked. The header and its separator carry no backticks, so they
    // fall out without special-casing.
    const answerFields: string[] = [];
    for (const line of section.split('\n')) {
      const cell = line.match(/^\|\s*`([^`]+)`\s*\|/);
      if (cell) answerFields.push(cell[1]);
    }
    // The `**Cites**` line names the fields whose answer must quote a line of
    // source, in the catalogue's order, each optionally with the one value
    // that has no line to quote: `**Cites** `wiredBy` unless `none``.
    const citedFields: CitedField[] = [];
    const citesLine = section.match(/^\*\*Cites\*\*\s+(.*)$/m);
    if (citesLine) {
      const pattern = /`([^`]+)`(?:\s+unless\s+`([^`]+)`)?/g;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(citesLine[1])) !== null)
        citedFields.push(
          m[2] === undefined
            ? { field: m[1] }
            : { field: m[1], uncitedWhen: m[2] },
        );
    }
    entries.push({ id: idMatch[1], title, answerFields, citedFields });
  }
  return entries;
}

/** One comparable string per cited field, the same on both sides. */
export const citedFieldLabel = (c: CitedField) =>
  c.uncitedWhen === undefined ? c.field : `${c.field} unless ${c.uncitedWhen}`;

const main = () => {
  let md: string;
  try {
    md = readFileSync(CHECKLIST, 'utf8');
  } catch (err) {
    die(`cannot read ${CHECKLIST}: ${errorMessage(err)}`);
  }

  let catalogue;
  try {
    catalogue = loadObligationCatalogue();
  } catch (err) {
    die(errorMessage(err));
  }

  const entries = parseChecklist(md);
  const findings: string[] = [];

  const wanted: string[] = catalogue.obligations.map(
    (o: { id: string }) => o.id,
  );
  const found = entries.map((e) => e.id);

  for (const id of wanted)
    if (!found.includes(id))
      findings.push(`obligation ${id} has no entry in ${CHECKLIST}`);
  for (const id of found)
    if (!wanted.includes(id))
      findings.push(
        `${CHECKLIST} documents ${id}, which the catalogue does not`,
      );

  // Order is asserted only once both sides carry the same ids; reporting a
  // reorder on top of a missing entry is noise about a problem already named.
  if (findings.length === 0 && wanted.join(',') !== found.join(','))
    findings.push(
      `entry order differs: catalogue has ${wanted.join(', ')}; ` +
        `${CHECKLIST} has ${found.join(', ')}`,
    );

  // Every obligation cites the golden case that scores it. That field was
  // shape-validated and never resolved, so a case renamed, retired, or parked
  // left it dangling with nothing noticing - the same drift this file gates
  // for the checklist, on the sibling relationship. A retired or parked case
  // still counts: its id stays reserved precisely so the reason it left is
  // not lost.
  let known: Set<string>;
  try {
    const set = loadGoldenSet();
    known = new Set([
      ...(set.cases ?? []).map((c: { id: string }) => c.id),
      ...(set.retired ?? []).map((c: { id: string }) => c.id),
      ...(set.parked ?? []).map((c: { id: string }) => c.id),
    ]);
  } catch (err) {
    die(`cannot read the golden set: ${errorMessage(err)}`);
  }
  for (const o of catalogue.obligations)
    if (!known.has(o.goldenCase))
      findings.push(
        `${o.id}: goldenCase ${o.goldenCase} names no case in the golden set`,
      );

  for (const o of catalogue.obligations) {
    const entry = entries.find((e) => e.id === o.id);
    if (!entry) continue;
    const a = o.answerFields.join(', ');
    const b = entry.answerFields.join(', ');
    if (a !== b)
      findings.push(
        `${o.id}: answerFields are [${a}] in the catalogue but the entry's ` +
          `answer table lists [${b}]`,
      );
    // Which answers must quote a line is the difference between an answer that
    // cites and one that merely asserts, so the two forms have to agree on it
    // as exactly as they agree on the fields themselves. A human reading an
    // entry that does not ask for the quotation writes none.
    const c = normalizeCitedFields(o.citedFields)
      .map(citedFieldLabel)
      .join(', ');
    const d = entry.citedFields.map(citedFieldLabel).join(', ');
    if (c !== d)
      findings.push(
        `${o.id}: citedFields are [${c}] in the catalogue but the entry's ` +
          `**Cites** line reads [${d}]`,
      );
  }

  if (process.argv.includes('--print')) {
    console.log(`catalogue: ${wanted.join(', ')}`);
    for (const e of entries)
      console.log(
        `entry ${e.id}: ${e.answerFields.join(', ')} ` +
          `(cites ${e.citedFields.map(citedFieldLabel).join(', ') || 'nothing'})`,
      );
  }

  if (findings.length) {
    for (const f of findings) console.error(`review-checklist: ${f}`);
    process.exit(1);
  }
  console.log(
    `review-checklist: ${entries.length} entries match the obligation catalogue`,
  );
};

// Behind an isMain guard because this module's own contract tests import
// parseChecklist from it. Run at load, the comparison below calls
// process.exit(1) the moment the checklist and the catalogue disagree - so
// the test file would die before a single test ran, and precisely when the
// gate was doing its job. A checker whose tests cannot run while it is
// failing is the shape ADR 0043 exists to keep out of this directory.
if (isMain(import.meta.url)) main();
