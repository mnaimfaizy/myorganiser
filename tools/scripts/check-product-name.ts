#!/usr/bin/env node
// Asserts that no tracked file spells the product the old "-izer" way, outside
// an allowlist of paths (ADR 0132, PRD #1172).
//
//   node tools/scripts/check-product-name.ts
//
// Direction asserted: old spelling present → failure. Every tracked file's
// path and text are matched case-insensitively, so `MyOrgani…zer`, the lower-
// case identifier and the upper-case constant all fail, each named by file
// and line. The allowlist (tools/config/product-name-allowlist.json) excuses
// paths, never values: a directory, one file, or one file from a `frozenFrom`
// line downward (CHANGELOG history). An allowlist entry that names no tracked
// file, excuses nothing, or whose `frozenFrom` matches no line is stale and
// fails too, so the list can only shrink.
//
// Direction omitted: new spelling absent → nothing. The check does not assert
// that "MyOrganiser" appears anywhere, nor that a string which should name
// the product does. A deleted product name is not a misspelled one, and which
// strings ought to carry the name is a judgment the tests at each brand seam
// make (email shell, BrandMark, legal content). Spaced or hyphenated variants
// are not matched either; none exist, and matching them would catch the
// ordinary English word.
//
// The old spelling is assembled from parts below so this file does not
// excuse itself.
//
// Exit 0 = clean. Exit 1 = drift or a stale allowlist entry. Exit 2 = the
// check could not run.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWLIST_PATH = 'tools/config/product-name-allowlist.json';
const OLD_SPELLING = new RegExp(['myorgani', 'zer'].join(''), 'i');

const fail: (msg: string) => never = (msg) => {
  console.error(`product-name: ${msg}`);
  process.exit(2);
};

function listTrackedFiles(cwd: string): string[] {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(`git ls-files failed: ${result.stderr || result.error}`);
  }
  return result.stdout.split('\0').filter(Boolean);
}

/** An allowlist entry as the config file writes it, before validation. */
interface AllowlistSource {
  path?: string;
  reason?: string;
  frozenFrom?: string;
}

/** A validated allowlist entry, carrying the tally one run accumulates on it. */
interface AllowlistEntry {
  path: string;
  frozenFrom: RegExp | null;
  tracked: number;
  excused: number;
  frozenLine: number | null;
}

function readAllowlist(cwd: string): AllowlistEntry[] {
  const absolute = join(cwd, ALLOWLIST_PATH);
  if (!existsSync(absolute)) fail(`${ALLOWLIST_PATH} not found`);
  let parsed: { allowlist?: unknown };
  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    fail(
      `${ALLOWLIST_PATH} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed.allowlist)) {
    fail(`${ALLOWLIST_PATH} has no "allowlist" array`);
  }
  return (parsed.allowlist as AllowlistSource[]).map((entry, index) => {
    const where = `${ALLOWLIST_PATH} entry ${index}`;
    if (typeof entry.path !== 'string' || entry.path === '') {
      fail(`${where} has no "path"`);
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      fail(`${where} (${entry.path}) has no written "reason"`);
    }
    let frozenFrom: RegExp | null = null;
    if (entry.frozenFrom !== undefined) {
      if (entry.path.endsWith('/')) {
        fail(`${where} (${entry.path}) puts "frozenFrom" on a directory`);
      }
      try {
        frozenFrom = new RegExp(entry.frozenFrom);
      } catch (error) {
        fail(
          `${where} (${entry.path}) has an invalid "frozenFrom": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return {
      path: entry.path,
      frozenFrom,
      tracked: 0,
      excused: 0,
      frozenLine: null,
    };
  });
}

const covers = (entry: AllowlistEntry, file: string) =>
  entry.path.endsWith('/') ? file.startsWith(entry.path) : file === entry.path;

function main({ cwd = process.cwd() } = {}) {
  const files = listTrackedFiles(cwd);
  const allowlist = readAllowlist(cwd);
  const findings: string[] = [];

  for (const file of files) {
    const entry = allowlist.find((candidate) => covers(candidate, file));
    if (entry) entry.tracked += 1;

    if (OLD_SPELLING.test(file) && !(entry && !entry.frozenFrom)) {
      findings.push(`${file}: the path itself`);
    }

    const absolute = join(cwd, file);
    // A deleted-but-staged path, a submodule or a symlink to a directory
    // carries no text of its own to read.
    if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
    const buffer = readFileSync(absolute);
    if (buffer.includes(0)) continue;
    const lines = buffer.toString('utf8').split('\n');

    let frozenAt = Infinity;
    const frozenFrom = entry?.frozenFrom;
    if (frozenFrom) {
      const index = lines.findIndex((line) => frozenFrom.test(line));
      if (index !== -1) {
        frozenAt = index;
        entry.frozenLine = index + 1;
      }
    }

    lines.forEach((line, index) => {
      if (!OLD_SPELLING.test(line)) return;
      const excused = entry && (!entry.frozenFrom || index >= frozenAt);
      if (excused) {
        entry.excused += 1;
        return;
      }
      findings.push(`${file}:${index + 1}: ${line.trim().slice(0, 160)}`);
    });
  }

  const stale: string[] = [];
  for (const entry of allowlist) {
    if (entry.tracked === 0) {
      stale.push(`${entry.path}: names no tracked file`);
    } else if (entry.frozenFrom && entry.frozenLine === null) {
      stale.push(`${entry.path}: "frozenFrom" matches no line`);
    } else if (entry.excused === 0) {
      stale.push(`${entry.path}: excuses no occurrence — remove the entry`);
    }
  }

  if (findings.length || stale.length) {
    if (findings.length) {
      console.error(
        'product-name: tracked files still use the old product spelling (ADR 0132)\n',
      );
      for (const finding of findings) console.error(`  ${finding}`);
      console.error(
        `\nRename to MyOrganiser / myorganiser, or — only for frozen history — add the path with a reason to ${ALLOWLIST_PATH}.`,
      );
    }
    if (stale.length) {
      console.error(`\nproduct-name: stale entries in ${ALLOWLIST_PATH}\n`);
      for (const entry of stale) console.error(`  ${entry}`);
    }
    process.exit(1);
  }

  console.log(
    `product-name: OK — ${files.length} tracked file(s) checked, ${allowlist.length} allowlisted path(s)`,
  );
}

main();
