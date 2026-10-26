import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CANONICAL_FONT_PAGE,
  LEGACY,
  ROSTER,
} from './lib/design-page-roster.mjs';
import { isolateGitEnvironment } from './lib/git-environment.mjs';

// Husky runs this suite with the hook's GIT_DIR; see git-environment.mjs.
isolateGitEnvironment();

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CHECKER_SOURCE = join(SCRIPT_DIR, 'check-design-hygiene.mjs');
const SCAN_SOURCE = join(SCRIPT_DIR, 'lib', 'design-page-scan.mjs');
const SHARED_SCAN_SOURCE = join(SCRIPT_DIR, 'lib', 'source-scan.mjs');
const ROSTER_SOURCE = join(SCRIPT_DIR, 'lib', 'design-page-roster.mjs');
const BASELINE_LIB_SOURCE = join(SCRIPT_DIR, 'lib', 'baseline-file.mjs');
const ANCHOR_BASELINE_FILE = 'tools/config/citation-anchor-baseline.json';

const FONT_BLOCK =
  '@font-face { font-family: Caprasimo; src: url(data:font/woff2;base64,AAAA); }';

function write(workspace, relativePath, content) {
  const file = join(workspace, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return relativePath;
}

/** A page that satisfies every rule, so each test can break exactly one thing. */
function housePage(title) {
  return [
    `<title>${title}</title>`,
    '<style>',
    FONT_BLOCK,
    ':root { --ink: #101010; }',
    '@media (prefers-color-scheme: dark) {',
    "  :root:not([data-theme='light']) { --ink: #f0f0f0; }",
    '}',
    ":root[data-theme='dark'] { --ink: #f0f0f0; }",
    '</style>',
    '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
    `<script type="application/json" id="${title}-manifest">{ "note": "x" }</script>`,
  ].join('\n');
}

// Derived from the checker's own roster, not copied from it. A hand-kept copy went
// stale the first time the roster grew: the fixture came up one page short and two
// tests failed with `page-missing`, a bookkeeping failure dressed as a page defect.
const ROSTER_PAGES = ROSTER;
const LEGACY_PAGES = Object.keys(LEGACY);

// Every page the fixture must write. CANONICAL_FONT_PAGE is a LEGACY entry today
// and is listed anyway, so the fixture does not depend on it staying one.
const FIXTURE_PAGES = [
  ...new Set([...ROSTER_PAGES, ...LEGACY_PAGES, CANONICAL_FONT_PAGE]),
];

function createWorkspace(t) {
  const workspace = mkdtempSync(join(tmpdir(), 'design-hygiene-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  write(
    workspace,
    'tools/scripts/check-design-hygiene.mjs',
    readFileSync(CHECKER_SOURCE, 'utf8'),
  );
  write(
    workspace,
    'tools/scripts/lib/design-page-scan.mjs',
    readFileSync(SCAN_SOURCE, 'utf8'),
  );
  write(
    workspace,
    'tools/scripts/lib/source-scan.mjs',
    readFileSync(SHARED_SCAN_SOURCE, 'utf8'),
  );
  write(
    workspace,
    'tools/scripts/lib/design-page-roster.mjs',
    readFileSync(ROSTER_SOURCE, 'utf8'),
  );
  write(
    workspace,
    'tools/scripts/lib/baseline-file.mjs',
    readFileSync(BASELINE_LIB_SOURCE, 'utf8'),
  );
  // Empty by default: a fixture page carrying an unanchored citation is held to
  // the rule unless a test puts it on the list itself.
  writeAnchorBaseline(workspace, []);

  for (const page of FIXTURE_PAGES) {
    write(
      workspace,
      page,
      housePage(page.split('/').pop().replace('.html', '')),
    );
  }
  write(workspace, '.prettierignore', FIXTURE_PAGES.join('\n'));

  // The checker resolves a bare-name citation with `git ls-files` (basenameIndex,
  // check-design-hygiene.mjs), so citation tests need a real index to search —
  // not a commit, just files staged so `git ls-files` can see them.
  spawnSync('git', ['init', '-q'], { cwd: workspace });
  spawnSync('git', ['add', '-A'], { cwd: workspace });

  return workspace;
}

function writeAnchorBaseline(workspace, pages) {
  write(
    workspace,
    ANCHOR_BASELINE_FILE,
    `${JSON.stringify({ schemaVersion: 1, baseline: pages }, null, 2)}\n`,
  );
}

/** A page carrying one citation, with an anchor map only when `anchor` is given. */
function pageWithCitation(title, { citation, anchor }) {
  const blocks = [`<span class="cite">${citation}</span>`];
  if (anchor) {
    blocks.push(
      `<script type="application/json" id="citation-anchors">${JSON.stringify({
        anchors: anchor,
      })}</script>`,
    );
  }
  return housePage(title).replace(
    '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
    [
      '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
      ...blocks,
    ].join('\n'),
  );
}

function run(workspace, ...args) {
  return spawnSync(
    process.execPath,
    [join(workspace, 'tools/scripts/check-design-hygiene.mjs'), ...args],
    { cwd: workspace, encoding: 'utf8' },
  );
}

test('a clean roster exits 0 and reports the page count', (t) => {
  const workspace = createWorkspace(t);
  const result = run(workspace, '--all');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Design hygiene: 0 error\(s\), 0 warning\(s\)/);
  for (const page of ROSTER_PAGES) assert.ok(result.stdout.includes(page));
});

test('a defect on a roster page exits 1 and names the file and rule', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/sandcastle/gates.html',
    housePage('gates').replace(
      '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
      '<svg viewBox="0 0 10 10" role="img"><title>Gates</title></svg>',
    ),
  );
  const result = run(workspace, '--all');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /docs\/sandcastle\/gates\.html/);
  assert.match(result.stdout, /ERROR svg-title-tooltip/);
  assert.match(result.stdout, /Design hygiene: 1 error\(s\)/);
});

test('an unclassified page under docs/ is a finding under --all', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'docs/newthing/overview.html', housePage('overview'));
  const result = run(workspace, '--all');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /docs\/newthing\/overview\.html/);
  assert.match(result.stdout, /ERROR unclassified-page/);
});

test('an approved design export under docs/design/ is not an unclassified page', (t) => {
  const workspace = createWorkspace(t);
  // A canvas artboard as exported: no theme block, no canonical fonts, a CDN
  // stylesheet — everything the convention forbids, kept as it was approved.
  write(
    workspace,
    'docs/design/mobile-v1/artboards/Task-List.dc.html',
    '<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet"></head><body><div style="width: 390px">Tasks</div></body></html>',
  );
  const result = run(workspace, '--all');
  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /Task-List\.dc\.html/);
});

test('the design exclusion is the directory, not a name that starts like it', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'docs/designs/overview.html', housePage('overview'));
  const result = run(workspace, '--all');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /docs\/designs\/overview\.html/);
  assert.match(result.stdout, /ERROR unclassified-page/);
});

test('a legacy page is skipped rather than failed, with its reason', (t) => {
  const workspace = createWorkspace(t);
  const result = run(workspace, 'docs/agents/skill-atlas.html');
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /docs\/agents\/skill-atlas\.html\s+SKIPPED \(Carries no @font-face/,
  );
});

// --- the LEGACY split (ADR 0085) ----------------------------------------------
//
// A LEGACY reason exempts a page from the mechanical-hygiene rules only. The
// citation rule is a factual-assertion rule, so it still runs — and still fails
// — over a page every other rule skips.

test('a legacy page with an unresolvable citation still fails', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/agents/skill-atlas.html',
    housePage('skill-atlas').replace(
      '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
      [
        '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
        '<span class="cite">nonexistent-source.yml:5</span>',
      ].join('\n'),
    ),
  );

  const result = run(workspace, 'docs/agents/skill-atlas.html');

  assert.equal(result.status, 1);
  // Still exempt from the mechanical rules — SKIPPED prints — and still failed
  // by the factual one, in the same report.
  assert.match(result.stdout, /SKIPPED \(Carries no @font-face/);
  assert.match(result.stdout, /ERROR citation-unresolved/);
  assert.match(result.stdout, /nonexistent-source\.yml/);
});

test('the same legacy page with only a non-canonical font block still passes — that reason stays exempt', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/agents/skill-atlas.html',
    housePage('skill-atlas').replace(
      FONT_BLOCK,
      '@font-face { font-family: Impostor; src: url(data:font/woff2;base64,ZZZZ); }',
    ),
  );

  const result = run(workspace, 'docs/agents/skill-atlas.html');

  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /font-block-drift/);
  assert.match(result.stdout, /SKIPPED/);
});

// --- an anchor nobody can check is not a passing anchor -----------------------

test('an anchor naming a file that cannot be read is a finding, not a skip', (t) => {
  // Falling through silently would let a citation pass by naming a file nobody
  // can read — a claim asserted by nothing, which is the defect this gate is for.
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/sandcastle/waves.html',
    pageWithCitation('waves', {
      citation: 'tools/scripts/lib/source-scan.mjs:2',
      anchor: {
        'tools/scripts/lib/source-scan.mjs:2': {
          file: 'does/not/exist.mjs',
          start: 'whatever text',
        },
      },
    }),
  );

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR citation-anchor-unreadable/);
  assert.match(result.stdout, /does\/not\/exist\.mjs/);
});

test('an anchor whose cited line is past the end of its own file is a finding', (t) => {
  // The citation resolves against short.txt, which is long enough; the anchor
  // names a shorter file, so the cited line is past the end of the file the
  // comparison actually reads.
  const workspace = createWorkspace(t);
  write(workspace, 'short.txt', 'one\ntwo\n');
  write(workspace, 'shorter.txt', 'only one line\n');
  write(
    workspace,
    'docs/sandcastle/waves.html',
    pageWithCitation('waves', {
      citation: 'short.txt:2',
      anchor: {
        'short.txt:2': { file: 'shorter.txt', start: 'two' },
      },
    }),
  );
  spawnSync('git', ['add', '-A'], { cwd: workspace });

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR citation-anchor-unreadable/);
  assert.match(result.stdout, /1 line\(s\)/);
});

// --- the anchor requirement is per citation, not per page (ADR 0085) ----------
//
// Keyed off the presence of a `citation-anchors` block, the rule would hold only
// the page that already opted in — every other cited page would pass by carrying
// nothing. The baseline is the migration hatch, and it can only shrink.

test('a citation with no anchor fails on a page the baseline does not name', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/sandcastle/waves.html',
    pageWithCitation('waves', {
      citation: 'tools/scripts/lib/source-scan.mjs:2',
    }),
  );

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR citation-missing-anchor/);
  assert.match(result.stdout, /source-scan\.mjs:2/);
});

test('the same citation passes while its page is on the anchor baseline', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/sandcastle/waves.html',
    pageWithCitation('waves', {
      citation: 'tools/scripts/lib/source-scan.mjs:2',
    }),
  );
  writeAnchorBaseline(workspace, ['docs/sandcastle/waves.html']);

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /citation-missing-anchor/);
});

test('a baselined page is still held to citation resolution — the hatch is only about anchors', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/sandcastle/waves.html',
    pageWithCitation('waves', { citation: 'nonexistent-source.yml:5' }),
  );
  writeAnchorBaseline(workspace, ['docs/sandcastle/waves.html']);

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR citation-unresolved/);
});

test('a baselined page whose citations are all anchored is reported as a stale entry', (t) => {
  // Otherwise the list stops meaning "not yet anchored" and starts meaning
  // nothing at all, which is the defect this PRD is named for.
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/sandcastle/waves.html',
    pageWithCitation('waves', {
      citation: 'tools/scripts/lib/source-scan.mjs:2',
      anchor: {
        'tools/scripts/lib/source-scan.mjs:2': {
          file: 'tools/scripts/lib/source-scan.mjs',
          start: readFileSync(
            join(workspace, 'tools/scripts/lib/source-scan.mjs'),
            'utf8',
          ).split('\n')[1],
        },
      },
    }),
  );
  writeAnchorBaseline(workspace, ['docs/sandcastle/waves.html']);

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR citation-anchor-baseline-stale/);
  assert.match(result.stdout, /citation-anchor-baseline\.json/);
});

// --- an anchor that keys no citation is an unasserted claim (#822) ------------
//
// The rules above run from a citation to its anchor. The reverse direction is
// the one four sandcastle pages passed review on: an entry the gate never looks
// up can quote anything, and reads as though it had been checked.

/** An anchor quoting `tools/scripts/lib/source-scan.mjs` at 1-based `line`. */
function sourceScanAnchor(workspace, line) {
  return {
    file: 'tools/scripts/lib/source-scan.mjs',
    start: readFileSync(
      join(workspace, 'tools/scripts/lib/source-scan.mjs'),
      'utf8',
    ).split('\n')[line - 1],
  };
}

test('an anchor that keys no citation on the page fails, even when what it quotes is true', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/sandcastle/waves.html',
    pageWithCitation('waves', {
      citation: 'tools/scripts/lib/source-scan.mjs:2',
      anchor: {
        'tools/scripts/lib/source-scan.mjs:2': sourceScanAnchor(workspace, 2),
        'tools/scripts/lib/source-scan.mjs:3': sourceScanAnchor(workspace, 3),
      },
    }),
  );

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR citation-anchor-orphan/);
  assert.match(result.stdout, /source-scan\.mjs:3/);
  assert.doesNotMatch(result.stdout, /citation-anchor-mismatch/);
});

test('the anchor baseline does not excuse an orphan anchor — the hatch is about absent anchors', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/sandcastle/waves.html',
    pageWithCitation('waves', {
      citation: 'tools/scripts/lib/source-scan.mjs:2',
      anchor: {
        'tools/scripts/lib/source-scan.mjs:3': sourceScanAnchor(workspace, 3),
      },
    }),
  );
  writeAnchorBaseline(workspace, ['docs/sandcastle/waves.html']);

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR citation-anchor-orphan/);
  assert.doesNotMatch(result.stdout, /citation-missing-anchor/);
  assert.doesNotMatch(result.stdout, /citation-anchor-baseline-stale/);
});

test('a legacy page with an orphan anchor still fails', (t) => {
  const workspace = createWorkspace(t);
  const page = 'docs/agents/skill-atlas.html';
  write(
    workspace,
    page,
    pageWithCitation('legacy', {
      citation: 'tools/scripts/lib/source-scan.mjs:2',
      anchor: {
        'tools/scripts/lib/source-scan.mjs:2': sourceScanAnchor(workspace, 2),
        'tools/scripts/lib/source-scan.mjs:3': sourceScanAnchor(workspace, 3),
      },
    }),
  );

  const result = run(workspace, page);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR citation-anchor-orphan/);
});

test('a continuation line with no leading colon fails — the gate cannot read it', (t) => {
  // `source-scan.mjs:2, 3` renders as two cited lines and parses as one. The
  // house form is `:2, :3`.
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/sandcastle/waves.html',
    pageWithCitation('waves', {
      citation: 'tools/scripts/lib/source-scan.mjs:2, 3',
      anchor: {
        'tools/scripts/lib/source-scan.mjs:2': sourceScanAnchor(workspace, 2),
      },
    }),
  );

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR citation-continuation-unparsed/);
  assert.doesNotMatch(result.stdout, /citation-anchor-orphan/);
});

test('the same lines written in the house continuation form pass', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/sandcastle/waves.html',
    pageWithCitation('waves', {
      citation: 'tools/scripts/lib/source-scan.mjs:2, :3',
      anchor: {
        'tools/scripts/lib/source-scan.mjs:2': sourceScanAnchor(workspace, 2),
        'tools/scripts/lib/source-scan.mjs:3': sourceScanAnchor(workspace, 3),
      },
    }),
  );

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 0, result.stdout);
});

// --- a citation rendered from script data is a citation (#982) ----------------
//
// The scanner used to blank every script body, so a page that renders its
// citations from script data — a walkthrough's scenes, an edge table — carried
// reader-visible claims nothing checked, and could not anchor them either.

/** A page whose only citation sits in a script string, plus an anchor map when given. */
function pageWithScriptCitation(title, { citation, anchor }) {
  const blocks = [`<script>const REFS = ['${citation}'];</script>`];
  if (anchor) {
    blocks.push(
      `<script type="application/json" id="citation-anchors">${JSON.stringify({
        anchors: anchor,
      })}</script>`,
    );
  }
  return housePage(title).replace(
    '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
    [
      '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
      ...blocks,
    ].join('\n'),
  );
}

test('a citation rendered from script data fails when it names a file that is not in the tree', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/sandcastle/waves.html',
    pageWithScriptCitation('waves', { citation: 'nonexistent-source.ts:5' }),
  );

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR citation-unresolved/);
  assert.match(result.stdout, /nonexistent-source\.ts/);
});

test('a citation rendered from script data fails without an anchor', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/sandcastle/waves.html',
    pageWithScriptCitation('waves', {
      citation: 'tools/scripts/lib/source-scan.mjs:2',
    }),
  );

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR citation-missing-anchor/);
});

test('a citation rendered from script data fails when its anchor does not match the line', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/sandcastle/waves.html',
    pageWithScriptCitation('waves', {
      citation: 'tools/scripts/lib/source-scan.mjs:2',
      anchor: {
        'tools/scripts/lib/source-scan.mjs:2': {
          file: 'tools/scripts/lib/source-scan.mjs',
          start: 'not what the line says',
        },
      },
    }),
  );

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR citation-anchor-mismatch/);
});

test('a citation rendered from script data passes with a matching anchor, which is no longer an orphan', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/sandcastle/waves.html',
    pageWithScriptCitation('waves', {
      citation: 'tools/scripts/lib/source-scan.mjs:2',
      anchor: {
        'tools/scripts/lib/source-scan.mjs:2': sourceScanAnchor(workspace, 2),
      },
    }),
  );

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 0, result.stdout);
});

test('a legacy page whose citation-anchors block cannot be read fails rather than asserting nothing', (t) => {
  const workspace = createWorkspace(t);
  const page = 'docs/agents/skill-atlas.html';
  write(
    workspace,
    page,
    housePage('skill-atlas').replace(
      '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
      [
        '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
        '<script type="application/json" id="citation-anchors">{ "anchors": { broken ]</script>',
      ].join('\n'),
    ),
  );

  const result = run(workspace, page);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR citation-anchor-block-invalid/);
});

// docs/example/notes.md would exist on disk but not in the index the checker
// searches (`git ls-files`, built once at createWorkspace time) — these two
// cite a file createWorkspace already staged, the same way production citations
// resolve against the committed tree rather than an untracked scratch file.

test('a citation on a roster page resolves against a real file in the tree', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/sandcastle/waves.html',
    housePage('waves').replace(
      '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
      [
        '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
        '<span class="cite">tools/scripts/lib/source-scan.mjs:2</span>',
      ].join('\n'),
    ),
  );

  // This page cites without an anchor on purpose: the subject here is resolution,
  // so the anchor requirement is held off with the baseline rather than satisfied.
  writeAnchorBaseline(workspace, ['docs/sandcastle/waves.html']);

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /citation-unresolved/);
});

test('a citation past the end of a real file fails on a roster page', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/sandcastle/waves.html',
    housePage('waves').replace(
      '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
      [
        '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
        '<span class="cite">tools/scripts/lib/source-scan.mjs:99999</span>',
      ].join('\n'),
    ),
  );

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR citation-unresolved/);
  assert.match(result.stdout, /source-scan\.mjs/);
});

test("a citation to a file's real last line resolves, and the line past it does not", (t) => {
  // A trailing newline is not a line of its own. Every tracked file here ends
  // with one (.editorconfig, insert_final_newline), so a resolver that counts
  // split('\n').length uncorrected reports one line too many for all of them —
  // silently accepting a citation to the line just past every file's real end.
  const workspace = createWorkspace(t);
  write(workspace, 'target.txt', 'one\ntwo\nthree\n');
  spawnSync('git', ['add', '-A'], { cwd: workspace });
  write(
    workspace,
    'docs/sandcastle/waves.html',
    housePage('waves').replace(
      '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
      [
        '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
        '<span class="cite">target.txt:3</span>',
      ].join('\n'),
    ),
  );
  // This page cites without an anchor on purpose: the subject here is resolution,
  // so the anchor requirement is held off with the baseline rather than satisfied.
  writeAnchorBaseline(workspace, ['docs/sandcastle/waves.html']);

  const goodResult = run(workspace, 'docs/sandcastle/waves.html');
  assert.equal(goodResult.status, 0, goodResult.stdout);

  write(
    workspace,
    'docs/sandcastle/waves.html',
    housePage('waves').replace(
      '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
      [
        '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
        '<span class="cite">target.txt:4</span>',
      ].join('\n'),
    ),
  );
  const badResult = run(workspace, 'docs/sandcastle/waves.html');
  assert.equal(badResult.status, 1);
  assert.match(badResult.stdout, /ERROR citation-unresolved/);
});

test('a citation whose name is short a directory prefix still resolves by suffix', (t) => {
  // The real defect this guards: skill-atlas.html cites `implement/SKILL.md`,
  // two segments short of `.agents/skills/implement/SKILL.md`. A resolver that
  // only tried the name as a literal repo-root path missed every one of these.
  const workspace = createWorkspace(t);
  write(
    workspace,
    'a/deep/nested/check-design-hygiene.mjs',
    'line one\nline two\nline three\n',
  );
  write(
    workspace,
    'docs/sandcastle/waves.html',
    housePage('waves').replace(
      '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
      [
        '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
        '<span class="cite">nested/check-design-hygiene.mjs:2</span>',
      ].join('\n'),
    ),
  );
  spawnSync('git', ['add', '-A'], { cwd: workspace });

  // This page cites without an anchor on purpose: the subject here is resolution,
  // so the anchor requirement is held off with the baseline rather than satisfied.
  writeAnchorBaseline(workspace, ['docs/sandcastle/waves.html']);

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /citation-unresolved/);
});

test('a bare-name citation resolves against a git-tracked file sharing that basename', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/sandcastle/waves.html',
    housePage('waves').replace(
      '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
      [
        '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
        // check-design-hygiene.mjs is written into the workspace and tracked by
        // createWorkspace's `git add -A` — its line 1 always exists.
        '<span class="cite">check-design-hygiene.mjs:1</span>',
      ].join('\n'),
    ),
  );

  // This page cites without an anchor on purpose: the subject here is resolution,
  // so the anchor requirement is held off with the baseline rather than satisfied.
  writeAnchorBaseline(workspace, ['docs/sandcastle/waves.html']);

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /citation-unresolved/);
});

test('a bare-name citation to a file absent from the tree fails', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/sandcastle/waves.html',
    housePage('waves').replace(
      '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
      [
        '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
        '<span class="cite">nonexistent-anywhere.yml:1</span>',
      ].join('\n'),
    ),
  );

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR citation-unresolved/);
  assert.match(result.stdout, /does not exist in the tree/);
});

test('a roster page passed explicitly is checked', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, '.prettierignore', '');
  const result = run(workspace, 'docs/sandcastle/waves.html');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR prettier-ignore-missing/);
});

test('a windows-style path argument resolves to the same roster entry', (t) => {
  const workspace = createWorkspace(t);
  const result = run(workspace, 'docs\\sandcastle\\waves.html');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Design hygiene: 0 error\(s\), 0 warning\(s\)/);
});

test('--json emits a machine-readable report', (t) => {
  const workspace = createWorkspace(t);
  const result = run(workspace, '--json', 'docs/sandcastle/waves.html');
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.errors, 0);
  assert.equal(report.results.length, 1);
  assert.deepEqual(report.results[0].findings, []);
});

test('a roster page missing from disk is a finding, not a crash', (t) => {
  const workspace = createWorkspace(t);
  rmSync(join(workspace, 'docs/sandcastle/logs.html'));
  const result = run(workspace, '--all');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR page-missing/);
});

test('--print-font-block emits a block a new page can splice verbatim', (t) => {
  const workspace = createWorkspace(t);
  const result = run(workspace, '--print-font-block');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, FONT_BLOCK);

  // Splicing that output into a page is what makes font-block-drift pass.
  write(
    workspace,
    'docs/sandcastle/logs.html',
    housePage('logs').replace(FONT_BLOCK, result.stdout),
  );
  assert.equal(run(workspace, 'docs/sandcastle/logs.html').status, 0);
});

test('no arguments is a bad invocation', (t) => {
  const workspace = createWorkspace(t);
  const result = run(workspace);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});

test('--all and --staged together is a bad invocation', (t) => {
  const workspace = createWorkspace(t);
  const result = run(workspace, '--all', '--staged');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /mutually exclusive/);
});

test('a missing canonical font page is a bad-run exit, not a page finding', (t) => {
  const workspace = createWorkspace(t);
  rmSync(join(workspace, 'docs/vault/lifecycle.html'));
  const result = run(workspace, '--all');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /canonical font page .* not found/);
});

// --- comment masking is scoped to code -----------------------------------------
//
// `/*` and `*/` are comment delimiters in a script and ordinary bytes in prose.
// Masking them document-wide made a glob in prose — `release/*`, `*.yml`,
// `docs/**/*.html` — open a comment that closed at the next real `*/` anywhere
// in the file, blanking everything between. Every rule reads that output, so the
// blanked region went unseen by all of them at once and the gate reported PASS.

/** Prose containing a glob, plus a later script carrying a real comment to close on. */
const withProseGlob = (page, markup = '') =>
  page.replace(
    '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
    [
      '<p>Production deploys run from release/* branches.</p>',
      markup ||
        '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
    ].join('\n'),
  ) + '\n<script>/* the pre-paint theme block */</script>';

test('a glob in prose does not hide a defect that follows it', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'docs/sandcastle/gates.html',
    withProseGlob(
      housePage('gates'),
      '<svg viewBox="0 0 10 10" role="img"><title>Gates</title></svg>',
    ),
  );

  const result = run(workspace, '--all');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR svg-title-tooltip/);
});

test('a glob in prose does not hide the manifest that follows it', (t) => {
  const workspace = createWorkspace(t);
  // The real failure: the manifest sat between a `release/**` in an SVG label and
  // the next real `*/`, so the scanner never saw it and the page passed anyway.
  write(
    workspace,
    'docs/sandcastle/gates.html',
    withProseGlob(housePage('gates')),
  );

  const result = run(workspace, '--all');

  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /manifest-missing/);
});

test('a comment inside a script is still masked', (t) => {
  const workspace = createWorkspace(t);
  // The reason the masker exists: these pages explain their own rules in code
  // comments, and scanning them raw reports the explanation as the violation.
  write(
    workspace,
    'docs/sandcastle/gates.html',
    housePage('gates') +
      "\n<script>// localStorage.getItem('theme') runs guarded below\n/* localStorage.setItem too */</script>",
  );

  const result = run(workspace, '--all');

  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /unguarded-storage/);
});

// --- anchor checking (ADR 0085, #788) ----------------------------------------
//
// Citations carry expected-content anchors so a broken reference is caught:
// a changed line no longer matches what the page claims it contains. Anchors
// are optional today (as a bridge while pages are retrofitted), but a citation
// carrying no anchor is itself a finding — leaving the rule silent if the anchor
// is forgotten or omitted.

test('a citation with a matching anchor passes', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'target.yml', 'key: value\nline two\nline three\n');
  spawnSync('git', ['add', '-A'], { cwd: workspace });

  write(
    workspace,
    'docs/sandcastle/waves.html',
    housePage('waves').replace(
      '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
      [
        '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
        '<span class="cite">target.yml:1</span>',
        '<script type="application/json" id="citation-anchors">',
        '{ "anchors": { "target.yml:1": { "file": "target.yml", "start": "key: value" } } }',
        '</script>',
      ].join('\n'),
    ),
  );

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /citation-anchor-mismatch/);
  assert.doesNotMatch(result.stdout, /citation-missing-anchor/);
});

test('a citation with a mismatched anchor fails', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'target.yml', 'key: value\nline two\nline three\n');
  spawnSync('git', ['add', '-A'], { cwd: workspace });

  write(
    workspace,
    'docs/sandcastle/waves.html',
    housePage('waves').replace(
      '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
      [
        '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
        '<span class="cite">target.yml:1</span>',
        '<script type="application/json" id="citation-anchors">',
        '{ "anchors": { "target.yml:1": { "file": "target.yml", "start": "wrong content here" } } }',
        '</script>',
      ].join('\n'),
    ),
  );

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR citation-anchor-mismatch/);
  assert.match(result.stdout, /wrong content here/);
  assert.match(result.stdout, /key: value/);
});

test('a citation with no anchor is a finding', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'target.yml', 'key: value\nline two\nline three\n');
  spawnSync('git', ['add', '-A'], { cwd: workspace });

  write(
    workspace,
    'docs/sandcastle/waves.html',
    housePage('waves').replace(
      '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
      [
        '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
        '<span class="cite">target.yml:1</span>',
        '<script type="application/json" id="citation-anchors">',
        '{ "anchors": {} }',
        '</script>',
      ].join('\n'),
    ),
  );

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR citation-missing-anchor/);
  assert.match(result.stdout, /target.yml:1/);
});

test('a range citation with matching start and end anchors passes', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'target.yml', 'line one\nline two\nline three\nline four\n');
  spawnSync('git', ['add', '-A'], { cwd: workspace });

  write(
    workspace,
    'docs/sandcastle/waves.html',
    housePage('waves').replace(
      '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
      [
        '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
        '<span class="cite">target.yml:2-3</span>',
        '<script type="application/json" id="citation-anchors">',
        '{ "anchors": { "target.yml:2-3": { "file": "target.yml", "start": "line two", "end": "line three" } } }',
        '</script>',
      ].join('\n'),
    ),
  );

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /citation-anchor-mismatch/);
});

test('a range citation with mismatched end anchor fails', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'target.yml', 'line one\nline two\nline three\nline four\n');
  spawnSync('git', ['add', '-A'], { cwd: workspace });

  write(
    workspace,
    'docs/sandcastle/waves.html',
    housePage('waves').replace(
      '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
      [
        '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
        '<span class="cite">target.yml:2-3</span>',
        '<script type="application/json" id="citation-anchors">',
        '{ "anchors": { "target.yml:2-3": { "file": "target.yml", "start": "line two", "end": "wrong end" } } }',
        '</script>',
      ].join('\n'),
    ),
  );

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR citation-anchor-mismatch/);
  assert.match(result.stdout, /wrong end/);
  assert.match(result.stdout, /line three/);
});

test('anchor comparison normalizes whitespace', (t) => {
  const workspace = createWorkspace(t);
  write(workspace, 'target.yml', '  key:   value  \nline two\nline three\n');
  spawnSync('git', ['add', '-A'], { cwd: workspace });

  write(
    workspace,
    'docs/sandcastle/waves.html',
    housePage('waves').replace(
      '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
      [
        '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
        '<span class="cite">target.yml:1</span>',
        '<script type="application/json" id="citation-anchors">',
        '{ "anchors": { "target.yml:1": { "file": "target.yml", "start": "key: value" } } }',
        '</script>',
      ].join('\n'),
    ),
  );

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /citation-anchor-mismatch/);
});

test('anchor comparison unescapes HTML entities', (t) => {
  const workspace = createWorkspace(t);
  write(
    workspace,
    'target.yml',
    '"quoted" & <bracketed>\nline two\nline three\n',
  );
  spawnSync('git', ['add', '-A'], { cwd: workspace });

  write(
    workspace,
    'docs/sandcastle/waves.html',
    housePage('waves').replace(
      '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
      [
        '<svg viewBox="0 0 10 10" role="img" aria-label="Diagram"></svg>',
        '<span class="cite">target.yml:1</span>',
        '<script type="application/json" id="citation-anchors">',
        '{ "anchors": { "target.yml:1": { "file": "target.yml", "start": "&quot;quoted&quot; &amp; &lt;bracketed&gt;" } } }',
        '</script>',
      ].join('\n'),
    ),
  );

  const result = run(workspace, 'docs/sandcastle/waves.html');

  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /citation-anchor-mismatch/);
});
