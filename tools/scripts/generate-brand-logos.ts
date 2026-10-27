/**
 * Generates the brand logo SVGs — the README pair and the email logo — from
 * the AppLogo shield and the design-token build.
 * Usage: yarn brand:logos:generate
 *
 * The logo has one source and it is not in this file: the shield and check
 * paths are read out of the exported `SHIELD_PATH` / `CHECK_PATH` /
 * `CHECK_STROKE_WIDTH` constants in
 * libs/web/ui/src/lib/components/AppLogo/AppLogo.tsx, and every colour and
 * the font stack out of the design-token build. This script only decides how
 * the mark and the wordmark sit on the 244 × 52 canvas, and fails if it
 * cannot find a value it reads.
 *
 * Writes apps/web/public/images/:
 * - logo-shield.svg — the README logo on a light page; wordmark in the light
 *   `foreground` role's colour.
 * - logo-shield-dark.svg — the README logo on a dark page; wordmark in the
 *   dark `foreground` role's colour.
 * - logo-email.svg — the one email logo (ADR 0034), wordmark in brand
 *   secondary. `yarn nx run email-shell:build-logo` rasterises it, so run
 *   that after this and commit both outputs together.
 *
 * The committed logos change only when someone runs this script. Nothing
 * compares them with the current shield or tokens, so a change to either
 * leaves them stale until it is re-run: re-run it after the shield, a Brand
 * Primitive, or the display font stack changes, and commit the output.
 *
 * Two things AppLogo draws are not reproduced, for the same reason
 * generate-web-app-icons.ts leaves them out — they are literals in AppLogo's
 * JSX rather than exported constants, so copying them here would be a second
 * source: the radial "shine" overlay on the shield, and the gradient's hex
 * stops (this script takes the same two colours from the tokens instead).
 *
 * The wordmark is a `<text>` element, not outlined paths, so its letterforms
 * come from whatever font the renderer has. An SVG shown through `<img>` (the
 * README on GitHub) cannot load a web font, and a headless rasteriser (the
 * email PNG) has only system fonts, so both normally fall back past
 * Plus Jakarta Sans. The two weights are `<tspan>`s of one `<text>`, so
 * "Organiser" follows "My" at whatever width the fallback font gives it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fromRoot = (path: string) => resolve(repoRoot, path);

const APP_LOGO = 'libs/web/ui/src/lib/components/AppLogo/AppLogo.tsx';
const TOKENS = 'libs/design-tokens/src/generated/tokens.ts';
const IMAGES_DIR = 'apps/web/public/images';

export const BRAND_NAME = 'MyOrganiser';

function readOrFail(path: string, pattern: RegExp, what: string): string {
  const match = readFileSync(fromRoot(path), 'utf8').match(pattern);
  if (!match) {
    throw new Error(`Could not read ${what} from ${path}`);
  }
  return match[1];
}

/**
 * Everything the logos are drawn from, read by name — not by position — so
 * reordering or restyling AppLogo's JSX can't silently bind a value to the
 * wrong path.
 */
export interface BrandSources {
  shieldPath: string;
  checkPath: string;
  checkStrokeWidth: number;
  gradientTop: string;
  gradientBottom: string;
  check: string;
  wordmarkOnLight: string;
  wordmarkOnDark: string;
  wordmarkEmail: string;
  fontStack: string;
}

export function readBrandSources(): BrandSources {
  const token = (name: string) =>
    readOrFail(
      TOKENS,
      new RegExp(`export const ${name} = "(#[0-9a-fA-F]{6})"`),
      name,
    );

  return {
    // The mark, in AppLogo's own 32 × 32 viewBox.
    shieldPath: readOrFail(
      APP_LOGO,
      /export const SHIELD_PATH = '([^']+)';/,
      'the shield path',
    ),
    checkPath: readOrFail(
      APP_LOGO,
      /export const CHECK_PATH = '([^']+)';/,
      'the check path',
    ),
    checkStrokeWidth: Number(
      readOrFail(
        APP_LOGO,
        /export const CHECK_STROKE_WIDTH = (\d+(?:\.\d+)?);/,
        'the check stroke width',
      ),
    ),
    gradientTop: token('colorSecondary'),
    gradientBottom: token('colorTertiary'),
    check: token('colorOnSecondary'),
    // The token build exports Brand Primitives and Neutral Ramp rungs, not
    // the Semantic Roles, so each mode's `foreground` role is read through
    // the value tokens.json aliases it to: color.primary in light,
    // neutral.200 in dark.
    wordmarkOnLight: token('colorPrimary'),
    wordmarkOnDark: token('neutral200'),
    wordmarkEmail: token('colorSecondary'),
    fontStack: readOrFail(
      TOKENS,
      /export const fontDisplay = "([^"<>&]+)"/,
      'fontDisplay',
    ),
  };
}

// The canvas the README (`width="220"`) and the email build already lay out
// against; build-logo.mjs derives the PNG's height from this viewBox.
const CANVAS = { width: 244, height: 52 };
// AppLogo's shield spans x 4–28, y 3–31 of its viewBox. At 1.5× it is 36 × 42
// and this places it at x 8–44, y 5–47: centred on the canvas's height.
const MARK = { scale: 1.5, translateX: 2, translateY: 0.5 };
// AppLogo sets the wordmark at 0.6 of the mark's height in two weights; 22 on
// this canvas keeps that proportion against the 36-wide shield.
const WORDMARK = { x: 57, baseline: 34, fontSize: 22, letterSpacing: -0.4 };

const EMAIL_COMMENT = `
  <!-- Email-only variant (ADR 0034): a single logo used everywhere rather than
       a light/dark pair, because Gmail and Outlook force their own colour
       inversion and ignore which pair a message would have picked anyway.
       The wordmark uses the brand secondary purple — a saturated, mid-lightness
       colour rather than near-black or near-white text — so it stays legible
       whether a client renders it as sent or inverts it. -->`;

export interface BrandLogo {
  filename: string;
  wordmark: 'wordmarkOnLight' | 'wordmarkOnDark' | 'wordmarkEmail';
  comment: string;
}

export const LOGOS: BrandLogo[] = [
  { filename: 'logo-shield.svg', wordmark: 'wordmarkOnLight', comment: '' },
  { filename: 'logo-shield-dark.svg', wordmark: 'wordmarkOnDark', comment: '' },
  {
    filename: 'logo-email.svg',
    wordmark: 'wordmarkEmail',
    comment: EMAIL_COMMENT,
  },
];

/** One logo as SVG: the AppLogo mark, then the two-weight wordmark. */
export function brandLogoSvg(logo: BrandLogo, sources: BrandSources): string {
  const wordmarkColour = sources[logo.wordmark];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}" fill="none" role="img" aria-label="${BRAND_NAME} logo">
  <title>${BRAND_NAME}</title>
  <!-- GENERATED FILE — do not edit. Produced by \`yarn brand:logos:generate\`
       (tools/scripts/generate-brand-logos.ts) from the AppLogo shield and the
       design-token build. -->${logo.comment}
  <defs>
    <linearGradient id="shield-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${sources.gradientTop}"/>
      <stop offset="1" stop-color="${sources.gradientBottom}"/>
    </linearGradient>
  </defs>
  <g transform="translate(${MARK.translateX} ${MARK.translateY}) scale(${MARK.scale})">
    <path d="${sources.shieldPath}" fill="url(#shield-grad)"/>
    <path d="${sources.checkPath}" fill="none" stroke="${sources.check}" stroke-width="${sources.checkStrokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <text x="${WORDMARK.x}" y="${WORDMARK.baseline}" font-family="${sources.fontStack}" font-size="${WORDMARK.fontSize}" letter-spacing="${WORDMARK.letterSpacing}" fill="${wordmarkColour}"><tspan font-weight="600">My</tspan><tspan font-weight="800">Organiser</tspan></text>
</svg>
`;
}

function write(path: string, content: string): void {
  mkdirSync(dirname(fromRoot(path)), { recursive: true });
  writeFileSync(fromRoot(path), content);
  console.log(`✓ ${path}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const sources = readBrandSources();
  for (const logo of LOGOS) {
    write(`${IMAGES_DIR}/${logo.filename}`, brandLogoSvg(logo, sources));
  }
}
