module.exports = {
  displayName: 'core',
  preset: '../../jest.preset.js',
  transform: {
    '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
    '^.+\\.[tj]sx?$': ['babel-jest', { presets: ['@nx/react/babel'] }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  coverageDirectory: '../../coverage/libs/core',
  // Pins a non-UTC timezone for every spec in this project before any Jest
  // worker touches a `Date` — see jest.global-setup.js for why this has to
  // run here rather than in a test file or `setupFiles`.
  globalSetup: '<rootDir>/jest.global-setup.js',
  passWithNoTests: true,
};
