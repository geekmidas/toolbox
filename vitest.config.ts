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
      include: ['packages/*/src/**/*.{ts,tsx}'],
      thresholds: {
        functions: 79,
        lines: 63,
        branches: 80,
      },
    },
  },
});
