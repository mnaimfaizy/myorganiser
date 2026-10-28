#!/usr/bin/env node
// Asserts the committed web app icons in apps/web/public/icons/ are what
// `yarn web:app-icons:generate` would render from the current AppLogo shield
// and design-token build, naming each icon that is missing or stale.
//
//   node tools/scripts/check-web-app-icons.ts
//
// The icons are binary, so review cannot see them drift: change `SHIELD_PATH`
// or a colour token the generator reads, skip the re-run, and the installed
// icon silently stops matching the brand mark. This renders the icons in
// memory through the generator's own module (tools/scripts/lib/
// web-app-icons.ts) and compares them with the committed files.
//
// The comparison is on decoded pixels, not file bytes: the same pixels can be
// encoded to different PNG bytes by a different zlib build, and a gate that
// fails on encoder noise gets turned off. Pixels must match exactly; `sharp`
// ships its own libvips and librsvg, and macOS arm64 and Linux x64 (Node 22,
// sharp 0.35.5) render these icons to identical pixels — identical bytes,
// even — as checked when this gate was added (#1135).
//
// Direction: sources → committed. Every icon the generator renders must exist
// and match. It does not assert the other direction — that every file in
// apps/web/public/icons/ is one the generator renders — because that
// directory is the web app's public folder, not the generator's output, and
// an extra file there is not drift from the shield or the tokens.
//
// Exit 0 = every icon matches. Exit 1 = an icon is missing or stale.
// Exit 2 = the check could not run (a source value could not be read).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { errorMessage } from './lib/error-message.ts';
import { renderWebAppIcons } from './lib/web-app-icons.ts';

const root = process.cwd();

let rendered: Awaited<ReturnType<typeof renderWebAppIcons>>;
try {
  rendered = await renderWebAppIcons({ root });
} catch (error) {
  console.error(
    `web-app-icons: the check could not run\n  - ${errorMessage(error)}`,
  );
  process.exit(2);
}

const pixels = (png: Buffer) =>
  sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

const drift: string[] = [];
for (const { path, png } of rendered) {
  const committedPath = resolve(root, path);
  if (!existsSync(committedPath)) {
    drift.push(`${path}: missing`);
    continue;
  }
  const [expected, actual] = await Promise.all([
    pixels(png),
    pixels(readFileSync(committedPath)),
  ]);
  if (
    expected.info.width !== actual.info.width ||
    expected.info.height !== actual.info.height
  ) {
    drift.push(
      `${path}: is ${actual.info.width} × ${actual.info.height}, ` +
        `expected ${expected.info.width} × ${expected.info.height}`,
    );
  } else if (!expected.data.equals(actual.data)) {
    drift.push(`${path}: pixels differ from the current shield and tokens`);
  }
}

if (drift.length) {
  console.error(
    'web-app-icons: committed icons do not match the AppLogo shield and design tokens\n',
  );
  for (const line of drift) console.error(`  - ${line}`);
  console.error(
    '\nRun `yarn web:app-icons:generate` and commit apps/web/public/icons/.',
  );
  process.exit(1);
}

console.log(`web-app-icons: ${rendered.length} icons match their sources`);
