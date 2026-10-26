/**
 * Generates the web app's installable icons from the AppLogo shield and the
 * design-token build.
 * Usage: yarn web:app-icons:generate
 *
 * What the icons are and where every value comes from lives in
 * tools/scripts/lib/web-app-icons.ts, which this script and
 * `yarn web:app-icons:check` share. This file only writes the rendered icons
 * to apps/web/public/icons/. Re-run it after the shield or a Brand Primitive
 * changes and commit the output; `yarn web:app-icons:check` fails until you
 * do.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderWebAppIcons } from './lib/web-app-icons.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

for (const { path, png } of await renderWebAppIcons({ root: repoRoot })) {
  mkdirSync(dirname(resolve(repoRoot, path)), { recursive: true });
  writeFileSync(resolve(repoRoot, path), png);
  console.log(`✓ ${path}`);
}
