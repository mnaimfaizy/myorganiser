const nx = require('@nx/eslint-plugin');
const unusedImports = require('eslint-plugin-unused-imports');

// The options for `@nx/enforce-module-boundaries`, named once because the
// last block below reuses them with one extra `allow` entry. Editing the
// constraints here changes both, which is the point: there is one ladder.
const MODULE_BOUNDARY_OPTIONS = {
  enforceBuildableLibDependency: true,
  allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?js$'],
  // Two dimensions, both enforced (a project must satisfy every
  // constraint its tags match). The vocabulary is pinned in
  // tools/config/nx-project-tags.json and every project must carry one
  // tag per dimension (yarn nx:tags:check), so no project falls through
  // to "matches nothing, may import anything".
  depConstraints: [
    // type: the layering ladder.
    {
      sourceTag: 'type:app',
      onlyDependOnLibsWithTags: [
        'type:page',
        'type:feature',
        'type:ui',
        'type:data-access',
        'type:domain',
        'type:util',
      ],
    },
    {
      sourceTag: 'type:e2e',
      // `type:data-access` is the generated API client. An E2E spec
      // derives route matchers from its enums rather than
      // hand-enumerating the members, which is what ADR 0053 asks of
      // any fan-out; forbidding the import would force the tests back
      // to the alternations that ADR exists to prevent.
      onlyDependOnLibsWithTags: ['type:app', 'type:util', 'type:data-access'],
    },
    {
      // Constraints AND together, so this narrows the line above
      // rather than replacing it. Three libraries carry
      // `type:data-access`: the generated client and `auth` are
      // `scope:shared`, and `web-vault` is `scope:web`. The E2E
      // project needs one enum from the generated client; it was
      // never meant to reach the vault data-access layer, and the
      // widening that let it in was broader than the import it was
      // written for. A future helper that genuinely needs a
      // `scope:web` library should land here and argue for itself.
      sourceTag: 'type:e2e',
      notDependOnLibsWithTags: ['scope:web'],
    },
    {
      sourceTag: 'type:page',
      onlyDependOnLibsWithTags: [
        'type:feature',
        'type:ui',
        'type:data-access',
        'type:domain',
        'type:util',
      ],
    },
    {
      sourceTag: 'type:feature',
      onlyDependOnLibsWithTags: [
        'type:feature',
        'type:ui',
        'type:data-access',
        'type:domain',
        'type:util',
      ],
    },
    {
      sourceTag: 'type:ui',
      onlyDependOnLibsWithTags: ['type:ui', 'type:util'],
    },
    {
      sourceTag: 'type:data-access',
      onlyDependOnLibsWithTags: [
        'type:data-access',
        'type:domain',
        'type:util',
      ],
    },
    {
      sourceTag: 'type:domain',
      onlyDependOnLibsWithTags: ['type:domain', 'type:util'],
    },
    {
      sourceTag: 'type:util',
      onlyDependOnLibsWithTags: ['type:util'],
    },
    {
      sourceTag: 'type:tooling',
      onlyDependOnLibsWithTags: ['type:util'],
    },
    // scope: shared is the only thing that crosses a platform line.
    {
      sourceTag: 'scope:web',
      onlyDependOnLibsWithTags: ['scope:web', 'scope:shared'],
    },
    {
      sourceTag: 'scope:mobile',
      onlyDependOnLibsWithTags: ['scope:mobile', 'scope:shared'],
    },
    {
      sourceTag: 'scope:backend',
      onlyDependOnLibsWithTags: ['scope:backend', 'scope:shared'],
    },
    {
      sourceTag: 'scope:shared',
      onlyDependOnLibsWithTags: ['scope:shared'],
    },
    {
      sourceTag: 'scope:tooling',
      onlyDependOnLibsWithTags: ['scope:tooling'],
    },
  ],
};

module.exports = [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/libs/app-api-client/src/**/*',
      '**/libs/api-specs/src/**/*',
      '**/dist',
      '**/storybook-static',
      'apps/backend/src/prisma/',
      'apps/backend/prisma/prisma-client',
      'apps/backend/prisma/migrations',
      // Vendored minified React runtime shipped with the agent tooling assets.
      'tools/assets/dc-runtime/**',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
    ],
  },
  {
    plugins: {
      'unused-imports': unusedImports,
    },
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@typescript-eslint/no-unused-expressions': [
        'error',
        {
          allowShortCircuit: true,
          allowTernary: true,
          allowTaggedTemplates: true,
        },
      ],
      '@nx/enforce-module-boundaries': ['error', MODULE_BOUNDARY_OPTIONS],
      'no-unused-vars': 'off', // or "@typescript-eslint/no-unused-vars": "off",
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    // Override or add rules here
    rules: {},
  },
  {
    // `.agents/skills/**` is not an Nx project, so the boundary rule reads a
    // relative import of one as reaching an external resource. Tooling reaches
    // it on purpose: a checker that validates a skill's artifacts reads them
    // with that skill's own readers rather than a second copy of the schema
    // here (`check-upstream-briefs.ts`, ADR 0084). That is the dependency
    // direction the ADR wants, so it is named as an allowed target rather than
    // worked around — and only for `tools/scripts`, so no app or library gains
    // a relative path into the skills.
    //
    // It had to be said once ADR 0135 moved the importer to `.ts`: the rule is
    // configured for `.ts`/`.js` and never saw the same imports while the file
    // was `.mjs`.
    files: ['tools/scripts/**/*.ts'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          ...MODULE_BOUNDARY_OPTIONS,
          allow: [...MODULE_BOUNDARY_OPTIONS.allow, '^.*\\.agents/skills/.*$'],
        },
      ],
    },
  },
];
