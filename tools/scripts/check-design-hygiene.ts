#!/usr/bin/env node

/**
 * Deterministic mechanical checks for House Explainer Pages — the self-contained
 * HTML artifacts the Designer sub-agent produces (`.github/agents/designer.agent.md`).
 *
 * Companion to check-test-hygiene.ts and check-component-hygiene.ts. The rules
 * live in tools/scripts/lib/design-page-scan.ts, which is pure; this file reads
 * the filesystem facts those rules compare against and decides what is in scope.
 *
 * Scope is an explicit roster, not a glob. `docs/**` holds three lineages of HTML
 * page and only one of them is this convention: the Claude Design canvas exports
 * carry a bundled runtime with CDN fallback strings, and two pages predate the
 * three-state theme block. Globbing would fail them all on day one and teach
 * everyone to pass --no-verify. Every page under docs/ is therefore either in
 * ROSTER or in LEGACY with a written reason, and a page in neither is a finding
 * — so a new page cannot escape the gate by being new (ADR 0043). The one
 * exception is a directory, not a page: docs/design/ holds approved design
 * exports, kept as approved (ADR 0110).
 *
 * A LEGACY reason buys an exemption from mechanical-hygiene rules only — none of
 * the five written reasons are about being wrong — so a LEGACY page still runs
 * the factual-assertion rules (the citation rules) and can still fail (ADR 0085).
 * A page in neither list gets no rules at all: it carries no citation contract
 * to hold it to.
 *
 * The citation rules run both ways between a page's citations and its
 * `citation-anchors` block. Citation → anchor: every citation resolves, carries
 * an anchor, and matches it. Anchor → citation: every entry keys a citation the
 * gate reads, because an entry nothing looks up can quote anything (#822) — and
 * the anchor baseline excuses only the first direction. Both are bounded by what
 * the scanner reads as a citation. A comma-separated continuation written
 * without its colon (`main.mts:153, 205`) is not read, and is reported as such;
 * one joined any other way (`153 and 205`), or split across elements, is not
 * read and not reported. A citation rendered from script data is read from the
 * string literals of every non-JSON `<script>` (#982), under a narrower grammar
 * than markup because script is full of `name:digit` shapes that are not
 * citations: a name counts only with a known file extension, and a bare `:line`
 * inherits only a file cited earlier in the same string. What that leaves out —
 * a script comment, script code, a bare line in a string naming no file, and a
 * string the lexer loses where it mistakes a regex literal for a division — is
 * not read and not reported, so it is a claim this gate does not check.
 *
 * A `citation-anchors` block that is present and unreadable (invalid JSON, or
 * no `anchors` map) is itself a finding: it asserts nothing, and is not the
 * same as a page that carries no block.
 *
 * Usage:
 *   node tools/scripts/check-design-hygiene.ts <file> [<file> ...]
 *   node tools/scripts/check-design-hygiene.ts --json <file>
 *   node tools/scripts/check-design-hygiene.ts --all
 *   node tools/scripts/check-design-hygiene.ts --staged
 *   node tools/scripts/check-design-hygiene.ts --print-font-block
 *
 * Exit codes: 0 = clean, 1 = findings, 2 = bad invocation.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  fontBlock,
  fontBlockHash,
  scanDesignPage,
  scanFactualAssertions,
  type GetFileContent,
  type ResolveCitation,
} from './lib/design-page-scan.ts';
// The roster is its own module so it has one definition. A CLI cannot export a
// const without running its main body on import, so keeping it here forced the
// contract suite to hand-copy the list, and the copy rotted the first time the
// roster grew.
import {
  CANONICAL_FONT_PAGE,
  DESIGN_EXPORTS_DIR,
  LEGACY,
  ROSTER,
} from './lib/design-page-roster.ts';
import { readBaselineEnvelope } from './lib/baseline-file.ts';
import {
  citableLines,
  reportFindings,
  type Finding,
  type FindingResult,
} from './lib/source-scan.ts';

// Pages whose citations are not yet anchored (ADR 0085; PRD #772). The rule is
// per citation, so this list is the only thing holding a page back from it — and
// it can only shrink: an entry whose page is fully anchored is reported as stale.
const ANCHOR_BASELINE_FILE = 'tools/config/citation-anchor-baseline.json';
const anchorBaseline = new Set(
  readBaselineEnvelope({
    path: ANCHOR_BASELINE_FILE,
    schemaVersion: 1,
  }).baseline,
);

const USAGE = `Usage:
  node tools/scripts/check-design-hygiene.ts <file> [<file> ...]
  node tools/scripts/check-design-hygiene.ts --json <file> [<file> ...]
  node tools/scripts/check-design-hygiene.ts --all
  node tools/scripts/check-design-hygiene.ts --staged
  node tools/scripts/check-design-hygiene.ts --print-font-block

Runs the mechanical House Explainer Page rules over the pages in ROSTER.
Judgment — is the hero the right hero, is the prose true — stays with review.

--print-font-block writes the canonical @font-face block to stdout so a new page
can splice it verbatim. Retyping or re-encoding it is what font-block-drift catches.
`;

const DOCS_DIR = 'docs';

function posix(file: string): string {
  return path.normalize(file).split(path.sep).join('/');
}

/**
 * The command line, once read. `printFontBlock` short-circuits everything
 * else, so every other field is absent on that path rather than defaulted.
 */
interface DesignHygieneOptions {
  printFontBlock: boolean;
  json?: boolean;
  all?: boolean;
  staged?: boolean;
  files?: string[];
}

function parseArgs(argv: string[]): DesignHygieneOptions {
  const args = argv.slice(2);
  const printFontBlock = args.includes('--print-font-block');
  const json = args.includes('--json');
  const all = args.includes('--all');
  const staged = args.includes('--staged');
  const files = args.filter((a) => !a.startsWith('--'));

  if (printFontBlock) return { printFontBlock };
  if (all && staged)
    throw new Error('--all and --staged are mutually exclusive.');
  if (!all && !staged && files.length === 0) throw new Error(USAGE);
  if ((all || staged) && files.length > 0) {
    throw new Error('--all and --staged take no file arguments.');
  }
  return { printFontBlock, json, all, staged, files };
}

function stagedHtmlFiles() {
  const out = execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=ACMRT'],
    { encoding: 'utf8' },
  );
  return out
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f.endsWith('.html'));
}

function htmlPagesUnderDocs() {
  const out = [];
  (function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const p = path.join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry.endsWith('.html')) out.push(posix(p));
    }
  })(DOCS_DIR);
  return out.sort();
}

/**
 * .prettierignore membership. Matches the exact path or a directory prefix, which
 * is the only shape this file uses for HTML pages.
 */
function prettierIgnoreMatcher(): (file: string) => boolean {
  if (!existsSync('.prettierignore')) return () => false;
  const patterns = readFileSync('.prettierignore', 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => (l.startsWith('/') ? l.slice(1) : l));
  return (file) =>
    patterns.some((p) => file === p || (p.endsWith('/') && file.startsWith(p)));
}

/**
 * Every git-tracked file, indexed by basename. A citation with a `/` in its name
 * is checked as a repo-relative path directly; a bare name (`ci.yml`, `SKILL.md`)
 * has to be found first, and more than one tracked file can share a basename.
 *
 * Reads the index with `git ls-files` rather than walking the filesystem, the
 * same way `stagedHtmlFiles` above already does — `node_modules` alone is
 * gigabytes, and git already knows what belongs to the tree. Outside a git
 * checkout this returns an empty index rather than throwing, so a bare-name
 * citation reports unresolved instead of crashing the run.
 */
function basenameIndex(): Map<string, string[]> {
  let out;
  try {
    out = execFileSync('git', ['ls-files'], { encoding: 'utf8' });
  } catch {
    return new Map();
  }
  const index = new Map<string, string[]>();
  for (const f of out.split('\n').filter(Boolean)) {
    // `split` always yields a last segment; the fallback is for the type only.
    const base = f.split('/').pop() ?? f;
    const paths = index.get(base) ?? [];
    paths.push(f);
    index.set(base, paths);
  }
  return index;
}

function lineCount(file: string): number | null {
  try {
    return citableLines(readFileSync(file, 'utf8')).length;
  } catch {
    return null;
  }
}

/**
 * Builds the `resolveCitation` callback `scanDesignPage`/`scanFactualAssertions`
 * ask for each citation. See `checkCitations` in design-page-scan.ts for what
 * "resolves" deliberately does and does not prove.
 *
 * A citation's name is matched by path *suffix* against the basename index, not
 * by an exact repo-root-relative path — `skill-atlas.html` cites
 * `implement/SKILL.md`, two segments short of its real
 * `.agents/skills/implement/SKILL.md`, and readers are trusted to fill in the
 * directory a page's own domain implies. A single-segment name (`ci.yml`) is
 * the same match with a one-segment suffix; a full repo-relative path
 * (`docs/adr/0012-….md`) is the same match again, just with a suffix equal to
 * the whole tracked path.
 */
function makeCitationResolver(index: Map<string, string[]>): ResolveCitation {
  return ({ name, line, endLine }) => {
    const need = Math.max(line, endLine);
    const span = endLine !== line ? `${line}-${endLine}` : `${line}`;
    // As in `basenameIndex`: the fallback only satisfies the type.
    const base = name.split('/').pop() ?? name;
    const candidates = (index.get(base) ?? []).filter(
      (path) => path === name || path.endsWith(`/${name}`),
    );
    if (candidates.length === 0) {
      return {
        ok: false,
        reason: `${name}:${span} cites a file that does not exist in the tree.`,
      };
    }
    const counts = candidates
      .map(lineCount)
      .filter((n): n is number => n !== null);
    if (!counts.some((n) => n >= need)) {
      const longest = counts.length ? Math.max(...counts) : 0;
      return {
        ok: false,
        reason: `${name}:${span} cites line ${need}, past the end of every ${name} in the tree (longest is ${longest} line(s)).`,
      };
    }
    // Return the first matching candidate path for anchor verification
    const resolvedPath = candidates.find((path) => {
      const count = lineCount(path);
      return count !== null && count >= need;
    });
    return { ok: true, filePath: resolvedPath };
  };
}

/**
 * Creates a function to read file content by path for anchor verification.
 */
function makeFileContentGetter(): GetFileContent {
  const cache = new Map<string, string | null>();
  return (filePath) => {
    if (!filePath) return null;
    const cached = cache.get(filePath);
    if (cached !== undefined) return cached;
    let content: string | null;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      content = null;
    }
    cache.set(filePath, content);
    return content;
  };
}

// --- run ---------------------------------------------------------------------

let options: DesignHygieneOptions;
try {
  options = parseArgs(process.argv);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
}

if (!existsSync(CANONICAL_FONT_PAGE)) {
  console.error(
    `design-hygiene: canonical font page ${CANONICAL_FONT_PAGE} not found — cannot compare @font-face blocks.`,
  );
  process.exit(2);
}
const canonicalSource = readFileSync(CANONICAL_FONT_PAGE, 'utf8');
const canonicalFontHash = fontBlockHash(canonicalSource);
const canonicalFontBlock = fontBlock(canonicalSource);
if (canonicalFontHash === null || canonicalFontBlock === null) {
  console.error(
    `design-hygiene: ${CANONICAL_FONT_PAGE} carries no @font-face block — the canonical block moved.`,
  );
  process.exit(2);
}

if (options.printFontBlock) {
  process.stdout.write(canonicalFontBlock);
  process.exit(0);
}

const isPrettierIgnored = prettierIgnoreMatcher();
const resolveCitation = makeCitationResolver(basenameIndex());
const getFileContent = makeFileContentGetter();
const results: FindingResult[] = [];

// A page under docs/ that is in neither list is unclassified: nobody decided
// whether it follows the convention, which is how the convention stops spreading.
// An approved design under docs/design/ is decided already (ADR 0110): it is an
// export kept as approved, not a page written to this convention.
if (options.all) {
  for (const page of htmlPagesUnderDocs()) {
    if (ROSTER.includes(page) || page in LEGACY) continue;
    if (page.startsWith(DESIGN_EXPORTS_DIR)) continue;
    results.push({
      file: page,
      findings: [
        {
          level: 'error',
          rule: 'unclassified-page',
          line: 1,
          message:
            'Not in ROSTER and not in LEGACY. Add it to ROSTER if it follows the House Explainer Page convention, or to LEGACY with the reason it does not (tools/scripts/check-design-hygiene.ts).',
        },
      ],
    });
  }
}

const selected = options.all
  ? [...ROSTER, ...Object.keys(LEGACY)]
  : (options.staged ? stagedHtmlFiles() : (options.files ?? [])).map(posix);

for (const file of selected) {
  const inRoster = ROSTER.includes(file);
  const legacyReason = LEGACY[file];
  const inLegacy = legacyReason !== undefined;

  // Neither ROSTER nor LEGACY: not a House Explainer Page at all, so even the
  // factual-assertion rules do not apply — there is no citation contract to hold
  // an arbitrary file under docs/ to.
  if (!inRoster && !inLegacy) {
    results.push({
      file,
      skipped: 'not a House Explainer Page',
      findings: [],
    });
    continue;
  }

  if (!existsSync(file)) {
    results.push({
      file,
      ...(inLegacy ? { skipped: legacyReason } : {}),
      findings: [
        {
          level: 'error',
          rule: 'page-missing',
          line: 1,
          message: `Listed in ${inRoster ? 'ROSTER' : 'LEGACY'} but not present on disk.`,
        },
      ],
    });
    continue;
  }

  const source = readFileSync(file, 'utf8');
  // LEGACY still honours its written reason for mechanical-hygiene rules — it
  // just no longer buys an exemption from the factual-assertion ones (ADR 0085).
  const requireAnchors = !anchorBaseline.has(file);
  const findings: Finding[] = (
    inRoster
      ? scanDesignPage({
          file,
          source,
          canonicalFontHash,
          pageFontHash: fontBlockHash(source),
          prettierIgnored: isPrettierIgnored(file),
          adrLinkExists: (resolved) => existsSync(resolved),
          resolveCitation,
          getFileContent,
          requireAnchors,
        })
      : scanFactualAssertions({
          source,
          resolveCitation,
          getFileContent,
          requireAnchors,
        })
  ).map((finding) => ({ level: 'error', ...finding }));

  // A baselined page that now anchors everything has to leave the list, or the
  // list stops meaning "not yet anchored" and starts meaning nothing at all.
  if (
    !requireAnchors &&
    scanFactualAssertions({ source, resolveCitation, getFileContent }).every(
      (finding) => finding.rule !== 'citation-missing-anchor',
    )
  ) {
    findings.push({
      level: 'error',
      rule: 'citation-anchor-baseline-stale',
      line: 1,
      message: `Every citation on this page carries an anchor, so its entry in ${ANCHOR_BASELINE_FILE} is stale. Remove it — the baseline only shrinks.`,
    });
  }
  results.push({
    file,
    ...(inLegacy ? { skipped: legacyReason } : {}),
    findings,
  });
}

const errors = results.reduce((n, r) => n + r.findings.length, 0);

if (options.json) {
  process.stdout.write(`${JSON.stringify({ errors, results }, null, 2)}\n`);
} else {
  reportFindings(results, 'Design hygiene');
}

process.exit(errors > 0 ? 1 : 0);
