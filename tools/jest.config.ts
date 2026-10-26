export default {
  displayName: 'tools',
  preset: '../jest.preset.js',
  testEnvironment: 'node',
  // Only the copilot-hooks specs are Jest's. Every other suite under
  // tools/scripts is a `node --test` Contract Suite run by `yarn tools:test`
  // (ADR 0135), and once one is `*.test.ts` Jest's default pattern collects it
  // and fails to compile it under this project's CommonJS tsconfig. This
  // project is retired with the copilot-hooks migration (#1336).
  testMatch: ['<rootDir>/scripts/copilot-hooks/__tests__/**/*.spec.ts'],
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../coverage/tools',
};
