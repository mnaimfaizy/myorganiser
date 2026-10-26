#!/usr/bin/env node
// Asserts the committed mobile app icon outputs are what
// `yarn mobile:app-icon:generate` would write from the current BrandMark
// shield and design-token build, naming each output that is missing or stale.
//
//   node tools/scripts/check-mobile-app-icon.mjs
//
// The icons ship inside the native projects, so a changed shield or Brand
// Primitive without a re-run leaves the installed app wearing the old mark,
// and nothing in review shows it. This builds every output in memory through
// the generator's own module (tools/scripts/lib/mobile-app-icon.ts).
//
// Directions:
// - Sources → text outputs, exactly: the SVG masters, the Android vector
//   drawables, the launcher background colour, the adaptive-icon entries,
//   and the iOS Contents.json. Between them they carry every value the icon
//   reads — the shield and check paths, the stroke width, each colour, and the
//   layout — so a source change without a re-run fails here.
// - Sources → PNGs, existence only. The PNGs are not compared: they are
//   rasterised through Chromium, and this gate runs in the pre-commit
//   aggregate, which reads files and does not launch a browser. They are
//   rasterised from the same SVGs in the same run that writes the text
//   outputs, so they go stale only alongside them, or by hand. (Chromium did
//   reproduce every committed PNG byte for byte on macOS arm64 and Linux x64
//   when this gate was added, #1135; that is why a re-run leaves no diff, not
//   something this gate relies on.)
// - Not asserted: that every file under the native projects' icon folders is
//   a generated output. Those folders belong to the native projects, and an
//   extra file there is not drift from the shield or the tokens.
//
// Exit 0 = every output matches. Exit 1 = an output is missing or stale.
// Exit 2 = the check could not run (a source value could not be read).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { planMobileAppIcon } from './lib/mobile-app-icon.ts';

const root = process.cwd();

let plan;
try {
  plan = planMobileAppIcon({ root });
} catch (error) {
  console.error(
    `mobile-app-icon: the check could not run\n  - ${error.message}`,
  );
  process.exit(2);
}

const drift = [];
for (const { path, content } of plan.files) {
  const committed = resolve(root, path);
  if (!existsSync(committed)) {
    drift.push(`${path}: missing`);
  } else if (readFileSync(committed, 'utf8') !== content) {
    drift.push(`${path}: differs from the current shield and tokens`);
  }
}
for (const { path } of plan.rasters) {
  if (!existsSync(resolve(root, path))) drift.push(`${path}: missing`);
}

if (drift.length) {
  console.error(
    'mobile-app-icon: committed outputs do not match the BrandMark shield and design tokens\n',
  );
  for (const line of drift) console.error(`  - ${line}`);
  console.error(
    '\nRun `yarn mobile:app-icon:generate` and commit everything it writes.',
  );
  process.exit(1);
}

console.log(
  `mobile-app-icon: ${plan.files.length} outputs match their sources, ` +
    `${plan.rasters.length} PNGs present`,
);
