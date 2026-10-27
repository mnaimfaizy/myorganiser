/**
 * Review obligations: the selected half of the review checklist
 * (docs/review/REVIEW_CHECKLIST.md).
 *
 * An obligation is not an instruction in the brief. The record says twice over
 * that an instruction written at the site of a miss does not produce a catch
 * (docs/research/2026-09-07-golden-replay-baseline.md,
 * docs/research/2026-09-09-wired-gate-qualifier-replay.md). What an obligation
 * changes is not what the reviewer is told but whether the check fires at all:
 * the trigger is matched HERE, outside the model, against the diff, and the
 * reviewer receives a worklist of concrete sites with a question it must answer
 * in writing. Noticing stops being the reviewer's job.
 *
 * The answers live BESIDE the finding contract, never inside it. ReportInputSchema
 * is a strict object and a report is accepted or rejected whole (ADR 0071), so a
 * malformed answer sheet folded into the report would reject the findings with it.
 * An unanswered obligation is a fact about the review's thoroughness, which is
 * neither a fact about the pipeline nor a judgment about the diff (ADR 0073), so
 * it is reported separately and fails nothing.
 *
 * An answer CITES rather than asserts. Every answer field that makes a claim
 * about source carries the file, the line, and the literal text at that line,
 * and `verifyCitation` compares the quotation to the tree at the reviewed head.
 * A mismatch is a fact about the pipeline and fails the check (ADR 0078); it is
 * never a finding, because a finding is about the diff and this is about the
 * reviewer.
 *
 * Everything here is pure. `select-obligations.ts` reads git and writes files.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { errorMessage } from '../lib/error-message.ts';
import type { GuardedEnum } from '../lib/enum-fanout-guarded.ts';
import { GUARDED_ENUMS } from '../lib/enum-fanout-guarded.ts';
import { globToRegExp } from '../lib/glob.ts';
import { citableLines } from '../lib/source-scan.ts';

// Re-exported: callers and tests of this module treat glob matching as
// part of the selector's surface. The implementation is shared with the
// Review Tier classifier, which is why it is not defined here.
export { globToRegExp };

/**
 * An obligation's `defectWhen`: `all`, `any`, or one answer field compared
 * for equality. Deliberately tiny — a richer predicate language would be a
 * second reviewer.
 */
export type DefectRule =
  | { all: DefectRule[] }
  | { any: DefectRule[] }
  | { field: string; equals?: unknown; notEquals?: unknown };

/** A cited answer field, in the one shape the worklist carries. */
export interface CitedFieldSpec {
  field: string;
  uncitedWhen?: string;
}

/**
 * A trigger path with its own patterns, and the site fields the catalogue
 * states for it (`siteFields` names which, so they are not fixed here).
 */
export interface TriggerPathObject {
  glob: string;
  addedPattern?: string;
  hunkPattern?: string;
  [fact: string]: unknown;
}

/** A trigger path: a bare glob, or a glob with its own patterns. */
export type TriggerPath = string | TriggerPathObject;

export interface ObligationTrigger {
  paths: TriggerPath[];
  addedPattern?: string;
  excludePaths?: string[];
  /** Expanded into concrete paths by `expandGuardedEnums` before validation. */
  guardedEnums?: Record<string, unknown>;
}

/** One catalogue entry, as `assertObligationCatalogue` has checked it. */
export interface Obligation {
  id: string;
  title: string;
  question: string;
  defect: string;
  answerFields: string[];
  citedFields: (string | CitedFieldSpec)[];
  seededFrom: string;
  goldenCase: string;
  defectWhen?: DefectRule;
  siteFields?: string[];
  trigger: ObligationTrigger;
}

/** The parsed `tools/config/review-obligations.json`. */
export interface ObligationCatalogue {
  schemaVersion: number;
  obligations: Obligation[];
}

/**
 * An entry as it arrives from the file. Each field is declared with the shape
 * this module requires of it, and the checks in
 * `assertObligationCatalogue` are what establish that shape — the
 * declaration is what lets those checks narrow, not a claim that the file is
 * valid. The index signature carries the site fields the catalogue states.
 */
export type ObligationCandidate = Partial<Obligation> &
  Record<string, unknown>;

/** A catalogue as it arrives from the file, before it is checked. */
export interface RawObligationCatalogue {
  schemaVersion?: unknown;
  obligations?: ObligationCandidate[];
}

/** One added line of a diff, as `parseAddedLines` reads it. */
export interface AddedLine {
  line: number;
  text: string;
  context?: string;
}

/** Every file the diff added lines to, with those lines. */
export type AddedLines = Map<string, AddedLine[]>;

/** A site an obligation fired at, with the facts the catalogue states. */
export interface WorklistSite {
  file: string;
  line: number;
  [fact: string]: unknown;
}

/** One obligation that fired, as the worklist carries it. */
export interface SelectedObligation {
  id: string;
  title: string;
  question: string;
  answerFields: string[];
  siteFields?: string[];
  citedFields: CitedFieldSpec[];
  defect: string;
  defectWhen?: DefectRule;
  sites: WorklistSite[];
  truncated: number;
}

/** A changed file and how many lines the diff added to it. */
export interface ChangedFile {
  file: string;
  added: number;
}

/** What `selectObligations` hands the reviewer. */
export interface Worklist {
  head: string;
  selected: SelectedObligation[];
  changedFiles: ChangedFile[];
}

export const OBLIGATION_CATALOGUE_SCHEMA_VERSION = 1;
export const OBLIGATIONS_PATH = join(
  'tools',
  'config',
  'review-obligations.json',
);

/** A worklist entry never carries more sites than this; the rest are counted. */
export const MAX_SITES_PER_OBLIGATION = 12;

const ID = /^[a-z0-9][a-z0-9-]*$/;

export class ObligationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObligationError';
  }
}

const compile = (pattern: string, where: string): RegExp => {
  try {
    return new RegExp(pattern);
  } catch (err) {
    throw new ObligationError(
      `${where}: bad pattern ${pattern}: ${errorMessage(err)}`,
    );
  }
};

export function assertObligationCatalogue(
  cat: unknown,
  source = 'obligations',
): ObligationCatalogue {
  function fail(msg: string): never {
    throw new ObligationError(`${source}: ${msg}`);
  }
  const candidate = (cat ?? {}) as RawObligationCatalogue;
  if (candidate.schemaVersion !== OBLIGATION_CATALOGUE_SCHEMA_VERSION)
    fail(`unsupported schemaVersion ${String(candidate.schemaVersion)}`);
  if (!Array.isArray(candidate.obligations) || candidate.obligations.length === 0)
    fail('obligations must be a non-empty array');
  const ids = new Set<string>();
  for (const o of candidate.obligations) {
    const where = `obligation ${o.id ?? '(no id)'}`;
    const id = o.id;
    if (typeof o.id !== 'string' || !ID.test(o.id))
      fail(`${where}: id must be a lowercase slug`);
    if (typeof id !== 'string') fail(`${where}: id must be a lowercase slug`);
    if (ids.has(id)) fail(`duplicate obligation id ${id}`);
    ids.add(id);
    for (const field of ['title', 'question', 'defect'] as const) {
      if (typeof o[field] !== 'string' || !o[field])
        fail(`${where}: ${field} must be a non-empty string`);
    }
    if (!Array.isArray(o.answerFields) || o.answerFields.length === 0)
      fail(`${where}: answerFields must name at least one field`);
    if (new Set(o.answerFields).size !== o.answerFields.length)
      fail(`${where}: duplicate answerFields`);
    // Every entry is bought by an incident. A catalogue grown from prudence is
    // the brief that did not work; this is what keeps it evidence.
    if (typeof o.seededFrom !== 'string' || !o.seededFrom)
      fail(
        `${where}: seededFrom must cite the incident that bought this entry`,
      );
    // A defectWhen that names a field outside answerFields can never fire,
    // which is the silent-no-op shape this repo keeps finding: the rule looks
    // present and asserts nothing. Validated here so a typo is a load error
    // rather than an obligation that quietly stops catching contradictions.
    if (o.defectWhen !== undefined) {
      const fields: string[] = [];
      const collect = (raw: unknown): void => {
        const r = raw as Partial<Record<'all' | 'any' | 'field', unknown>>;
        if (!r || typeof r !== 'object') fail(`${where}: bad defectWhen`);
        else if (Array.isArray(r.all)) r.all.forEach(collect);
        else if (Array.isArray(r.any)) r.any.forEach(collect);
        else if (typeof r.field === 'string') fields.push(r.field);
        else fail(`${where}: bad defectWhen`);
      };
      collect(o.defectWhen);
      if (fields.length === 0) fail(`${where}: defectWhen names no field`);
      for (const f of fields)
        if (!o.answerFields.includes(f))
          fail(`${where}: defectWhen names ${f}, which is not an answerField`);
    }
    // An answer field that makes a claim about source must quote that source.
    // Required, and required to be non-empty: an obligation asks what the code
    // actually does, so at least one of its fields is always a claim about a
    // line somebody can go and read. An entry with no cited field is an entry
    // whose answers nothing can be compared against, which is the state run 45
    // measured (docs/research/2026-09-10-the-answer-sheet-is-inert.md).
    if (!Array.isArray(o.citedFields) || o.citedFields.length === 0)
      fail(
        `${where}: citedFields must name at least one answerField that claims something about source`,
      );
    const cited = new Set<string>();
    for (const c of o.citedFields) {
      const field = typeof c === 'string' ? c : c?.field;
      if (typeof field !== 'string' || !field)
        fail(
          `${where}: a citedFields entry is a field name or an object with one`,
        );
      if (!o.answerFields.includes(field))
        fail(
          `${where}: citedFields names ${field}, which is not an answerField`,
        );
      if (cited.has(field))
        fail(`${where}: duplicate citedFields entry ${field}`);
      cited.add(field);
      if (typeof c === 'object' && c.uncitedWhen !== undefined) {
        // The one answer with no line to point at: `wiredBy: "none"` says the
        // gate is invoked nowhere, and nowhere has no file and no line. Any
        // other value must quote one.
        if (typeof c.uncitedWhen !== 'string' || !c.uncitedWhen)
          fail(`${where}: ${field}: uncitedWhen must be a non-empty string`);
      }
    }
    if (typeof o.goldenCase !== 'string' || !ID.test(o.goldenCase))
      fail(`${where}: goldenCase must name the case that scores this entry`);
    // Fields the CATALOGUE supplies and the selector carries into every site,
    // rather than fields the reviewer writes (ADR 0098). `coveringGate` is the
    // first: Golden Replay run 47 answered `gate: "deploy:pages:check"` — true,
    // citable, correctly non-defecting, and about the wrong gate, because the
    // one field with no citation requirement was also the one that selected
    // what every other field meant. A fact the catalogue can state is not a
    // choice the reviewer should be making.
    const siteFields: string[] = [];
    if (o.siteFields !== undefined) {
      if (!Array.isArray(o.siteFields) || o.siteFields.length === 0)
        fail(`${where}: siteFields must name at least one field, or be absent`);
      for (const f of o.siteFields) {
        if (typeof f !== 'string' || !f)
          fail(`${where}: a siteFields entry is a field name`);
        if (o.answerFields.includes(f))
          fail(
            `${where}: ${f} is in both siteFields and answerFields; a field the catalogue states is not one the reviewer answers`,
          );
        if (siteFields.includes(f))
          fail(`${where}: duplicate siteFields entry ${f}`);
        siteFields.push(f);
      }
    }
    const t = o.trigger;
    if (!t || typeof t !== 'object') fail(`${where}: trigger missing`);
    if (!Array.isArray(t.paths) || t.paths.length === 0)
      fail(`${where}: trigger.paths must name at least one glob`);
    for (const g of t.paths) {
      // A path is a bare glob, or a glob with its own addedPattern. One entry
      // often spans places that need different evidence: a version line in
      // package.json is a trigger, a whole generated directory is a trigger,
      // and the same regex cannot mean both.
      if (typeof g === 'string') {
        if (!g) fail(`${where}: bad trigger path`);
        // Required, not defaulted: this is what makes "no entry exists"
        // unrepresentable, leaving only "no gate covers this" — which is the
        // obligation's own defect condition and is spelled `wiredBy: "none"`.
        if (siteFields.length)
          fail(
            `${where}: ${g}: a trigger path must carry ${siteFields.join(', ')}`,
          );
        continue;
      }
      if (!g || typeof g !== 'object') fail(`${where}: bad trigger path`);
      if (typeof g.glob !== 'string' || !g.glob)
        fail(`${where}: a trigger path object needs a glob`);
      for (const f of siteFields)
        if (typeof g[f] !== 'string' || !g[f])
          fail(`${where}: ${g.glob}: trigger path must carry a non-empty ${f}`);
      if (g.addedPattern !== undefined) {
        if (typeof g.addedPattern !== 'string')
          fail(`${where}: ${g.glob}: addedPattern must be a string`);
        compile(g.addedPattern, `${where} (${g.glob})`);
      }
      if (g.hunkPattern !== undefined) {
        if (typeof g.hunkPattern !== 'string')
          fail(`${where}: ${g.glob}: hunkPattern must be a string`);
        compile(g.hunkPattern, `${where} (${g.glob})`);
      }
    }
    if (t.addedPattern !== undefined) {
      if (typeof t.addedPattern !== 'string')
        fail(`${where}: trigger.addedPattern must be a string`);
      compile(t.addedPattern, where);
    }
    if (t.excludePaths !== undefined) {
      if (
        !Array.isArray(t.excludePaths) ||
        t.excludePaths.some((g) => typeof g !== 'string' || !g)
      )
        fail(`${where}: trigger.excludePaths must be an array of globs`);
    }
  }
  return candidate as ObligationCatalogue;
}

/**
 * The catalogue's two spellings of a cited field — a bare name, or a name with
 * the one value that legitimately has no line to quote — reduced to one shape.
 * The worklist carries the normalized form, so the reviewer reading it and the
 * checker comparing against it see the same thing.
 *
 */
export const normalizeCitedFields = (
  citedFields: readonly (string | CitedFieldSpec)[] = [],
): CitedFieldSpec[] =>
  citedFields.map((c) =>
    typeof c === 'string'
      ? { field: c }
      : c.uncitedWhen === undefined
        ? { field: c.field }
        : { field: c.field, uncitedWhen: c.uncitedWhen },
  );

/**
 * The member values of a const-object enum in generated-client form
 * (`export const X = {` … `Name: 'value',` … `}`), or [] when the source or
 * the declaration is absent.
 *
 */
export const enumMemberValues = (
  source: string | null | undefined,
  enumName: string,
): string[] => {
  if (!source) return [];
  const lines = source.split('\n');
  const start = lines.findIndex((l) =>
    l.startsWith(`export const ${enumName} = {`),
  );
  if (start === -1) return [];
  const values: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*}/.test(line)) break;
    const m = /^\s*[A-Za-z_$][\w$]*\s*:\s*'([^']*)'/.exec(line);
    if (m) values.push(m[1]);
  }
  return values;
};

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Expand a `trigger.guardedEnums` entry into concrete trigger paths, one set
 * per enum enum:fanout:check guards (ADR 0053). The catalogue states what the
 * entry is about; which enums those are, where they are defined, and where
 * their bare values mean them is the checker's list, read here rather than
 * restated in a regex that can drift from it (#895).
 *
 * Per enum, first match wins, so the narrow paths come first:
 *   1. a member line inside the enum's own declaration, at `definedIn`;
 *   2. inside each `valueRoot`, the enum named, or one of its values used as a
 *      property name or string literal — the shape envelopeFromLocalVault had,
 *      which never wrote the enum's name (#537);
 *   3. anywhere else under apps/ or libs/, the enum named.
 *
 * `membersOf(guard)` supplies the values at the reviewed head. Without them,
 * shape 2 falls back to the enum-qualified pattern alone.
 *
 * @param cat the parsed catalogue
 * @param guarded the checker's list
 * @param membersOf the enum's member values at the reviewed head
 */
export const expandGuardedEnums = (
  cat: RawObligationCatalogue,
  guarded: readonly GuardedEnum[],
  membersOf: (guard: GuardedEnum) => string[] = () => [],
): RawObligationCatalogue => ({
  ...cat,
  obligations: (cat.obligations ?? []).map((o) => {
    const trigger = o.trigger;
    const spec = trigger?.guardedEnums;
    if (trigger === undefined || spec === undefined) return o;
    const { guardedEnums: _spec, ...rest } = trigger;
    const facts = { ...spec };
    const paths: TriggerPathObject[] = [];
    for (const g of guarded) {
      const name = escapeRegExp(g.enum);
      const qualified = `\\b${name}\\.[A-Z]`;
      paths.push({
        glob: g.definedIn,
        hunkPattern: `^export const ${name} = \\{`,
        addedPattern: "^\\s*[A-Z][A-Za-z0-9]*: '[^']*',?\\s*$",
        ...facts,
      });
      const values = membersOf(g).map(escapeRegExp);
      const byValue = values.length
        ? `${qualified}|\\.(?:${values.join('|')})\\b|['"](?:${values.join('|')})['"]`
        : qualified;
      for (const root of g.valueRoots ?? [])
        paths.push({ glob: `${root}**`, addedPattern: byValue, ...facts });
      for (const glob of ['apps/**', 'libs/**'])
        paths.push({ glob, addedPattern: qualified, ...facts });
    }
    // A declaration site lists the members because it is the list; the pin's
    // `satisfies` clause ties it back, so the checker exempts it and so does
    // this trigger.
    const excludePaths = [
      ...(rest.excludePaths ?? []),
      ...guarded.flatMap((g) => (g.declarationSites ?? []).map((d) => d.path)),
    ];
    return { ...o, trigger: { ...rest, paths, excludePaths } };
  }),
});

export const loadObligationCatalogue = (
  path = OBLIGATIONS_PATH,
  { membersOf }: { membersOf?: (guard: GuardedEnum) => string[] } = {},
): ObligationCatalogue =>
  assertObligationCatalogue(
    expandGuardedEnums(
      JSON.parse(readFileSync(path, 'utf8')),
      GUARDED_ENUMS,
      membersOf,
    ),
    path,
  );

/**
 * Added lines only, with their line numbers in the head file. A removal cannot
 * carry a site the reviewer is asked to inspect at `<head>`, and context lines
 * would fire an obligation on code the diff never touched.
 *
 * Each line also carries `context` when git's hunk header names one: the
 * nearest line above the hunk that starts a declaration. That is how a trigger
 * tells a member added to one enum from a member added to the next, in a
 * generated file that declares dozens, without reading the head tree.
 */
export const parseAddedLines = (diffText: string): AddedLines => {
  const byFile: AddedLines = new Map();
  let file: string | null = null;
  let lineNo = 0;
  let context = '';
  let previous = '';
  for (const raw of diffText.split('\n')) {
    const afterOld = previous.startsWith('--- ');
    previous = raw;
    // A file header is `+++ ` straight after `--- `; anywhere else a line
    // starting `+++ ` is added content. And `+++ /dev/null` above all: a deleted
    // file's header starts with `+`, and read as content it was an added line
    // of whichever file came before it.
    if (afterOld && raw.startsWith('+++ ')) {
      file = raw.startsWith('+++ b/') ? raw.slice(6) : null;
      if (file && !byFile.has(file)) byFile.set(file, []);
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)/.exec(raw);
      lineNo = m ? Number(m[1]) : 0;
      context = m ? m[2].trim() : '';
      continue;
    }
    if (!file) continue;
    if (raw.startsWith('+')) {
      const text = raw.slice(1);
      // `file` was put in the map when its header was read, so this is the
      // one list every added line of this file goes into.
      byFile
        .get(file)!
        .push(
          context ? { line: lineNo, text, context } : { line: lineNo, text },
        );
      lineNo += 1;
    } else if (raw.startsWith('-') || raw.startsWith('\\')) {
      // a removal or "\ No newline"; neither advances the head line number
    } else {
      lineNo += 1;
    }
  }
  return byFile;
};

/** One trigger path compiled: the glob, its patterns, and its stated facts. */
interface TriggerRule {
  glob: RegExp;
  pattern: RegExp | null;
  hunk?: RegExp | null;
  facts: Record<string, unknown>;
}

/**
 * Match the catalogue against one diff. Returns the worklist the reviewer is
 * handed: only obligations that fired, each with the sites that fired it.
 */
export const selectObligations = ({
  catalogue,
  addedLines,
  head,
  maxSites = MAX_SITES_PER_OBLIGATION,
}: {
  catalogue: ObligationCatalogue;
  addedLines: AddedLines;
  head: string;
  maxSites?: number;
}): Worklist => {
  const selected: SelectedObligation[] = [];
  for (const o of catalogue.obligations) {
    const entryPattern = o.trigger.addedPattern
      ? compile(o.trigger.addedPattern, o.id)
      : null;
    // The catalogue's own site fields, resolved per trigger path. The matching
    // rule was already computed here and thrown away; carrying it is what lets
    // a site arrive already knowing its Covering Gate (ADR 0098).
    const siteFields = o.siteFields ?? [];
    const facts = (p: TriggerPath): Record<string, unknown> =>
      Object.fromEntries(
        siteFields.map((f) => [f, typeof p === 'string' ? undefined : p[f]]),
      );
    const rules: TriggerRule[] = o.trigger.paths.map((p) =>
      typeof p === 'string'
        ? { glob: globToRegExp(p), pattern: entryPattern, facts: facts(p) }
        : {
            glob: globToRegExp(p.glob),
            pattern:
              p.addedPattern === undefined
                ? entryPattern
                : compile(p.addedPattern, `${o.id} (${p.glob})`),
            // Matched against the declaration enclosing the hunk, not the
            // line: a member line alone does not say which enum it is in.
            hunk:
              p.hunkPattern === undefined
                ? null
                : compile(p.hunkPattern, `${o.id} (${p.glob})`),
            facts: facts(p),
          },
    );
    // Kept out of every path at once. A site's answer can only be satisfied by
    // a finding anchored in the site's own file (raisedForSite), so a file the
    // entry is not about — a test listing members as fixtures — is not noise
    // but a contradiction the reviewer cannot avoid.
    const excluded = (o.trigger.excludePaths ?? []).map(globToRegExp);
    const sites: WorklistSite[] = [];
    for (const [file, lines] of addedLines) {
      if (excluded.some((g) => g.test(file))) continue;
      const rule = rules.find((r) => r.glob.test(file));
      if (!rule) continue;
      if (!rule.pattern) {
        // A path-only trigger fires on the file, at its first changed line.
        sites.push({ file, line: lines[0]?.line ?? 1, ...rule.facts });
        continue;
      }
      for (const { line, text, context = '' } of lines) {
        if (rule.hunk && !rule.hunk.test(context)) continue;
        if (rule.pattern.test(text)) sites.push({ file, line, ...rule.facts });
      }
    }
    if (sites.length === 0) continue;
    selected.push({
      id: o.id,
      title: o.title,
      question: o.question,
      answerFields: o.answerFields,
      // Named on the entry as well as spread onto each site, so a reader of the
      // worklist can tell a fact the catalogue stated from one the reviewer is
      // being asked for without diffing the two lists.
      ...(o.siteFields ? { siteFields: o.siteFields } : {}),
      // Normalized and carried for the same reason defectWhen is: the checker
      // reads it off the worklist, so an entry that arrives without it is not
      // an error but a citation nobody verifies. It is also what tells the
      // reviewer, in the file it is handed, which answers must quote a line.
      citedFields: normalizeCitedFields(o.citedFields),
      defect: o.defect,
      // Carried, or the contradiction check downstream reads undefined on
      // every entry and silently reports nothing. Its guard is
      // `want.defectWhen && ...`, so a missing field is not an error — it is
      // a gate that passes everything.
      defectWhen: o.defectWhen,
      sites: sites.slice(0, maxSites),
      truncated: Math.max(0, sites.length - maxSites),
    });
  }
  // Every file the diff added lines to, most lines first, so a run fact can be
  // held to a changed-file list the reviewer did not write (issue #1140).
  // A file that only lost lines has nothing at head to open, so it is left out.
  const changedFiles = [...addedLines]
    .filter(([, lines]) => lines.length > 0)
    .map(([file, lines]) => ({ file, added: lines.length }))
    .sort((a, b) => b.added - a.added || a.file.localeCompare(b.file));
  return { head, selected, changedFiles };
};

/** One answer per site the worklist named. */
/**
 * Evaluate an obligation's `defectWhen` against one written answer.
 *
 * Run 45 is why this exists. The obligations fired on exactly the right lines
 * and the reviewer answered every one of them; two of those answers were
 * simply false, and one was true and ignored. `import-confirm` wrote
 * `namesEverything: false` - which its own defect rule calls a finding in so
 * many words - and then raised nothing. A written answer is not a verified
 * answer, and the cheapest half of that gap needs no source access at all:
 * an answer that satisfies its own declared defect condition while raising no
 * finding contradicts itself, on the page, in one file.
 *
 * The grammar is deliberately tiny - `all`, `any`, and a field compared for
 * equality - because a predicate language rich enough to express judgment
 * would be a second reviewer, and this is a comparison, not an opinion.
 *
 * @param {object|undefined} rule
 * @param {Record<string, unknown>} answer
 * @returns {boolean} true when the answer meets the defect condition
 */
export function defectHolds(
  rule: unknown,
  answer: Record<string, unknown>,
): boolean {
  if (!rule || typeof rule !== 'object') return false;
  const r = rule as Partial<
    Record<'all' | 'any' | 'field' | 'equals' | 'notEquals', unknown>
  >;
  if (Array.isArray(r.all))
    return r.all.length > 0 && r.all.every((x) => defectHolds(x, answer));
  if (Array.isArray(r.any)) return r.any.some((x) => defectHolds(x, answer));
  if (typeof r.field !== 'string') return false;
  const actual = answer?.[r.field];
  if ('equals' in r) return actual === r.equals;
  if ('notEquals' in r) return actual !== r.notEquals;
  return false;
}

/** How much of a mismatching line is quoted back in the report. */
export const MAX_QUOTED_SOURCE = 200;

export const CitationSchema = z.strictObject({
  file: z.string().min(1),
  line: z.number().int().positive(),
  text: z.string().min(1),
});

export const AnswerSchema = z.strictObject({
  id: z.string().regex(ID),
  site: z.strictObject({ file: z.string().min(1), line: z.number().int() }),
  answer: z.record(z.string(), z.unknown()),
  // One citation per cited answer field, keyed by the field it backs. Optional
  // in the schema and required by the check: a sheet that carries none is
  // readable, and every cited field it left unquoted is a failure with a name.
  citations: z.record(z.string(), CitationSchema).optional(),
  raisedFindingIds: z.array(z.string()).optional(),
});

export const AnswerSheetSchema = z.strictObject({
  head: z.string().min(1),
  answers: z.array(AnswerSchema),
});

export type Citation = z.infer<typeof CitationSchema>;
export type Answer = z.infer<typeof AnswerSchema>;
export type AnswerSheet = z.infer<typeof AnswerSheetSchema>;

/** What `verifyCitation` concludes about one quotation. */
export type CitationVerdict =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      actual?: string;
      lineCount?: number;
    };

/** What `raisedForSite` reads of a reported finding. */
export interface RaisedFinding {
  ruleId?: string;
  location?: { file?: string } | undefined;
}

/** One site an answer is expected for, with what its answer must carry. */
interface ExpectedSite {
  id: string;
  site: WorklistSite;
  fields: string[];
  cited: CitedFieldSpec[];
  defectWhen?: DefectRule;
}

/** A cited field whose quotation could not be verified. */
export interface CitationFailure {
  key: string;
  id: string;
  site: WorklistSite;
  field: string;
  reason: string;
  cited?: Citation;
  actual?: string;
  lineCount?: number;
}

/** What `checkAnswers` reads beside the worklist and the sheet. */
export interface CheckAnswersIo {
  readSource?: (file: string) => string | null | undefined;
  findings?: readonly RaisedFinding[];
}

/** What `checkAnswers` concludes: completeness apart from trust. */
export interface AnswerCheck {
  head: string;
  expected: number;
  answered: number;
  unanswered: { key: string; id: string; site: WorklistSite }[];
  incomplete: { key: string; missing: string[] }[];
  unexpected: string[];
  contradictions: {
    key: string;
    id: string;
    site: WorklistSite;
    answer: Record<string, unknown>;
    readFrom: 'report' | 'declaration';
  }[];
  citations: { required: number; verified: number };
  citationFailures: CitationFailure[];
  complete: boolean;
  sound: boolean;
}

const siteKey = (
  id: string,
  site: { file: string; line: number },
): string => `${id}@${site.file}:${site.line}`;

/**
 * Whitespace is presentation. A line the reviewer copied out of a Read result
 * carries whatever indentation it had; comparing on collapsed whitespace means
 * a re-indented quote is the same quote and a different quote is not.
 */
const normalizeSource = (s: unknown): string =>
  String(s).replace(/\s+/g, ' ').trim();

/**
 * Compare one quotation to the tree at the reviewed head.
 *
 * This is the half of the answer sheet that run 45 showed was missing. The
 * reviewer wrote `slotChild: "Input"` for two sites whose direct child is a
 * positioning `div`, and nothing compared the writing to anything — a wrong
 * element name is a perfectly non-blank string. A quotation can still be true
 * about the wrong line, but it can no longer be invented: the file, the line,
 * and the text at that line are three facts a reader can check, and this
 * checks them.
 *
 * @param citation the quotation an answer carries
 * @param readSource file contents at head, or null
 */
export const verifyCitation = (
  citation: Citation,
  readSource: (file: string) => string | null | undefined,
): CitationVerdict => {
  // A quotation with no content in it is not a quotation. Whitespace is
  // presentation everywhere else in this comparison, which is exactly what
  // makes `text: " "` a forgery that would otherwise match every blank line in
  // the tree — the cheapest possible way to satisfy a citation without reading
  // anything, and the failure this check exists to stop.
  if (normalizeSource(citation.text) === '')
    return { ok: false, reason: 'quotes-nothing' };
  const source = readSource(citation.file);
  if (source === null || source === undefined)
    return { ok: false, reason: 'file-not-found' };
  // A file ending in a newline splits to a trailing empty element that is not
  // a line anybody can cite; citableLines drops it, so the count in the message
  // whose whole job is to say how many lines there are is the real one.
  const lines = citableLines(source);
  if (
    !Number.isInteger(citation.line) ||
    citation.line < 1 ||
    citation.line > lines.length
  )
    return { ok: false, reason: 'line-out-of-range', lineCount: lines.length };
  const actual = lines[citation.line - 1];
  if (normalizeSource(actual) !== normalizeSource(citation.text))
    return {
      ok: false,
      reason: 'text-differs',
      actual: actual.trim().slice(0, MAX_QUOTED_SOURCE),
    };
  return { ok: true };
};

/**
 * The rule id the catalogue mirrors for an obligation. One per entry, asserted
 * in both directions by `review:rules:check`, which is what makes it usable
 * here: the reviewer picks it from a list it was handed, so a finding raised
 * for an obligation is findable in the report without anybody agreeing on a
 * second identifier.
 */
export const obligationRuleId = (id: string): string => `obligation-${id}`;

/**
 * Did the reviewer actually raise the finding its own answer says is there?
 *
 * Read out of the report when there is one, and only declared otherwise. The
 * declaration alone cannot be the check: a finding's id is a hash the
 * validator computes after the sheet is written, so a reviewer that raised the
 * finding correctly has no id to write and would be failed for it, while any
 * string at all would pass. Same failure as the one ADR 0078 is about — a
 * written answer is not a verified answer — one level up.
 *
 * A finding counts for a site when it carries the obligation's mirrored rule id
 * and is anchored in the site's file, or carries no location at all (the
 * contract allows a located-nowhere finding, and refusing to count one would
 * fail a reviewer for using the contract as written).
 *
 * @param id the obligation id
 * @param site the site the answer is about
 * @param answer the reviewer's answer for that site
 * @param findings the report's findings, when there is a report
 */
export const raisedForSite = (
  id: string,
  site: { file: string },
  answer: { raisedFindingIds?: string[] },
  findings: readonly RaisedFinding[] | undefined,
): { raised: boolean; readFrom: 'report' | 'declaration' } => {
  if (!Array.isArray(findings))
    return {
      raised: (answer.raisedFindingIds ?? []).length > 0,
      readFrom: 'declaration',
    };
  const want = obligationRuleId(id);
  const raised = findings.some(
    (f) =>
      f?.ruleId === want &&
      (f.location?.file === undefined || f.location.file === site.file),
  );
  return { raised, readFrom: 'report' };
};

/**
 * Two kinds of fact, kept apart.
 *
 * **Completeness is never a verdict.** An unanswered obligation says the
 * review was thin, which is worth knowing and is not grounds to reject a
 * report that met its contract.
 *
 * **A citation that does not match its source is.** So is an answer that meets
 * its own defect condition while raising no finding. Both are facts about the
 * reviewer rather than judgments about the diff, which is what makes them
 * eligible to fail a check at all (ADR 0073, ADR 0078). Neither becomes a
 * finding: a finding is about the code under review, and this is not.
 *
 * @param worklist the selector's output
 * @param sheet the reviewer's answers
 * @param io `readSource` reads a file at the reviewed head; `findings` is the
 *   report the reviewer wrote, which is how a raised finding is confirmed
 *   rather than taken on trust.
 */
export const checkAnswers = (
  worklist: Worklist,
  sheet: AnswerSheet,
  { readSource, findings }: CheckAnswersIo = {},
): AnswerCheck => {
  const expected = new Map<string, ExpectedSite>();
  for (const o of worklist.selected) {
    for (const site of o.sites)
      expected.set(siteKey(o.id, site), {
        id: o.id,
        site,
        fields: o.answerFields,
        // Normalized again here rather than trusted: the selector writes the
        // object form, and a worklist written by hand is as likely to carry
        // the catalogue's bare-name spelling.
        cited: normalizeCitedFields(o.citedFields ?? []),
        defectWhen: o.defectWhen,
      });
  }
  // Refused rather than skipped, twice over. A citation check with no tree to
  // read, and an entry that asks for no citation at all, are the same silent
  // no-op: every sheet comes back sound and nothing says why. The catalogue
  // requires at least one cited field on every entry, so an entry that arrives
  // here without one did not come from the selector at this head — a stale
  // worklist or one written by hand — and waving it through is exactly the
  // state run 45 was in.
  for (const [key, want] of expected)
    if (want.cited.length === 0)
      throw new ObligationError(
        `checkAnswers: ${key} names no cited field, so nothing in its answer could be compared to the tree`,
      );
  if (expected.size > 0 && typeof readSource !== 'function')
    throw new ObligationError(
      'checkAnswers: this worklist has cited fields and no readSource, so no quotation could be compared to anything',
    );
  const seen = new Set<string>();
  const unanswered: AnswerCheck['unanswered'] = [];
  const unexpected: string[] = [];
  const incomplete: AnswerCheck['incomplete'] = [];
  const contradictions: AnswerCheck['contradictions'] = [];
  const citationFailures: CitationFailure[] = [];
  let citationsRequired = 0;
  let citationsVerified = 0;
  for (const a of sheet.answers) {
    const key = siteKey(a.id, a.site);
    const want = expected.get(key);
    if (!want) {
      unexpected.push(key);
      continue;
    }
    seen.add(key);
    // A field is answered when it carries a value. An empty or whitespace-only
    // string is the shape that slips through: it satisfies a presence test
    // while telling a reader nothing, and every obligation's defect rule is a
    // comparison over what was actually written.
    const missing = want.fields.filter((f) => {
      const v = a.answer[f];
      return v === undefined || v === null || String(v).trim() === '';
    });
    if (missing.length) incomplete.push({ key, missing });
    // Every cited field that carries a real answer must quote a real line. A
    // field left blank is already reported as incomplete, so it is not failed
    // twice, and a field whose answer is the obligation's `uncitedWhen` value
    // has no line to quote by construction.
    for (const spec of want.cited) {
      if (missing.includes(spec.field)) continue;
      if ('uncitedWhen' in spec && a.answer[spec.field] === spec.uncitedWhen)
        continue;
      citationsRequired += 1;
      const citation = a.citations?.[spec.field];
      if (!citation) {
        citationFailures.push({
          key,
          id: want.id,
          site: want.site,
          field: spec.field,
          reason: 'uncited',
        });
        continue;
      }
      // `readSource` is established above: a worklist with a cited field and
      // no reader was refused, and only such a worklist reaches a citation.
      const verdict = verifyCitation(citation, readSource!);
      if (verdict.ok) {
        citationsVerified += 1;
        continue;
      }
      citationFailures.push({
        key,
        id: want.id,
        site: want.site,
        field: spec.field,
        reason: verdict.reason,
        cited: citation,
        ...(verdict.actual === undefined ? {} : { actual: verdict.actual }),
        ...(verdict.lineCount === undefined
          ? {}
          : { lineCount: verdict.lineCount }),
      });
    }
    // The self-contradiction. An answer that meets its obligation's own
    // defect condition and raises nothing is not a judgment call the
    // reviewer is entitled to make: the catalogue already decided that this
    // answer is a finding. Only checked when the answer is complete, so a
    // blank field is reported once as incomplete rather than twice.
    if (
      !missing.length &&
      want.defectWhen &&
      defectHolds(want.defectWhen, a.answer)
    ) {
      const raised = raisedForSite(want.id, want.site, a, findings);
      if (!raised.raised)
        contradictions.push({
          key,
          id: want.id,
          site: want.site,
          answer: a.answer,
          readFrom: raised.readFrom,
        });
    }
  }
  for (const [key, want] of expected) {
    if (!seen.has(key)) unanswered.push({ key, id: want.id, site: want.site });
  }
  return {
    head: worklist.head,
    expected: expected.size,
    answered: seen.size,
    unanswered,
    incomplete,
    unexpected,
    contradictions,
    citations: { required: citationsRequired, verified: citationsVerified },
    citationFailures,
    complete:
      unanswered.length === 0 && incomplete.length === 0 && expected.size > 0,
    // Thoroughness is `complete`; this is trust. A sound sheet is one whose
    // claims about source hold and whose answers do not contradict their own
    // defect rules — the two things a check may fail on.
    sound: contradictions.length === 0 && citationFailures.length === 0,
  };
};
