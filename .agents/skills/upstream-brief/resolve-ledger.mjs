#!/usr/bin/env node
// Prints what an Upstream Brief run would remember (ADR 0084 items 11 and 12),
// so a human can see the carry-forward before any research hop spends a token.
//
//   node .agents/skills/upstream-brief/resolve-ledger.mjs [--repo <dir>]
//
// For every Ecosystem the adapter declares, it resolves the new Baseline the
// same way `resolve-baseline.mjs` does, finds that Ecosystem's ledger — the
// latest committed structured report in the brief directory that carries it —
// and reports which checked-and-clear claims survive into this run, which go
// back on the research list and why, and which declined Upstream
// Opportunities are still suppressed at the new Baseline.
//
// WHICH TREE THE INSTRUCTION TEXT IS READ FROM
//   The working tree, which is the tree a run about to be made is about. A
//   frozen report is a different question — its citations are compared to the
//   commit it records, and `yarn upstream:briefs:check` is what does that.
//
// NOT A GATE. It asserts nothing and always exits 0, exactly like
// `resolve-baseline.mjs`: a declined entry pointing at a deleted file is a
// failure, and the gate that fails on it is `check-upstream-briefs.ts` in
// `tools/scripts/`, where the Meta-Gate can see it. This command reports the
// same condition so a developer meets it before CI does.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  applyDeclinedOpportunities,
  carryForwardCheckedAndClear,
  normalizeDeclinedEntry,
  parseDeclinedOpportunitiesFromConfig,
  selectLatestLedgerReport,
  validateDeclinedOpportunities,
} from './ledger.mjs';
import {
  parseEcosystemsFromConfig,
  resolveDeclaredEcosystems,
} from './resolve-baseline.mjs';

const LABEL = 'upstream-ledger';
const CONFIG_PATHS = [
  'upstream-brief.config.yml',
  'upstream-brief.config.yaml',
  'upstream-brief.config.json',
];
/** ADAPTER.md's default, used when the adapter declares no brief directory. */
export const DEFAULT_BRIEF_DIR = 'docs/research';

/**
 * Read one thing out of the adapter, in whichever dialect it is written in.
 *
 * One walker for all three readers below, because three copies of "find the
 * config file, branch on JSON, fall back to the documented default" are three
 * chances to disagree about which file wins and what an absent key means —
 * and they did. ADAPTER.md's lookup order is over **files**: the first config
 * file present is the adapter, and a key it does not carry takes the default
 * rather than sending the search on to a file the repo also did not choose.
 *
 * A reader returns `undefined` for "this adapter does not say", which is the
 * one thing a legitimate value is never allowed to be.
 */
function fromAdapter(read, { json, yaml, fallback }) {
  for (const path of CONFIG_PATHS) {
    const text = read(path);
    if (text === null || text === undefined) continue;
    if (path.endsWith('.json')) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return fallback;
      }
      return json(parsed) ?? fallback;
    }
    return yaml(text) ?? fallback;
  }
  return fallback;
}

/**
 * The adapter's declined entries. Both dialects land on
 * `normalizeDeclinedEntry`, which is keyed off `DECLINED_ADAPTER_KEYS` — the
 * one table of what a declined entry is made of. A second hand-written list
 * here would mean a key added to that table arrives required by the validator
 * and never populated from a `.json` adapter.
 */
export const readDeclinedOpportunities = (read) =>
  fromAdapter(read, {
    json: (parsed) =>
      Array.isArray(parsed?.declined_opportunities)
        ? parsed.declined_opportunities.map(normalizeDeclinedEntry)
        : undefined,
    yaml: parseDeclinedOpportunitiesFromConfig,
    fallback: [],
  });

/**
 * The leads the adapter declares, which is what "this Ecosystem still exists"
 * means when a declined entry names one (ADR 0084 item 12).
 */
export const readDeclaredLeads = (read) =>
  fromAdapter(read, {
    json: (parsed) =>
      Array.isArray(parsed?.ecosystems)
        ? parsed.ecosystems.map((eco) => String(eco?.lead ?? '').trim())
        : undefined,
    yaml: (text) => parseEcosystemsFromConfig(text).map((eco) => eco.lead),
    fallback: [],
  });

/** `brief_dir:`, matched rather than parsed — see `check-upstream-briefs.ts`. */
export const readBriefDir = (read) =>
  fromAdapter(read, {
    json: (parsed) =>
      typeof parsed?.brief_dir === 'string' && parsed.brief_dir.trim()
        ? parsed.brief_dir.trim()
        : undefined,
    yaml: (text) =>
      text.match(/^brief_dir:[ \t]*['"]?([^'"\s#]+)['"]?[ \t]*(?:#.*)?$/m)?.[1],
    fallback: DEFAULT_BRIEF_DIR,
  });

/** Every structured report committed in the brief directory, newest last. */
export function readCommittedReports(read, list, briefDir) {
  const names = list(briefDir);
  if (names === null || names === undefined) return [];
  const reports = [];
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    const path = `${briefDir}/${name}`;
    const text = read(path);
    if (text === null || text === undefined) continue;
    try {
      reports.push({ path, report: JSON.parse(text) });
    } catch {
      // A report that is not JSON is the gate's business, not this command's.
    }
  }
  return reports;
}

/**
 * Pure over its inputs, so the contract suite drives fixtures rather than the
 * repository.
 *
 * @param {object} io
 * @param {(path: string) => string|null} io.read a repo file, or null
 * @param {(dir: string) => string[]|null} io.list directory entries, or null
 * @param {(path: string) => boolean} [io.exists] does the current tree carry
 *   that path — asked only of a declined entry's local site, and the same
 *   question the gate asks. It is a seam rather than `read(path) !== null`
 *   because the two must agree: a site that is a directory, or a file this
 *   process cannot read, exists for the gate and would read as
 *   `site-not-found` here, and this command's whole claim is that it reports
 *   the condition `check-upstream-briefs.ts` fails on.
 * @param {Array<{lead: string, ok: boolean, baseline?: string, reason?: string}>} io.resolved
 *   the Baseline resolution for every declared Ecosystem
 * @returns {{lines: string[], briefDir: string}}
 */
export function ledgerStatus({
  read,
  list,
  resolved,
  exists = (path) => read(path) !== null && read(path) !== undefined,
}) {
  const briefDir = readBriefDir(read);
  const reports = readCommittedReports(read, list, briefDir);
  const declined = readDeclinedOpportunities(read);
  const lines = [];

  if (resolved.length === 0)
    lines.push(`${LABEL}: no Ecosystem declared — nothing to remember`);

  for (const ecosystem of resolved) {
    if (!ecosystem.ok) {
      lines.push(`${LABEL}: ${ecosystem.lead} — FAILED: ${ecosystem.reason}`);
      continue;
    }
    const current = { lead: ecosystem.lead, baseline: ecosystem.baseline };
    const found = selectLatestLedgerReport(reports, ecosystem.lead);
    if (!found) {
      // Said out loud: a first run has no ledger and researches everything,
      // which must not read like a run that carried nothing forward.
      lines.push(
        `${LABEL}: ${ecosystem.lead} — no committed report in ${briefDir} ` +
          `carries this Ecosystem; the first run at Baseline ${ecosystem.baseline} ` +
          'researches everything',
      );
      continue;
    }

    const { carriedForward, toResearch } = carryForwardCheckedAndClear({
      previous: found.report,
      ecosystems: [current],
      readCurrent: read,
    });
    lines.push(
      `${LABEL}: ${ecosystem.lead} — ledger ${found.path} (${found.report.date}); ` +
        `at Baseline ${ecosystem.baseline}, ${carriedForward.length} claim(s) ` +
        `carried forward, ${toResearch.length} researched again`,
    );
    for (const claim of carriedForward)
      lines.push(`  carried: ${claim.claim} (holds for ${claim.holdsFor})`);
    for (const claim of toResearch)
      lines.push(
        `  research: ${claim.claim} — ${claim.reason}: ${claim.detail}`,
      );

    const opportunities = Array.isArray(found.ecosystem?.opportunities)
      ? found.ecosystem.opportunities
      : [];
    const { suppressed, resurfaced } = applyDeclinedOpportunities(
      opportunities,
      declined,
      current,
    );
    for (const { opportunity, entry } of suppressed)
      lines.push(
        `  declined: ${opportunity.technique} — suppressed at ${ecosystem.baseline} ` +
          `(${entry.baselineRange}): ${entry.reason}`,
      );
    for (const item of resurfaced)
      lines.push(
        `  resurfaced: ${item.opportunity.technique} — ${item.reason}: ${item.detail}`,
      );
  }

  const problems = validateDeclinedOpportunities(declined, {
    knownEcosystems: resolved.map((eco) => eco.lead),
    exists,
  }).problems;
  if (declined.length === 0)
    lines.push(`${LABEL}: no declined Opportunity recorded in the adapter`);
  for (const problem of problems)
    lines.push(
      `${LABEL}: declined_opportunities[${problem.index}] (${problem.entry.ecosystem} ` +
        `→ ${problem.entry.site}) — ${problem.reason}: ${problem.detail}. ` +
        'Run `yarn upstream:briefs:check` — this fails there.',
    );

  return { lines, briefDir };
}

function main(argv) {
  const flagIndex = argv.indexOf('--repo');
  const repo =
    flagIndex === -1 ? process.cwd() : argv[flagIndex + 1] || process.cwd();

  const read = (path) => {
    const absolute = join(repo, path);
    if (!existsSync(absolute)) return null;
    try {
      return readFileSync(absolute, 'utf8');
    } catch {
      // A directory, or something unreadable: absent, for this command's
      // purposes, which only ever asks for files.
      return null;
    }
  };
  const list = (dir) => {
    const absolute = join(repo, dir);
    if (!existsSync(absolute)) return null;
    return readdirSync(absolute, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  };

  const { results } = resolveDeclaredEcosystems({ repo });
  const exists = (path) => existsSync(join(repo, path));
  for (const line of ledgerStatus({ read, list, exists, resolved: results })
    .lines)
    console.log(line);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`)
  main(process.argv.slice(2));
