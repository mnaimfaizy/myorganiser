/**
 * The one place a finding's evidence becomes a line of prose. The renderer
 * and the publisher both read it, so the fan-out over the evidence kinds is
 * pinned here and asserted at module load against the enum (ADR 0053); a
 * new kind cannot render as `undefined` in one place and a sentence in the
 * other.
 */
import type { Evidence, FindingEvidenceKind } from './schema.ts';
import { FINDING_EVIDENCE_KINDS } from './schema.ts';

/** The evidence of one kind, as that kind's renderer receives it. */
type EvidenceOf<K extends FindingEvidenceKind> = Extract<Evidence, { kind: K }>;

/**
 * A quote is one line of inline code. Newlines would let a spec author
 * start a Markdown heading, list, or fence inside the posted comment;
 * backticks would close the code span early. Both are flattened here, for
 * repo standards as well as spec text, so the rendering never depends on
 * who wrote the quote.
 */
export const inlineQuote = (text: unknown): string =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/`/g, "'")
    .trim();

export const EVIDENCE_TEXT: {
  [K in FindingEvidenceKind]: (e: EvidenceOf<K>) => string;
} = {
  executed: (e) =>
    `executed \`${e.command}\` (exit ${e.exitCode}, in \`${e.cwd}\`)`,
  // Quotes are fenced as one line of inline code, never interpolated as
  // Markdown; a spec quote is additionally labelled untrusted.
  cited: (e) =>
    e.sourceKind === 'spec'
      ? `cited spec (untrusted quote): \`${inlineQuote(e.quote)}\``
      : `cited standard: \`${inlineQuote(e.quote)}\``,
  inferred: (e) => `inferred: ${inlineQuote(e.reasoning)}`,
} as const;
for (const kind of FINDING_EVIDENCE_KINDS)
  if (typeof EVIDENCE_TEXT[kind] !== 'function')
    throw new Error(`EVIDENCE_TEXT lacks ${kind}`);

export const evidenceText = (finding: { evidence: Evidence }): string => {
  const { evidence } = finding;
  // The table is keyed by kind, so each entry receives exactly its own kind's
  // evidence; that is what the index cannot carry through on its own.
  const render = EVIDENCE_TEXT[evidence.kind] as (e: Evidence) => string;
  return render(evidence);
};
