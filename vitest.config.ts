import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    projects: ['packages/*'],
    coverage: {
      provider: 'v8',
      exclude: [
        '**/dist/**',
        '**/node_modules/**',
        '**/*.d.ts',
        '**/examples/**',
        '**/exports/**',
        '**/.gkm/**',
      ],
      thresholds: {
        functions: 46,
        lines: 43,
        branches: 77,
      },
    },
  },
});
