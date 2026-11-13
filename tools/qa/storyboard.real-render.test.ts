// One real render of a Storyboard in Playwright's Chromium (PRD #1544). Every
// other suite stubs the browser; this one launches it deliberately, to check
// that the page lays out at 1280 px, that the PNG is written, and that the
// HTML work file is removed afterwards.
//
// Without Chromium the test is skipped with a visible reason. Set
// QA_REQUIRE_REAL_RENDER=1 (CI's QA tooling step does) to make a missing
// Chromium a failure instead.
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { storyboardRenderer } from './lib/storyboard-render.ts';
import { type Storyboard, buildStoryboard } from './lib/storyboard.ts';

/** tools/qa/ is two levels below the repository root. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const EXECUTABLE = chromium.executablePath();
const PRESENT = existsSync(EXECUTABLE);
const SKIP =
  PRESENT || process.env.QA_REQUIRE_REAL_RENDER
    ? false
    : "Playwright's Chromium is not installed (set QA_REQUIRE_REAL_RENDER=1 to require it)";

const MISSING_CHROMIUM = `Playwright's Chromium is required (QA_REQUIRE_REAL_RENDER is set) but not found at ${EXECUTABLE}`;

/** Writes one small real PNG per entry, each a full 1280x720 page with its label. */
async function makeStills(
  dir: string,
  stills: readonly [relative: string, label: string][],
): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    for (const [relative, label] of stills) {
      const path = join(dir, relative);
      mkdirSync(dirname(path), { recursive: true });
      await page.setContent(
        `<body style="margin:0"><h1 style="font:40px sans-serif;padding:40px">${label}</h1></body>`,
      );
      await page.screenshot({ path });
    }
  } finally {
    await browser.close();
  }
}

/** A two-column Storyboard: Before has a subject box, After has none. */
function storyboardFixture(): Storyboard {
  return buildStoryboard({
    id: 'S',
    title: 'Real render',
    expected: { before: 'the defect shows', after: 'the fix shows' },
    result: 'PASS',
    commits: { before: 'a'.repeat(40), after: 'b'.repeat(40) },
    sides: {
      before: {
        outcome: 'fail',
        message: 'the defect shows here',
        steps: [
          {
            side: 'before',
            index: 1,
            device: 'Desktop',
            tab: '',
            label: 'Device Desktop',
            caption: 'the defect',
            still: 'steps/S/before/01.png',
            subject: { x: 600, y: 300, width: 40, height: 20 },
            atMs: 0,
          },
        ],
      },
      after: {
        outcome: 'pass',
        observed: 'the fix shows here',
        steps: [
          {
            side: 'after',
            index: 1,
            device: 'Desktop',
            tab: '',
            label: 'Device Desktop',
            caption: 'the fix',
            still: 'steps/S/after/01.png',
            subject: null,
            atMs: 0,
          },
        ],
      },
    },
  });
}

test(
  'renders a two-column Storyboard to a 1280 px wide PNG and removes its HTML work file',
  { skip: SKIP },
  async () => {
    assert.ok(PRESENT, MISSING_CHROMIUM);
    const dir = mkdtempSync(join(tmpdir(), 'storyboard-real-'));
    try {
      await makeStills(dir, [
        ['steps/S/before/01.png', 'Before'],
        ['steps/S/after/01.png', 'After'],
      ]);
      const png = join(dir, 'out.png');
      await storyboardRenderer(REPO_ROOT)(storyboardFixture(), dir, png);

      assert.ok(existsSync(png), 'the PNG exists');
      // A PNG's IHDR chunk holds the width at bytes 16-19 and the height at 20-23.
      const bytes = readFileSync(png);
      assert.equal(bytes.readUInt32BE(16), 1280, 'the PNG is 1280 px wide');
      assert.ok(
        bytes.readUInt32BE(20) > 300,
        `the PNG is ${bytes.readUInt32BE(20)} px high, expected more than 300`,
      );
      assert.equal(
        existsSync(`${png}.html`),
        false,
        'the HTML work file is removed',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  'a render into a missing directory rejects and leaves no PNG behind',
  { skip: SKIP },
  async () => {
    assert.ok(PRESENT, MISSING_CHROMIUM);
    const dir = mkdtempSync(join(tmpdir(), 'storyboard-real-'));
    try {
      const png = join(dir, 'missing', 'out.png');
      await assert.rejects(
        storyboardRenderer(REPO_ROOT)(storyboardFixture(), dir, png),
      );
      assert.equal(existsSync(png), false, 'no PNG is left behind');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
