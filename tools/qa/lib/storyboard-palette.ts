/**
 * Reads the design tokens' generated stylesheets for a Storyboard page
 * (PRD #1544): `roles.css` (the Semantic Roles, light mode on `:root`) and
 * `tokens.css` (type and the primitive tier). The page inlines their text
 * and colours everything with `var(--…)`, so colours come from
 * `@myorganiser/design-tokens` without importing across a project boundary.
 *
 * It fails loudly, naming each custom property the page uses
 * (`STORYBOARD_VARIABLES`) that the stylesheets do not declare, so a renamed
 * token stops the render instead of drawing an uncoloured page.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { STORYBOARD_VARIABLES } from './storyboard-html.ts';

/** The generated stylesheets, relative to the repository root. */
export const TOKEN_STYLESHEETS = [
  'libs/design-tokens/src/generated/roles.css',
  'libs/design-tokens/src/generated/tokens.css',
] as const;

/** The custom properties in `needed` that `css` does not declare. Pure. */
export function missingVariables(
  css: string,
  needed: readonly string[] = STORYBOARD_VARIABLES,
): string[] {
  const declared = new Set(
    [...css.matchAll(/(?:^|[\s;{])--([A-Za-z0-9-]+)\s*:/g)].map(
      (match) => match[1],
    ),
  );
  return needed.filter((name) => !declared.has(name));
}

/** The stylesheets' text, checked to declare every variable the page uses. */
export function readTokenCss(repoRoot: string): string {
  const css = TOKEN_STYLESHEETS.map((path) =>
    readFileSync(join(repoRoot, path), 'utf8'),
  ).join('\n');
  const missing = missingVariables(css);
  if (missing.length > 0) {
    throw new Error(
      `the design tokens do not declare ${missing.map((name) => `--${name}`).join(', ')}, which the Storyboard page uses (${TOKEN_STYLESHEETS.join(', ')})`,
    );
  }
  return css;
}
