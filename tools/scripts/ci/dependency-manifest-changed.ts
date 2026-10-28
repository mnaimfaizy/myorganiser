#!/usr/bin/env node

/**
 * Decides whether a pull request actually changes dependencies.
 *
 * `Secure Install Review` used to gate `yarn npm audit` on the *path*
 * `package.json` changing. That is a poor proxy: editing a `scripts` entry is
 * not a dependency change, but it triggered a full audit — and because the
 * audit queries the live advisory database, an unrelated PR could go red
 * overnight through no fault of its own.
 *
 * This narrows the trigger to *content*. Coverage of real dependency changes is
 * unchanged: `yarn.lock` and `.yarnrc.yml` still always trigger, and any
 * dependency-bearing field in any workspace manifest still triggers. Note the
 * old check only looked at the root `package.json`; this one looks at every
 * manifest in the repo, so it is strictly broader on that axis.
 *
 * Prints `true` or `false` on stdout. Exits non-zero only on internal error —
 * callers should treat a failure as "audit anyway" rather than "skip".
 *
 * Usage:
 *   node tools/scripts/ci/dependency-manifest-changed.ts <baseSha> <headSha>
 */

import { execFileSync } from 'node:child_process';
import process from 'node:process';

/** Manifest fields that can change what gets installed. */
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'peerDependenciesMeta',
  'dependenciesMeta',
  'resolutions',
  'overrides',
  'packageManager',
  'workspaces',
  'bundledDependencies',
  'bundleDependencies',
] as const;

/** Files whose change always warrants an audit, regardless of content. */
const ALWAYS_AUDIT = new Set(['yarn.lock', '.yarnrc.yml']);

const MANIFEST_RE = /(^|\/)package\.json$/;

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type Manifest = Record<string, JsonValue>;

interface RenamedPath {
  before: string;
  after: string;
}

function git(args: string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Returns the parsed manifest at `ref:path`, or null when absent/unparseable. */
function manifestAt(ref: string, path: string): Manifest | null {
  let raw: string;
  try {
    raw = git(['show', `${ref}:${path}`]);
  } catch {
    return null; // added or deleted on one side
  }
  try {
    return JSON.parse(raw) as Manifest;
  } catch {
    // A manifest we cannot parse is not something to reason about — let the
    // caller audit rather than silently skipping.
    throw new Error(`Unparseable JSON at ${ref}:${path}`);
  }
}

function dependencySlice(manifest: Manifest | null): Manifest | null {
  if (!manifest) return null;
  const slice: Manifest = {};
  for (const field of DEPENDENCY_FIELDS) {
    if (manifest[field] !== undefined) slice[field] = manifest[field];
  }
  return slice;
}

/** Stable stringify so key reordering alone is not treated as a change. */
function canonical(value: JsonValue | null): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function main(): void {
  const [baseSha, headSha] = process.argv.slice(2);
  if (!baseSha || !headSha) {
    process.stderr.write(
      'Usage: dependency-manifest-changed.ts <baseSha> <headSha>\n',
    );
    process.exit(2);
  }

  // Rename-aware: a manifest that only moved is compared against its old path.
  // Read path-by-path, a moved manifest looks absent at base and present at
  // head, so moving a library directory audited a pull request that changed no
  // dependency at all.
  const changed: RenamedPath[] = git([
    'diff',
    '--name-status',
    '-M',
    '--diff-filter=ACDMRT',
    baseSha,
    headSha,
  ])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, first, second] = line.split('\t');
      return status.startsWith('R')
        ? { before: first, after: second }
        : { before: first, after: first };
    });

  const reasons: string[] = [];

  for (const { before, after } of changed) {
    for (const file of new Set([before, after])) {
      if (ALWAYS_AUDIT.has(file)) reasons.push(`${file} changed`);
    }
  }

  if (!reasons.length) {
    for (const { before, after } of changed) {
      if (!MANIFEST_RE.test(before) && !MANIFEST_RE.test(after)) continue;
      const was = MANIFEST_RE.test(before)
        ? canonical(dependencySlice(manifestAt(baseSha, before)))
        : canonical(null);
      const now = MANIFEST_RE.test(after)
        ? canonical(dependencySlice(manifestAt(headSha, after)))
        : canonical(null);
      if (was !== now) reasons.push(`${after} dependency fields changed`);
    }
  }

  const shouldAudit = reasons.length > 0;
  for (const reason of reasons)
    process.stderr.write(`audit reason: ${reason}\n`);
  if (!shouldAudit) {
    process.stderr.write(
      'no dependency-bearing changes detected (manifest edits, if any, were to non-dependency fields)\n',
    );
  }
  process.stdout.write(shouldAudit ? 'true\n' : 'false\n');
}

try {
  main();
} catch (error) {
  // Fail loud: the workflow treats a non-zero exit as "audit anyway".
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
