#!/usr/bin/env node
// Asserts bidirectional coverage of the feature index against dashboard
// routes (ADR 0043).
//
//   node tools/scripts/check-feature-index.ts [featureIndexPath] [dashboardRoot] [exclusionsPath]
//
// `docs/features/README.md` carries a "Features Index" table naming each
// product feature. This slugifies each name ("Mobile Numbers" ->
// "mobile-numbers") and checks it bidirectionally against the top-level
// directories Next.js actually serves under `apps/web/src/app/dashboard`:
//
// 1. Every indexed feature must map to a real route.
// 2. Every real route (except those explicitly excluded) must have an index entry.
//
// Platform-level routes like `account` (administers settings, not a feature)
// are exempted in tools/config/feature-index-exclusions.json with documented
// reasons. An exclusion with no reason, naming a route that no longer exists,
// naming a route twice, or naming a route the index already covers fails.
//
// The exclusions live in their own file rather than in
// tools/config/gate-coverage-optout.json on purpose. That file exempts a
// checker from the Meta-Gate and every entry is keyed by a checker name, which
// `gates:coverage:check` validates as an existing check; a dashboard route is a
// different kind of subject and would fail that validation.
//
// Exit 0 = bidirectional coverage holds. Exit 1 = drift or staleness.
// Exit 2 = the check could not run.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const FEATURE_INDEX = resolve(process.argv[2] ?? 'docs/features/README.md');
const DASHBOARD_ROOT = resolve(process.argv[3] ?? 'apps/web/src/app/dashboard');
const EXCLUSIONS_CONFIG = resolve(
  process.argv[4] ?? 'tools/config/feature-index-exclusions.json',
);

const fail: (msg: string) => never = (msg) => {
  console.error(`feature-index: ${msg}`);
  process.exit(2);
};

if (!existsSync(FEATURE_INDEX)) fail(`${FEATURE_INDEX} not found`);
if (!existsSync(DASHBOARD_ROOT)) fail(`${DASHBOARD_ROOT} not found`);
if (!existsSync(EXCLUSIONS_CONFIG)) fail(`${EXCLUSIONS_CONFIG} not found`);

/**
 * An exclusions entry as it arrives from the config file: untrusted. Only
 * `reason` was ever guarded here, so `route` stays `unknown` and is guarded at
 * each lookup rather than widened into a `string` the file never promised.
 */
interface ExclusionEntry {
  route?: unknown;
  reason?: unknown;
}

let parsedExclusions: unknown;
try {
  parsedExclusions = (
    JSON.parse(readFileSync(EXCLUSIONS_CONFIG, 'utf8')) as {
      exclusions?: unknown;
    }
  ).exclusions;
} catch (err) {
  fail(
    `could not parse ${EXCLUSIONS_CONFIG}: ${err instanceof Error ? err.message : String(err)}`,
  );
}
if (!Array.isArray(parsedExclusions)) {
  fail(`${EXCLUSIONS_CONFIG} has no "exclusions" array`);
}
const exclusionEntries: ExclusionEntry[] = parsedExclusions.map(
  (entry: unknown) => (entry ?? {}) as ExclusionEntry,
);
const exclusions = new Set(exclusionEntries.map((entry) => entry.route));

const content = readFileSync(FEATURE_INDEX, 'utf8');

const sectionMatch = content.match(
  /## Features Index\s*\n([\s\S]*?)(?:\n## |$)/,
);
if (!sectionMatch)
  fail(`no "## Features Index" section found in ${FEATURE_INDEX}`);
const section = sectionMatch[1];

const slugify = (name: string) =>
  name.trim().toLowerCase().replace(/\s+/g, '-');

const features: string[] = [];
for (const line of section.split('\n')) {
  if (!line.trim().startsWith('|')) continue;
  const cells = line
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
  if (cells.length === 0) continue;
  const [first] = cells;
  if (first.toLowerCase() === 'feature') continue; // header row
  if (/^:?-+:?$/.test(first)) continue; // separator row
  features.push(first);
}

if (features.length === 0) {
  fail(`no feature rows found under "## Features Index" in ${FEATURE_INDEX}`);
}

const realRoutes = new Set(
  readdirSync(DASHBOARD_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
);

const findings: string[] = [];

// Check 1: every indexed feature must map to a real route
for (const feature of features) {
  const slug = slugify(feature);
  if (!realRoutes.has(slug)) {
    findings.push(
      `"${feature}" maps to /dashboard/${slug}, which the app router does not serve`,
    );
  }
}

// Check 2: every real route (except excluded ones) must have an index entry
const indexedSlugs = new Set(features.map(slugify));
for (const route of realRoutes) {
  if (!exclusions.has(route) && !indexedSlugs.has(route)) {
    findings.push(
      `dashboard route /dashboard/${route} has no entry in the feature index`,
    );
  }
}

// Check 3: every exclusion must carry a reason, name a route once, name a
// route that still exists, and not name a route the index already covers
const seenExclusions = new Set<unknown>();
for (const exclusion of exclusionEntries) {
  if (seenExclusions.has(exclusion.route)) {
    findings.push(
      `exclusion for /dashboard/${exclusion.route} is listed twice`,
    );
  }
  seenExclusions.add(exclusion.route);
  if (typeof exclusion.reason !== 'string' || !exclusion.reason.trim()) {
    findings.push(
      `exclusion for /dashboard/${exclusion.route} has no written reason`,
    );
  }
  if (typeof exclusion.route !== 'string' || !realRoutes.has(exclusion.route)) {
    findings.push(
      `exclusion for /dashboard/${exclusion.route} is stale; the route no longer exists`,
    );
  } else if (indexedSlugs.has(exclusion.route)) {
    findings.push(
      `exclusion for /dashboard/${exclusion.route} is stale; the route now has a feature-index entry`,
    );
  }
}

if (findings.length) {
  console.error(`feature-index: ${findings.length} issue(s) found\n`);
  for (const finding of findings) console.error(`  - ${finding}`);
  console.error(
    `\nUpdate ${FEATURE_INDEX}, the app router, or the exclusions config, as appropriate.`,
  );
  process.exit(1);
}

console.log(
  `feature-index: ${features.length} feature(s) indexed, ${realRoutes.size} route(s) exist, ${exclusions.size} route(s) excluded, all checks pass`,
);
