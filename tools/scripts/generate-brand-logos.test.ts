import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BRAND_NAME,
  LOGOS,
  brandLogoSvg,
  readBrandSources,
} from './generate-brand-logos.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const appLogo = readFileSync(
  resolve(repoRoot, 'libs/web/ui/src/lib/components/AppLogo/AppLogo.tsx'),
  'utf8',
);

const sources = readBrandSources();
const svgFor = (filename: string) =>
  brandLogoSvg(LOGOS.find((logo) => logo.filename === filename)!, sources);

test('the sources are the constants AppLogo exports', () => {
  assert.ok(
    appLogo.includes(`export const SHIELD_PATH = '${sources.shieldPath}';`),
  );
  assert.ok(
    appLogo.includes(`export const CHECK_PATH = '${sources.checkPath}';`),
  );
  assert.ok(
    appLogo.includes(
      `export const CHECK_STROKE_WIDTH = ${sources.checkStrokeWidth};`,
    ),
  );
});

test('the script writes the README pair and the one email logo', () => {
  assert.deepEqual(
    LOGOS.map((logo) => logo.filename),
    ['logo-shield.svg', 'logo-shield-dark.svg', 'logo-email.svg'],
  );
});

for (const { filename } of LOGOS) {
  test(`${filename} draws the AppLogo mark`, () => {
    const svg = svgFor(filename);

    assert.ok(svg.includes(`<path d="${sources.shieldPath}"`));
    assert.ok(svg.includes(`<path d="${sources.checkPath}"`));
    assert.ok(svg.includes(`stroke-width="${sources.checkStrokeWidth}"`));
    assert.equal(svg.match(/<path /g)!.length, 2, 'shield and check only');
  });

  test(`${filename} is named MyOrganiser, never MyOrganiser`, () => {
    const svg = svgFor(filename);

    assert.equal(BRAND_NAME, 'MyOrganiser');
    assert.ok(svg.includes('<title>MyOrganiser</title>'));
    assert.ok(svg.includes('aria-label="MyOrganiser logo"'));
    assert.ok(svg.includes('role="img"'));
    assert.ok(
      svg.includes(
        '<tspan font-weight="600">My</tspan><tspan font-weight="800">Organiser</tspan>',
      ),
    );
    assert.doesNotMatch(svg, /organizer/i);
  });

  test(`${filename} keeps the 244 × 52 canvas its consumers size against`, () => {
    assert.ok(svgFor(filename).includes('viewBox="0 0 244 52"'));
  });
}

test('each logo takes its own wordmark colour', () => {
  const fill = (filename: string) =>
    /<text [^>]*fill="([^"]+)"/.exec(svgFor(filename))![1];

  assert.equal(fill('logo-shield.svg'), sources.wordmarkOnLight);
  assert.equal(fill('logo-shield-dark.svg'), sources.wordmarkOnDark);
  assert.equal(fill('logo-email.svg'), sources.wordmarkEmail);
  assert.notEqual(sources.wordmarkOnLight, sources.wordmarkOnDark);
});

test('the email logo stays one variant that cites ADR 0034', () => {
  const svg = svgFor('logo-email.svg');

  assert.ok(svg.includes('ADR 0034'));
  assert.doesNotMatch(svg, /prefers-color-scheme|https?:\/\/(?!www\.w3\.org)/);
  assert.doesNotMatch(svgFor('logo-shield.svg'), /ADR 0034/);
});
