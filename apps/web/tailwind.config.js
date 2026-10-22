const { createRequire } = require('node:module');
const { join } = require('node:path');

// The shared theme lives in libs/design-tokens and is required by a path built
// at runtime: a relative import specifier across projects is what
// `@nx/enforce-module-boundaries` refuses (the same reason apps/web/next.config.js
// reads the workspace package.json by path). It goes through createRequire
// because global.css pulls this file into the Turbopack graph via `@config`, and
// Turbopack warns "Module not found" on a plain require of a computed path.
const theme = createRequire(__filename)(
  join(__dirname, '..', '..', 'libs', 'design-tokens', 'tailwind-theme.cjs'),
);

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx,html}', '../../libs/**/*.{ts,tsx,js,jsx,html}'],
  theme: {
    extend: {
      ...theme,
      borderRadius: {
        lg: `var(--radius)`,
        md: `calc(var(--radius) - 2px)`,
        sm: 'calc(var(--radius) - 4px)',
        ...theme.borderRadius,
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
