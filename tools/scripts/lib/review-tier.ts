/**
 * The Review Tier classifier (ADR 0070): a deterministic function from a diff
 * to `auto | agent | human`, explained signal by signal.
 *
 * Inputs, all passed in so the contract tests never touch the repository:
 *
 *   - `files`    the diff as `{ path, additions, deletions }` records
 *   - `graph`    the Nx project graph, `{ nodes, dependencies }`, which carries
 *                every project's root and `tier:*` tag
 *   - `pathMap`  `tools/config/review-tier-paths.json`
 *   - `author`   the Pull Request author's login, or undefined
 *
 * Every rule resolves upward on doubt, as ADR 0012 requires: an unmatched
 * path, an untagged project, a missing author, an empty diff, or a malformed
 * map all land on `human`. The result is the maximum over every signal that
 * fired, and the signals are returned so the job can post why.
 *
 * Never an LLM, never reads the label: the tier is computed from the diff and
 * the label on the Pull Request is a display of it (ADR 0070 items 2 and 3).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { globToRegExp } from './glob.ts';

// Re-exported so this module's contract tests and callers keep one import
// site, while the implementation lives in glob.ts beside the obligation
// selector that used to carry a second, divergent copy.
export { globToRegExp };

export const REVIEW_TIER_PATHS_CONFIG = join(
  'tools',
  'config',
  'review-tier-paths.json',
);
export const REVIEW_TIER_SCHEMA_VERSION = 1;

/** Ascending: a later tier is stricter. */
export const REVIEW_TIERS = ['auto', 'agent', 'human'] as const;

export type ReviewTier = (typeof REVIEW_TIERS)[number];

/** Is `value` one of the three tiers? The guard every untrusted input goes through. */
export const isReviewTier = (value: unknown): value is ReviewTier =>
  (REVIEW_TIERS as readonly unknown[]).includes(value);

export const reviewTierLabel = (tier: ReviewTier): string => `review:${tier}`;
export const REVIEW_TIER_LABELS: string[] = REVIEW_TIERS.map(reviewTierLabel);

/** The labels to add and remove so the Pull Request carries exactly `target`. */
export interface RelabelPlan {
  add: string[];
  remove: string[];
}

/**
 * @param currentLabels every label on the Pull Request
 * @param target the tier label the Pull Request should end up with
 */
export const planRelabel = (
  currentLabels: readonly string[],
  target: string | null | undefined,
): RelabelPlan | null => {
  if (!target) return null;
  if (!REVIEW_TIER_LABELS.includes(target))
    throw new Error(`unknown tier label ${target}`);
  const current = currentLabels.filter((l) => REVIEW_TIER_LABELS.includes(l));
  const remove = current.filter((l) => l !== target);
  const add = current.includes(target) ? [] : [target];
  return add.length === 0 && remove.length === 0 ? null : { add, remove };
};

const rank = (tier: ReviewTier) => REVIEW_TIERS.indexOf(tier);
export const maxTier = (...tiers: (ReviewTier | undefined)[]): ReviewTier =>
  tiers.reduce<ReviewTier>(
    (acc, t) => (t !== undefined && rank(t) > rank(acc) ? t : acc),
    'auto',
  );

export const SIGNAL_KINDS = [
  'empty',
  'path',
  'project',
  'unmatched',
  'reach',
  'size',
  'blast-radius',
  'author',
  'error',
] as const;

export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** Thrown for a malformed path map. Callers report `human` and exit 2. */
export class ReviewTierConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewTierConfigError';
  }
}

/** One ordered rule from the path map: the first whose glob matches wins. */
export interface ReviewTierRule {
  id: string;
  tier: ReviewTier;
  reason: string;
  patterns: string[];
}

/** A threshold group, read at `auto` and at `agent`; over both is `human`. */
export interface ThresholdGroup<T> {
  auto: T;
  agent: T;
}

export interface SizeThresholds {
  maxFiles: number;
  maxLines: number;
}

export interface BlastRadiusThresholds {
  maxProjects: number;
}

/** `tools/config/review-tier-paths.json`, after `assertPathMap`. */
export interface ReviewTierPathMap {
  schemaVersion: number;
  rules: ReviewTierRule[];
  size: ThresholdGroup<SizeThresholds>;
  blastRadius: ThresholdGroup<BlastRadiusThresholds>;
  reach?: { exclude?: string[] };
  authors: { trusted: string[] };
}

// The shape before validation: a JSON file claims nothing, so every field
// arrives as `unknown` and is read through its own guard below.
interface UncheckedRule {
  id?: unknown;
  tier?: unknown;
  reason?: unknown;
  patterns?: unknown;
}

interface UncheckedPathMap {
  schemaVersion?: unknown;
  rules?: unknown;
  size?: unknown;
  blastRadius?: unknown;
  reach?: { exclude?: unknown };
  authors?: { trusted?: unknown };
}

export const loadPathMap = (
  path: string = REVIEW_TIER_PATHS_CONFIG,
): ReviewTierPathMap =>
  assertPathMap(JSON.parse(readFileSync(path, 'utf8')), path);

export function assertPathMap(
  map: unknown,
  source = 'path map',
): ReviewTierPathMap {
  // Annotated `=> never` so each guard below narrows the field it checked.
  const fail: (msg: string) => never = (msg) => {
    throw new ReviewTierConfigError(`${source}: ${msg}`);
  };
  const unchecked = (map ?? {}) as UncheckedPathMap;
  if (unchecked.schemaVersion !== REVIEW_TIER_SCHEMA_VERSION)
    fail(`unsupported schemaVersion ${unchecked.schemaVersion}`);
  if (!Array.isArray(unchecked.rules) || unchecked.rules.length === 0)
    fail('rules must be a non-empty array');
  const ids = new Set<string>();
  for (const entry of unchecked.rules as unknown[]) {
    const rule = (entry ?? {}) as UncheckedRule;
    if (typeof rule.id !== 'string' || !rule.id) fail('a rule has no id');
    if (ids.has(rule.id)) fail(`duplicate rule id "${rule.id}"`);
    ids.add(rule.id);
    if (!isReviewTier(rule.tier))
      fail(`rule "${rule.id}" has tier "${rule.tier}"`);
    if (typeof rule.reason !== 'string' || !rule.reason)
      fail(`rule "${rule.id}" has no reason`);
    if (!Array.isArray(rule.patterns) || rule.patterns.length === 0)
      fail(`rule "${rule.id}" has no patterns`);
  }
  for (const [group, keys] of [
    ['size', ['maxFiles', 'maxLines']],
    ['blastRadius', ['maxProjects']],
  ] as const) {
    const thresholds = unchecked[group] as
      | Record<string, Record<string, unknown> | undefined>
      | undefined;
    for (const tier of ['auto', 'agent'] as const) {
      for (const key of keys) {
        const value = thresholds?.[tier]?.[key];
        // `typeof` first so the comparison below reads a number: anything
        // else already failed `Number.isInteger`.
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
          fail(`${group}.${tier}.${key} must be a non-negative integer`);
      }
    }
  }
  if (
    unchecked.reach !== undefined &&
    (!Array.isArray(unchecked.reach.exclude) ||
      !unchecked.reach.exclude.every((g) => typeof g === 'string' && g))
  )
    fail('reach.exclude must be an array of globs');
  const trusted = unchecked.authors?.trusted;
  if (
    !Array.isArray(trusted) ||
    !trusted.every((a) => typeof a === 'string' && a)
  )
    fail('authors.trusted must be an array of logins');
  return map as ReviewTierPathMap;
}

interface CompiledRule extends ReviewTierRule {
  matchers: RegExp[];
}

const compileRules = (map: ReviewTierPathMap): CompiledRule[] =>
  map.rules.map((rule) => ({
    ...rule,
    matchers: rule.patterns.map(globToRegExp),
  }));

const matchRule = (rules: readonly CompiledRule[], path: string) =>
  rules.find((rule) => rule.matchers.some((re) => re.test(path)));

/** The part of the Nx project graph the classifier reads. */
export interface ReviewTierGraph {
  nodes?: Record<
    string,
    { name: string; data?: { root?: string; tags?: readonly string[] } }
  >;
  dependencies?: Record<
    string,
    readonly { source: string; target: string }[] | undefined
  >;
}

/** An Nx project as the classifier needs it: where it lives and its tier tag. */
interface TieredProject {
  name: string;
  root: string;
  tier: ReviewTier | undefined;
}

/** Project roots, longest first, so `libs/web/pages/vault` wins over `libs/web`. */
function indexProjects(graph: ReviewTierGraph): TieredProject[] {
  const projects = Object.values(graph.nodes ?? {}).map((node) => {
    const root = node.data?.root ?? '';
    const tags = node.data?.tags ?? [];
    const tierTag = tags.find((t) => t.startsWith('tier:'));
    const tier = tierTag?.slice('tier:'.length);
    return {
      name: node.name,
      root,
      tier: isReviewTier(tier) ? tier : undefined,
    };
  });
  projects.sort((a, b) => b.root.length - a.root.length);
  return projects;
}

const ownerOf = (projects: readonly TieredProject[], path: string) =>
  projects.find(
    (p) => p.root && (path === p.root || path.startsWith(`${p.root}/`)),
  );

/** source → dependents, project edges only (npm: targets are dropped). */
function reverseEdges(
  graph: ReviewTierGraph,
  names: readonly string[],
): Map<string, Set<string>> {
  const dependents = new Map(names.map((n) => [n, new Set<string>()]));
  for (const edges of Object.values(graph.dependencies ?? {})) {
    for (const edge of edges ?? []) {
      const dependentsOfTarget = dependents.get(edge.target);
      if (dependentsOfTarget && names.includes(edge.source))
        dependentsOfTarget.add(edge.source);
    }
  }
  return dependents;
}

/** One changed file in the diff. */
export interface DiffFile {
  path: string;
  additions?: number;
  deletions?: number;
}

/** How a file's own tier was decided. */
export type FileTierSource = 'path' | 'project' | 'untagged' | 'unmatched';

/** One file of the diff with the tier and the reason it carries. */
export interface ResolvedFile {
  path: string;
  tier: ReviewTier;
  source: FileTierSource;
  rule?: string;
  project?: string;
}

/** One reason the tier is what it is, as the job summary prints it. */
export interface ReviewTierSignal {
  kind: SignalKind;
  tier: ReviewTier;
  detail: string;
  id?: string;
  files?: string[];
}

/** A project no changed file touches, reached through the Nx graph. */
export interface ReachedProject {
  name: string;
  via: string;
  tier: ReviewTier;
}

/** The diff's measured size. */
export interface DiffSize {
  files: number;
  additions: number;
  deletions: number;
  lines: number;
}

export interface ReviewTierThresholds {
  size: ThresholdGroup<SizeThresholds>;
  blastRadius: ThresholdGroup<BlastRadiusThresholds>;
}

/** The classifier's whole output: the tier, and every signal behind it. */
export interface ReviewTierResult {
  schemaVersion: number;
  tier: ReviewTier;
  label: string;
  author: string | null;
  signals: ReviewTierSignal[];
  files: ResolvedFile[];
  projects: { changed: string[]; reached: ReachedProject[] };
  size: DiffSize;
  thresholds: ReviewTierThresholds | null;
}

export interface ClassifyReviewTierInput {
  files: readonly DiffFile[];
  graph: ReviewTierGraph;
  pathMap: unknown;
  author?: string;
}

export function classifyReviewTier({
  files,
  graph,
  pathMap,
  author,
}: ClassifyReviewTierInput): ReviewTierResult {
  const map = assertPathMap(pathMap);
  const rules = compileRules(map);
  const reachExclude = (map.reach?.exclude ?? []).map(globToRegExp);
  const projects = indexProjects(graph);
  const byName = new Map(projects.map((p) => [p.name, p]));
  const signals: ReviewTierSignal[] = [];

  if (!Array.isArray(files) || files.length === 0) {
    signals.push({
      kind: 'empty',
      tier: 'human',
      detail: 'the diff is empty; nothing to classify',
    });
  }

  const resolved: ResolvedFile[] = [];
  const ruleHits = new Map<string, string[]>();
  const changedProjects = new Map<
    string,
    { project: TieredProject; files: string[]; seedsReach: boolean }
  >();
  for (const file of files ?? []) {
    const path = String(file.path).replace(/\\/g, '/');
    const rule = matchRule(rules, path);
    const owner = ownerOf(projects, path);
    let entry: ResolvedFile;
    if (rule) {
      entry = { path, tier: rule.tier, source: 'path', rule: rule.id };
      if (!ruleHits.has(rule.id)) ruleHits.set(rule.id, []);
      ruleHits.get(rule.id)!.push(path);
    } else if (owner) {
      entry = owner.tier
        ? { path, tier: owner.tier, source: 'project', project: owner.name }
        : { path, tier: 'human', source: 'untagged', project: owner.name };
      if (!changedProjects.has(owner.name))
        changedProjects.set(owner.name, {
          project: owner,
          files: [],
          seedsReach: false,
        });
      const changed = changedProjects.get(owner.name)!;
      changed.files.push(path);
      // A story, a test, or a note counts toward its own project's tier but
      // cannot change what a dependent project runs, so it never seeds reach.
      if (!reachExclude.some((re) => re.test(path))) changed.seedsReach = true;
    } else {
      entry = { path, tier: 'human', source: 'unmatched' };
      signals.push({
        kind: 'unmatched',
        tier: 'human',
        detail: `${path} belongs to no Nx project and matches no rule in ${REVIEW_TIER_PATHS_CONFIG}`,
        files: [path],
      });
    }
    if (owner) entry.project = owner.name;
    resolved.push(entry);
  }

  for (const rule of rules) {
    const hit = ruleHits.get(rule.id);
    if (!hit) continue;
    signals.push({
      kind: 'path',
      tier: rule.tier,
      id: rule.id,
      detail: `${hit.length} file(s) match "${rule.id}": ${rule.reason}`,
      files: hit,
    });
  }

  for (const { project, files: hit } of changedProjects.values()) {
    signals.push({
      kind: 'project',
      tier: project.tier ?? 'human',
      id: project.name,
      detail: project.tier
        ? `${hit.length} file(s) in ${project.name} (tier:${project.tier})`
        : `${hit.length} file(s) in ${project.name}, which carries no tier:* tag`,
      files: hit,
    });
  }

  // Reach: every project that depends, transitively, on a changed project.
  const names = projects.map((p) => p.name);
  const dependents = reverseEdges(graph, names);
  const reached = new Map<string, string>();
  const queue = [...changedProjects.entries()]
    .filter(([, c]) => c.seedsReach)
    .map(([name]) => name);
  while (queue.length) {
    const current = queue.shift()!;
    for (const dependent of dependents.get(current) ?? []) {
      if (changedProjects.has(dependent) || reached.has(dependent)) continue;
      reached.set(dependent, current);
      queue.push(dependent);
    }
  }
  const reachedList = [...reached].map(([name, via]) => ({
    name,
    via,
    tier: byName.get(name)?.tier ?? 'human',
  }));
  const reachedTier = maxTier(...reachedList.map((r) => r.tier));
  if (reachedList.length) {
    const strictest = reachedList.filter((r) => r.tier === reachedTier);
    signals.push({
      kind: 'reach',
      tier: reachedTier,
      detail: `${reachedList.length} dependent project(s) reached through the Nx graph; strictest tier:${reachedTier} via ${strictest
        .map((r) => `${r.name} (imports ${r.via})`)
        .join(', ')}`,
    });
  }

  const additions = sum(files, 'additions');
  const deletions = sum(files, 'deletions');
  const size: DiffSize = {
    files: (files ?? []).length,
    additions,
    deletions,
    lines: additions + deletions,
  };
  const sizeTier = thresholdTier(map.size, [
    ['maxFiles', size.files],
    ['maxLines', size.lines],
  ]);
  signals.push({
    kind: 'size',
    tier: sizeTier,
    detail: `${size.files} file(s), ${size.lines} line(s) changed (auto ≤ ${map.size.auto.maxFiles}/${map.size.auto.maxLines}, agent ≤ ${map.size.agent.maxFiles}/${map.size.agent.maxLines})`,
  });

  const blast = changedProjects.size + reachedList.length;
  const blastTier = thresholdTier(map.blastRadius, [['maxProjects', blast]]);
  signals.push({
    kind: 'blast-radius',
    tier: blastTier,
    detail: `${blast} project(s) changed or reached (auto ≤ ${map.blastRadius.auto.maxProjects}, agent ≤ ${map.blastRadius.agent.maxProjects})`,
  });

  signals.push(authorSignal(author, map.authors.trusted));

  const tier = maxTier(...signals.map((s) => s.tier));
  return {
    schemaVersion: REVIEW_TIER_SCHEMA_VERSION,
    tier,
    label: reviewTierLabel(tier),
    author: author ?? null,
    signals,
    files: resolved,
    projects: {
      changed: [...changedProjects.keys()].sort(),
      reached: reachedList.sort((a, b) => a.name.localeCompare(b.name)),
    },
    size,
    thresholds: { size: map.size, blastRadius: map.blastRadius },
  };
}

const sum = (
  files: readonly DiffFile[] | undefined,
  key: 'additions' | 'deletions',
) => (files ?? []).reduce((acc, f) => acc + (Number(f[key]) || 0), 0);

function thresholdTier<T extends Record<keyof T, number>>(
  group: ThresholdGroup<T>,
  measures: readonly (readonly [keyof T, number])[],
): ReviewTier {
  const over = (tier: 'auto' | 'agent') =>
    measures.some(([key, value]) => value > group[tier][key]);
  if (over('agent')) return 'human';
  if (over('auto')) return 'agent';
  return 'auto';
}

function authorSignal(
  author: string | undefined,
  trusted: readonly string[],
): ReviewTierSignal {
  if (!author)
    return { kind: 'author', tier: 'human', detail: 'author is unknown' };
  if (author.endsWith('[bot]'))
    return { kind: 'author', tier: 'human', detail: `${author} is a bot` };
  if (!trusted.includes(author))
    return {
      kind: 'author',
      tier: 'human',
      detail: `${author} is not in authors.trusted`,
    };
  return {
    kind: 'author',
    tier: 'auto',
    detail: `${author} is in authors.trusted`,
  };
}

/** The result a caller reports when the classifier itself failed. */
export const errorResult = (
  message: string,
  author?: string | null,
): ReviewTierResult => ({
  schemaVersion: REVIEW_TIER_SCHEMA_VERSION,
  tier: 'human',
  label: reviewTierLabel('human'),
  author: author ?? null,
  signals: [{ kind: 'error', tier: 'human', detail: message }],
  files: [],
  projects: { changed: [], reached: [] },
  size: { files: 0, additions: 0, deletions: 0, lines: 0 },
  thresholds: null,
});

/**
 * Parses `git diff --numstat -M` output. Binary files report `-` and count
 * as zero lines; renames report the new path.
 */
export function parseNumstat(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const [add, del, ...rest] = line.split('\t');
    let path = rest.join('\t');
    if (path.includes(' => ')) {
      const braced = path.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
      path = braced
        ? `${braced[1]}${braced[3]}${braced[4]}`.replace(/\/\//g, '/')
        : path.split(' => ')[1];
    }
    files.push({
      path,
      additions: add === '-' ? 0 : Number(add),
      deletions: del === '-' ? 0 : Number(del),
    });
  }
  return files;
}

const TIER_MEANING = {
  auto: 'merge on green required checks plus an agent verdict with no finding above nit',
  agent:
    'merge on green required checks plus an agent verdict with no blocking finding',
  human:
    'a named human approval is required; the agent verdict is necessary but never sufficient',
} as const satisfies Record<ReviewTier, string>;
for (const tier of REVIEW_TIERS)
  if (!TIER_MEANING[tier]) throw new Error(`TIER_MEANING lacks ${tier}`);

/** The range a summary names, when it has one. */
export interface SummaryRange {
  base?: string;
  head?: string;
}

/** Markdown for the job summary and the Pull Request comment. */
export function renderReviewTierSummary(
  result: ReviewTierResult,
  { base, head }: SummaryRange = {},
): string {
  const lines = [
    `## Review Tier: \`${result.label}\``,
    '',
    `_${TIER_MEANING[result.tier]}._ Computed from the diff by \`tools/scripts/check-review-tier.ts\` (ADR 0070); the label is a display of this output, not the other way round.`,
    '',
  ];
  if (base && head)
    lines.push(`Range: \`${base.slice(0, 7)}..${head.slice(0, 7)}\``, '');
  lines.push('| Signal | Tier | Detail |', '| --- | --- | --- |');
  for (const s of [...result.signals].sort(
    (a, b) => rank(b.tier) - rank(a.tier),
  )) {
    const name = s.id ? `${s.kind} · ${s.id}` : s.kind;
    lines.push(`| ${name} | \`${s.tier}\` | ${escapeCell(s.detail)} |`);
  }
  if (result.projects.changed.length || result.projects.reached.length) {
    lines.push(
      '',
      `Projects changed: ${result.projects.changed.map((p) => `\`${p}\``).join(', ') || 'none'}.`,
      `Projects reached: ${
        result.projects.reached
          .map((r) => `\`${r.name}\` (tier:${r.tier})`)
          .join(', ') || 'none'
      }.`,
    );
  }
  const strict = result.files.filter((f) => f.tier === result.tier);
  if (strict.length && result.tier !== 'auto') {
    lines.push(
      '',
      `<details><summary>${strict.length} file(s) at \`${result.tier}\`</summary>`,
      '',
    );
    for (const f of strict.slice(0, 50))
      lines.push(
        `- \`${f.path}\` — ${f.source}${f.rule ? ` \`${f.rule}\`` : ''}${f.project ? ` in \`${f.project}\`` : ''}`,
      );
    if (strict.length > 50) lines.push(`- … ${strict.length - 50} more`);
    lines.push('', '</details>');
  }
  return `${lines.join('\n')}\n`;
}

const escapeCell = (text: string) =>
  String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
