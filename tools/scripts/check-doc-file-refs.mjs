#!/usr/bin/env node
// Asserts that a backticked file-ref in tracked Markdown names something that exists.
//
//   node tools/scripts/check-doc-file-refs.mjs [--print]
//
// A file-ref is a high-confidence claim that a path or directory-scoped module exists
// in this repository (ADR 0093). PR #743 copied `migrationRunner` from issue #290 into
// an ADR addendum; the file is libs/web/vault-ui/src/lib/reconcileRunner.tsx.
// `docs:commands:check` only reads fenced shell blocks, so the wrong name reached code
// review. This gate reads inline backticks.
//
// This is an Assertion Gate in the sense of ADR 0043: it compares two artifacts — the
// file-refs a document names, and the filesystem — and names the claim that is wrong.
// It never asks whether a doc was touched. Direction of travel is one way: a named
// file that does not exist fails. The reverse (every file is mentioned in a doc) is
// omitted because no document makes that claim.
//
// What it reads: every tracked `*.md` except `docs/research/` (frozen at the date in
// the filename, ADR 0041).
// What it asserts, and only these shapes (ADR 0093):
//   1. A backticked token that starts under a known top-level directory, has no
//      spaces or ellipsis, and is not a negative existence claim, resolves on disk.
//   2. A camelCase or PascalCase identifier in the same sentence as a backticked
//      trailing-slash directory under libs/ or apps/ resolves as `{dir}/{name}`
//      plus a source extension. That is the #743 sentence.
//
// What it deliberately skips, and why:
//   - `docs/research/`. A Research Brief is frozen history; demanding its names
//     exist today would fail on the documents ADR 0041 most wants left alone.
//   - Fenced code blocks. Shell fences belong to `docs:commands:check`; other
//     fences are examples, not file-refs.
//   - Placeholders, globs, and gitignored build outputs — same judgement as
//     `docs:commands:check`.
//   - Bare filenames with no path, type names, CLI flags, JSON keys, and
//     all-lowercase identifiers. Those are not file-refs; widening needs a miss.
//   - Sentences that deny existence ("this app has no `proxy.ts`"). The claim is
//     that the file is absent; failing because it is absent would invert it.
//
// Recorded-history claims that must keep a missing name (a superseded path in a
// merged ADR) live in tools/config/doc-file-refs-exemptions.json with a written
// reason. A stale entry fails.
//
// Exit 0 = every file-ref resolves, or is exempted. Exit 1 = at least one does
// not, or an exemption is stale. Exit 2 = cannot run.
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  cleanRepoPathToken,
  createCheckerFail,
  gitIgnoredPaths,
  hasPathPlaceholder,
  isRepoPathToken,
  listTrackedMarkdown,
} from './lib/doc-paths.ts';

const PREFIX = 'doc-file-refs';
const EXEMPTIONS_PATH = 'tools/config/doc-file-refs-exemptions.json';
const SCHEMA_VERSION = 1;
const RESEARCH_PREFIX = 'docs/research/';

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.cjs'];

/** Sentences that say a path is absent are not file-refs; they are the opposite claim. */
const DENIED_EXISTENCE =
  /does not exist|do not exist|did not exist|never existed|has no |have no |do not add |do not create |do not introduce |do not invent |do not put |must not exist|never been committed|is not (?:committed|tracked|present)|no longer exists|there is no |no tracked |since renamed|\bmissing |is not a second |not a second |committed as /i;

const FENCE = /```[\s\S]*?```/g;
const INLINE_CODE = /`([^`\n]+)`/g;

const fail = createCheckerFail(PREFIX);

/** Strip wrapping punctuation a path picks up in running text. Keep a trailing slash. */
export function clean(token) {
  return cleanRepoPathToken(token);
}

export function isRepoPath(token) {
  return isRepoPathToken(token, { strict: true });
}

export function stripLineNumber(token) {
  return token.replace(/:\d+$/, '');
}

export function deniesExistence(sentence) {
  const normalized = sentence.replace(/\*\*/g, '').replace(/\s+/g, ' ');
  return DENIED_EXISTENCE.test(normalized);
}

/**
 * camelCase or multi-word PascalCase — `migrationRunner`, `vaultGate`,
 * `ComponentBuilder`. Not `session`, not `AGENTS`, not `JWT`.
 */
export function isModuleIdentifier(token) {
  if (
    !token ||
    token.includes('/') ||
    token.includes('.') ||
    hasPathPlaceholder(token)
  ) {
    return false;
  }
  if (/[^A-Za-z0-9]/.test(token)) return false;
  return (
    /^[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*$/.test(token) ||
    /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+$/.test(token) ||
    /^[A-Z][a-z0-9]+[A-Z][a-zA-Z0-9]*$/.test(token)
  );
}

function stripFences(text) {
  return text.replace(FENCE, '\n');
}

function backticks(text) {
  return [...text.matchAll(INLINE_CODE)].map((match) => clean(match[1]));
}

function isScopedDirectory(token, { exists, isDirectory }) {
  if (!token.endsWith('/')) return false;
  if (!isRepoPath(token)) return false;
  if (!(token.startsWith('libs/') || token.startsWith('apps/'))) return false;
  const path = token.replace(/\/+$/, '');
  return exists(path) && isDirectory(path);
}

function sentencesOf(paragraph) {
  return paragraph
    .split(/(?<=\.)\s+|\n\s*(?=[-*] |\d+\. )/)
    .filter((part) => part.trim());
}

/**
 * Collect file-ref claims from one Markdown document.
 * `exists` / `isDirectory` are injectable so contract tests can pin the tree.
 */
export function collectClaims(text, { exists, isDirectory }) {
  const claims = [];
  const body = stripFences(text);
  const paragraphs = body.split(/\n\s*\n/);

  const push = (kind, claim) => {
    if (!claim) return;
    claims.push({ kind, claim });
  };

  for (const paragraph of paragraphs) {
    for (const sentence of sentencesOf(paragraph)) {
      if (deniesExistence(sentence)) continue;
      const tokens = backticks(sentence).map(stripLineNumber);
      const directories = tokens.filter((token) =>
        isScopedDirectory(token, { exists, isDirectory }),
      );

      for (const token of tokens) {
        if (isRepoPath(token)) {
          push('path', token.replace(/\/+$/, ''));
          continue;
        }
        if (isModuleIdentifier(token) && directories.length > 0) {
          for (const dir of directories) {
            const base = dir.replace(/\/+$/, '');
            push('module', `${base}/${token}`);
          }
        }
      }
    }
  }

  return claims;
}

function moduleResolves(claim, exists) {
  return MODULE_EXTENSIONS.some((ext) => exists(claim + ext));
}

function pathResolves(claim, exists, tracked) {
  const path = claim.replace(/\/+$/, '');
  if (exists(path)) return true;
  const adr = path.match(/^(docs\/adr\/\d{4})$/);
  if (!adr) return false;
  const prefix = `${adr[1]}-`;
  const hits = tracked.filter(
    (file) => file.startsWith(prefix) && file.endsWith('.md'),
  );
  return hits.length === 1;
}

function readExemptions({ cwd, path = EXEMPTIONS_PATH }) {
  const absolute = join(cwd, path);
  if (!existsSync(absolute)) {
    fail(`${path} not found — the exemption list is a required artifact`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error.message}`);
  }
  if (parsed?.schemaVersion !== SCHEMA_VERSION) {
    fail(
      `${path}: expected "schemaVersion": ${SCHEMA_VERSION}, found ${JSON.stringify(parsed?.schemaVersion)}`,
    );
  }
  if (!Array.isArray(parsed?.exemptions)) {
    fail(`${path}: expected an "exemptions" array`);
  }

  const seen = new Set();
  const exemptions = [];
  parsed.exemptions.forEach((entry, index) => {
    const at = `${path}[${index}]`;
    const file = typeof entry?.file === 'string' ? entry.file.trim() : '';
    const claim = typeof entry?.claim === 'string' ? entry.claim.trim() : '';
    const reason = typeof entry?.reason === 'string' ? entry.reason.trim() : '';
    if (!file)
      fail(`${at}: entry names no documenting file (\`file\` is required)`);
    if (!claim) fail(`${at}: exemption for \`${file}\` names no claim`);
    if (!reason) {
      fail(
        `${at}: exemption for \`${file}\` → \`${claim}\` carries no written reason. ` +
          'An exemption is a decision somebody made, not a gap nobody saw.',
      );
    }
    const key = `${file}\0${claim}`;
    if (seen.has(key))
      fail(`${at}: \`${file}\` → \`${claim}\` is exempted twice`);
    seen.add(key);
    if (!existsSync(join(cwd, file))) {
      fail(
        `${at}: documenting file \`${file}\` does not exist. An exemption ` +
          'naming a file that is gone is a hole nobody sees.',
      );
    }
    exemptions.push({ file, claim, reason });
  });
  return exemptions;
}

export function exemptionKey(file, claim) {
  return `${file}\0${claim}`;
}

function main({ cwd = process.cwd(), argv = process.argv } = {}) {
  const printOnly = argv.includes('--print');
  const tracked = listTrackedMarkdown({ cwd, fail });
  const files = tracked.filter((file) => !file.startsWith(RESEARCH_PREFIX));
  if (files.length === 0) fail('no tracked Markdown files found');

  const exemptions = readExemptions({ cwd });
  const exists = (path) => existsSync(join(cwd, path));
  const isDirectory = (path) => {
    try {
      return lstatSync(join(cwd, path)).isDirectory();
    } catch {
      return false;
    }
  };

  const findings = [];
  const claimed = [];

  for (const file of files) {
    if (!exists(file)) continue;
    const text = readFileSync(join(cwd, file), 'utf8');
    const claims = collectClaims(text, { exists, isDirectory });
    for (const { kind, claim } of claims) {
      claimed.push({ file, kind, claim });
      let missing = false;
      if (kind === 'path') missing = !pathResolves(claim, exists, tracked);
      else if (kind === 'module') missing = !moduleResolves(claim, exists);
      if (missing) findings.push({ file, kind, claim });
    }
  }

  const ignored = gitIgnoredPaths(
    [...new Set(findings.filter((f) => f.kind === 'path').map((f) => f.claim))],
    { cwd, fail, includeDirectoryCandidates: true },
  );
  const live = [];
  const seenLive = new Set();
  for (const finding of findings) {
    if (finding.kind === 'path' && ignored.has(finding.claim)) continue;
    const key = exemptionKey(finding.file, finding.claim);
    if (seenLive.has(key)) continue;
    seenLive.add(key);
    live.push(finding);
  }

  const exemptionSet = new Map(
    exemptions.map((entry) => [exemptionKey(entry.file, entry.claim), entry]),
  );
  const used = new Set();
  const unexempted = [];
  for (const finding of live) {
    const key = exemptionKey(finding.file, finding.claim);
    if (exemptionSet.has(key)) {
      used.add(key);
      continue;
    }
    unexempted.push(finding);
  }

  const stale = [];
  for (const [key, entry] of exemptionSet) {
    if (used.has(key)) continue;
    stale.push(entry);
  }

  if (printOnly) {
    console.log(
      `${PREFIX}: ${claimed.length} file-ref(s) across ${files.length} Markdown files, ` +
        `${exemptions.length} exemption(s)`,
    );
    for (const { file, kind, claim } of claimed) {
      console.log(`  ${kind}: ${file} → ${claim}`);
    }
  }

  const errors = [];
  if (unexempted.length > 0) {
    errors.push(`${unexempted.length} file-ref(s) do not resolve`);
  }
  if (stale.length > 0) {
    errors.push(
      `${stale.length} exemption(s) are stale (the claim is gone, or the file exists again)`,
    );
  }

  if (errors.length > 0) {
    console.error(`${PREFIX}: ${errors.join('; ')}\n`);
    for (const { file, claim } of unexempted) {
      console.error(`  - ${file} → ${claim}`);
    }
    for (const { file, claim } of stale) {
      console.error(`  - stale exemption: ${file} → ${claim}`);
    }
    console.error(
      '\nEither commit the file, correct the doc, or add a written-reason exemption' +
        `\nin ${EXEMPTIONS_PATH} (ADR 0093). A stale exemption is removed, not kept.`,
    );
    process.exit(1);
  }

  console.log(
    `${PREFIX}: OK — ${claimed.length} file-ref(s) across ${files.length} Markdown files resolve` +
      (exemptions.length ? `, ${exemptions.length} exempted` : ''),
  );
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) main();
