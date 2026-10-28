#!/usr/bin/env node
// Asserts that no ADR in docs/adr/ carries the status `proposed` (ADR 0097).
//
//   node tools/scripts/check-adr-status.ts
//
// On 2026-09-22 five ADRs — 0090, 0092, 0093, 0094, 0095 — sat `proposed` on
// main after the pull requests introducing them had merged. This was the
// second occurrence: an identical sweep of four ADRs bought the AGENTS.md
// sentence "an ADR is `proposed` while its pull request is open and `accepted`
// once it merges". The sentence did not hold, because a sentence is not an
// assertion (ADR 0085).
//
// The obvious check — "an ADR merged on main does not say `proposed`" — cannot
// be written honestly. On a pull_request CI checks out refs/pull/N/merge, and
// in that tree an ADR the pull request is *adding* is indistinguishable by
// content from one that merged last month. Telling them apart needs git, and
// the check would then fire one pull request late, failing an author over a
// file they did not touch.
//
// ADR 0097 removes the window instead: an ADR is authored `accepted`, because
// the number is already a claim-until-merged (ADR 0042) and nobody writes the
// *number* differently while the pull request is open. `proposed` then has no
// correct moment, and the assertion collapses to a directory listing.
//
// Deliberately pure: a directory listing, no git, like check-adr-numbering.ts.
//
// ASSERTS: no ADR's status slot reads `proposed`, in either form the corpus
// uses — a `## Status` section body (76 ADRs) or YAML frontmatter `status:`
// (6 ADRs: 0005-0008, 0011, 0089). Reading both is load-bearing; a check that
// knew only the section form would pass a frontmatter `status: proposed` by
// not looking at it.
//
// DOES NOT ASSERT that an ADR *has* a status. 13 ADRs carry none — 0001, 0002,
// 0016, 0017, 0021-0023, 0038-0041, 0043, 0046 — because the authoring template
// (.agents/skills/domain-modeling/ADR-FORMAT.md) marks Status optional and an
// ADR may legitimately be one paragraph. Requiring one is a separate decision
// about the format, not about this drift, and nothing was ever broken by an
// ADR that stayed silent. It is omitted deliberately, not overlooked.
//
// DOES NOT VALIDATE the other status values. `accepted`, `deprecated` and
// `superseded by ADR-NNNN` are prose whose correctness is a claim about another
// decision's state, which this script cannot read. Per ADR 0085 the header
// claims only the one direction the code runs.
//
// This check cannot catch the drift that motivated it. Those five ADRs said
// `proposed` correctly under the old rule. It prevents the next one by
// abolishing the state, not by detecting a stale one.
//
// Exit 0 = no ADR says proposed. Exit 1 = one does. Exit 2 = could not run.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'docs/adr';
const ADR_FILENAME = /^\d{4}-.*\.md$/;
const FORBIDDEN = 'proposed';

const fail: (msg: string) => never = (msg) => {
  console.error(`adr-status: ${msg}`);
  process.exit(2);
};

// The first non-blank line of the `## Status` section, stopping at the next
// `##` heading so an empty Status section does not borrow the next section's
// opening sentence and report it as a status.
export function statusFromSection(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Status\s*$/i.test(l));
  if (start === -1) return null;
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) return null;
    if (line.trim()) return line.trim();
  }
  return null;
}

// `status: accepted` inside a leading `---` frontmatter block. Only the leading
// block counts: a `status:` line in a prose table further down the file is not
// this ADR's status, which is how 0002's label glossary would otherwise read as
// one.
export function statusFromFrontmatter(text: string): string | null {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return null;
  for (const line of lines.slice(1, end)) {
    const m = /^status:\s*(.+)$/i.exec(line.trim());
    if (m) return m[1].trim();
  }
  return null;
}

export function isProposed(status: string | null): boolean {
  return status !== null && status.trim().toLowerCase() === FORBIDDEN;
}

export interface ProposedAdr {
  path: string;
  form: string;
  status: string | null;
}

export interface FindProposedAdrsOptions {
  readdir?: (dir: string) => string[];
  read?: (path: string, encoding: 'utf8') => string;
}

export function findProposedAdrs(
  dir: string,
  { readdir = readdirSync, read = readFileSync }: FindProposedAdrsOptions = {},
): ProposedAdr[] {
  const offenders: ProposedAdr[] = [];
  for (const name of readdir(dir)
    .filter((n) => ADR_FILENAME.test(n))
    .sort()) {
    const path = join(dir, name);
    const text = read(path, 'utf8');
    const forms: [string, string | null][] = [
      ['## Status section', statusFromSection(text)],
      ['frontmatter status:', statusFromFrontmatter(text)],
    ];
    for (const [form, status] of forms) {
      if (isProposed(status)) offenders.push({ path, form, status });
    }
  }
  return offenders;
}

function main() {
  if (!existsSync(ROOT)) fail(`${ROOT} does not exist`);

  let offenders: ProposedAdr[];
  try {
    offenders = findProposedAdrs(ROOT);
  } catch (err) {
    fail(
      `could not read ${ROOT}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (offenders.length === 0) {
    const count = readdirSync(ROOT).filter((n) => ADR_FILENAME.test(n)).length;
    console.log(`adr-status: ${count} ADRs, none proposed`);
    process.exit(0);
  }

  for (const { path, form, status } of offenders) {
    console.error(
      `adr-status: ${path} — ${form} reads "${status}". An ADR is authored ` +
        `"accepted" (ADR 0097); "proposed" has no correct moment.`,
    );
  }
  process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('check-adr-status.ts')) main();
