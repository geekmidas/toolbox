import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
    coverage: {
      provider: 'v8',
      exclude: [
        '**/dist/**',
        '**/node_modules/**',
        '**/*.d.ts',
        '**/examples/**',
        '**/exports/**',
      ],
      thresholds: {
        functions: 36,
        lines: 41,
        branches: 77,
      },
    },
  },
});
