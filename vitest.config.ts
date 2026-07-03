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
    // apps/** added (Sprint 3d-A, ADR-0051) so the single env-reading path `apps/chunsik/src/config.ts`
    // can be tested directly (CA change 8) — the narrowest enabling change, no broad refactor.
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
    environment: 'node',
  },
});
