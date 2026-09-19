/** @type {import('jest').Config} */
const base = require('../../jest.config.base.cjs')

module.exports = {
  ...base,
  testEnvironment: 'node',
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@open-mercato/integration-apify/(.*)$': '<rootDir>/src/$1',
    '^@open-mercato/ai-assistant/(.*)$': '<rootDir>/../ai-assistant/src/$1',
    '^@open-mercato/core/(.*)$': '<rootDir>/../core/src/$1',
    '^@open-mercato/shared/(.*)$': '<rootDir>/../shared/src/$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': [
      '<rootDir>/../../scripts/jest-mikroorm-transformer.cjs',
      { tsconfig: { rootDir: '.', ignoreDeprecations: '6.0' } },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!(@mikro-orm|apify-client|ow|got-scraping)/)'],
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  passWithNoTests: true,
}
