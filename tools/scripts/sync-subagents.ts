#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import type { Dirent } from 'node:fs';

import {
  type AgentToolMap,
  type Grant,
  type GrantChange,
  describeGrant,
  describeGrantChange,
  formatGrant,
  grantsEqual,
  parseCanonicalRoles,
  readGrant,
  renderGrant,
  validateToolMap,
  writeGrant,
} from './lib/agent-tool-grants.ts';
import { renderHarnessSections } from './lib/harness-sections.ts';

const repoRoot = process.cwd();

const CANONICAL_DIR = path.join(repoRoot, '.github', 'agents');
const MODEL_POLICY_PATH = path.join(
  repoRoot,
  'tools',
  'config',
  'agent-model-policy.json',
);

/** The subset of `tools/config/agent-model-policy.json` this sync reads. */
interface ModelPolicy {
  agents?: Record<string, { models?: Record<string, string | string[]> }>;
}

const MODEL_POLICY = JSON.parse(
  await fs.readFile(MODEL_POLICY_PATH, 'utf8'),
) as ModelPolicy;
const TOOL_MAP_PATH = path.join(
  repoRoot,
  'tools',
  'config',
  'agent-tool-map.json',
);
const TOOL_MAP = JSON.parse(
  await fs.readFile(TOOL_MAP_PATH, 'utf8'),
) as AgentToolMap;
validateToolMap(TOOL_MAP);

interface HarnessSyncConfig {
  dir: string;
  extension: string;
  nameTransform: (name: string, slug: string) => string;
}

const HARNESS_CONFIG: Record<string, HarnessSyncConfig> = {
  claude: {
    dir: path.join(repoRoot, '.claude', 'agents'),
    extension: '.md',
    nameTransform: (name) => name,
  },
  cursor: {
    dir: path.join(repoRoot, '.cursor', 'agents'),
    extension: '.md',
    nameTransform: (name) => name,
  },
  gemini: {
    dir: path.join(repoRoot, '.gemini', 'agents'),
    extension: '.md',
    nameTransform: (name, slug) => {
      if (slug === 'explore') return 'code-explorer';
      return toKebab(name);
    },
  },
};

const USAGE = `Usage:\n  node tools/scripts/sync-subagents.ts --check\n  node tools/scripts/sync-subagents.ts --apply [--no-prune]\n\nNotes:\n  - Canonical source is .github/agents/*.agent.md\n  - Tool grants are rendered from the canonical tools: roles through\n    tools/config/agent-tool-map.json (Cursor: a derived readonly flag). A target whose\n    grant differs is reported as toolDrift; --apply rewrites only the grant lines and\n    prints each change labelled as widened or narrowed.\n  - All other existing target frontmatter is preserved verbatim; the body is synced.\n  - A target whose frontmatter cannot be parsed is reported as malformed and skipped,\n    never rewritten.\n  - Canonical bodies may scope a section to specific harnesses:\n      <!-- harness:claude,cursor -->  ...  <!-- /harness -->\n    Unmarked content goes to every harness. See tools/scripts/lib/harness-sections.ts.\n  - Missing target files are created with rendered frontmatter.\n  - --apply prunes extra files by default (disable with --no-prune).\n`;

function parseArgs(argv: string[]): {
  mode: 'apply' | 'check';
  prune: boolean;
} {
  const args = new Set(argv.slice(2));
  const mode = args.has('--apply')
    ? 'apply'
    : args.has('--check')
      ? 'check'
      : null;
  if (!mode) {
    throw new Error(USAGE);
  }
  const prune = mode === 'apply' ? !args.has('--no-prune') : false;
  return { mode, prune };
}

function toKebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function splitFrontmatter(content: string): {
  frontmatter: string | null;
  body: string;
} {
  // Normalize line endings first. Matching '\n---\n' against a CRLF file used to
  // report "no frontmatter", which made the caller regenerate frontmatter from
  // freshly rendered frontmatter and silently discard hand-written keys.
  const normalized = content.replace(/\r\n/g, '\n');

  if (!normalized.startsWith('---\n')) {
    return { frontmatter: null, body: normalized.replace(/^\s+/, '') };
  }

  const closeIdx = normalized.indexOf('\n---\n', 4);
  if (closeIdx === -1) {
    return { frontmatter: null, body: normalized.replace(/^\s+/, '') };
  }

  const frontmatter = normalized.slice(0, closeIdx + 5);
  const body = normalized.slice(closeIdx + 5).replace(/^\s+/, '');
  return { frontmatter, body };
}

interface CanonicalMeta {
  name: string;
  description: string;
}

function parseCanonicalMeta(
  frontmatter: string,
  fallbackSlug: string,
): CanonicalMeta {
  const nameMatch = frontmatter.match(/^name:\s*['"]?(.+?)['"]?\s*$/m);
  const descMatch = frontmatter.match(/^description:\s*['"]?(.+?)['"]?\s*$/m);
  const name = nameMatch?.[1]?.trim() || fallbackSlug;
  const description =
    descMatch?.[1]?.trim() || `Canonical agent for ${fallbackSlug}`;
  return { name, description };
}

function normalizeBody(body: string): string {
  return body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

function buildFrontmatter(
  harness: string,
  slug: string,
  canonicalMeta: CanonicalMeta,
  grant: Grant,
): string {
  const cfg = HARNESS_CONFIG[harness];
  const name = cfg.nameTransform(canonicalMeta.name, slug);
  const model = MODEL_POLICY.agents?.[slug]?.models?.[harness];
  if (!model || Array.isArray(model)) {
    throw new Error(
      `Missing single-model ${harness} assignment for ${slug} in ${MODEL_POLICY_PATH}`,
    );
  }
  const description = canonicalMeta.description.replace(/\s+/g, ' ').trim();
  // formatGrant is newline-terminated (or empty); split into lines for join.
  const grantLines = formatGrant(harness, grant).split('\n').filter(Boolean);

  if (harness === 'gemini') {
    return [
      '---',
      `name: ${name}`,
      'description: >',
      `  ${description}`,
      `model: ${model}`,
      ...grantLines,
      '---',
      '',
    ].join('\n');
  }

  if (harness === 'claude') {
    return [
      '---',
      `name: ${name}`,
      'description: >',
      `  ${description}`,
      ...grantLines,
      `model: ${model}`,
      '---',
      '',
    ].join('\n');
  }

  return [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    `model: ${model}`,
    ...grantLines,
    '---',
    '',
  ].join('\n');
}

async function readDirSafe(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

interface CanonicalAgent {
  slug: string;
  roles: string[];
  body: string;
  canonicalMeta: CanonicalMeta;
  sourcePath: string;
}

async function loadCanonicalAgents(): Promise<CanonicalAgent[]> {
  const entries = await readDirSafe(CANONICAL_DIR);
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.agent.md'))
    .map((entry) => entry.name)
    .sort();

  const agents: CanonicalAgent[] = [];
  for (const fileName of files) {
    const slug = fileName.replace(/\.agent\.md$/, '');
    const fullPath = path.join(CANONICAL_DIR, fileName);
    const content = await fs.readFile(fullPath, 'utf8');
    const { frontmatter, body } = splitFrontmatter(content);
    if (!frontmatter) {
      throw new Error(`Canonical agent missing frontmatter: ${fullPath}`);
    }
    const canonicalMeta = parseCanonicalMeta(frontmatter, slug);
    agents.push({
      slug,
      roles: parseCanonicalRoles(frontmatter, slug),
      body: normalizeBody(body),
      canonicalMeta,
      sourcePath: path.relative(repoRoot, fullPath),
    });
  }
  return agents;
}

interface ToolDriftEntry {
  path: string;
  before: Grant | null;
  after: Grant;
  change: GrantChange;
}

interface HarnessReport {
  harness: string;
  created: string[];
  updated: string[];
  unchanged: string[];
  removed: string[];
  drifted: string[];
  toolDrift: ToolDriftEntry[];
  missing: string[];
  extra: string[];
  malformed: string[];
}

async function syncHarness(
  harness: string,
  canonicalAgents: CanonicalAgent[],
  mode: 'apply' | 'check',
  prune: boolean,
): Promise<HarnessReport> {
  const cfg = HARNESS_CONFIG[harness];
  await fs.mkdir(cfg.dir, { recursive: true });

  const existingEntries = await readDirSafe(cfg.dir);
  const existingFiles = existingEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(cfg.extension))
    .map((entry) => entry.name);

  const canonicalSlugs = new Set(canonicalAgents.map((agent) => agent.slug));
  const report: HarnessReport = {
    harness,
    created: [],
    updated: [],
    unchanged: [],
    removed: [],
    drifted: [],
    toolDrift: [],
    missing: [],
    extra: [],
    malformed: [],
  };

  for (const canonical of canonicalAgents) {
    const fileName = `${canonical.slug}${cfg.extension}`;
    const targetPath = path.join(cfg.dir, fileName);
    let existingContent: string | null = null;
    try {
      existingContent = await fs.readFile(targetPath, 'utf8');
    } catch {
      existingContent = null;
    }

    const desiredBody = normalizeBody(
      renderHarnessSections(canonical.body, harness, {
        source: canonical.sourcePath,
      }),
    );
    const desiredGrant = renderGrant(
      canonical.roles,
      harness,
      canonical.slug,
      TOOL_MAP,
    );
    if (!existingContent) {
      const frontmatter = buildFrontmatter(
        harness,
        canonical.slug,
        canonical.canonicalMeta,
        desiredGrant,
      );
      // The blank line after `---` is what prettier expects; without it every
      // file this script rewrites fails `nx format:check`.
      const nextContent = `${frontmatter}\n${desiredBody}\n`;
      if (mode === 'apply') {
        await fs.writeFile(targetPath, nextContent, 'utf8');
      }
      report.created.push(path.relative(repoRoot, targetPath));
      report.missing.push(path.relative(repoRoot, targetPath));
      continue;
    }

    const { frontmatter, body } = splitFrontmatter(existingContent);
    const rel = path.relative(repoRoot, targetPath);

    // Apart from the grant, an existing target's frontmatter is owned by the
    // harness (hand-written descriptions, model pins synced separately). If it
    // cannot be parsed, refuse to touch the file instead of regenerating it:
    // regenerating would discard those keys.
    if (!frontmatter) {
      report.malformed.push(rel);
      continue;
    }

    const existingBody = normalizeBody(body);
    const bodyDiffers = existingBody !== desiredBody;
    if (bodyDiffers) {
      report.drifted.push(rel);
    }

    // The grant is not owned by the harness file: it is rendered from the
    // canonical roles, so a widening can only come from a reviewed change to
    // the roles or to agent-tool-map.json.
    const existingGrant = readGrant(frontmatter, harness);
    const grantDiffers = !grantsEqual(existingGrant, desiredGrant);
    if (grantDiffers) {
      report.toolDrift.push({
        path: rel,
        before: existingGrant,
        after: desiredGrant,
        change: describeGrantChange(existingGrant, desiredGrant),
      });
    }

    if (!bodyDiffers && !grantDiffers) {
      report.unchanged.push(rel);
      continue;
    }

    if (mode === 'apply') {
      const nextFrontmatter = grantDiffers
        ? writeGrant(frontmatter, harness, desiredGrant)
        : frontmatter;
      const nextContent = `${nextFrontmatter}\n${desiredBody}\n`;
      await fs.writeFile(targetPath, nextContent, 'utf8');
      report.updated.push(rel);
    }
  }

  for (const fileName of existingFiles) {
    const slug = fileName.replace(/\.md$/, '');
    if (!canonicalSlugs.has(slug)) {
      const targetPath = path.join(cfg.dir, fileName);
      const rel = path.relative(repoRoot, targetPath);
      report.extra.push(rel);
      if (mode === 'apply' && prune) {
        await fs.rm(targetPath, { force: true });
        report.removed.push(rel);
      }
    }
  }

  return report;
}

// Widenings and narrowings are printed on separate labelled lines so a
// capability increase is visible at a glance in review.
function printToolDrift(toolDrift: ToolDriftEntry[]): void {
  for (const { path: rel, before, after, change } of toolDrift) {
    console.log(`    grant ${rel}`);
    console.log(`      before: ${describeGrant(before)}`);
    console.log(`      after:  ${describeGrant(after)}`);
    if (change.widened.length)
      console.log(`      WIDENED:  + ${change.widened.join(', ')}`);
    if (change.narrowed.length)
      console.log(`      narrowed: - ${change.narrowed.join(', ')}`);
    if (change.reordered) console.log('      reordered only');
  }
}

function printReport(
  mode: 'apply' | 'check',
  prune: boolean,
  reports: HarnessReport[],
): void {
  console.log(
    `Sub-agent sync mode: ${mode}${mode === 'apply' ? ` (prune=${prune})` : ''}`,
  );

  for (const report of reports) {
    console.log(`\n[${report.harness}]`);
    if (mode === 'check') {
      console.log(`  missing: ${report.missing.length}`);
      console.log(`  drifted: ${report.drifted.length}`);
      console.log(`  toolDrift: ${report.toolDrift.length}`);
      console.log(`  extra: ${report.extra.length}`);
      console.log(`  malformed: ${report.malformed.length}`);
      if (report.missing.length)
        report.missing.forEach((p) => console.log(`    + ${p}`));
      if (report.drifted.length)
        report.drifted.forEach((p) => console.log(`    ~ ${p}`));
      printToolDrift(report.toolDrift);
      if (report.extra.length)
        report.extra.forEach((p) => console.log(`    - ${p}`));
      if (report.malformed.length)
        report.malformed.forEach((p) => console.log(`    ! ${p}`));
    } else {
      console.log(`  created: ${report.created.length}`);
      console.log(`  updated: ${report.updated.length}`);
      console.log(`  removed: ${report.removed.length}`);
      console.log(`  grants changed: ${report.toolDrift.length}`);
      console.log(`  skipped (malformed): ${report.malformed.length}`);
      if (report.created.length)
        report.created.forEach((p) => console.log(`    + ${p}`));
      if (report.updated.length)
        report.updated.forEach((p) => console.log(`    ~ ${p}`));
      if (report.removed.length)
        report.removed.forEach((p) => console.log(`    - ${p}`));
      printToolDrift(report.toolDrift);
      if (report.malformed.length)
        report.malformed.forEach((p) => console.log(`    ! ${p}`));
    }
  }
}

function hasDrift(reports: HarnessReport[]): boolean {
  return reports.some(
    (report) =>
      report.missing.length ||
      report.drifted.length ||
      report.toolDrift.length ||
      report.extra.length ||
      report.malformed.length,
  );
}

function hasMalformed(reports: HarnessReport[]): boolean {
  return reports.some((report) => report.malformed.length > 0);
}

async function main() {
  const { mode, prune } = parseArgs(process.argv);
  const canonicalAgents = await loadCanonicalAgents();

  const reports: HarnessReport[] = [];
  for (const harness of Object.keys(HARNESS_CONFIG)) {
    const report = await syncHarness(harness, canonicalAgents, mode, prune);
    reports.push(report);
  }

  printReport(mode, prune, reports);

  if (hasMalformed(reports)) {
    console.error(
      '\nERROR: the files marked ! have unreadable frontmatter and were left untouched.\n' +
        'Fix their `---` delimited frontmatter by hand, then re-run. This script will not\n' +
        'regenerate frontmatter for an existing file — doing so would discard its hand-written keys.',
    );
    process.exitCode = 1;
    return;
  }

  if (mode === 'check' && hasDrift(reports)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
