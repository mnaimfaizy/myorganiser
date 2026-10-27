/**
 * Detect when an Ecosystem's Baseline has left the range recorded in its
 * latest committed Upstream Brief report (ADR 0084 item 14).
 *
 * After a dependency mutation, checks each Ecosystem declared in the
 * upstream-brief adapter config. For each one with a committed report:
 *   1. Resolves the current installed Baseline
 *   2. Reads the latest committed report
 *   3. Checks if any checkedAndClear item's holdsFor range no longer covers
 *      the current Baseline
 *   4. If so, the Ecosystem is outside its recorded range and needs a new brief
 *
 * Falls back gracefully: missing config, missing reports, uninstalled
 * ecosystems, or unreadable ranges all result in no suggestion.
 *
 * Version comparison, range parsing, adapter reading, and ledger lookup are
 * the skill's — imported rather than re-implemented, the same way
 * `check-upstream-briefs.ts` does, so a range this hook treats as covering
 * is a range `ledger.mjs` would carry forward (ADR 0018 keeps that logic in
 * the skill; this file is allowed to import it).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  RESEARCH,
  carryForwardCheckedAndClear,
  selectLatestLedgerReport,
} from '../../../.agents/skills/upstream-brief/ledger.mjs';
import {
  DEFAULT_BRIEF_DIR,
  readBriefDir,
  readCommittedReports,
  readDeclaredLeads,
} from '../../../.agents/skills/upstream-brief/resolve-ledger.mjs';

/** One Ecosystem's entry in a committed report, as far as this hook reads it. */
interface ReportEcosystem {
  lead?: unknown;
  baseline?: unknown;
  checkedAndClear?: unknown;
}

/** A committed report, plus the file it was read from. */
export interface LatestReport {
  ecosystems: (ReportEcosystem | null | undefined)[];
  reportFile: string;
}

/** The adapter config, as far as this hook reads it. */
export interface UpstreamBriefConfig {
  ecosystems: { lead: string }[];
  brief_dir: string;
}

/** Same lookup order as `resolve-ledger.mjs` — the first file present wins. */
const ADAPTER_FILES = [
  'upstream-brief.config.yml',
  'upstream-brief.config.yaml',
  'upstream-brief.config.json',
];

/**
 * @param root join relative paths onto this directory; `null` leaves paths
 *   unchanged (absolute brief directories in the unit tests).
 */
function makeFsIo(root: string | null = null) {
  const resolvePath = (path: string) =>
    root == null ? path : join(root, path);
  return {
    read(path: string): string | null {
      const absolute = resolvePath(path);
      if (!existsSync(absolute)) return null;
      try {
        return readFileSync(absolute, 'utf8');
      } catch {
        return null;
      }
    },
    list(dir: string): string[] | null {
      const absolute = resolvePath(dir);
      if (!existsSync(absolute)) return null;
      return readdirSync(absolute, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
    },
  };
}

function hasAdapter(repoDir: string): boolean {
  return ADAPTER_FILES.some((name) => existsSync(join(repoDir, name)));
}

/**
 * Resolve the installed version of a package from node_modules/package.json
 * (the lead package only — not companions).
 */
export function resolveInstalledVersion(
  packageName: string,
  repoDir = process.cwd(),
): string | null {
  const packageJsonPath = join(
    repoDir,
    'node_modules',
    packageName,
    'package.json',
  );
  if (!existsSync(packageJsonPath)) return null;

  try {
    const content = readFileSync(packageJsonPath, 'utf8');
    const pkg = JSON.parse(content) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

/**
 * Load the adapter the same way the skill does. Returns null when no config
 * file is present, so a first-time clone does not look like an empty Ecosystem
 * list.
 */
export function loadConfig(
  repoDir = process.cwd(),
): UpstreamBriefConfig | null {
  if (!hasAdapter(repoDir)) return null;
  const { read } = makeFsIo(repoDir);
  const leads: string[] = readDeclaredLeads(read);
  return {
    ecosystems: leads.filter(Boolean).map((lead) => ({ lead })),
    brief_dir: readBriefDir(read) ?? DEFAULT_BRIEF_DIR,
  };
}

/**
 * The latest committed report that carries this Ecosystem, or null.
 */
export function findLatestReport(
  ecosystemLead: string,
  briefDir: string,
): LatestReport | null {
  const { read, list } = makeFsIo();
  const found = selectLatestLedgerReport(
    readCommittedReports(read, list, briefDir),
    ecosystemLead,
  );
  if (!found) return null;
  return {
    ...(found.report as Omit<LatestReport, 'reportFile'>),
    reportFile: found.path,
  };
}

/**
 * Check if an ecosystem's current baseline is outside the range recorded
 * in its latest report. Returns the ecosystem lead name if it needs a new brief.
 *
 * @returns the ecosystem lead name, or null if no suggestion
 */
export function checkEcosystemBaseline(
  ecosystemLead: string,
  briefDir: string,
  repoDir = process.cwd(),
): string | null {
  const currentBaseline = resolveInstalledVersion(ecosystemLead, repoDir);
  if (!currentBaseline) return null;

  const report = findLatestReport(ecosystemLead, briefDir);
  if (!report) return null;

  const ecosystem = report.ecosystems.find((e) => e?.lead === ecosystemLead);
  if (!ecosystem) return null;

  if (ecosystem.baseline === currentBaseline) return null;

  const checkedAndClear = Array.isArray(ecosystem.checkedAndClear)
    ? ecosystem.checkedAndClear
    : [];
  if (checkedAndClear.length === 0) return ecosystemLead;

  const { toResearch } = carryForwardCheckedAndClear({
    previous: report,
    ecosystems: [{ lead: ecosystemLead, baseline: currentBaseline }],
    readCurrent: makeFsIo(repoDir).read,
  });

  const baselineLeftRange = toResearch.some(
    (item) =>
      (item as { reason?: unknown }).reason === RESEARCH.baselineOutsideRange,
  );
  return baselineLeftRange ? ecosystemLead : null;
}

/**
 * Main entry point: check all configured ecosystems and return those needing a new brief.
 *
 * @returns ecosystem lead names that need a new brief
 */
export function getUpstreamBriefSuggestions(repoDir = process.cwd()): string[] {
  const config = loadConfig(repoDir);
  if (!config) return [];

  const briefDirPath = join(repoDir, config.brief_dir || DEFAULT_BRIEF_DIR);
  const suggestions: string[] = [];

  for (const ecoConfig of config.ecosystems) {
    const lead = ecoConfig?.lead;
    if (!lead) continue;

    const result = checkEcosystemBaseline(lead, briefDirPath, repoDir);
    if (result) suggestions.push(result);
  }

  return suggestions;
}
