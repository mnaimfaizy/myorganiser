#!/usr/bin/env node
// Prints the Baseline resolution for this repo's declared Ecosystems (ADR
// 0084 items 1 and 2), so a developer can see what an Upstream Brief would
// anchor to before any research hop runs.
//
//   node .agents/skills/upstream-brief/resolve-baseline.mjs [--repo <dir>]
//
// Reads `ecosystems` and `version_record.path` from `upstream-brief.config.yml`
// (also `.yaml`/`.json`; see ADAPTER.md). Installed versions come from each
// installed package's own manifest under node_modules — this repo uses a
// node-modules linker, so no lockfile parser is introduced. The version
// record is read only to name a drift note; ADR 0084 item 1 forbids reading
// it as a source.
//
// This is not a gate: it asserts nothing and always exits 0. It is a small
// command, not a Wired Gate, so it stays out of `gates:coverage:check`'s
// non-recursive scan of `tools/scripts/` and needs no optout entry there.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { findVersionInText, resolveEcosystemBaselines } from './baseline.mjs';

const LABEL = 'upstream-baseline';
const CONFIG_PATHS = [
  'upstream-brief.config.yml',
  'upstream-brief.config.yaml',
  'upstream-brief.config.json',
];
/** ADAPTER.md's default: compare against package.json when nothing is configured. */
export const DEFAULT_VERSION_RECORD_PATH = 'package.json';

function readRepoFile(repo, path) {
  const absolute = join(repo, path);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
}

function splitFlowList(inner) {
  return inner
    .split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

/**
 * `ecosystems:` — a list of `{lead, members: {add, remove}}` mappings. This
 * repo has no YAML parser (`resolveBriefDir` in `check-upstream-briefs.ts`
 * faces the same constraint for `brief_dir`), and the schema ADAPTER.md
 * documents is exactly this narrow, so it is matched line-by-line rather
 * than parsed generally:
 *
 *   ecosystems:
 *     - lead: nx
 *     - lead: next
 *       members:
 *         add: [eslint-config-next]
 *         remove: []
 */
export function parseEcosystemsFromConfig(text) {
  const lines = text.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => /^ecosystems:\s*$/.test(line));
  if (startIndex === -1) return [];

  const ecosystems = [];
  let current = null;
  let inMembers = false;

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) break; // dedent back to a top-level key

    const itemMatch = line.match(/^\s*-\s*lead:\s*(\S+)\s*$/);
    if (itemMatch) {
      current = { lead: itemMatch[1] };
      ecosystems.push(current);
      inMembers = false;
      continue;
    }
    if (!current) continue;
    if (/^\s*members:\s*$/.test(line)) {
      inMembers = true;
      continue;
    }
    if (!inMembers) continue;
    const addMatch = line.match(/^\s*add:\s*\[([^\]]*)\]\s*$/);
    if (addMatch) {
      current.addMembers = splitFlowList(addMatch[1]);
      continue;
    }
    const removeMatch = line.match(/^\s*remove:\s*\[([^\]]*)\]\s*$/);
    if (removeMatch) current.removeMembers = splitFlowList(removeMatch[1]);
  }
  return ecosystems;
}

/** `version_record.path`, defaulting to `package.json` (ADAPTER.md). */
export function resolveVersionRecordPath(text) {
  const lines = text.split(/\r?\n/);
  const startIndex = lines.findIndex((line) =>
    /^version_record:\s*$/.test(line),
  );
  if (startIndex === -1) return DEFAULT_VERSION_RECORD_PATH;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (/^\S/.test(lines[i])) break;
    const match = lines[i].match(
      /^\s+path:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/,
    );
    if (match) return match[1];
  }
  return DEFAULT_VERSION_RECORD_PATH;
}

function readAdapterConfig(repo) {
  for (const path of CONFIG_PATHS) {
    const text = readRepoFile(repo, path);
    if (text === null) continue;
    if (path.endsWith('.json')) {
      const parsed = JSON.parse(text);
      const ecosystems = Array.isArray(parsed.ecosystems)
        ? parsed.ecosystems.map((eco) => ({
            lead: eco.lead,
            addMembers: eco.members?.add ?? [],
            removeMembers: eco.members?.remove ?? [],
          }))
        : [];
      return {
        ecosystems,
        versionRecordPath:
          parsed.version_record?.path ?? DEFAULT_VERSION_RECORD_PATH,
      };
    }
    return {
      ecosystems: parseEcosystemsFromConfig(text),
      versionRecordPath: resolveVersionRecordPath(text),
    };
  }
  return { ecosystems: [], versionRecordPath: DEFAULT_VERSION_RECORD_PATH };
}

function installedVersionIn(repo) {
  return (name) => {
    const text = readRepoFile(
      repo,
      join('node_modules', ...name.split('/'), 'package.json'),
    );
    if (text === null) return null;
    try {
      const parsed = JSON.parse(text);
      return typeof parsed.version === 'string' ? parsed.version : null;
    } catch {
      return null;
    }
  };
}

function discoverScopeMembersIn(repo) {
  return (prefix) => {
    // scopePrefixFor always returns `@scope/`; the scope directory is
    // node_modules/@scope.
    const scope = prefix.replace(/\/$/, '');
    const dir = join(repo, 'node_modules', scope);
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${scope}/${entry.name}`);
  };
}

/**
 * Every declared Ecosystem, resolved against what this repo has installed.
 *
 * Separated from `run` below because the ledger command
 * (`resolve-ledger.mjs`) needs the resolution itself, not a printed line: a
 * carry-forward decision is made against a **new Baseline**, so a second copy
 * of "how this repo finds installed versions" is a second place for the two
 * commands to disagree about what the Baseline is.
 *
 * @param {{repo?: string}} [options]
 * @returns {{results: object[], ecosystems: object[], versionRecordPath: string}}
 */
export function resolveDeclaredEcosystems({ repo = process.cwd() } = {}) {
  const { ecosystems, versionRecordPath } = readAdapterConfig(repo);
  if (ecosystems.length === 0)
    return { results: [], ecosystems, versionRecordPath };

  const recordText = readRepoFile(repo, versionRecordPath);
  const recordedVersion =
    recordText === null
      ? () => null
      : (name) => findVersionInText(recordText, name);

  return {
    ecosystems,
    versionRecordPath,
    results: resolveEcosystemBaselines(
      ecosystems,
      {
        installedVersion: installedVersionIn(repo),
        discoverScopeMembers: discoverScopeMembersIn(repo),
        recordedVersion,
      },
      { recordSourceLabel: versionRecordPath },
    ),
  };
}

export function run({ repo = process.cwd() } = {}) {
  const { results, ecosystems } = resolveDeclaredEcosystems({ repo });
  if (ecosystems.length === 0)
    return [
      `${LABEL}: no ecosystems declared in ${CONFIG_PATHS[0]} (or .yaml/.json) — nothing to resolve`,
    ];

  const lines = [];
  for (const result of results) {
    if (!result.ok) {
      lines.push(`${LABEL}: ${result.lead} — FAILED: ${result.reason}`);
      continue;
    }
    lines.push(
      `${LABEL}: ${result.lead} — Baseline ${result.baseline}, ` +
        `${result.members.length} member(s): ${result.members.join(', ')}`,
    );
    for (const note of result.driftNotes) lines.push(`  drift: ${note}`);
  }
  return lines;
}

function main(argv) {
  const flagIndex = argv.indexOf('--repo');
  const repo =
    flagIndex === -1 ? process.cwd() : argv[flagIndex + 1] || process.cwd();
  for (const line of run({ repo })) console.log(line);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`)
  main(process.argv.slice(2));
