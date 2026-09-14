import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
    fileParallelism: false, // integration suites share one database
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
