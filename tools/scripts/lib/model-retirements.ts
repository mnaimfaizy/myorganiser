/**
 * Retirement-table reading for the agent model audit (ADR 0013).
 *
 * `audit-agent-model-catalog.mjs` asks whether a pinned model term still
 * appears anywhere in a first-party catalog page. For Copilot that question
 * cannot see a retirement: a retired model leaves the supported-models table
 * but stays on the same page under "Model retirement history", so the term is
 * still found. In October 2026 (issue #985) `Gemini 3.6 Flash` and
 * `Kimi K2.7 Code` were retired while ten agents pinned them, and the audit
 * reported only a changed snapshot hash.
 *
 * The audit flattens a page to one line per text node, so a table row arrives
 * as consecutive lines: model name, retirement date, suggested alternative. A
 * footnote marker on the name is a line of its own between the name and the
 * date. Rows are therefore anchored on the date line, and the name is the
 * nearest line above it that is not a footnote marker.
 *
 * A name matches a term only when the two are equal. `GPT-5.1` is not retired
 * because `GPT-5.1-Codex` is.
 *
 * Run the tests with: yarn agents:models:test
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FOOTNOTE_MARKER = /^\d{1,2}$/;
const HEADER = ['model name', 'retirement date', 'suggested alternative'];

/** A row is at most name, marker(s), date, alternative; past this the table has ended. */
const MAX_LINES_BETWEEN_DATES = 6;

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface RetirementRow {
  model: string;
  date: string;
}

export interface RetirementTable {
  tableFound: boolean;
  rows: RetirementRow[];
}

/** `lines` has one entry per text node, as `htmlToLines` produces. */
export function parseRetirementTable(lines: string[]): RetirementTable {
  const headerIndex = lines.findIndex((_, index) =>
    HEADER.every(
      (cell, offset) => normalize(lines[index + offset] ?? '') === cell,
    ),
  );
  if (headerIndex < 0) return { tableFound: false, rows: [] };

  const rows: RetirementRow[] = [];
  const firstRow = headerIndex + HEADER.length;
  let lastDateIndex = firstRow - 1;
  for (let index = firstRow; index < lines.length; index += 1) {
    if (index - lastDateIndex > MAX_LINES_BETWEEN_DATES) break;
    if (!ISO_DATE.test(lines[index])) continue;

    let nameIndex = index - 1;
    while (nameIndex >= firstRow && FOOTNOTE_MARKER.test(lines[nameIndex])) {
      nameIndex -= 1;
    }
    if (nameIndex >= firstRow && nameIndex > lastDateIndex) {
      rows.push({ model: lines[nameIndex], date: lines[index] });
    }
    lastDateIndex = index;
  }
  return { tableFound: true, rows };
}

export interface RetirementFindingsInput {
  harness: string;
  /** Terms an agent is pinned to. */
  assignedTerms: string[];
  /** Terms the policy tracks without pinning. */
  requiredTerms: string[];
  rows: RetirementRow[];
  /** Run date as `YYYY-MM-DD`. */
  today: string;
}

/** One finding per retired or soon-retired term. */
export function retirementFindings({
  harness,
  assignedTerms,
  requiredTerms,
  rows,
  today,
}: RetirementFindingsInput): string[] {
  const dateByModel = new Map(rows.map((row) => [normalize(row.model), row]));
  const assigned = new Set(assignedTerms.map(normalize));
  const terms = [...new Set([...assignedTerms, ...requiredTerms])];

  return terms.flatMap((term) => {
    const row = dateByModel.get(normalize(term));
    if (!row) return [];
    const subject = `${harness}: ${assigned.has(normalize(term)) ? 'pinned' : 'tracked'} model "${term}"`;
    return [
      row.date <= today
        ? `${subject} is listed as retired (retirement date ${row.date}).`
        : `${subject} is scheduled for retirement on ${row.date}.`,
    ];
  });
}
