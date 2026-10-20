import type { StorybookConfig } from '@storybook/react-vite';

import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import react from '@vitejs/plugin-react';
import { mergeConfig } from 'vite';

const config: StorybookConfig = {
  stories: [
    '../src/lib/**/*.@(mdx|stories.@(js|jsx|ts|tsx))',
    '../../vault-ui/src/lib/**/*.@(mdx|stories.@(js|jsx|ts|tsx))',
    '../../usage-locations/src/lib/**/*.@(mdx|stories.@(js|jsx|ts|tsx))',
    // Page-library components. Added for the groceries selection states, whose
    // affordance is carried by colour — the one failure mode Jest cannot see.
    '../../pages/*/src/**/*.@(mdx|stories.@(js|jsx|ts|tsx))',
  ],
  addons: ['@storybook/addon-essentials', '@storybook/addon-interactions'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },

  viteFinal: async (config) =>
    mergeConfig(config, {
      plugins: [react(), nxViteTsPaths()],
    }),
};

export default config;

// To customize your Vite configuration you can use the viteFinal field.
// Check https://storybook.js.org/docs/react/builders/vite#configuration
// and https://nx.dev/recipes/storybook/custom-builder-configs
