import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Minimal test config (Sprint 1b-2). Tests import package sources directly; the
// alias lets cross-package imports resolve to `@chunsik/core` source without a build.
export default defineConfig({
  resolve: {
    alias: {
      '@chunsik/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/src/**/*.test.ts'],
    environment: 'node',
  },
});
