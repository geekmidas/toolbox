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
      ],
      thresholds: {
        functions: 80,
        lines: 80,
        branches: 80,
      },
    },
  },
});
