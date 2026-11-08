/**
 * Detect when an Ecosystem's Baseline has left the range recorded in its
 * latest committed Upstream Brief report (ADR 0084 item 14).
 *
 * A thin adapter: the logic ships inside the portable skill as
 * `.agents/skills/upstream-brief/suggest-run.mjs`, so every repository that
 * adopts the skill suggests runs the same way. This file keeps the name and
 * the exports `dep-sync-reminder.ts` and this module's contract suite import.
 */
import {
  checkEcosystemBaseline as skillCheckEcosystemBaseline,
  findLatestReport as skillFindLatestReport,
  loadConfig as skillLoadConfig,
  resolveInstalledVersion as skillResolveInstalledVersion,
  suggestRuns,
} from '../../../.agents/skills/upstream-brief/suggest-run.mjs';

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

export const resolveInstalledVersion: (
  packageName: string,
  repoDir?: string,
) => string | null = skillResolveInstalledVersion;

export const loadConfig: (repoDir?: string) => UpstreamBriefConfig | null =
  skillLoadConfig;

export const findLatestReport: (
  ecosystemLead: string,
  briefDir: string,
) => LatestReport | null = skillFindLatestReport;

export const checkEcosystemBaseline: (
  ecosystemLead: string,
  briefDir: string,
  repoDir?: string,
) => string | null = skillCheckEcosystemBaseline;

/** Every declared Ecosystem whose Baseline has moved: the leads to suggest. */
export const getUpstreamBriefSuggestions: (repoDir?: string) => string[] =
  suggestRuns;
