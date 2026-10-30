module.exports = {
  displayName: 'backend',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  // Binds supertest's ephemeral servers to 127.0.0.1 (issue #1169).
  setupFiles: ['<rootDir>/src/testing/supertestLoopback.ts'],
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/backend',
  // Every other *.int.test.ts mocks ../prisma; this one deliberately doesn't —
  // it runs a landed migration's real SQL against a live Postgres inside a
  // rolled-back transaction. The `Test` job carries no database (ADR 0094,
  // ADR 0140, issue #1394), so this file is excluded here and run instead as
  // its own step in the `Prisma Migration Gate` job, which still has one and
  // has already applied the migration history by the time it runs.
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/src/testing/backfillUserCreatedAt.int.test.ts',
  ],
};
