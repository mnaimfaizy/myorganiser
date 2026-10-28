/**
 * The #771 replay: the citation gate, run against the real page and the real
 * drift rather than a fixture (ADR 0085; PRD #772, slice #788).
 *
 * The contract suites next door build their own pages, so they prove the rule
 * fires on the shapes they invent. That is not the same claim as "this gate
 * would have caught the drift that motivated it" — the gate this PRD built
 * exists because #771 found 19 stale citations on `release-pipeline.html`, and
 * a suite of fixtures cannot say whether those particular nineteen would have
 * been caught. Only history can, so this file reads it.
 *
 * Two directions, because they fail for different reasons and a gate that
 * caught only one of them would still be the defect this PRD is named for:
 *
 *   1. The page as it stood BEFORE #771 — stale citations, no anchors — must
 *      fail. Every one of those citations pointed at a line that exists, so
 *      resolution alone cannot fail them; the anchor requirement is what does.
 *   2. The page as it stands NOW, read against the source tree as it stood
 *      before #771, must fail. The citations resolve, carry anchors, and are
 *      still wrong for that tree. A line that exists there with different text
 *      is a content mismatch. A line past that file's end is unreadable. Both
 *      are the drift: an insertion in ci.yml that pushes a citation past the
 *      historical file must not turn this half into a pass.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  scanFactualAssertions,
  type ResolveCitation,
} from './lib/design-page-scan.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE = 'docs/deployment/release-pipeline.html';

// The merge-base of #771's pull request: the last commit on main whose
// release-pipeline.html still carried the 19 stale citations that issue fixed.
const BEFORE_771 = '33db0adbf91a49f63b01f17c3c4260bf7c4c9371';

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** File content at a commit, or null when the path did not exist there. */
function contentAt(commit: string, path: string): string | null {
  try {
    return git(['show', `${commit}:${path}`]);
  } catch {
    return null;
  }
}

// A replay needs the history it replays. A shallow clone does not have it, and
// skipping would let this file assert nothing while still reporting a pass —
// so it says which it is. CI checks out with fetch-depth: 0.
const historyAvailable = (() => {
  try {
    git(['cat-file', '-e', `${BEFORE_771}^{commit}`]);
    return true;
  } catch {
    return false;
  }
})();
const shallow = (() => {
  try {
    return git(['rev-parse', '--is-shallow-repository']).trim() === 'true';
  } catch {
    return false;
  }
})();

/**
 * Resolves a citation through the page's own anchor map.
 *
 * The checker resolves a short name (`ci.yml`) against the git index; here the
 * name comes out of the anchor entry, which carries the repo-relative path the
 * page means. That keeps this file about the comparison it is replaying rather
 * than about resolution, which the contract suites already cover.
 */
interface CitationAnchorBlock {
  anchors?: Record<string, { file?: string }>;
}

function anchorResolver(page: string): ResolveCitation {
  const block = page.match(/id="citation-anchors"[^>]*>([\s\S]*?)<\/script>/);
  if (!block) throw new Error(`${PAGE} carries no citation-anchors block`);
  const anchors = (JSON.parse(block[1]) as CitationAnchorBlock).anchors ?? {};
  const nameToFile = new Map<string, string | undefined>(
    Object.entries(anchors).map(([key, anchor]) => [
      key.slice(0, key.lastIndexOf(':')),
      anchor.file,
    ]),
  );
  return (citation) => {
    const filePath = nameToFile.get(citation.name);
    return filePath
      ? { ok: true, filePath }
      : { ok: false, reason: `unknown citation target ${citation.name}` };
  };
}

test('the history this replay needs is present', () => {
  assert.ok(
    historyAvailable,
    shallow
      ? `This clone is shallow, so commit ${BEFORE_771} is not present and the ` +
          '#771 replay cannot run. Fetch the full history (CI checks out with ' +
          'fetch-depth: 0).'
      : `Commit ${BEFORE_771} is missing from a full clone — if #771's history ` +
          'was rewritten, repoint BEFORE_771 at the new commit before this fix.',
  );
});

test('the page as it stood before #771 fails the finished rule', () => {
  const page = contentAt(BEFORE_771, PAGE);
  assert.ok(page, `${PAGE} not found at ${BEFORE_771}`);

  // Resolution against today's tree, which is the generous reading: those
  // citations pointed at lines that existed, so resolution passes and the
  // anchor requirement is the only thing left to fail them.
  const findings = scanFactualAssertions({
    source: page,
    resolveCitation: () => ({ ok: true }),
    getFileContent: (path) => contentAt('HEAD', path),
  });

  assert.ok(
    findings.length > 0,
    'the gate passed the page whose drift it was built to catch',
  );
  assert.ok(
    findings.every((finding) => finding.rule === 'citation-missing-anchor'),
    `expected only missing-anchor findings, got ${[
      ...new Set(findings.map((finding) => finding.rule)),
    ].join(', ')}`,
  );

  // Four of the nineteen, named so this asserts the corrected citations rather
  // than a count: #771 moved these from ci.yml:648/652/694/698.
  for (const stale of [
    'ci.yml:648',
    'ci.yml:652',
    'ci.yml:694',
    'ci.yml:698',
  ]) {
    assert.ok(
      findings.some((finding) => finding.message.includes(stale)),
      `no finding names ${stale}, one of the citations #771 corrected`,
    );
  }
});

test("today's anchored page fails on content when read against the pre-#771 tree", () => {
  const page = readFileSync(join(REPO_ROOT, PAGE), 'utf8');

  const findings = scanFactualAssertions({
    source: page,
    resolveCitation: anchorResolver(page),
    getFileContent: (path) => contentAt(BEFORE_771, path),
  });

  const mismatches = findings.filter(
    (finding) => finding.rule === 'citation-anchor-mismatch',
  );
  assert.ok(
    mismatches.length > 0,
    'content comparison found nothing in a tree the page is genuinely wrong about',
  );

  // The ci.yml citations #771 corrected are the ones that have kept moving.
  // While the cited line is still inside the pre-#771 file, content comparison
  // separates them. Once an insertion above them puts the line past that
  // file's end — the nightly rot-issue step moved build-backend from :972 to
  // :975, and the historical ci.yml has no such line — the same citations fail
  // as unreadable. Either rule is the drift. Other mismatches can be citations
  // whose text differs for unrelated reasons; they are not a substitute.
  const ciYmlDrift = findings.filter(
    (finding) =>
      (finding.rule === 'citation-anchor-mismatch' ||
        finding.rule === 'citation-anchor-unreadable') &&
      finding.message.includes('ci.yml:'),
  );
  assert.ok(
    ciYmlDrift.length > 0,
    `expected a ci.yml citation to fail against the pre-#771 tree, got: ${findings
      .map((finding) => `${finding.rule}: ${finding.message}`)
      .join(' | ')}`,
  );
});
