// Tests are transpiled with @swc/jest (not ts-jest): TypeScript 7's native
// compiler dropped the internal APIs ts-jest relies on. SWC only strips types
// for the runner — real type checking is enforced separately by `tsc --noEmit`.
// The `test` script runs Node with --experimental-vm-modules because PGlite (the
// in-process Postgres behind test/pglite.integration.spec.ts) loads node:fs and
// friends through dynamic import(), which Jest only allows with that flag.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.spec.ts', '**/test/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/test-utils/**/*',
    '!src/**/*.interface.{ts,tsx}',
    '!src/**/*.type.{ts,tsx}',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFiles: ['reflect-metadata'],
  transform: {
    '^.+\\.tsx?$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', decorators: true },
          transform: { decoratorMetadata: true, legacyDecorator: true },
          target: 'es2022',
        },
      },
    ],
  },
};
